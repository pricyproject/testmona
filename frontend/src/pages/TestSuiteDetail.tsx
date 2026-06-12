import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Download,
  Edit,
  FileText,
  Folder,
  FolderMinus,
  FolderTree,
  Loader2,
  Play,
  Plus,
  Search,
  Square,
  TestTube,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { sectionsAPI, testCasesAPI, testSuitesAPI } from '@/lib/api';
import { useTestSuiteDetail, useTestSuiteSections } from '@/hooks/queries/testSuiteDetail';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';
import { TestCase, TestSuite } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { SectionTree, SectionTreeNode } from '@/components/SectionTree';

const TEST_CASES_PER_PAGE = 10;
const TEST_CASE_STATUSES = ['active', 'inactive', 'archived'] as const;
const TEST_CASE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
const SUITE_STATUSES = ['active', 'inactive', 'archived'] as const;

const normalizeTestCasesResponse = (data: unknown): TestCase[] => {
  if (Array.isArray(data)) return data as TestCase[];
  if (data && typeof data === 'object') {
    const maybeItems = (data as { items?: unknown }).items;
    if (Array.isArray(maybeItems)) return maybeItems as TestCase[];
    const maybeData = (data as { data?: unknown }).data;
    if (Array.isArray(maybeData)) return maybeData as TestCase[];
  }
  return [];
};

const sanitizeFileName = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'test-suite';

const escapeCsvCell = (value: string | null | undefined): string => {
  const str = String(value ?? '');
  // RFC 4180: wrap in quotes and double any quote inside the value.
  return `"${str.replace(/"/g, '""')}"`;
};

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const getPriorityVariant = (priority?: string | null): BadgeVariant => {
  switch (priority) {
    case 'critical':
      return 'destructive';
    case 'high':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'low':
      return 'outline';
    default:
      return 'secondary';
  }
};

const getStatusVariant = (status?: string | null): BadgeVariant => {
  switch (status) {
    case 'active':
      return 'default';
    case 'inactive':
      return 'secondary';
    case 'archived':
      return 'outline';
    default:
      return 'secondary';
  }
};

interface SectionFormState {
  name: string;
  description: string;
  parent_section_id: string;
}

const emptySectionForm: SectionFormState = {
  name: '',
  description: '',
  parent_section_id: '',
};

const flattenSectionTree = (
  nodes: SectionTreeNode[],
  parentPath = '',
): Array<{ id: number; label: string }> => {
  const out: Array<{ id: number; label: string }> = [];
  nodes.forEach((node) => {
    const label = parentPath ? `${parentPath} / ${node.name}` : node.name;
    out.push({ id: node.id, label });
    if (node.subsections?.length) out.push(...flattenSectionTree(node.subsections, label));
  });
  return out;
};

const collectSectionDescendantIds = (node: SectionTreeNode): Set<number> => {
  const ids = new Set<number>();
  const walk = (n: SectionTreeNode) => {
    ids.add(n.id);
    (n.subsections || []).forEach(walk);
  };
  walk(node);
  return ids;
};

const findSectionInTree = (
  nodes: SectionTreeNode[],
  id: number,
): SectionTreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findSectionInTree(node.subsections || [], id);
    if (found) return found;
  }
  return null;
};

function UnsectionedNode({
  count,
  isSelected,
  label,
  tooltip,
  onSelect,
}: {
  count: number;
  isSelected: boolean;
  label: string;
  tooltip: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={tooltip}
      className={`mt-2 flex w-full items-center gap-2 rounded-md border border-dashed py-2 ps-3 pe-2 text-left transition-colors ${
        isSelected
          ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30'
          : 'border-border/60 hover:bg-accent/60'
      }`}
    >
      <FolderMinus className="h-4 w-4 text-amber-600" />
      <span className="flex-1 truncate font-medium">{label}</span>
      <Badge variant="secondary" className="text-xs">
        {count}
      </Badge>
    </button>
  );
}

export function TestSuiteDetail() {
  const { projectId, id } = useParams<{ projectId: string; id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();

  const numericProjectId = useMemo(() => {
    if (!projectId) return null;
    const parsed = Number(projectId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [projectId]);

  // The URL carries the per-project sequence; resolve it to the global suite id.
  const { id: numericSuiteId, loading: suiteIdLoading } = useResolvedEntityId(projectId, 'test-suites', id);

  const [testSuite, setTestSuite] = useState<TestSuite | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Edit dialog state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ name: string; description: string; status: TestSuite['status'] }>(
    { name: '', description: '', status: 'active' },
  );
  const [editError, setEditError] = useState<string | null>(null);

  // Action loading flags
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [isBulkActionLoading, setIsBulkActionLoading] = useState(false);

  // Delete dialogs
  const [showDeleteSuiteDialog, setShowDeleteSuiteDialog] = useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);

  // Filters / pagination
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Selection
  const [selectedTestCases, setSelectedTestCases] = useState<number[]>([]);

  // Sections (folded in from former SectionManagement page)
  const [sections, setSections] = useState<SectionTreeNode[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [isSectionFormOpen, setIsSectionFormOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<SectionTreeNode | null>(null);
  const [sectionForm, setSectionForm] = useState<SectionFormState>(emptySectionForm);
  const [sectionFormErrors, setSectionFormErrors] = useState<
    Partial<Record<keyof SectionFormState, string>>
  >({});
  const [sectionFormError, setSectionFormError] = useState<string | null>(null);
  const [isSavingSection, setIsSavingSection] = useState(false);
  const [deleteSectionTarget, setDeleteSectionTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [isDeletingSection, setIsDeletingSection] = useState(false);

  // URL-driven selection so deep-links keep working after the section page was folded in.
  // 'unsectioned' is a virtual selection that scopes the test-case list to cases without
  // a section_id (the orphans that used to be invisible in the old tree).
  type SectionSelection = number | 'unsectioned' | null;

  const selectedSection: SectionSelection = useMemo(() => {
    const raw = searchParams.get('section');
    if (!raw) return null;
    if (raw === 'unsectioned') return 'unsectioned';
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const selectedSectionId = typeof selectedSection === 'number' ? selectedSection : null;
  const isUnsectionedSelected = selectedSection === 'unsectioned';

  const setSelectedSection = useCallback(
    (next: SectionSelection) => {
      const params = new URLSearchParams(searchParams);
      if (next === null) {
        params.delete('section');
      } else {
        params.set('section', String(next));
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const searchTimeoutRef = useRef<number | null>(null);

  // Debounce raw input → committed search query
  useEffect(() => {
    if (searchTimeoutRef.current !== null) {
      window.clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = window.setTimeout(() => {
      setSearchQuery(searchInput);
    }, 250);
    return () => {
      if (searchTimeoutRef.current !== null) window.clearTimeout(searchTimeoutRef.current);
    };
  }, [searchInput]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, priorityFilter, selectedSectionId, isUnsectionedSelected]);

  const detailEnabled = !suiteIdLoading && !!numericSuiteId && !!numericProjectId;
  const detailQuery = useTestSuiteDetail(numericProjectId, numericSuiteId, detailEnabled);
  const sectionsQuery = useTestSuiteSections(numericProjectId, numericSuiteId, !!numericProjectId && !!numericSuiteId);

  // Fetch via react-query, then seed local state so the page's existing
  // optimistic mutations (inline edit + rollback, bulk-delete filtering) keep
  // working unchanged. Manual reloads below become query refetches.
  const loadTestSuite = useCallback(() => detailQuery.refetch(), [detailQuery]);
  const loadSections = useCallback(() => sectionsQuery.refetch(), [sectionsQuery]);

  useEffect(() => {
    if (detailQuery.data) {
      setTestSuite(detailQuery.data.suite);
      setTestCases(normalizeTestCasesResponse(detailQuery.data.testCasesRaw));
    }
  }, [detailQuery.data]);

  useEffect(() => {
    if (suiteIdLoading) return;
    if (!numericSuiteId || !numericProjectId) {
      setError(t('testSuiteNotFound') || 'Invalid suite or project ID');
      return;
    }
    if (detailQuery.isError) {
      const status = (detailQuery.error as any)?.response?.status;
      if (status === 404) setError(t('testSuiteNotFound'));
      else if (status === 403) setError(t('permissionDeniedViewTestSuite'));
      else if (status === 401) setError(t('authenticationRequired') || t('failedToLoadTestSuiteDetail'));
      else setError(t('failedToLoadTestSuiteDetail'));
    } else if (detailQuery.isSuccess) {
      setError(null);
    }
  }, [suiteIdLoading, numericSuiteId, numericProjectId, detailQuery.status, detailQuery.isError, detailQuery.isSuccess, detailQuery.error, t]);

  const loading = (detailEnabled && detailQuery.isLoading) || (suiteIdLoading && !!numericSuiteId);

  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const sectionsLoading = sectionsQuery.isFetching;

  useEffect(() => {
    if (sectionsQuery.data) {
      setSections(sectionsQuery.data);
    }
  }, [sectionsQuery.data]);

  useEffect(() => {
    if (sectionsQuery.isError) {
      const status = (sectionsQuery.error as any)?.response?.status;
      const message =
        status === 403
          ? t('permissionDeniedViewSections') || t('failedToSaveSection')
          : t('failedToLoadSections') || t('failedToSaveSection');
      setSectionsError(message);
      setSections([]);
    } else if (sectionsQuery.isSuccess) {
      setSectionsError(null);
    }
  }, [sectionsQuery.status, sectionsQuery.isError, sectionsQuery.isSuccess, sectionsQuery.error, t]);

  // Auto-expand the path to the selected section so it's visible on load / deep-link.
  useEffect(() => {
    if (!selectedSectionId || sections.length === 0) return;
    const path: number[] = [];
    const walk = (nodes: SectionTreeNode[], trail: number[]): boolean => {
      for (const node of nodes) {
        if (node.id === selectedSectionId) {
          path.push(...trail);
          return true;
        }
        if (walk(node.subsections || [], [...trail, node.id])) return true;
      }
      return false;
    };
    walk(sections, []);
    if (path.length > 0) {
      setExpandedSections((prev) => {
        const next = new Set(prev);
        path.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [selectedSectionId, sections]);

  const selectedSectionScope = useMemo(() => {
    if (selectedSectionId === null) return null;
    const node = findSectionInTree(sections, selectedSectionId);
    if (!node) return null;
    return { node, ids: collectSectionDescendantIds(node) };
  }, [sections, selectedSectionId]);

  // Recursive (own + descendants) count per section — for the "(N total)" suffix on
  // non-leaf rows so you can see branch size without expanding every level.
  const totalCountsBySection = useMemo(() => {
    const counts: Record<number, number> = {};
    const compute = (node: SectionTreeNode): number => {
      const own = node.test_case_count || 0;
      const childTotal = (node.subsections || []).reduce(
        (sum, child) => sum + compute(child),
        0,
      );
      counts[node.id] = own + childTotal;
      return counts[node.id];
    };
    sections.forEach(compute);
    return counts;
  }, [sections]);

  // Parent chain to the currently-selected section, for the breadcrumb in the scope chip.
  const selectedBreadcrumb = useMemo(() => {
    if (selectedSectionId === null) return [] as SectionTreeNode[];
    const path: SectionTreeNode[] = [];
    const walk = (nodes: SectionTreeNode[], trail: SectionTreeNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === selectedSectionId) {
          path.push(...trail, node);
          return true;
        }
        if (walk(node.subsections || [], [...trail, node])) return true;
      }
      return false;
    };
    walk(sections, []);
    return path;
  }, [sections, selectedSectionId]);

  // Cases without a section_id — would otherwise be invisible if a user assumes the tree
  // covers everything in the suite.
  const unsectionedCount = useMemo(
    () => testCases.filter((tc) => !tc.section_id).length,
    [testCases],
  );

  // Flat list of all section ids in this suite for expand-all.
  const allSectionIds = useMemo(() => {
    const ids: number[] = [];
    const walk = (nodes: SectionTreeNode[]) => {
      nodes.forEach((n) => {
        ids.push(n.id);
        walk(n.subsections || []);
      });
    };
    walk(sections);
    return ids;
  }, [sections]);

  // Drop expanded ids for sections that no longer exist (e.g. after a delete or
  // move). Stale ids would otherwise inflate expandedSections.size and wrongly
  // disable "Expand all".
  useEffect(() => {
    setExpandedSections((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(allSectionIds);
      const next = new Set<number>();
      prev.forEach((id) => valid.has(id) && next.add(id));
      return next.size === prev.size ? prev : next;
    });
  }, [allSectionIds]);

  const filteredTestCases = useMemo(() => {
    let filtered = testCases;
    if (isUnsectionedSelected) {
      filtered = filtered.filter((tc) => !tc.section_id);
    } else if (selectedSectionScope) {
      filtered = filtered.filter(
        (tc) => tc.section_id !== undefined && selectedSectionScope.ids.has(tc.section_id),
      );
    }
    const trimmed = searchQuery.trim().toLowerCase();
    if (trimmed) {
      filtered = filtered.filter(
        (tc) =>
          tc.title.toLowerCase().includes(trimmed) ||
          (tc.description && tc.description.toLowerCase().includes(trimmed)) ||
          (tc.preconditions && tc.preconditions.toLowerCase().includes(trimmed)),
      );
    }
    if (statusFilter !== 'all') {
      filtered = filtered.filter((tc) => tc.status === statusFilter);
    }
    if (priorityFilter !== 'all') {
      filtered = filtered.filter((tc) => tc.priority === priorityFilter);
    }
    return filtered;
  }, [
    testCases,
    searchQuery,
    statusFilter,
    priorityFilter,
    selectedSectionScope,
    isUnsectionedSelected,
  ]);

  // Keep the selection scoped to what's actually visible. Without this, cases
  // selected in one section/filter stay selected after switching scope — the
  // "selected" bar would count invisible cases and a bulk delete would remove
  // them. Pagination doesn't change the filtered set, so page-to-page
  // selections are preserved.
  useEffect(() => {
    setSelectedTestCases((prev) => {
      if (prev.length === 0) return prev;
      const visible = new Set(filteredTestCases.map((tc) => tc.id));
      const next = prev.filter((id) => visible.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredTestCases]);

  const parentSectionOptions = useMemo(() => {
    const flat = flattenSectionTree(sections);
    if (!editingSection) return flat;
    const blocked = collectSectionDescendantIds(editingSection);
    return flat.filter((opt) => !blocked.has(opt.id));
  }, [sections, editingSection]);

  const paginationInfo = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredTestCases.length / TEST_CASES_PER_PAGE));
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = filteredTestCases.length > 0 ? (safePage - 1) * TEST_CASES_PER_PAGE + 1 : 0;
    const endIndex = Math.min(safePage * TEST_CASES_PER_PAGE, filteredTestCases.length);
    return { totalPages, startIndex, endIndex, safePage };
  }, [filteredTestCases, currentPage]);

  const paginatedTestCases = useMemo(() => {
    const start = (paginationInfo.safePage - 1) * TEST_CASES_PER_PAGE;
    return filteredTestCases.slice(start, start + TEST_CASES_PER_PAGE);
  }, [filteredTestCases, paginationInfo.safePage]);

  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= paginationInfo.totalPages) {
        setCurrentPage(page);
      }
    },
    [paginationInfo.totalPages],
  );

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setCurrentPage(1);
    setSelectedTestCases([]);
  }, []);

  const openEditDialog = () => {
    if (!testSuite) return;
    setEditForm({
      name: testSuite.name,
      description: testSuite.description || '',
      status: testSuite.status,
    });
    setEditError(null);
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!testSuite) return;
    const trimmedName = editForm.name.trim();
    if (!trimmedName) {
      setEditError(t('testSuiteNameRequired'));
      return;
    }
    if (trimmedName.length > 255) {
      setEditError(t('testSuiteNameLengthError'));
      return;
    }
    const trimmedDescription = editForm.description.trim();
    if (trimmedDescription.length > 1000) {
      setEditError(t('descriptionLengthError'));
      return;
    }

    const original = testSuite;
    setIsUpdating(true);
    setEditError(null);
    // Optimistic update for snappy feel; reverted on failure.
    setTestSuite({
      ...testSuite,
      name: trimmedName,
      description: trimmedDescription || undefined,
      status: editForm.status,
    });
    try {
      const updated = await testSuitesAPI.update(testSuite.id, {
        name: trimmedName,
        description: trimmedDescription || null,
        status: editForm.status,
      });
      setTestSuite(updated);
      setIsEditDialogOpen(false);
      toast({ title: t('success'), description: t('testSuiteUpdatedSuccessfully') });
    } catch (err: any) {
      setTestSuite(original);
      const detail = err?.response?.data?.detail;
      const apiMsg = typeof detail === 'string' ? detail : null;
      const status = err?.response?.status;
      const message =
        status === 403
          ? apiMsg || t('failedToUpdateTestSuite')
          : status === 404
          ? t('testSuiteNotFound')
          : apiMsg || t('failedToUpdateTestSuite');
      setEditError(message);
      toast({ title: t('error'), description: message, variant: 'destructive' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRunTestSuite = async () => {
    if (!testSuite || !numericProjectId) return;
    if (testCases.length === 0) {
      toast({ title: t('noData'), description: t('noTestCasesInSuite'), variant: 'destructive' });
      return;
    }
    setIsCreatingRun(true);
    try {
      // TestSuiteRunCreate accepts only: name, description, priority, assigned_to, estimated_duration
      const newTestRun = await testSuitesAPI.createRun(testSuite.id, {
        name: t('testRunName', { name: testSuite.name, date: new Date().toLocaleDateString() }),
        description: t('automatedTestRunDescription', { name: testSuite.name }),
        priority: 'medium',
      });
      navigate(`/projects/${numericProjectId}/test-runs/${newTestRun.id}`);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const apiMsg = typeof detail === 'string' ? detail : null;
      toast({
        title: t('error'),
        description: apiMsg || t('failedToCreateTestRun'),
        variant: 'destructive',
      });
    } finally {
      setIsCreatingRun(false);
    }
  };

  const handleExportTestSuite = async () => {
    if (!testSuite || !numericProjectId) return;
    setIsExporting(true);
    try {
      const cases = await testCasesAPI
        .getAll(numericProjectId, testSuite.id, undefined, 'id', 'asc', 0, 500)
        .then((data) => normalizeTestCasesResponse(data));

      if (cases.length === 0) {
        toast({
          title: t('noData'),
          description: t('noTestCasesToExport'),
          variant: 'destructive',
        });
        return;
      }

      const headers = ['Title', 'Description', 'Priority', 'Status', 'Preconditions', 'Steps', 'Expected Result'];
      const rows = cases.map((tc) => [
        tc.title || '',
        tc.description || '',
        tc.priority || '',
        tc.status || '',
        tc.preconditions || '',
        tc.steps || '',
        tc.expected_result || '',
      ]);
      const csv = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
      // BOM so Excel correctly detects UTF-8 (e.g. for Persian/Arabic suite content).
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `test-suite-${sanitizeFileName(testSuite.name)}-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: t('success'),
        description: t('exportedTestCasesSuccessfully', { count: cases.length }),
      });
    } catch (err: any) {
      toast({
        title: t('error'),
        description: t('failedToExportTestSuite'),
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleConfirmDeleteSuite = async () => {
    if (!testSuite || !numericProjectId) return;
    setIsDeleting(true);
    try {
      await testSuitesAPI.delete(testSuite.id);
      toast({ title: t('success'), description: t('testSuiteDeletedSuccessfullyDetail') });
      setShowDeleteSuiteDialog(false);
      navigate(`/projects/${numericProjectId}/test-suites`);
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      const apiMsg = typeof detail === 'string' ? detail : null;
      const message =
        status === 409
          ? apiMsg || t('failedToDeleteTestSuiteDetail')
          : status === 403
          ? apiMsg || t('failedToDeleteTestSuiteDetail')
          : status === 404
          ? t('testSuiteNotFound')
          : apiMsg || t('failedToDeleteTestSuiteDetail');
      toast({ title: t('error'), description: message, variant: 'destructive' });
      setShowDeleteSuiteDialog(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // ─── Section CRUD ────────────────────────────────────────────────────────
  const toggleSectionExpansion = useCallback((id: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAllSections = useCallback(() => {
    setExpandedSections(new Set(allSectionIds));
  }, [allSectionIds]);

  const collapseAllSections = useCallback(() => {
    setExpandedSections(new Set());
  }, []);

  const openCreateSection = (parent?: SectionTreeNode | null) => {
    setEditingSection(null);
    setSectionForm({
      ...emptySectionForm,
      parent_section_id: parent ? String(parent.id) : '',
    });
    setSectionFormErrors({});
    setSectionFormError(null);
    setIsSectionFormOpen(true);
  };

  const openEditSection = (section: SectionTreeNode) => {
    setEditingSection(section);
    setSectionForm({
      name: section.name,
      description: section.description || '',
      parent_section_id: section.parent_section_id ? String(section.parent_section_id) : '',
    });
    setSectionFormErrors({});
    setSectionFormError(null);
    setIsSectionFormOpen(true);
  };

  const closeSectionForm = (force = false) => {
    if (!force && isSavingSection) return;
    setIsSectionFormOpen(false);
    setEditingSection(null);
    setSectionForm(emptySectionForm);
    setSectionFormErrors({});
    setSectionFormError(null);
  };

  const validateSectionForm = (): boolean => {
    const errors: Partial<Record<keyof SectionFormState, string>> = {};
    const trimmed = sectionForm.name.trim();
    if (!trimmed) errors.name = t('sectionNameRequired');
    else if (trimmed.length > 255) errors.name = t('sectionNameTooLong');
    setSectionFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveSection = async () => {
    if (!numericSuiteId) return;
    if (!validateSectionForm()) return;
    setIsSavingSection(true);
    setSectionFormError(null);
    try {
      const payload: Record<string, unknown> = {
        name: sectionForm.name.trim(),
        description: sectionForm.description.trim() || null,
        parent_section_id: sectionForm.parent_section_id
          ? Number(sectionForm.parent_section_id)
          : null,
      };
      if (editingSection) {
        await sectionsAPI.update(editingSection.id, payload);
        toast({
          title: t('success'),
          description: t('sectionUpdatedSuccessfully', { name: sectionForm.name.trim() }),
        });
      } else {
        payload.test_suite_id = numericSuiteId;
        await sectionsAPI.create(payload);
        toast({
          title: t('success'),
          description: t('sectionCreatedSuccessfully', { name: sectionForm.name.trim() }),
        });
      }
      closeSectionForm(true);
      await loadSections();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const message = typeof detail === 'string' ? detail : t('failedToSaveSection');
      setSectionFormError(message);
    } finally {
      setIsSavingSection(false);
    }
  };

  const handleDeleteSection = async () => {
    if (!deleteSectionTarget) return;
    setIsDeletingSection(true);
    try {
      await sectionsAPI.delete(deleteSectionTarget.id);
      toast({
        title: t('success'),
        description: t('sectionDeletedSuccessfully', { name: deleteSectionTarget.name }),
      });
      if (selectedSectionId === deleteSectionTarget.id) {
        setSelectedSection(null);
      }
      setDeleteSectionTarget(null);
      await loadSections();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      const message =
        typeof detail === 'string'
          ? detail
          : status === 409
          ? t('sectionNotEmptyMoveContentFirst')
          : t('failedToDeleteSection');
      toast({ title: t('error'), description: message, variant: 'destructive' });
      setDeleteSectionTarget(null);
    } finally {
      setIsDeletingSection(false);
    }
  };

  const handleMoveSection = useCallback(
    async (sectionId: number, newParentId: number | null) => {
      try {
        await sectionsAPI.update(sectionId, { parent_section_id: newParentId });
        await loadSections();
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        toast({
          title: t('error'),
          description: typeof detail === 'string' ? detail : t('failedToMoveSection'),
          variant: 'destructive',
        });
      }
    },
    [loadSections, toast, t],
  );

  const handleInvalidMove = useCallback(
    (message: string) => {
      toast({ title: t('warning'), description: message, variant: 'destructive' });
    },
    [toast, t],
  );

  const toggleTestCaseSelection = (testCaseId: number) => {
    setSelectedTestCases((prev) =>
      prev.includes(testCaseId) ? prev.filter((tcId) => tcId !== testCaseId) : [...prev, testCaseId],
    );
  };

  const selectAllFiltered = () => {
    setSelectedTestCases(filteredTestCases.map((tc) => tc.id));
  };

  const deselectAll = () => setSelectedTestCases([]);

  const handleConfirmBulkDelete = async () => {
    if (selectedTestCases.length === 0) {
      setShowBulkDeleteDialog(false);
      return;
    }
    setIsBulkActionLoading(true);
    const targets = [...selectedTestCases];
    // Sequential settlement so a partial failure leaves the UI in a consistent state
    // (we know exactly which ids were actually deleted before updating).
    const results = await Promise.allSettled(targets.map((tcId) => testCasesAPI.delete(tcId)));
    const successIds = targets.filter((_, idx) => results[idx].status === 'fulfilled');
    const failureCount = results.length - successIds.length;

    if (successIds.length > 0) {
      setTestCases((prev) => prev.filter((tc) => !successIds.includes(tc.id)));
      setSelectedTestCases((prev) => prev.filter((tcId) => !successIds.includes(tcId)));
      // Keep the info-card total accurate (it prefers the suite's own count).
      setTestSuite((prev) =>
        prev && typeof prev.test_case_count === 'number'
          ? { ...prev, test_case_count: Math.max(0, prev.test_case_count - successIds.length) }
          : prev,
      );
      // Refresh the section tree so per-section counts reflect the deletions.
      void loadSections();
    }

    if (failureCount === 0) {
      toast({
        title: t('success'),
        description: t('testCasesDeletedSuccessfully', { count: successIds.length }),
      });
    } else if (successIds.length === 0) {
      toast({
        title: t('error'),
        description: t('failedToDeleteTestCases'),
        variant: 'destructive',
      });
    } else {
      toast({
        title: t('error'),
        description: `${successIds.length} succeeded, ${failureCount} failed.`,
        variant: 'destructive',
      });
    }

    setIsBulkActionLoading(false);
    setShowBulkDeleteDialog(false);
  };

  if (!numericProjectId || (!numericSuiteId && !suiteIdLoading)) {
    return (
      <div className={`space-y-4 ${isRTL ? 'rtl' : 'ltr'}`}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t('testSuiteNotFound')}</AlertDescription>
        </Alert>
        <Button onClick={() => navigate(`/projects/${projectId || ''}/test-suites`)}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
          {t('backToTestSuites')}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <TestTube className="mx-auto h-8 w-8 animate-spin text-blue-500" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('loadingTestSuiteDetail')}
          </h3>
        </div>
      </div>
    );
  }

  if (error || !testSuite) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <TestTube className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('testSuiteNotFound')}</h3>
          <p className="mt-1 text-sm text-gray-500">{error || t('testSuiteNotFoundDescription')}</p>
          <Button className="mt-4" onClick={() => navigate(`/projects/${numericProjectId}/test-suites`)}>
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('backToTestSuites')}
          </Button>
        </div>
      </div>
    );
  }

  const hasActiveFilters =
    !!searchInput || searchQuery !== '' || statusFilter !== 'all' || priorityFilter !== 'all';

  return (
    <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${numericProjectId}/test-suites`)}>
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('back')}
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-bold">{testSuite.name}</h1>
            <p className="text-gray-600 dark:text-gray-400">{t('testSuiteDetails')}</p>
          </div>
        </div>
        <Badge variant={testSuite.status === 'active' ? 'default' : 'secondary'}>{t(testSuite.status)}</Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('basicInformation') || 'Information'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-medium text-gray-500">{t('description')}</Label>
              <p className="mt-1 break-words">{testSuite.description || t('noDescriptionProvided')}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium text-gray-500">{t('statusLabel')}</Label>
                <p className="mt-1 capitalize">{t(testSuite.status)}</p>
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-500">{t('testCases')}</Label>
                <p className="mt-1">{testSuite.test_case_count ?? testCases.length}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
              <div className="flex items-center">
                <Calendar className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                {t('createdLabel')} {new Date(testSuite.created_at).toLocaleDateString()}
              </div>
              {testSuite.updated_at && (
                <div className="flex items-center">
                  <User className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  {t('updatedLabel')} {new Date(testSuite.updated_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('actionsLabel') || 'Actions'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" variant="default" onClick={openEditDialog} disabled={isUpdating}>
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('editTestSuite')}
            </Button>
            <Button
              className="w-full"
              variant="outline"
              onClick={handleRunTestSuite}
              disabled={isCreatingRun || testCases.length === 0}
              title={testCases.length === 0 ? t('noTestCasesInSuite') : undefined}
            >
              {isCreatingRun && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Play className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('runTestSuite')}
            </Button>
            <Button className="w-full" variant="outline" onClick={handleExportTestSuite} disabled={isExporting}>
              {isExporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('exportTestSuite')}
            </Button>
            <Button
              className="w-full"
              variant="destructive"
              onClick={() => setShowDeleteSuiteDialog(true)}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('deleteTestSuite')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-blue-600" />
            <CardTitle>{t('sections')}</CardTitle>
            {sectionsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className={`flex flex-wrap items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}>
            {allSectionIds.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={expandAllSections}
                  disabled={expandedSections.size >= allSectionIds.length}
                  title={t('expandAll')}
                >
                  <ChevronsDown className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  <span className="hidden sm:inline">{t('expandAll')}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={collapseAllSections}
                  disabled={expandedSections.size === 0}
                  title={t('collapseAll')}
                >
                  <ChevronsUp className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  <span className="hidden sm:inline">{t('collapseAll')}</span>
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => openCreateSection()}>
              <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('newSection')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sectionsError && (
            <Alert variant="destructive" className="mb-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{sectionsError}</AlertDescription>
            </Alert>
          )}
          {selectedSectionScope && (
            <div className="mb-3 flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-800 dark:bg-blue-950/40">
              {selectedBreadcrumb.length > 1 && (
                <nav
                  aria-label="section breadcrumb"
                  className="flex flex-wrap items-center gap-1 text-xs text-blue-900/80 dark:text-blue-100/80"
                >
                  {selectedBreadcrumb.map((node, idx) => {
                    const isLast = idx === selectedBreadcrumb.length - 1;
                    return (
                      <span key={node.id} className="flex items-center gap-1">
                        {isLast ? (
                          <span className="font-medium">{node.name}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedSection(node.id)}
                            className="hover:underline"
                          >
                            {node.name}
                          </button>
                        )}
                        {!isLast && <ChevronRight className="h-3 w-3 opacity-60" />}
                      </span>
                    );
                  })}
                </nav>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <Folder className="h-4 w-4 shrink-0 text-blue-600" />
                  <span className="truncate font-medium">
                    {t('scopedToSection', { name: selectedSectionScope.node.name })}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedSection(null)}
                  className="h-7 px-2 text-xs"
                >
                  <X className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  {t('clearSelection')}
                </Button>
              </div>
              {selectedSectionScope.node.description && (
                <p className="text-xs text-blue-900/80 dark:text-blue-100/80">
                  {selectedSectionScope.node.description}
                </p>
              )}
            </div>
          )}
          {isUnsectionedSelected && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <span className="flex min-w-0 items-center gap-2 truncate">
                <FolderMinus className="h-4 w-4 shrink-0 text-amber-600" />
                <span className="truncate font-medium">{t('scopedToUnsectioned')}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedSection(null)}
                className="h-7 px-2 text-xs"
              >
                <X className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                {t('clearSelection')}
              </Button>
            </div>
          )}
          <SectionTree
            suiteId={numericSuiteId}
            sections={sections}
            selectedId={selectedSectionId}
            expanded={expandedSections}
            emptyLabel={t('noSectionsYetForSuite')}
            rootDropHint={t('dropHereToMoveToRoot')}
            invalidMoveMessage={t('sectionCannotMoveBetweenSuites')}
            cycleMoveMessage={t('sectionCannotMoveIntoDescendant')}
            totalCounts={totalCountsBySection}
            onToggle={toggleSectionExpansion}
            onSelect={setSelectedSection}
            onEdit={openEditSection}
            onDelete={(section) =>
              setDeleteSectionTarget({ id: section.id, name: section.name })
            }
            onAddChild={(section) => openCreateSection(section)}
            onMove={handleMoveSection}
            onInvalidMove={handleInvalidMove}
            extraNodes={
              unsectionedCount > 0 ? (
                <UnsectionedNode
                  count={unsectionedCount}
                  isSelected={isUnsectionedSelected}
                  label={t('unsectioned')}
                  tooltip={t('unsectionedTooltip')}
                  onSelect={() =>
                    setSelectedSection(isUnsectionedSelected ? null : 'unsectioned')
                  }
                />
              ) : null
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('testCasesCount', { count: filteredTestCases.length })}</CardTitle>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search
                  className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 ${isRTL ? 'right-3' : 'left-3'}`}
                />
                <Input
                  value={searchInput}
                  placeholder={t('searchTestCasesPlaceholder')}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className={isRTL ? 'pr-10' : 'pl-10'}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue placeholder={t('statusLabel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allStatus')}</SelectItem>
                  {TEST_CASE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue placeholder={t('priority')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allPriority')}</SelectItem>
                  {TEST_CASE_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllFiltered}
                  disabled={filteredTestCases.length === 0}
                >
                  <CheckSquare className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  {t('selectAllCount', { count: filteredTestCases.length })}
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll} disabled={selectedTestCases.length === 0}>
                  <Square className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  {t('deselectAll')}
                </Button>
                {selectedTestCases.length > 0 && (
                  <>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t('selectedCount', { count: selectedTestCases.length })}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowBulkDeleteDialog(true)}
                      disabled={isBulkActionLoading}
                    >
                      {isBulkActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                      {t('deleteSelected')}
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
              <div>
                {filteredTestCases.length > 0 ? (
                  paginationInfo.totalPages > 1 ? (
                    <span>
                      {t('showingTestCasesRange', {
                        start: paginationInfo.startIndex,
                        end: paginationInfo.endIndex,
                        total: filteredTestCases.length,
                      })}
                    </span>
                  ) : (
                    <span>{t('testCasesCountSimple', { count: filteredTestCases.length })}</span>
                  )
                ) : (
                  <span>{t('noTestCasesFound')}</span>
                )}
                {filteredTestCases.length !== testCases.length && filteredTestCases.length > 0 && (
                  <span className="ml-2">{t('filteredFromTotal', { total: testCases.length })}</span>
                )}
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs">
                  {t('clearFilters')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTestCases.length === 0 ? (
            <div className="py-8 text-center">
              <TestTube className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {testCases.length === 0 ? t('noTestCases') : t('noMatchingTestCases')}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {testCases.length === 0 ? t('noTestCasesInSuite') : t('tryAdjustingSearchFilters')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedTestCases.map((testCase) => (
                <div
                  key={testCase.id}
                  className="rounded-lg border p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Checkbox
                        checked={selectedTestCases.includes(testCase.id)}
                        onCheckedChange={() => toggleTestCaseSelection(testCase.id)}
                        className="mt-1 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                          <h4 className="truncate font-medium text-gray-900 dark:text-white">{testCase.title}</h4>
                        </div>
                        {testCase.description && (
                          <p className="mb-3 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                            {testCase.description}
                          </p>
                        )}
                        {testCase.preconditions && (
                          <div className="mb-2 line-clamp-1 text-xs text-gray-500 dark:text-gray-500">
                            <span className="font-medium">{t('preconditions')}</span> {testCase.preconditions}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getStatusVariant(testCase.status)} className="text-xs">
                            {t(testCase.status)}
                          </Badge>
                          <Badge variant={getPriorityVariant(testCase.priority)} className="text-xs">
                            {t(testCase.priority)}
                          </Badge>
                          {testCase.tags &&
                            testCase.tags
                              .split(',')
                              .map((tag) => tag.trim())
                              .filter(Boolean)
                              .map((tag) => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                        </div>
                      </div>
                    </div>

                    <div className="ml-4 flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/projects/${numericProjectId}/test-cases/${testCase.id}`)}
                      >
                        {t('viewDetails')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {paginationInfo.totalPages > 1 && (
                <div className="flex items-center justify-between border-t pt-4">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {t('showingTestCasesRange', {
                      start: paginationInfo.startIndex,
                      end: paginationInfo.endIndex,
                      total: filteredTestCases.length,
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(paginationInfo.safePage - 1)}
                      disabled={paginationInfo.safePage === 1}
                      className="h-8 w-8 p-0"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, paginationInfo.totalPages) }, (_, i) => {
                        let pageNum: number;
                        if (paginationInfo.totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (paginationInfo.safePage <= 3) {
                          pageNum = i + 1;
                        } else if (paginationInfo.safePage >= paginationInfo.totalPages - 2) {
                          pageNum = paginationInfo.totalPages - 4 + i;
                        } else {
                          pageNum = paginationInfo.safePage - 2 + i;
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={paginationInfo.safePage === pageNum ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handlePageChange(pageNum)}
                            className="h-8 w-8 p-0 text-xs"
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(paginationInfo.safePage + 1)}
                      disabled={paginationInfo.safePage === paginationInfo.totalPages}
                      className="h-8 w-8 p-0"
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => (isUpdating ? null : setIsEditDialogOpen(open))}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t('editTestSuite')}</DialogTitle>
            <DialogDescription>{t('makeChangesToTestSuite')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="suite-name">
                {t('nameLabel')} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="suite-name"
                value={editForm.name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('enterTestSuiteName')}
                maxLength={255}
                autoComplete="off"
              />
              <p className="text-right text-xs text-muted-foreground">{editForm.name.length}/255</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="suite-description">{t('description')}</Label>
              <Textarea
                id="suite-description"
                value={editForm.description}
                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={t('enterTestSuiteDescription')}
                rows={4}
                maxLength={1000}
              />
              <p className="text-right text-xs text-muted-foreground">{editForm.description.length}/1000</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t('statusLabel')}</Label>
              <Select
                value={editForm.status}
                onValueChange={(value) =>
                  setEditForm((prev) => ({ ...prev, status: value as TestSuite['status'] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUITE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isUpdating}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editForm.name.trim() || isUpdating}>
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete suite confirmation */}
      <Dialog
        open={showDeleteSuiteDialog}
        onOpenChange={(open) => (isDeleting ? null : setShowDeleteSuiteDialog(open))}
      >
        <DialogContent isRTL={isRTL} className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              {t('deleteTestSuite')}
            </DialogTitle>
            <DialogDescription className="pt-1">
              {t('areYouSureToDeleteSuiteWithCases', { name: testSuite.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteSuiteDialog(false)} disabled={isDeleting}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteSuite} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('deleting')}
                </>
              ) : (
                <>
                  <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('delete')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Section create/edit dialog */}
      <Dialog
        open={isSectionFormOpen}
        onOpenChange={(open) => {
          if (!open) closeSectionForm();
        }}
      >
        <DialogContent isRTL={isRTL} className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {editingSection ? t('editSection') : t('createNewSection')}
            </DialogTitle>
            <DialogDescription>
              {editingSection ? t('editSectionDescription') : t('createSectionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="section-name">
                {t('sectionNameLabel')} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="section-name"
                value={sectionForm.name}
                maxLength={255}
                placeholder={t('enterSectionName')}
                onChange={(e) => {
                  setSectionForm((p) => ({ ...p, name: e.target.value }));
                  if (sectionFormErrors.name)
                    setSectionFormErrors((p) => ({ ...p, name: undefined }));
                }}
                className={sectionFormErrors.name ? 'border-red-400 focus-visible:ring-red-300' : ''}
              />
              {sectionFormErrors.name && (
                <p className="text-xs text-red-500">{sectionFormErrors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="section-desc">{t('description')}</Label>
              <Textarea
                id="section-desc"
                value={sectionForm.description}
                placeholder={t('enterSectionDescription')}
                rows={3}
                onChange={(e) =>
                  setSectionForm((p) => ({ ...p, description: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('parentSectionOptional')}</Label>
              <Select
                value={sectionForm.parent_section_id || 'root'}
                onValueChange={(value) =>
                  setSectionForm((p) => ({
                    ...p,
                    parent_section_id: value === 'root' ? '' : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('rootLevel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">{t('rootLevel')}</SelectItem>
                  {parentSectionOptions.map((opt) => (
                    <SelectItem key={opt.id} value={String(opt.id)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingSection && (
                <p className="text-xs text-muted-foreground">
                  {t('descendantsHiddenToPreventCycle')}
                </p>
              )}
            </div>

            {sectionFormError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{sectionFormError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => closeSectionForm()}
              disabled={isSavingSection}
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSaveSection}
              disabled={isSavingSection || !sectionForm.name.trim()}
            >
              {isSavingSection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingSection ? t('saveChanges') : t('createSection')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Section delete confirmation */}
      <Dialog
        open={!!deleteSectionTarget}
        onOpenChange={(open) => {
          if (!open && !isDeletingSection) setDeleteSectionTarget(null);
        }}
      >
        <DialogContent isRTL={isRTL} className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('deleteSection')}
            </DialogTitle>
            <DialogDescription className="pt-1">
              {t('areYouSureToDeleteSection', { name: deleteSectionTarget?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteSectionTarget(null)}
              disabled={isDeletingSection}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSection}
              disabled={isDeletingSection}
            >
              {isDeletingSection ? (
                <>
                  <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('deleting')}
                </>
              ) : (
                <>
                  <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('delete')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk-delete test cases confirmation */}
      <Dialog
        open={showBulkDeleteDialog}
        onOpenChange={(open) => (isBulkActionLoading ? null : setShowBulkDeleteDialog(open))}
      >
        <DialogContent isRTL={isRTL} className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              {t('deleteSelected')}
            </DialogTitle>
            <DialogDescription className="pt-1">
              {t('areYouSureToDeleteTestCases', { count: selectedTestCases.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDeleteDialog(false)} disabled={isBulkActionLoading}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleConfirmBulkDelete} disabled={isBulkActionLoading}>
              {isBulkActionLoading ? (
                <>
                  <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('deleting')}
                </>
              ) : (
                <>
                  <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('delete')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
