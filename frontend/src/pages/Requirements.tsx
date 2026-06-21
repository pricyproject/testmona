import { useCallback, useMemo, useState, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, Search, ChevronLeft, ChevronRight, Edit, Trash2, Download, Upload, FileCode, Eye, Users, Clock, CheckCircle, AlertCircle, XCircle, AlertTriangle, ExternalLink, Wand2, ArrowUpDown, ArrowUp, ArrowDown, Bookmark, BookmarkPlus, Star, X, ListChecks, ShieldCheck, ShieldAlert, ShieldX, Loader2, Tag, Sparkles, Copy, Check, Link2, LayoutGrid, Table2, MoreHorizontal, Folder, FolderPlus, FolderOpen, FolderInput, Inbox, Pencil, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { requirementsAPI, bulkAPI, savedFiltersAPI, SavedFilter, requirementFoldersAPI } from '@/lib/api';
import { useRequirementsList, useRequirementFolders } from '@/hooks/queries/requirements';
import { entitySeq } from '@/lib/utils';
import { Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageItem, RequirementCoverageStatus, RequirementFolder } from '@/types';
import { RequirementChatPanel } from '@/components/requirements/RequirementChatPanel';
import { TestCaseSearchBar, SearchSuggestionGroup } from '@/components/TestCases/TestCaseSearchBar';
import { parseRequirementQuery, requirementMatchesQuery } from '@/components/requirements/requirementsSearchQuery';
import { useAuthStore } from '@/stores/authStore';
import { canWriteResults } from '@/utils/roles';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { ContentEditor, htmlToMarkdown, markdownToHtml } from '@/components/ui/content-editor';
import { GherkinEditor } from '@/components/requirements/GherkinEditor';
import { isGherkinText } from '@/components/requirements/gherkin';
import { decodeEntitiesDeep, htmlToReadableText, isHtmlMarkup, richTextToMarkdownForEdit } from '@/components/requirements/richText';
import { diffWords } from 'diff';
import { sanitizeHtml } from '@/lib/sanitize';

const parsePositiveQueryNumber = (value: string | null): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export function Requirements() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();
  const { formatDate: fmtDate, formatDateTime } = useDateFormat();
  const { user } = useAuthStore();
  const linkedMilestoneId = parsePositiveQueryNumber(searchParams.get('milestone_id'));
  const numericProjectId = projectId ? parseInt(projectId) : null;
  // Requirements/folders are project planning artifacts: testers can create/edit
  // (write) but deletion is a manager+ action.
  const { canManageProject } = useProjectPermissions(numericProjectId);
  const requirementsQuery = useRequirementsList(numericProjectId, linkedMilestoneId, numericProjectId != null);
  const foldersQuery = useRequirementFolders(numericProjectId, numericProjectId != null);
  const requirements: Requirement[] = requirementsQuery.data?.requirements ?? [];
  const coverageMap: Record<number, RequirementCoverageItem> = requirementsQuery.data?.coverageMap ?? {};
  const folders: RequirementFolder[] = foldersQuery.data ?? [];
  const loading = numericProjectId != null && requirementsQuery.isLoading;
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRequirement, setSelectedRequirement] = useState<Requirement | null>(null);
  const [requirementToDelete, setRequirementToDelete] = useState<Requirement | null>(null);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>(() => {
    try {
      return localStorage.getItem('requirements-view-mode') === 'grid' ? 'grid' : 'table';
    } catch {
      return 'table';
    }
  });

  // ── Folders / categories ────────────────────────────────────────────────
  const [selectedFolder, setSelectedFolder] = useState<'all' | 'unfiled' | number>('all');
  // Folder sidebar starts collapsed by default; the choice is remembered.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem('requirements-sidebar-collapsed');
      return stored == null ? true : stored === 'true';
    } catch {
      return true;
    }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('requirements-sidebar-collapsed', String(next));
      } catch {
        // ignore persistence failures (private mode, etc.)
      }
      return next;
    });
  };
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState<'create' | 'edit'>('create');
  const [editingFolder, setEditingFolder] = useState<RequirementFolder | null>(null);
  const [folderForm, setFolderForm] = useState<{ name: string; parent_folder_id: string }>({ name: '', parent_folder_id: 'root' });
  const [folderSaving, setFolderSaving] = useState(false);
  const [reqFolderId, setReqFolderId] = useState<string>('none');

  // Sorting
  const [sortBy, setSortBy] = useState<'requirement_id' | 'title' | 'status' | 'priority' | 'created_at' | 'coverage'>('requirement_id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Gherkin .feature import
  const featureFileInputRef = useRef<HTMLInputElement>(null);
  const [isImportingFeatures, setIsImportingFeatures] = useState(false);
  // Bulk selection + actions
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [showBulkTagInput, setShowBulkTagInput] = useState(false);
  // Saved views
  const [savedViews, setSavedViews] = useState<SavedFilter[]>([]);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [isSaveViewOpen, setIsSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewShared, setViewShared] = useState(false);
  const [viewDefault, setViewDefault] = useState(false);
  const [savingView, setSavingView] = useState(false);

  // Form states
  const [reqTitle, setReqTitle] = useState('');
  const [reqDescription, setReqDescription] = useState('');
  const [reqId, setReqId] = useState('');
  const [reqPriority, setReqPriority] = useState('medium');
  const [reqStatus, setReqStatus] = useState('draft');
  const [reqAcceptanceCriteria, setReqAcceptanceCriteria] = useState('');
  const [reqTags, setReqTags] = useState('');
  const [reqEstimatedEffort, setReqEstimatedEffort] = useState('');
  const [useGherkinSyntax, setUseGherkinSyntax] = useState(false);
  const [externalDocumentUrl, setExternalDocumentUrl] = useState('');
  const [importSource, setImportSource] = useState<'atlassian' | 'asana' | 'linear' | 'monday'>('atlassian');
  const [isFetchingDocument, setIsFetchingDocument] = useState(false);
  const [showExternalImport, setShowExternalImport] = useState(false);
  const [showAdvancedRequirementTools, setShowAdvancedRequirementTools] = useState(false);
  const [initialFormState, setInitialFormState] = useState<any>(null);
  const draftSaveTimeoutRef = useRef<number | null>(null);
  const [contentVersions, setContentVersions] = useState<Array<{ id: string; createdAt: string; description: string; acceptance: string }>>([]);
  const [compareFromId, setCompareFromId] = useState<string>('');
  const [compareToId, setCompareToId] = useState<string>('');

  const getPlainTextLength = (html: string): number =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().length;
  
  const toPlain = (html: string): string =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Requirement description/acceptance is stored as rich-text HTML, sometimes
  // escaped or double-escaped. Decode it, then show only readable text in the
  // list/export views so wrapper tags like <p> are not displayed.
  const toDisplayText = (value?: string | null): string => {
    if (!value) return '';
    const decodeHtmlEntities = (input: string): string => {
      const namedEntities: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      };

      return input.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
        if (entity.startsWith('#x') || entity.startsWith('#X')) {
          const codePoint = Number.parseInt(entity.slice(2), 16);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }

        if (entity.startsWith('#')) {
          const codePoint = Number.parseInt(entity.slice(1), 10);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }

        return namedEntities[entity] ?? match;
      });
    };

    const decoded = decodeHtmlEntities(decodeHtmlEntities(value));
    if (!/<[a-z][\s\S]*>/i.test(decoded)) {
      return decoded.replace(/\s+/g, ' ').trim();
    }

    const htmlForText = decoded
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote|section)\s*>/gi, '\n');

    if (typeof window === 'undefined') {
      return htmlForText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const parsed = new DOMParser().parseFromString(htmlForText, 'text/html');
    return (parsed.body.textContent || decoded).replace(/\s+/g, ' ').trim();
  };

  const gherkinTemplate = [
    'Feature: ',
    '',
    '  Scenario: ',
    '    Given ',
    '    When ',
    '    Then ',
  ].join('\n');

  const gherkinBackgroundTemplate = ['  Background:', '    Given '].join('\n');
  const gherkinScenarioOutlineTemplate = [
    '  Scenario Outline: ',
    '    Given ',
    '    When ',
    '    Then ',
    '',
    '    Examples:',
    '      | input | result |',
    '      | value | expected |',
  ].join('\n');

  // Host allow-list per import source. Matching on host only — matching the
  // path let through URLs like https://evil.com/jira. The backend remains the
  // authoritative gate.
  const isValidImportUrl = (value: string, source: typeof importSource): boolean => {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      const host = parsed.hostname.toLowerCase();
      switch (source) {
        case 'atlassian':
          return host.endsWith('.atlassian.net') || /(^|\.)(jira|confluence)(\.|$)/.test(host);
        case 'asana':
          return host === 'asana.com' || host.endsWith('.asana.com');
        case 'linear':
          return host === 'linear.app' || host.endsWith('.linear.app');
        case 'monday':
          return host === 'monday.com' || host.endsWith('.monday.com');
        default:
          return false;
      }
    } catch {
      return false;
    }
  };

  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const buildExternalDocumentText = (documentData: any, currentDescription: string): string => {
    const sourceType = String(documentData.source_type || 'external').toLowerCase();
    const sourceHeadings: Record<string, string> = {
      confluence: t('confluenceDocument'),
      jira: t('jiraDocument'),
      asana: t('asanaTask'),
      linear: t('linearIssue'),
      monday: t('mondayItem'),
    };
    const heading = sourceHeadings[sourceType] || t('jiraDocument');
    const sourceUrl = String(documentData.url || '');
    const documentText = [
      `<section data-requirement-source="true" data-requirement-source-url="${escapeHtml(sourceUrl)}">`,
      `<h2>${escapeHtml(`${heading}: ${documentData.title || t('untitledDocument')}`)}</h2>`,
      documentData.external_key ? `<p><strong>Key:</strong> ${escapeHtml(String(documentData.external_key))}</p>` : '',
      `<p><strong>Source:</strong> <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a></p>`,
      `<pre>${escapeHtml(documentData.description || '')}</pre>`,
      '</section>',
    ].filter(Boolean).join('');

    const existing = currentDescription.trim();
    if (!existing) return documentText;
    if (/data-requirement-source-url=/i.test(existing)) return documentText;
    return `${existing}<hr />${documentText}`;
  };

  const insertGherkinSnippet = (snippet: string) => {
    setReqAcceptanceCriteria((current) => current.trim() ? `${current.trim()}\n\n${snippet}` : snippet);
  };

  const buildDiffHtml = (from: string, to: string): string => {
    const parts = diffWords(toPlain(from), toPlain(to));
    return parts
      .map((part) => {
        const escaped = part.value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        if (part.added) return `<span style="background:#dcfce7;color:#166534;">${escaped}</span>`;
        if (part.removed) return `<span style="background:#fee2e2;color:#991b1b;text-decoration:line-through;">${escaped}</span>`;
        return `<span>${escaped}</span>`;
      })
      .join('');
  };

  const saveVersionSnapshot = () => {
    const snapshot = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      description: reqDescription,
      acceptance: reqAcceptanceCriteria,
    };
    setContentVersions((previous) => [snapshot, ...previous].slice(0, 30));
    setCompareFromId(snapshot.id);
  };

  // Requirements + coverage and folders are fetched via react-query (above).
  // These wrappers let the existing mutation handlers trigger a refetch.
  const loadRequirements = useCallback(async () => {
    await requirementsQuery.refetch();
  }, [requirementsQuery]);

  // Surface a list-load failure as a toast (parity with the previous loader).
  useEffect(() => {
    if (requirementsQuery.isError) {
      toast({
        title: t('error'),
        description: t('failedToLoadRequirements'),
        variant: 'destructive',
      });
    }
  }, [requirementsQuery.isError, t, toast]);

  // ── Folders: load, tree helpers, CRUD ───────────────────────────────────
  const loadFolders = useCallback(async () => {
    await foldersQuery.refetch();
  }, [foldersQuery]);

  // If the active folder filter no longer exists (deleted elsewhere), fall back
  // to "all" so the list never gets stuck showing an empty, unfilterable view.
  useEffect(() => {
    if (typeof selectedFolder === 'number' && folders.length > 0 && !folders.some((f) => f.id === selectedFolder)) {
      setSelectedFolder('all');
    }
  }, [folders, selectedFolder]);

  // Ids of a folder plus all its descendants — for scoping the list to a branch.
  const folderDescendantIds = useCallback((rootId: number): Set<number> => {
    const ids = new Set<number>([rootId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) {
        if (f.parent_folder_id != null && ids.has(f.parent_folder_id) && !ids.has(f.id)) {
          ids.add(f.id);
          added = true;
        }
      }
    }
    return ids;
  }, [folders]);

  // Flattened tree (depth-annotated) for indented rendering and select options.
  const folderTree = useMemo(() => {
    const byParent = new Map<number | null, RequirementFolder[]>();
    for (const f of folders) {
      const key = f.parent_folder_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(f);
    }
    const out: Array<{ folder: RequirementFolder; depth: number }> = [];
    const walk = (parent: number | null, depth: number) => {
      for (const f of (byParent.get(parent) || [])) {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders]);

  // Recursive count (folder + descendants) for the rail badges.
  const folderTotalCounts = useMemo(() => {
    const direct: Record<number, number> = {};
    for (const f of folders) direct[f.id] = f.requirement_count;
    const childrenOf = new Map<number, number[]>();
    for (const f of folders) {
      if (f.parent_folder_id != null) {
        if (!childrenOf.has(f.parent_folder_id)) childrenOf.set(f.parent_folder_id, []);
        childrenOf.get(f.parent_folder_id)!.push(f.id);
      }
    }
    const memo: Record<number, number> = {};
    const compute = (id: number, visiting: Set<number>): number => {
      if (memo[id] != null) return memo[id];
      if (visiting.has(id)) return direct[id] || 0; // guard against malformed cycles
      visiting.add(id);
      let sum = direct[id] || 0;
      for (const child of (childrenOf.get(id) || [])) sum += compute(child, visiting);
      visiting.delete(id);
      memo[id] = sum;
      return sum;
    };
    for (const f of folders) compute(f.id, new Set());
    return memo;
  }, [folders]);

  const unfiledCount = useMemo(() => requirements.filter((r) => r.folder_id == null).length, [requirements]);

  // Parent-folder choices for the folder dialog. When editing, a folder cannot
  // be moved under itself or one of its descendants (would create a cycle).
  const folderParentOptions = useMemo(() => {
    if (folderDialogMode !== 'edit' || !editingFolder) return folderTree;
    const blocked = folderDescendantIds(editingFolder.id);
    return folderTree.filter(({ folder }) => !blocked.has(folder.id));
  }, [folderTree, folderDialogMode, editingFolder, folderDescendantIds]);

  const openCreateFolder = (parent?: RequirementFolder | null) => {
    setFolderDialogMode('create');
    setEditingFolder(null);
    setFolderForm({ name: '', parent_folder_id: parent ? String(parent.id) : 'root' });
    setFolderDialogOpen(true);
  };

  const openEditFolder = (folder: RequirementFolder) => {
    setFolderDialogMode('edit');
    setEditingFolder(folder);
    setFolderForm({ name: folder.name, parent_folder_id: folder.parent_folder_id ? String(folder.parent_folder_id) : 'root' });
    setFolderDialogOpen(true);
  };

  const handleSaveFolder = async () => {
    if (!projectId || !folderForm.name.trim()) return;
    const parentId = folderForm.parent_folder_id === 'root' ? null : Number(folderForm.parent_folder_id);
    try {
      setFolderSaving(true);
      if (folderDialogMode === 'edit' && editingFolder) {
        await requirementFoldersAPI.update(editingFolder.id, { name: folderForm.name.trim(), parent_folder_id: parentId });
      } else {
        await requirementFoldersAPI.create({ project_id: parseInt(projectId), name: folderForm.name.trim(), parent_folder_id: parentId });
      }
      setFolderDialogOpen(false);
      loadFolders();
    } catch (error: any) {
      toast({ title: t('error'), description: error.response?.data?.detail || t('folderSaveFailed'), variant: 'destructive' });
    } finally {
      setFolderSaving(false);
    }
  };

  const handleDeleteFolder = async (folder: RequirementFolder) => {
    if (!window.confirm(t('deleteFolderConfirm', { name: folder.name }))) return;
    try {
      await requirementFoldersAPI.remove(folder.id);
      if (selectedFolder === folder.id) setSelectedFolder('all');
      loadFolders();
      loadRequirements();
    } catch (error: any) {
      toast({ title: t('error'), description: error.response?.data?.detail || t('folderDeleteFailed'), variant: 'destructive' });
    }
  };

  const handleBulkMoveToFolder = async (folderId: number | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    // Settle individually so one bad id (e.g. concurrently deleted) doesn't
    // abort the rest; report exactly what moved.
    const results = await Promise.allSettled(ids.map((id) => requirementsAPI.update(id, { folder_id: folderId })));
    const moved = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - moved;
    setBulkBusy(false);
    if (moved > 0) {
      clearSelection();
      loadRequirements();
      loadFolders();
    }
    if (failed === 0) {
      toast({ title: t('success'), description: t('bulkMovedToFolder', { count: moved }) });
    } else if (moved === 0) {
      toast({ title: t('error'), description: t('bulkUpdateFailed'), variant: 'destructive' });
    } else {
      toast({ title: t('error'), description: `${moved} moved, ${failed} failed.`, variant: 'destructive' });
    }
  };

  // Parse the search box into structured terms + key:value filters once per
  // keystroke; the per-row matcher then stays cheap as the list scales.
  const parsedSearchQuery = useMemo(() => parseRequirementQuery(searchQuery), [searchQuery]);

  // Filtering logic
  const filteredRequirements = requirements.filter(req => {
    if (!requirementMatchesQuery(req, parsedSearchQuery)) return false;

    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || req.priority === priorityFilter;

    const matchesFolder =
      selectedFolder === 'all'
        ? true
        : selectedFolder === 'unfiled'
          ? req.folder_id == null
          : req.folder_id != null && folderDescendantIds(selectedFolder).has(req.folder_id);

    return matchesStatus && matchesPriority && matchesFolder;
  });

  // Workflow / severity orderings so status & priority sort meaningfully
  // rather than alphabetically.
  const statusRank: Record<string, number> = { draft: 1, reviewed: 2, approved: 3, implemented: 4, verified: 5, deprecated: 6 };
  const priorityRank: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

  const sortedRequirements = useMemo(() => {
    const arr = [...filteredRequirements];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let cmp: number;
      switch (sortBy) {
        case 'title':
          cmp = (a.title || '').localeCompare(b.title || '');
          break;
        case 'status':
          cmp = (statusRank[a.status] || 0) - (statusRank[b.status] || 0);
          break;
        case 'priority':
          cmp = (priorityRank[a.priority] || 0) - (priorityRank[b.priority] || 0);
          break;
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'coverage':
          cmp = (coverageMap[a.id]?.linked_count || 0) - (coverageMap[b.id]?.linked_count || 0);
          break;
        case 'requirement_id':
        default:
          cmp = (a.requirement_id || '').localeCompare(b.requirement_id || '', undefined, { numeric: true });
      }
      return cmp * dir;
    });
    return arr;
  }, [filteredRequirements, sortBy, sortDir, coverageMap]);

  const totalPages = Math.max(1, Math.ceil(sortedRequirements.length / itemsPerPage));
  // Clamp so a stale page index (e.g. after filtering) never yields an empty slice.
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safePage - 1) * itemsPerPage;
  const paginatedRequirements = sortedRequirements.slice(startIndex, startIndex + itemsPerPage);

  // ---- Bulk selection helpers -------------------------------------------
  const pageIds = paginatedRequirements.map((req) => req.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Reset to the first page whenever the active filters or sort change.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, priorityFilter, sortBy, sortDir, itemsPerPage, selectedFolder]);

  // Drop selections that are no longer present (e.g. after delete/filter).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(requirements.map((req) => req.id));
      const next = new Set(Array.from(prev).filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [requirements]);

  // ---- Bulk actions ------------------------------------------------------
  const runBulkUpdate = async (payload: { status?: string; priority?: string; add_tags?: string }) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      setBulkBusy(true);
      const result = await bulkAPI.requirements({ ids, ...payload });
      toast({ title: t('success'), description: t('bulkUpdated', { count: result.updated }) });
      clearSelection();
      loadRequirements();
    } catch (error: any) {
      toast({ title: t('error'), description: error.response?.data?.detail || t('bulkUpdateFailed'), variant: 'destructive' });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkAddTag = () => {
    const tag = bulkTagInput.trim();
    setShowBulkTagInput(false);
    setBulkTagInput('');
    if (tag) runBulkUpdate({ add_tags: tag });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      setBulkBusy(true);
      const result = await bulkAPI.deleteRequirements({ ids });
      toast({ title: t('success'), description: t('bulkDeleted', { count: result.updated }) });
      clearSelection();
      setIsBulkDeleteOpen(false);
      loadRequirements();
    } catch (error: any) {
      toast({ title: t('error'), description: error.response?.data?.detail || t('bulkDeleteFailed'), variant: 'destructive' });
    } finally {
      setBulkBusy(false);
    }
  };

  // ---- Saved views -------------------------------------------------------
  const loadSavedViews = useCallback(async () => {
    if (!projectId) return;
    try {
      const views = await savedFiltersAPI.list(parseInt(projectId), 'requirements');
      setSavedViews(views);
      // Auto-apply the user's default view on first load only.
      const def = views.find((v) => v.is_default);
      if (def) {
        setActiveViewId((current) => {
          if (current !== null) return current;
          const d = def.definition || {};
          setSearchQuery(d.search || '');
          setStatusFilter(d.status || 'all');
          setPriorityFilter(d.priority || 'all');
          if (d.sortBy) setSortBy(d.sortBy);
          if (d.sortDir) setSortDir(d.sortDir);
          return def.id;
        });
      }
    } catch {
      // Saved views are non-critical; ignore load failures silently.
    }
  }, [projectId]);

  useEffect(() => {
    loadSavedViews();
  }, [loadSavedViews]);

  // Deactivate the "active view" indicator once the live filters no longer match
  // the saved definition — otherwise the chip and highlighted Views button keep
  // claiming a view is applied after the user edits search/status/priority/sort.
  useEffect(() => {
    if (activeViewId == null) return;
    const view = savedViews.find((v) => v.id === activeViewId);
    if (!view) return;
    const d = view.definition || {};
    const matches =
      (d.search || '') === searchQuery &&
      (d.status || 'all') === statusFilter &&
      (d.priority || 'all') === priorityFilter &&
      (d.sortBy || 'requirement_id') === sortBy &&
      (d.sortDir || 'asc') === sortDir;
    if (!matches) setActiveViewId(null);
  }, [searchQuery, statusFilter, priorityFilter, sortBy, sortDir, activeViewId, savedViews]);

  const currentViewDefinition = () => ({
    search: searchQuery,
    status: statusFilter,
    priority: priorityFilter,
    sortBy,
    sortDir,
  });

  const applyView = (view: SavedFilter) => {
    const d = view.definition || {};
    setSearchQuery(d.search || '');
    setStatusFilter(d.status || 'all');
    setPriorityFilter(d.priority || 'all');
    setSortBy(d.sortBy || 'requirement_id');
    setSortDir(d.sortDir || 'asc');
    setActiveViewId(view.id);
  };

  const handleSaveView = async () => {
    if (!projectId || !viewName.trim()) return;
    try {
      setSavingView(true);
      const created = await savedFiltersAPI.create({
        project_id: parseInt(projectId),
        scope: 'requirements',
        name: viewName.trim(),
        definition: currentViewDefinition(),
        is_shared: viewShared,
        is_default: viewDefault,
      });
      toast({ title: t('success'), description: t('viewSaved', { name: created.name }) });
      setIsSaveViewOpen(false);
      setViewName('');
      setViewShared(false);
      setViewDefault(false);
      setActiveViewId(created.id);
      loadSavedViews();
    } catch (error: any) {
      toast({ title: t('error'), description: error.response?.data?.detail || t('viewSaveFailed'), variant: 'destructive' });
    } finally {
      setSavingView(false);
    }
  };

  const handleDeleteView = async (view: SavedFilter) => {
    try {
      await savedFiltersAPI.remove(view.id);
      if (activeViewId === view.id) setActiveViewId(null);
      loadSavedViews();
    } catch (error: any) {
      toast({ title: t('error'), description: error.response?.data?.detail || t('viewDeleteFailed'), variant: 'destructive' });
    }
  };

  // API functions
  const handleCreateRequirement = async () => {
    if (!projectId) return;
    
    if (!reqId.trim() || !reqTitle.trim()) {
      toast({
        title: t('error'),
        description: t('fieldRequired', {field: 'All required fields'}),
        variant: 'destructive',
      });
      return;
    }
    
    if (!/^REQ-\d{3,}$/.test(reqId.trim())) {
      toast({
        title: t('error'),
        description: t('requirementIdInvalid'),
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setIsSubmitting(true);
      let currentUser;
      try {
        currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      } catch {
        currentUser = { id: 1 };
      }
      
      const estimatedEffort = reqEstimatedEffort ? parseFloat(reqEstimatedEffort) : undefined;
      if (estimatedEffort !== undefined && (!Number.isFinite(estimatedEffort) || estimatedEffort < 0)) {
        toast({
          title: t('error'),
          description: t('estimatedEffortInvalid'),
          variant: 'destructive',
        });
        return;
      }
      
      const newRequirement: RequirementCreate = {
        title: reqTitle,
        description: markdownToHtml(reqDescription),
        requirement_id: reqId,
        priority: reqPriority as any,
        status: reqStatus as any,
        acceptance_criteria: useGherkinSyntax ? reqAcceptanceCriteria : markdownToHtml(reqAcceptanceCriteria),
        tags: reqTags,
        estimated_effort: estimatedEffort,
        folder_id: reqFolderId === 'none' ? null : Number(reqFolderId),
        project_id: parseInt(projectId),
        created_by: currentUser.id || 1,
      };

      await requirementsAPI.create(newRequirement);
      
      toast({
        title: t('success'),
        description: t('requirementCreated', {name: reqTitle}),
      });
      
      setIsCreateDialogOpen(false);
      resetForm();
      loadRequirements();
    } catch (error: any) {
      console.error('Error creating requirement:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToCreateRequirement'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditRequirement = (requirement: Requirement) => {
    const decodedAcceptance = decodeEntitiesDeep(requirement.acceptance_criteria);
    const readableAcceptance = htmlToReadableText(requirement.acceptance_criteria);
    const shouldUseGherkinSyntax = isGherkinText(readableAcceptance);
    const descriptionForEdit = richTextToMarkdownForEdit(requirement.description);
    const acceptanceForEdit = shouldUseGherkinSyntax
      ? readableAcceptance
      : isHtmlMarkup(decodedAcceptance)
        ? htmlToMarkdown(decodedAcceptance)
        : decodedAcceptance;

    setSelectedRequirement(requirement);
    setReqTitle(requirement.title);
    setReqDescription(descriptionForEdit);
    setReqId(requirement.requirement_id);
    setReqPriority(requirement.priority);
    setReqStatus(requirement.status);
    setReqAcceptanceCriteria(acceptanceForEdit);
    setReqTags(requirement.tags || '');
    setReqEstimatedEffort(requirement.estimated_effort?.toString() || '');
    setReqFolderId(requirement.folder_id != null ? String(requirement.folder_id) : 'none');
    setUseGherkinSyntax(shouldUseGherkinSyntax);
    setExternalDocumentUrl('');
    setShowExternalImport(false);
    setShowAdvancedRequirementTools(false);
    setInitialFormState({
      title: requirement.title,
      description: descriptionForEdit,
      priority: requirement.priority,
      status: requirement.status,
      acceptanceCriteria: acceptanceForEdit,
      tags: requirement.tags || '',
      estimatedEffort: requirement.estimated_effort?.toString() || '',
      useGherkinSyntax: shouldUseGherkinSyntax,
    });
    setContentVersions([]);
    setCompareFromId('');
    setCompareToId('');
    setIsEditDialogOpen(true);
    setTimeout(() => titleInputRef.current?.focus(), 100);
  };

  const handleUpdateRequirement = async () => {
    if (!selectedRequirement) return;
    
    if (!reqTitle.trim()) {
      toast({
        title: t('error'),
        description: t('fieldRequired', {field: 'Title'}),
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setIsSubmitting(true);
      const estimatedEffort = reqEstimatedEffort ? parseFloat(reqEstimatedEffort) : undefined;
      if (estimatedEffort !== undefined && (!Number.isFinite(estimatedEffort) || estimatedEffort < 0)) {
        toast({
          title: t('error'),
          description: t('estimatedEffortInvalid'),
          variant: 'destructive',
        });
        return;
      }
      
      const updateData: RequirementUpdate = {
        title: reqTitle,
        description: markdownToHtml(reqDescription),
        priority: reqPriority as any,
        status: reqStatus as any,
        acceptance_criteria: useGherkinSyntax ? reqAcceptanceCriteria : markdownToHtml(reqAcceptanceCriteria),
        tags: reqTags,
        estimated_effort: estimatedEffort,
        folder_id: reqFolderId === 'none' ? null : Number(reqFolderId),
      };

      await requirementsAPI.update(selectedRequirement.id, updateData);
      
      toast({
        title: t('success'),
        description: t('requirementUpdated'),
      });
      
      setIsEditDialogOpen(false);
      setSelectedRequirement(null);
      resetForm();
      loadRequirements();
    } catch (error: any) {
      console.error('Error updating requirement:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToUpdateRequirement'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRequirement = async () => {
    if (!requirementToDelete) return;
    
    if (deleteConfirmationName.trim().toLowerCase() !== requirementToDelete.title.trim().toLowerCase()) {
      toast({
        title: t('error'),
        description: t('titleDoesntMatch'),
        variant: 'destructive',
      });
      return;
    }

    try {
      await requirementsAPI.delete(requirementToDelete.id);
      
      toast({
        title: t('success'),
        description: t('requirementDeleted', {name: requirementToDelete.title}),
      });
      
      setIsDeleteDialogOpen(false);
      setRequirementToDelete(null);
      setDeleteConfirmationName('');
      
      // Reload requirements
      loadRequirements();
    } catch (error) {
      console.error('Error deleting requirement:', error);
      toast({
        title: t('error'),
        description: t('failedToDeleteRequirement'),
        variant: 'destructive',
      });
    }
  };

  const handleFetchExternalDocument = async () => {
    if (!projectId) return;
    const url = externalDocumentUrl.trim();
    if (!isValidImportUrl(url, importSource)) {
      toast({
        title: t('validationError'),
        description: importSource === 'atlassian'
          ? t('externalDocInvalidUrl')
          : t('trackerImportInvalidUrl', { source: t(`importSource_${importSource}` as any) }),
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsFetchingDocument(true);
      const documentData = importSource === 'atlassian'
        ? await requirementsAPI.fetchExternalDocument({
            project_id: Number(projectId),
            url,
          })
        : await requirementsAPI.importFromTracker({
            project_id: Number(projectId),
            source: importSource,
            url,
          });
      setReqTitle(documentData.title || reqTitle);
      setReqDescription(buildExternalDocumentText(documentData, reqDescription));
      setReqAcceptanceCriteria(documentData.acceptance_criteria || reqAcceptanceCriteria);
      setUseGherkinSyntax(isGherkinText(documentData.acceptance_criteria || reqAcceptanceCriteria));
      toast({
        title: t('success'),
        description: t('externalDocImported', { title: documentData.title || url }),
      });
    } catch (error: any) {
      console.error('Error fetching external document:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToFetchExternalDoc'),
        variant: 'destructive',
      });
    } finally {
      setIsFetchingDocument(false);
    }
  };

  const resetForm = () => {
    setReqTitle('');
    setReqDescription('');
    setReqId('');
    setReqPriority('medium');
    setReqStatus('draft');
    setReqAcceptanceCriteria('');
    setReqTags('');
    setReqEstimatedEffort('');
    setReqFolderId('none');
    setUseGherkinSyntax(false);
    setExternalDocumentUrl('');
    setImportSource('atlassian');
    setShowExternalImport(false);
    setShowAdvancedRequirementTools(false);
    setHasUnsavedChanges(false);
    setInitialFormState(null);
    if (projectId) {
      localStorage.removeItem(`requirement-draft-${projectId}`);
    }
  };
  
  const currentFormState = useMemo(() => ({
      title: reqTitle,
      description: reqDescription,
      priority: reqPriority,
      status: reqStatus,
      acceptanceCriteria: reqAcceptanceCriteria,
      tags: reqTags,
      estimatedEffort: reqEstimatedEffort,
      useGherkinSyntax,
  }), [reqTitle, reqDescription, reqPriority, reqStatus, reqAcceptanceCriteria, reqTags, reqEstimatedEffort, useGherkinSyntax]);

  const checkUnsavedChanges = useCallback(() => {
    return JSON.stringify(currentFormState) !== JSON.stringify(initialFormState);
  }, [currentFormState, initialFormState]);
  
  const handleDialogClose = (dialogType: 'create' | 'edit') => {
    if (hasUnsavedChanges && checkUnsavedChanges()) {
      setShowUnsavedDialog(true);
      return;
    }
    if (dialogType === 'create') {
      setIsCreateDialogOpen(false);
    } else {
      setIsEditDialogOpen(false);
      setSelectedRequirement(null);
    }
    resetForm();
  };
  
  const handleUnsavedConfirm = (dialogType: 'create' | 'edit') => {
    setShowUnsavedDialog(false);
    if (dialogType === 'create') {
      setIsCreateDialogOpen(false);
    } else {
      setIsEditDialogOpen(false);
      setSelectedRequirement(null);
    }
    resetForm();
  };
  
  const handleUnsavedCancel = () => {
    setShowUnsavedDialog(false);
  };

  const handleViewRequirement = (requirement: Requirement) => {
    if (projectId) {
      navigate(`/projects/${projectId}/requirements/${entitySeq(requirement)}`);
    }
  };

  const handleCopyRequirementId = async (requirement: Requirement) => {
    try {
      await navigator.clipboard.writeText(requirement.requirement_id);
      setCopiedKeyId(requirement.id);
      setTimeout(() => setCopiedKeyId((cur) => (cur === requirement.id ? null : cur)), 1500);
    } catch {
      toast({ title: t('error'), description: t('copyFailed'), variant: 'destructive' });
    }
  };

  const handleCopyRequirementLink = async (requirement: Requirement) => {
    // Absolute URL so the copied link works when pasted anywhere, not just in-app.
    const url = `${window.location.origin}/projects/${projectId}/requirements/${entitySeq(requirement)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(requirement.id);
      setTimeout(() => setCopiedLinkId((cur) => (cur === requirement.id ? null : cur)), 1500);
    } catch {
      toast({ title: t('error'), description: t('copyFailed'), variant: 'destructive' });
    }
  };

  const openDeleteDialog = (requirement: Requirement) => {
    setRequirementToDelete(requirement);
    setDeleteConfirmationName('');
    setIsDeleteDialogOpen(true);
  };

  const handleExportRequirements = () => {
    if (filteredRequirements.length === 0) {
      toast({
        title: t('error'),
        description: t('noRequirementsFound'),
        variant: 'destructive',
      });
      return;
    }

    const escapeCsv = (value: unknown): string => {
      const str = value == null ? '' : String(value);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const headers = ['Requirement ID', 'Title', 'Status', 'Priority', 'Tags', 'Estimated Effort', 'Description', 'Acceptance Criteria', 'Created At'];
    const rows = filteredRequirements.map((req) => [
      req.requirement_id,
      req.title,
      req.status,
      req.priority,
      req.tags || '',
      req.estimated_effort ?? '',
      toDisplayText(req.description),
      toDisplayText(req.acceptance_criteria),
      req.created_at,
    ].map(escapeCsv).join(','));

    // Prepend a BOM so Excel reads the UTF-8 content correctly.
    const csv = '﻿' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `requirements-project-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: t('success'),
      description: t('requirementsExported', { count: filteredRequirements.length }),
    });
  };

  // Export Gherkin .feature files — the current selection if any, else every
  // requirement currently visible (respecting search/status/folder filters).
  // The download is a single .feature file or a .zip bundle.
  const handleExportFeatureFiles = async () => {
    const ids = selectedIds.size > 0
      ? Array.from(selectedIds)
      : filteredRequirements.map((req) => req.id);
    if (ids.length === 0) {
      toast({ title: t('error'), description: t('noRequirementsFound'), variant: 'destructive' });
      return;
    }
    try {
      await requirementsAPI.exportFeatureFiles(parseInt(projectId), ids);
      toast({ title: t('success'), description: t('featureFilesExported', { count: ids.length }) });
    } catch (error: any) {
      toast({
        title: t('error'),
        description: error?.response?.status === 404 ? t('noRequirementsFound') : t('featureFilesExportFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleImportFeatureFiles = async (file: File) => {
    setIsImportingFeatures(true);
    const folderTarget = typeof selectedFolder === 'number' ? selectedFolder : undefined;
    try {
      const result = await requirementsAPI.importFeatureFiles(parseInt(projectId), file, folderTarget);
      const count = result.created?.length ?? 0;
      toast({
        title: t('success'),
        description: result.skipped?.length
          ? t('featureFilesImportedWithSkips', { count, skipped: result.skipped.length })
          : t('featureFilesImported', { count }),
      });
      await Promise.all([loadRequirements(), loadFolders()]);
    } catch (error: any) {
      toast({
        title: t('error'),
        description: error?.response?.data?.detail || t('featureFilesImportFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsImportingFeatures(false);
      if (featureFileInputRef.current) featureFileInputRef.current.value = '';
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      reviewed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      implemented: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
      deprecated: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[priority] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft':
        return <FileText className="h-4 w-4" />;
      case 'reviewed':
        return <Eye className="h-4 w-4" />;
      case 'approved':
        return <CheckCircle className="h-4 w-4" />;
      case 'implemented':
        return <Users className="h-4 w-4" />;
      case 'verified':
        return <CheckCircle className="h-4 w-4" />;
      case 'deprecated':
        return <XCircle className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const coverageMeta: Record<RequirementCoverageStatus, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
    covered: { label: t('covCovered'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', Icon: ShieldCheck },
    partial: { label: t('covPartial'), cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', Icon: ShieldCheck },
    failing: { label: t('covFailing'), cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', Icon: ShieldX },
    blocked: { label: t('covBlocked'), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', Icon: ShieldAlert },
    uncovered: { label: t('covUncovered'), cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', Icon: ShieldX },
  };

  const renderCoverageBadge = (requirement: Requirement) => {
    const cov = coverageMap[requirement.id];
    const status: RequirementCoverageStatus = cov?.status || 'uncovered';
    const meta = coverageMeta[status];
    const Icon = meta.Icon;
    const detail =
      status === 'failing' && cov?.failed_related_runs
        ? ` · ${cov.failed_related_runs} ${t('failed')}`
        : cov?.linked_count
          ? ` · ${cov.linked_count}`
          : '';
    return (
      <Badge className={`${meta.cls} border-0`} title={t('coverageBadgeTooltip')}>
        <Icon className={`h-3 w-3 ${isRTL ? 'ml-1' : 'mr-1'}`} />
        {meta.label}{detail}
      </Badge>
    );
  };

  const sortOptions: Array<{ value: typeof sortBy; label: string }> = [
    { value: 'requirement_id', label: t('reqId') },
    { value: 'title', label: t('title') },
    { value: 'status', label: t('status') },
    { value: 'priority', label: t('priority') },
    { value: 'created_at', label: t('created') },
    { value: 'coverage', label: t('coverage') },
  ];

  // Generate next requirement ID
  const generateRequirementId = () => {
    if (requirements.length === 0) {
      return 'REQ-001';
    }
    
    // Only consider well-formed "REQ-<number>" ids so an outlier like
    // "REQ-2024-001" cannot inflate the next suggested id.
    const maxId = requirements.reduce((max, req) => {
      const match = /^REQ-(\d+)$/.exec((req.requirement_id || '').trim());
      if (!match) return max;
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }, 0);
    return `REQ-${String(maxId + 1).padStart(3, '0')}`;
  };

  // Initialize requirement ID when opening create dialog
  const handleOpenCreateDialog = () => {
    if (projectId) {
      const rawDraft = localStorage.getItem(`requirement-draft-${projectId}`);
      if (rawDraft) {
        try {
          const draft = JSON.parse(rawDraft);
          const draftAcceptance = draft.reqAcceptanceCriteria || '';
          const draftUsesGherkin = Boolean(draft.useGherkinSyntax || isGherkinText(draftAcceptance));
          setReqTitle(draft.reqTitle || '');
          setReqDescription(richTextToMarkdownForEdit(draft.reqDescription || ''));
          setReqId(draft.reqId || generateRequirementId());
          setReqPriority(draft.reqPriority || 'medium');
          setReqStatus(draft.reqStatus || 'draft');
          setReqAcceptanceCriteria(draftUsesGherkin ? htmlToReadableText(draftAcceptance) : richTextToMarkdownForEdit(draftAcceptance));
          setReqTags(draft.reqTags || '');
          setReqEstimatedEffort(draft.reqEstimatedEffort || '');
          setUseGherkinSyntax(draftUsesGherkin);
          setExternalDocumentUrl('');
          setShowExternalImport(false);
          setShowAdvancedRequirementTools(false);
          setInitialFormState({
            title: draft.reqTitle || '',
            description: richTextToMarkdownForEdit(draft.reqDescription || ''),
            priority: draft.reqPriority || 'medium',
            status: draft.reqStatus || 'draft',
            acceptanceCriteria: draftUsesGherkin ? htmlToReadableText(draftAcceptance) : richTextToMarkdownForEdit(draftAcceptance),
            tags: draft.reqTags || '',
            estimatedEffort: draft.reqEstimatedEffort || '',
            useGherkinSyntax: draftUsesGherkin,
          });
          setContentVersions([]);
          setCompareFromId('');
          setCompareToId('');
          setIsCreateDialogOpen(true);
          setTimeout(() => titleInputRef.current?.focus(), 100);
          return;
        } catch {
          localStorage.removeItem(`requirement-draft-${projectId}`);
        }
      }
    }
    resetForm();
    setReqId(generateRequirementId());
    setReqFolderId(typeof selectedFolder === 'number' ? String(selectedFolder) : 'none');
    setUseGherkinSyntax(false);
    setExternalDocumentUrl('');
    setShowExternalImport(false);
    setShowAdvancedRequirementTools(false);
    setInitialFormState({
      title: '',
      description: '',
      priority: 'medium',
      status: 'draft',
      acceptanceCriteria: '',
      tags: '',
      estimatedEffort: '',
      useGherkinSyntax: false,
    });
    setContentVersions([]);
    setCompareFromId('');
    setCompareToId('');
    setIsCreateDialogOpen(true);
    setTimeout(() => titleInputRef.current?.focus(), 100);
  };

  useEffect(() => {
    if (!isCreateDialogOpen || !projectId) return;
    if (draftSaveTimeoutRef.current) {
      window.clearTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = window.setTimeout(() => {
      localStorage.setItem(
        `requirement-draft-${projectId}`,
        JSON.stringify({
          reqTitle,
          reqDescription,
          reqId,
          reqPriority,
          reqStatus,
          reqAcceptanceCriteria,
          reqTags,
          reqEstimatedEffort,
          useGherkinSyntax,
        })
      );
    }, 350);
    return () => {
      if (draftSaveTimeoutRef.current) {
        window.clearTimeout(draftSaveTimeoutRef.current);
      }
    };
  }, [isCreateDialogOpen, projectId, reqTitle, reqDescription, reqId, reqPriority, reqStatus, reqAcceptanceCriteria, reqTags, reqEstimatedEffort, useGherkinSyntax]);
  
  // Track form changes
  useEffect(() => {
    if (initialFormState) {
      Promise.resolve().then(() => setHasUnsavedChanges(checkUnsavedChanges()));
    }
  }, [checkUnsavedChanges, initialFormState]);
  
  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((isCreateDialogOpen || isEditDialogOpen) && !showUnsavedDialog) {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleDialogClose(isCreateDialogOpen ? 'create' : 'edit');
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (isCreateDialogOpen) {
            handleCreateRequirement();
          } else {
            handleUpdateRequirement();
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);

  }, [isCreateDialogOpen, isEditDialogOpen, showUnsavedDialog, reqId, reqTitle, reqDescription, reqPriority, reqStatus, reqAcceptanceCriteria, reqTags, reqEstimatedEffort, selectedRequirement]);

  const importSourceOptions: Array<{ value: typeof importSource; label: string }> = [
    { value: 'atlassian', label: t('importSource_atlassian') },
    { value: 'asana', label: t('importSource_asana') },
    { value: 'linear', label: t('importSource_linear') },
    { value: 'monday', label: t('importSource_monday') },
  ];

  const importUrlPlaceholders: Record<typeof importSource, string> = {
    atlassian: t('externalDocUrlPlaceholder'),
    asana: 'https://app.asana.com/0/1234567890/1234567890',
    linear: 'https://linear.app/acme/issue/ENG-123/title',
    monday: 'https://acme.monday.com/boards/123456/pulses/7890123',
  };

  const renderExternalDocumentImport = (inputId: string) => (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
      <div className="flex items-center gap-2">
        <ExternalLink className="h-4 w-4 text-blue-600 dark:text-blue-300" />
        <Label htmlFor={inputId} className="text-sm font-semibold">
          {t('importFromExternalTool')}
        </Label>
      </div>
      <Select value={importSource} onValueChange={(value) => setImportSource(value as typeof importSource)}>
        <SelectTrigger className="text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {importSourceOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          value={externalDocumentUrl}
          onChange={(e) => setExternalDocumentUrl(e.target.value)}
          placeholder={importUrlPlaceholders[importSource]}
          className="min-w-0 flex-1"
          dir="ltr"
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleFetchExternalDocument}
          disabled={isFetchingDocument || !externalDocumentUrl.trim()}
          className="shrink-0"
        >
          {isFetchingDocument ? (
            <>
              <div className={`h-4 w-4 animate-spin rounded-full border-b-2 border-current ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
              {t('fetching')}
            </>
          ) : (
            <>
              <Wand2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('fetchDocument')}
            </>
          )}
        </Button>
      </div>
      <p className="text-xs text-blue-700 dark:text-blue-300">
        {importSource === 'atlassian' ? t('externalDocImportHelp') : t('trackerImportHelp')}
      </p>
    </div>
  );

  const renderRequirementModeControls = (idPrefix: string) => (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <Label htmlFor={`${idPrefix}-external-import`} className="text-sm font-medium">
          {t('importFromExternalTool')}
        </Label>
        <Switch
          id={`${idPrefix}-external-import`}
          checked={showExternalImport}
          onCheckedChange={setShowExternalImport}
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <Label htmlFor={`${idPrefix}-advanced-tools`} className="text-sm font-medium">
          {t('advancedRequirementTools')}
        </Label>
        <Switch
          id={`${idPrefix}-advanced-tools`}
          checked={showAdvancedRequirementTools}
          onCheckedChange={setShowAdvancedRequirementTools}
        />
      </div>
    </div>
  );

  const renderAcceptanceCriteriaEditor = (idPrefix: string) => (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Label htmlFor={`${idPrefix}-acceptanceCriteria`} className="text-base font-semibold">
          {t('acceptanceCriteria')}
        </Label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{getPlainTextLength(reqAcceptanceCriteria)} {t('chars')}</span>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${idPrefix}-gherkin`} className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('gherkinSyntax')}
            </Label>
            <Switch
              id={`${idPrefix}-gherkin`}
              checked={useGherkinSyntax}
              onCheckedChange={(checked) => {
                setUseGherkinSyntax(checked);
                if (checked && !reqAcceptanceCriteria.trim()) {
                  setReqAcceptanceCriteria(gherkinTemplate);
                }
              }}
            />
          </div>
        </div>
      </div>
      {useGherkinSyntax ? (
        <GherkinEditor
          id={`${idPrefix}-acceptanceCriteria`}
          ariaLabel={t('acceptanceCriteria')}
          value={reqAcceptanceCriteria}
          onChange={setReqAcceptanceCriteria}
          placeholder={t('gherkinAcceptancePlaceholder')}
          minHeight="210px"
          emptyPreviewLabel={t('noAcceptanceCriteriaProvided')}
        />
      ) : (
        <ContentEditor
          value={reqAcceptanceCriteria}
          onChange={setReqAcceptanceCriteria}
          placeholder={t('enterAcceptanceCriteria')}
          format="markdown"
          dir={isRTL ? 'rtl' : 'ltr'}
          minHeight="170px"
        />
      )}
      <p className="text-xs text-gray-500">
        {useGherkinSyntax ? t('gherkinAcceptanceHelper') : t('acceptanceCriteriaHelper')}
      </p>
    </div>
  );

  const fromSnapshot = contentVersions.find((version) => version.id === compareFromId) || null;
  const toSnapshot = contentVersions.find((version) => version.id === compareToId) || null;

  const renderVersionHistory = () => (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{t('rteVersionHistory')}</Label>
        <Button type="button" size="sm" variant="outline" onClick={saveVersionSnapshot}>
          {t('rteSaveSnapshot')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={compareFromId}
          onChange={(e) => setCompareFromId(e.target.value)}
        >
          <option value="">{t('rteCompareFrom')}</option>
          {contentVersions.map((version) => (
            <option key={version.id} value={version.id}>
              {formatDateTime(version.createdAt)}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={compareToId}
          onChange={(e) => setCompareToId(e.target.value)}
        >
          <option value="">{t('rteCompareTo')}</option>
          {contentVersions.map((version) => (
            <option key={version.id} value={version.id}>
              {formatDateTime(version.createdAt)}
            </option>
          ))}
        </select>
      </div>
      {fromSnapshot && toSnapshot && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900/30">
          <div className="font-medium">{t('rteInlineDiff')}</div>
          <div
            className="prose prose-sm max-w-none whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildDiffHtml(fromSnapshot.description, toSnapshot.description)) }}
          />
        </div>
      )}
    </div>
  );

  const requirementStatusOptions = ['draft', 'reviewed', 'approved', 'implemented', 'verified', 'deprecated'];
  const requirementPriorityOptions = ['low', 'medium', 'high', 'critical'];
  const isRequirementIdValid = /^REQ-\d{3,}$/.test(reqId.trim());
  const estimatedEffortValue = reqEstimatedEffort ? parseFloat(reqEstimatedEffort) : undefined;
  const hasInvalidEstimatedEffort = estimatedEffortValue !== undefined && (!Number.isFinite(estimatedEffortValue) || estimatedEffortValue < 0);
  const canCreateRequirement = Boolean(reqId.trim() && reqTitle.trim() && isRequirementIdValid && !hasInvalidEstimatedEffort && !isSubmitting);
  const canUpdateRequirement = Boolean(reqTitle.trim() && !hasInvalidEstimatedEffort && !isSubmitting);

  const getRequirementSubmitDisabledReason = (mode: 'create' | 'edit'): string => {
    if (isSubmitting) return '';
    if (mode === 'create' && !reqId.trim()) return t('fieldRequired', { field: t('reqId') });
    if (!reqTitle.trim()) return t('fieldRequired', { field: t('title') });
    if (mode === 'create' && !isRequirementIdValid) return t('requirementIdInvalid');
    if (hasInvalidEstimatedEffort) return t('estimatedEffortInvalid');
    return '';
  };

  const renderRequirementTitleField = (mode: 'create' | 'edit') => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${mode}-reqTitle`} className="text-base font-semibold">
          {t('title')} <span className="text-red-500">*</span>
        </Label>
        {reqTitle.trim().length > 0 && (
          <span className="text-xs font-medium text-green-600">✓</span>
        )}
      </div>
      <Input
        id={`${mode}-reqTitle`}
        ref={titleInputRef}
        value={reqTitle}
        onChange={(e) => setReqTitle(e.target.value)}
        className="h-12 text-lg font-medium transition-all focus:ring-2 focus:ring-blue-500"
        placeholder={t('enterRequirementTitle')}
      />
      <p className="text-xs text-gray-500">{t('titleHelper')}</p>
    </div>
  );

  const renderRequirementDescriptionField = (mode: 'create' | 'edit') => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${mode}-reqDescription`} className="text-base font-semibold">
          {t('description')}
        </Label>
        <span className="text-xs text-gray-500">{getPlainTextLength(reqDescription)} {t('chars')}</span>
      </div>
      <ContentEditor
        value={reqDescription}
        onChange={setReqDescription}
        placeholder={t('enterRequirementDescription')}
        format="markdown"
        dir={isRTL ? 'rtl' : 'ltr'}
        minHeight="220px"
      />
      <p className="text-xs text-gray-500">{t('descriptionHelper')}</p>
    </div>
  );

  const renderRequirementMetadataFields = (mode: 'create' | 'edit') => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqId`} className="text-sm font-medium">
          {t('reqId')}
        </Label>
        <Input
          id={`${mode}-reqId`}
          value={reqId}
          disabled
          className="border-gray-300 bg-gray-100 text-sm dark:border-gray-600 dark:bg-gray-700"
          placeholder="REQ-001"
        />
        {/* The key is derived from the per-project sequence on the server. In
            create mode the value shown is the next id that will be assigned. */}
        <p className="text-xs text-gray-500">{t('reqIdImmutable')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqStatus`} className="text-sm font-medium">
          {t('status')}
        </Label>
        <Select value={reqStatus} onValueChange={setReqStatus}>
          <SelectTrigger className="text-sm transition-all focus:ring-2 focus:ring-blue-500">
            <SelectValue placeholder={t('selectStatus')} />
          </SelectTrigger>
          <SelectContent>
            {requirementStatusOptions.map((status) => (
              <SelectItem key={status} value={status}>{t(status as any)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqPriority`} className="text-sm font-medium">
          {t('priority')}
        </Label>
        <Select value={reqPriority} onValueChange={setReqPriority}>
          <SelectTrigger className="text-sm transition-all focus:ring-2 focus:ring-blue-500">
            <SelectValue placeholder={t('selectPriority')} />
          </SelectTrigger>
          <SelectContent>
            {requirementPriorityOptions.map((priority) => (
              <SelectItem key={priority} value={priority}>{t(priority as any)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqEstimatedEffort`} className="text-sm font-medium">
          {t('estEffort')}
        </Label>
        <Input
          id={`${mode}-reqEstimatedEffort`}
          type="number"
          step="0.5"
          min="0"
          value={reqEstimatedEffort}
          onChange={(e) => setReqEstimatedEffort(e.target.value)}
          className="text-sm transition-all focus:ring-2 focus:ring-blue-500"
          placeholder="8.0"
        />
        <p className={hasInvalidEstimatedEffort ? 'text-xs text-red-500' : 'text-xs text-gray-500'}>
          {hasInvalidEstimatedEffort ? t('estimatedEffortInvalid') : t('estimatedEffortHelper')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqTags`} className="text-sm font-medium">
          {t('tags')}
        </Label>
        <Input
          id={`${mode}-reqTags`}
          value={reqTags}
          onChange={(e) => setReqTags(e.target.value)}
          className="text-sm transition-all focus:ring-2 focus:ring-blue-500"
          placeholder="security, authentication"
        />
        <p className="text-xs text-gray-500">{t('tagsHelper')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqFolder`} className="text-sm font-medium">
          {t('folder')}
        </Label>
        <Select value={reqFolderId} onValueChange={setReqFolderId}>
          <SelectTrigger id={`${mode}-reqFolder`} className="text-sm transition-all focus:ring-2 focus:ring-blue-500">
            <SelectValue placeholder={t('unfiled')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('unfiled')}</SelectItem>
            {folderTree.map(({ folder, depth }) => (
              <SelectItem key={folder.id} value={String(folder.id)}>
                {`${'  '.repeat(depth)}${folder.name}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500">{t('folderHelper')}</p>
      </div>
    </div>
  );

  const renderRequirementToolPanel = (mode: 'create' | 'edit', isCreateMode: boolean) => (
    <aside className="space-y-4">
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{t('requirementDetails')}</h3>
        {renderRequirementMetadataFields(mode)}
      </div>
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{t('tools')}</h3>
        <div className="space-y-3">
          {renderRequirementModeControls(mode)}
        </div>
      </div>
      {showExternalImport && renderExternalDocumentImport(isCreateMode ? 'external-document-url' : 'edit-external-document-url')}
      {showAdvancedRequirementTools && renderVersionHistory()}
    </aside>
  );

  const renderRequirementDialogContent = (mode: 'create' | 'edit') => {
    const isCreateMode = mode === 'create';
    const canSubmit = isCreateMode ? canCreateRequirement : canUpdateRequirement;
    const submitLabel = isCreateMode ? t('createRequirement') : t('updateRequirement');
    const submittingLabel = isCreateMode ? t('creating') : t('updating');

    return (
      <DialogContent isRTL={isRTL} className="max-h-[90vh] w-[96vw] max-w-[96vw] overflow-y-auto overflow-x-hidden sm:max-w-[95vw] lg:max-w-[1080px]">
        <DialogHeader className="border-b border-gray-200 pb-4 text-start dark:border-gray-700">
          <div className="min-w-0">
            <DialogTitle className="text-2xl font-semibold">
              {isCreateMode ? t('createNewRequirement') : t('editRequirement')}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm">
              {isCreateMode ? t('createRequirementDesc') : t('updateRequirementInfo')}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0 space-y-5">
            <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              {renderRequirementTitleField(mode)}
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              {renderRequirementDescriptionField(mode)}
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              {renderAcceptanceCriteriaEditor(mode)}
            </div>
          </section>
          {renderRequirementToolPanel(mode, isCreateMode)}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleDialogClose(mode)}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            onClick={isCreateMode ? handleCreateRequirement : handleUpdateRequirement}
            disabled={!canSubmit}
            title={getRequirementSubmitDisabledReason(mode)}
          >
            {isSubmitting ? (
              <>
                <div className={`h-4 w-4 animate-spin rounded-full border-b-2 border-current ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
                {submittingLabel}
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  };

  const changeViewMode = (mode: 'table' | 'grid') => {
    setViewMode(mode);
    try { localStorage.setItem('requirements-view-mode', mode); } catch { /* ignore */ }
  };

  const hasActiveFilters = searchQuery.trim() !== '' || statusFilter !== 'all' || priorityFilter !== 'all';

  const clearAllFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setActiveViewId(null);
  };

  // Safe, locale-aware date formatter — guards against missing or unparsable
  // timestamps so rows never render "Invalid Date".
  const formatReqDate = (value?: string | null): string => (value ? fmtDate(value) || '-' : '-');

  // Portfolio summary for the header strip (derived from the loaded set).
  const summary = useMemo(() => {
    const total = requirements.length;
    let open = 0;
    let verified = 0;
    let covered = 0;
    let uncovered = 0;
    for (const req of requirements) {
      if (req.status === 'verified' || req.status === 'implemented') verified += 1;
      else if (req.status !== 'deprecated') open += 1;
      const status = coverageMap[req.id]?.status || 'uncovered';
      if (status === 'covered' || status === 'partial') covered += 1;
      else uncovered += 1;
    }
    const coveragePct = total > 0 ? Math.round((covered / total) * 100) : 0;
    return { total, open, verified, covered, uncovered, coveragePct };
  }, [requirements, coverageMap]);

  // Click a column header to sort by it; clicking the active column flips direction.
  const toggleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
  };

  const SortIndicator = ({ column }: { column: typeof sortBy }) =>
    sortBy === column ? (
      sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
    ) : (
      <ArrowUpDown className="h-3 w-3 opacity-30" />
    );

  const statusFilterOptions = ['all', ...requirementStatusOptions];
  const priorityFilterOptions = ['all', ...requirementPriorityOptions];
  const activeViewName = activeViewId ? savedViews.find((v) => v.id === activeViewId)?.name : undefined;

  // Suggestion catalog for the "/" advanced-search palette — built from the
  // project's real statuses, priorities and tags so completions are always valid.
  const searchSuggestionGroups = useMemo<SearchSuggestionGroup[]>(() => {
    const tagCounts = new Map<string, number>();
    requirements.forEach((req) => {
      (req.tags || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
    });
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => ({ value: tag.toLowerCase(), label: tag }));

    return [
      { key: 'status', label: t('status'), values: requirementStatusOptions.map((s) => ({ value: s, label: t(s as any) })) },
      { key: 'priority', label: t('priority'), values: requirementPriorityOptions.map((p) => ({ value: p, label: t(p as any) })) },
      { key: 'tag', label: t('tags'), values: topTags },
      { key: 'id', label: t('reqId'), values: [] },
    ];
  }, [requirements, requirementStatusOptions, requirementPriorityOptions, t]);

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-sm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.10),transparent_38%)]" />
        <div className="relative flex flex-col gap-5 p-6 sm:p-7 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2.5">
            <Badge className="w-fit gap-1.5 border border-primary/30 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/15">
              <ListChecks className="h-3.5 w-3.5" />
              {t('requirements')}
            </Badge>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('requirements')}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('requirementsDescription')}</p>
            </div>
            {/* Summary chips */}
            {requirements.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <SummaryChip icon={FileText} label={t('total')} value={summary.total} />
                <SummaryChip icon={CheckCircle} label={t('verified')} value={summary.verified} tone="emerald" />
                <SummaryChip icon={ShieldCheck} label={t('coverage')} value={`${summary.coveragePct}%`} tone={summary.coveragePct >= 60 ? 'emerald' : summary.coveragePct > 0 ? 'amber' : 'muted'} />
                {summary.uncovered > 0 && <SummaryChip icon={ShieldX} label={t('covUncovered')} value={summary.uncovered} tone="rose" />}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canWriteResults(user) && requirements.length > 0 && (
              <Button variant="outline" className="gap-2" onClick={() => setIsChatOpen(true)}>
                <Sparkles className="h-4 w-4" />
                {t('reqChatButton')}
              </Button>
            )}
            <Dialog open={isCreateDialogOpen} onOpenChange={(open) => !open && handleDialogClose('create')}>
              <DialogTrigger asChild>
                <Button className="gap-2 shadow-sm" onClick={handleOpenCreateDialog}>
                  <Plus className="h-4 w-4" />
                  {t('addRequirement')}
                </Button>
              </DialogTrigger>
              {renderRequirementDialogContent('create')}
            </Dialog>
          </div>
        </div>
      </section>
      {projectId && (
        <RequirementChatPanel
          projectId={parseInt(projectId)}
          open={isChatOpen}
          onOpenChange={setIsChatOpen}
        />
      )}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* ── Folder sidebar (desktop) — collapsible, collapsed by default ── */}
        <aside className={`hidden shrink-0 transition-[width] duration-200 lg:block ${sidebarCollapsed ? 'w-14' : 'w-60'}`}>
          <div className="sticky top-4 rounded-2xl border border-border bg-card p-2">
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-1">
                <Button variant="ghost" size="icon" className="h-9 w-9" title={t('expandSidebar')} aria-label={t('expandSidebar')} onClick={toggleSidebar}>
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" title={t('newFolder')} aria-label={t('newFolder')} onClick={() => openCreateFolder()}>
                  <FolderPlus className="h-4 w-4" />
                </Button>
                <div className="my-1 h-px w-7 bg-border" />
                <nav className="flex max-h-[calc(100vh-16rem)] flex-col items-center gap-1 overflow-y-auto">
                  <CollapsedRailItem active={selectedFolder === 'all'} icon={ListChecks} label={t('allRequirements')} count={requirements.length} onClick={() => setSelectedFolder('all')} />
                  <CollapsedRailItem active={selectedFolder === 'unfiled'} icon={Inbox} label={t('unfiled')} count={unfiledCount} onClick={() => setSelectedFolder('unfiled')} />
                  {folderTree.length > 0 && <div className="my-1 h-px w-7 bg-border" />}
                  {folderTree.map(({ folder }) => (
                    <CollapsedRailItem
                      key={folder.id}
                      active={selectedFolder === folder.id}
                      icon={Folder}
                      label={folder.name}
                      count={folderTotalCounts[folder.id] ?? 0}
                      onClick={() => setSelectedFolder(folder.id)}
                    />
                  ))}
                </nav>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                    <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">{t('folders')}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title={t('newFolder')} aria-label={t('newFolder')} onClick={() => openCreateFolder()}>
                      <FolderPlus className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title={t('collapseSidebar')} aria-label={t('collapseSidebar')} onClick={toggleSidebar}>
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <nav className="mt-1 max-h-[calc(100vh-12rem)] space-y-0.5 overflow-y-auto pe-0.5">
                  <FolderRailItem
                    active={selectedFolder === 'all'}
                    icon={ListChecks}
                    label={t('allRequirements')}
                    count={requirements.length}
                    onClick={() => setSelectedFolder('all')}
                  />
                  <FolderRailItem
                    active={selectedFolder === 'unfiled'}
                    icon={Inbox}
                    label={t('unfiled')}
                    count={unfiledCount}
                    onClick={() => setSelectedFolder('unfiled')}
                  />
                  {folderTree.length > 0 && <div className="my-1 h-px bg-border" />}
                  {folderTree.map(({ folder, depth }) => (
                    <div key={folder.id} className="group/folder relative flex items-center">
                      <button
                        type="button"
                        onClick={() => setSelectedFolder(folder.id)}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pe-8 text-sm transition-colors ${
                          selectedFolder === folder.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'
                        }`}
                        style={{ paddingInlineStart: `${8 + depth * 14}px` }}
                        title={folder.name}
                      >
                        <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate text-start">{folder.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{folderTotalCounts[folder.id] ?? 0}</span>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className={`absolute end-1 flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/folder:opacity-100 focus:opacity-100`}
                            aria-label={t('actions')}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => openCreateFolder(folder)}><FolderPlus className="mr-2 h-3.5 w-3.5" />{t('newFolder')}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditFolder(folder)}><Pencil className="mr-2 h-3.5 w-3.5" />{t('editFolder')}</DropdownMenuItem>
                          {canManageProject && (<>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDeleteFolder(folder)} className="text-rose-600 focus:text-rose-700 dark:text-rose-400"><Trash2 className="mr-2 h-3.5 w-3.5" />{t('delete')}</DropdownMenuItem>
                          </>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                  {folders.length === 0 && (
                    <p className="px-2 py-3 text-xs text-muted-foreground">{t('noFoldersYet')}</p>
                  )}
                </nav>
              </>
            )}
          </div>
        </aside>

        {/* ── Content column ─────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 space-y-5">
          {/* Folder filter (mobile) */}
          <div className="flex items-center gap-2 lg:hidden">
            <Select
              value={selectedFolder === 'all' ? 'all' : selectedFolder === 'unfiled' ? 'unfiled' : String(selectedFolder)}
              onValueChange={(v) => setSelectedFolder(v === 'all' ? 'all' : v === 'unfiled' ? 'unfiled' : Number(v))}
            >
              <SelectTrigger className="h-10 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allRequirements')}</SelectItem>
                <SelectItem value="unfiled">{t('unfiled')}</SelectItem>
                {folderTree.map(({ folder, depth }) => (
                  <SelectItem key={folder.id} value={String(folder.id)}>{`${'  '.repeat(depth)}${folder.name}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" title={t('newFolder')} aria-label={t('newFolder')} onClick={() => openCreateFolder()}>
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 lg:flex-row lg:flex-wrap lg:items-center">
        {/* Advanced search — shared "/" palette with status/priority/tag/id tokens.
            min-w-0 + lg:w-auto let it shrink/share space so a narrower content area
            (expanded sidebar) wraps gracefully instead of overflowing. */}
        <div className="w-full min-w-0 lg:w-auto lg:min-w-[220px] lg:flex-1">
          <TestCaseSearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t('requirementsAdvancedSearchPlaceholder')}
            groups={searchSuggestionGroups}
            isRTL={isRTL}
            resultCount={filteredRequirements.length}
            resultLabel={t('requirements')}
          />
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-[calc(50%-0.25rem)] shrink-0 sm:w-36"><SelectValue placeholder={t('status')} /></SelectTrigger>
            <SelectContent>
              {statusFilterOptions.map((s) => (
                <SelectItem key={s} value={s}>{s === 'all' ? t('allStatus') : t(s as any)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-10 w-[calc(50%-0.25rem)] shrink-0 sm:w-36"><SelectValue placeholder={t('priority')} /></SelectTrigger>
            <SelectContent>
              {priorityFilterOptions.map((p) => (
                <SelectItem key={p} value={p}>{p === 'all' ? t('allPriority') : t(p as any)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10 shrink-0 gap-1.5">
                <ArrowUpDown className="h-4 w-4" />
                <span className="hidden sm:inline">{sortOptions.find((o) => o.value === sortBy)?.label}</span>
                {sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t('sortBy')}</DropdownMenuLabel>
              {sortOptions.map((option) => (
                <DropdownMenuItem key={option.value} onClick={() => setSortBy(option.value)} className="flex items-center justify-between">
                  {option.label}
                  {sortBy === option.value && <CheckCircle className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="flex items-center justify-between">
                {sortDir === 'asc' ? t('ascending') : t('descending')}
                {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Saved views */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={activeViewId ? 'default' : 'outline'} className="h-10 shrink-0 gap-1.5">
                <Bookmark className="h-4 w-4" />
                <span className="hidden max-w-[120px] truncate sm:inline">{activeViewName || t('views')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{t('savedViews')}</DropdownMenuLabel>
              {savedViews.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('noSavedViews')}</div>
              ) : (
                savedViews.map((view) => (
                  <DropdownMenuItem key={view.id} onClick={() => applyView(view)} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate">
                      {view.is_default && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                      {view.is_shared && <Users className="h-3 w-3 text-muted-foreground" />}
                      <span className="truncate">{view.name}</span>
                    </span>
                    {view.owned_by_current_user && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteView(view); }}
                        className="text-muted-foreground hover:text-rose-600"
                        aria-label={t('delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              {activeViewId && (
                <DropdownMenuItem onClick={() => { setActiveViewId(null); setSearchQuery(''); setStatusFilter('all'); setPriorityFilter('all'); }}>
                  <X className={`h-3.5 w-3.5 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('clearActiveView')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setIsSaveViewOpen(true)}>
                <BookmarkPlus className={`h-3.5 w-3.5 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('saveCurrentView')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Import / Export (CSV + Gherkin .feature files) */}
          <input
            ref={featureFileInputRef}
            type="file"
            accept=".feature,.zip,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFeatureFiles(file);
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10 shrink-0 gap-1.5" disabled={isImportingFeatures}>
                {isImportingFeatures ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span className="hidden sm:inline">{t('importExport')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>{t('export')}</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleExportRequirements}>
                <Download className={`h-3.5 w-3.5 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('exportCsv')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportFeatureFiles}>
                <FileCode className={`h-3.5 w-3.5 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {selectedIds.size > 0 ? t('exportFeatureFilesSelected', { count: selectedIds.size }) : t('exportFeatureFiles')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('import')}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => featureFileInputRef.current?.click()}>
                <Upload className={`h-3.5 w-3.5 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('importFeatureFiles')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View toggle */}
          <div className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
            <ViewToggleButton active={viewMode === 'table'} onClick={() => changeViewMode('table')} icon={Table2} label={t('tableView')} />
            <ViewToggleButton active={viewMode === 'grid'} onClick={() => changeViewMode('grid')} icon={LayoutGrid} label={t('gridView')} />
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {(hasActiveFilters || activeViewName) && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
          <span className="text-muted-foreground">{t('filters')}:</span>
          {activeViewName && <FilterChip label={activeViewName} icon={Bookmark} onClear={() => setActiveViewId(null)} />}
          {searchQuery.trim() && <FilterChip label={`"${searchQuery.trim()}"`} icon={Search} onClear={() => setSearchQuery('')} />}
          {statusFilter !== 'all' && <FilterChip label={t(statusFilter as any)} onClear={() => setStatusFilter('all')} />}
          {priorityFilter !== 'all' && <FilterChip label={t(priorityFilter as any)} onClear={() => setPriorityFilter('all')} />}
          <button type="button" onClick={clearAllFilters} className="font-medium text-primary hover:underline">
            {t('clearFilters')}
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/90 p-3 shadow-sm backdrop-blur dark:border-blue-900/60 dark:bg-blue-950/60">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-blue-600 dark:text-blue-300" />
            {t('selectedCount', { count: selectedIds.size })}
          </span>
          <span className="mx-1 h-5 w-px bg-blue-200 dark:bg-blue-800" />

          {/* Set status */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={bulkBusy}>{t('setStatus')}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {['draft', 'reviewed', 'approved', 'implemented', 'verified', 'deprecated'].map((status) => (
                <DropdownMenuItem key={status} onClick={() => runBulkUpdate({ status })}>{t(status as any)}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Set priority */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={bulkBusy}>{t('setPriority')}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {['low', 'medium', 'high', 'critical'].map((priority) => (
                <DropdownMenuItem key={priority} onClick={() => runBulkUpdate({ priority })}>{t(priority as any)}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Add tag */}
          {showBulkTagInput ? (
            <div className="flex items-center gap-1">
              <Input
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleBulkAddTag(); }}
                placeholder={t('tagName')}
                className="h-8 w-32"
                autoFocus
              />
              <Button size="sm" onClick={handleBulkAddTag} disabled={bulkBusy || !bulkTagInput.trim()}>{t('add')}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowBulkTagInput(false); setBulkTagInput(''); }}>{t('cancel')}</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => setShowBulkTagInput(true)}>
              <Tag className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
              {t('addTag')}
            </Button>
          )}

          {/* Move to folder */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={bulkBusy}>
                <FolderInput className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                {t('moveToFolder')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 overflow-y-auto">
              <DropdownMenuItem onClick={() => handleBulkMoveToFolder(null)}>
                <Inbox className="mr-2 h-3.5 w-3.5" />{t('unfiled')}
              </DropdownMenuItem>
              {folderTree.length > 0 && <DropdownMenuSeparator />}
              {folderTree.map(({ folder, depth }) => (
                <DropdownMenuItem key={folder.id} onClick={() => handleBulkMoveToFolder(folder.id)}>
                  <Folder className="mr-2 h-3.5 w-3.5 opacity-70" />
                  <span className="truncate">{`${'  '.repeat(depth)}${folder.name}`}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {canManageProject && (
          <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={bulkBusy} onClick={() => setIsBulkDeleteOpen(true)}>
            <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
            {t('delete')}
          </Button>
          )}

          <span className="flex-1" />
          {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            <X className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
            {t('clearSelection')}
          </Button>
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────────── */}
      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('loading')}>
          <RequirementsSkeleton viewMode={viewMode} />
        </div>
      ) : paginatedRequirements.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-[18rem] flex-col items-center justify-center gap-4 p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">
                {hasActiveFilters ? t('noRequirementsFound') : t('noRequirements')}
              </h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                {hasActiveFilters ? t('tryAdjustingSearch') : t('getStartedCreating')}
              </p>
            </div>
            {hasActiveFilters ? (
              <Button variant="outline" onClick={clearAllFilters}>{t('clearFilters')}</Button>
            ) : (
              <Button className="gap-2" onClick={handleOpenCreateDialog}>
                <Plus className="h-4 w-4" />
                {t('addRequirement')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : viewMode === 'table' ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                      onCheckedChange={toggleSelectAllPage}
                      aria-label={t('selectAllOnPage')}
                    />
                  </TableHead>
                  <SortableHead label={t('reqId')} column="requirement_id" sortBy={sortBy} onSort={toggleSort} SortIndicator={SortIndicator} className="w-32" />
                  <SortableHead label={t('title')} column="title" sortBy={sortBy} onSort={toggleSort} SortIndicator={SortIndicator} />
                  <SortableHead label={t('status')} column="status" sortBy={sortBy} onSort={toggleSort} SortIndicator={SortIndicator} />
                  <SortableHead label={t('priority')} column="priority" sortBy={sortBy} onSort={toggleSort} SortIndicator={SortIndicator} />
                  <SortableHead label={t('coverage')} column="coverage" sortBy={sortBy} onSort={toggleSort} SortIndicator={SortIndicator} />
                  <SortableHead label={t('created')} column="created_at" sortBy={sortBy} onSort={toggleSort} SortIndicator={SortIndicator} />
                  <TableHead className={isRTL ? 'text-left' : 'text-right'}>{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRequirements.map((requirement) => {
                  const selected = selectedIds.has(requirement.id);
                  return (
                    <TableRow key={requirement.id} data-state={selected ? 'selected' : undefined} className="group">
                      <TableCell>
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleSelect(requirement.id)}
                          aria-label={t('selectRequirement', { id: requirement.requirement_id })}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-xs text-muted-foreground">{requirement.requirement_id}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyRequirementId(requirement)}
                            className="text-muted-foreground/60 opacity-0 transition hover:text-foreground group-hover:opacity-100"
                            aria-label={t('copyRequirementId')}
                            title={copiedKeyId === requirement.id ? t('copied') : t('copyRequirementId')}
                          >
                            {copiedKeyId === requirement.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyRequirementLink(requirement)}
                            className="text-muted-foreground/60 opacity-0 transition hover:text-foreground group-hover:opacity-100"
                            aria-label={t('copyRequirementLink')}
                            title={copiedLinkId === requirement.id ? t('linkCopied') : t('copyRequirementLink')}
                          >
                            {copiedLinkId === requirement.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Link2 className="h-3 w-3" />}
                          </button>
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[28rem]">
                        <button
                          type="button"
                          onClick={() => handleViewRequirement(requirement)}
                          className={`block max-w-full truncate font-medium transition hover:text-primary hover:underline ${isRTL ? 'text-right' : 'text-left'}`}
                          title={requirement.title}
                        >
                          {requirement.title}
                        </button>
                        {requirement.tags && requirement.tags.trim() && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {requirement.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 3).map((tag, i) => (
                              <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={`gap-1 border-0 ${getStatusBadge(requirement.status)}`}>
                          {getStatusIcon(requirement.status)}
                          <span className="capitalize">{t(requirement.status as any)}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`border-0 ${getPriorityBadge(requirement.priority)}`}>
                          <span className="capitalize">{t(requirement.priority as any)}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>{renderCoverageBadge(requirement)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatReqDate(requirement.created_at)}
                      </TableCell>
                      <TableCell className={isRTL ? 'text-left' : 'text-right'}>
                        <div className={`flex items-center gap-0.5 ${isRTL ? 'justify-start' : 'justify-end'}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title={t('view')} aria-label={t('view')} onClick={() => handleViewRequirement(requirement)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title={t('edit')} aria-label={t('edit')} onClick={() => handleEditRequirement(requirement)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          {canManageProject && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40" title={t('delete')} aria-label={t('delete')} onClick={() => openDeleteDialog(requirement)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Checkbox
              checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
              onCheckedChange={toggleSelectAllPage}
              aria-label={t('selectAllOnPage')}
            />
            <span>{t('selectAllOnPage')}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {paginatedRequirements.map((requirement) => {
              const selected = selectedIds.has(requirement.id);
              return (
                <article
                  key={requirement.id}
                  className={`group flex flex-col rounded-2xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-foreground/15'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleSelect(requirement.id)}
                        aria-label={t('selectRequirement', { id: requirement.requirement_id })}
                      />
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono text-xs text-muted-foreground">{requirement.requirement_id}</span>
                        <button
                          type="button"
                          onClick={() => handleCopyRequirementId(requirement)}
                          className="text-muted-foreground/60 transition hover:text-foreground"
                          aria-label={t('copyRequirementId')}
                          title={copiedKeyId === requirement.id ? t('copied') : t('copyRequirementId')}
                        >
                          {copiedKeyId === requirement.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyRequirementLink(requirement)}
                          className="text-muted-foreground/60 transition hover:text-foreground"
                          aria-label={t('copyRequirementLink')}
                          title={copiedLinkId === requirement.id ? t('linkCopied') : t('copyRequirementLink')}
                        >
                          {copiedLinkId === requirement.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Link2 className="h-3 w-3" />}
                        </button>
                      </span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label={t('actions')}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => handleViewRequirement(requirement)}><Eye className="mr-2 h-3.5 w-3.5" />{t('view')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEditRequirement(requirement)}><Edit className="mr-2 h-3.5 w-3.5" />{t('edit')}</DropdownMenuItem>
                        {canManageProject && (<>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => openDeleteDialog(requirement)} className="text-rose-600 focus:text-rose-700 dark:text-rose-400"><Trash2 className="mr-2 h-3.5 w-3.5" />{t('delete')}</DropdownMenuItem>
                        </>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleViewRequirement(requirement)}
                    className={`mt-2 block w-full truncate text-base font-semibold tracking-tight transition group-hover:text-primary ${isRTL ? 'text-right' : 'text-left'}`}
                    title={requirement.title}
                  >
                    {requirement.title}
                  </button>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {toDisplayText(requirement.description) || t('noDescriptionProvided')}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge className={`gap-1 border-0 ${getStatusBadge(requirement.status)}`}>
                      {getStatusIcon(requirement.status)}
                      <span className="capitalize">{t(requirement.status as any)}</span>
                    </Badge>
                    <Badge className={`border-0 ${getPriorityBadge(requirement.priority)}`}>
                      <span className="capitalize">{t(requirement.priority as any)}</span>
                    </Badge>
                    {renderCoverageBadge(requirement)}
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {requirement.estimated_effort ? t('estimatedEffort', { effort: requirement.estimated_effort }) : formatReqDate(requirement.created_at)}
                    </span>
                    <button type="button" onClick={() => handleViewRequirement(requirement)} className="font-medium text-primary hover:underline">
                      {t('view')}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Requirement Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => !open && handleDialogClose('edit')}>
        {renderRequirementDialogContent('edit')}
      </Dialog>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent isRTL={isRTL}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsavedChangesTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('unsavedChangesModalMessage')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleUnsavedCancel}>
              {t('keepEditingModal')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleUnsavedConfirm(isCreateDialogOpen ? 'create' : 'edit')}
              className="bg-red-600 hover:bg-red-700"
            >
              {t('discardChangesModal')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent isRTL={isRTL} className="sm:max-w-[95vw] md:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className={`h-5 w-5 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('deleteRequirementConfirm')}
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t('aboutToDeleteRequirement')}
            </AlertDialogDescription>
            <div className="space-y-4">
              <div className="text-sm">
                <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {t('aboutToDeleteRequirement')}
                </p>
                <p className="font-bold text-lg text-red-600 dark:text-red-400 mb-3">
                  "{requirementToDelete?.title}"
                </p>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mb-3">
                  <p className="font-semibold text-red-800 dark:text-red-200 mb-2">
                    {t('actionWillDelete')}
                  </p>
                  <ul className={`text-xs text-red-700 dark:text-red-300 space-y-1 ${isRTL ? 'mr-4' : 'ml-4'} list-disc`}>
                    <li>{t('deleteRequirementItem1')}</li>
                    <li>{t('deleteRequirementItem2')}</li>
                    <li>{t('deleteRequirementItem3')}</li>
                    <li>{t('deleteRequirementItem4')}</li>
                  </ul>
                </div>
                <p className="text-red-600 dark:text-red-400 font-semibold mb-2">
                  {t('cannotUndo')}
                </p>
                <div className="mt-4">
                  <Label htmlFor="confirm-name" className="text-sm font-medium">
                    {t('toConfirmTypeTitle')} <span className="font-bold">{requirementToDelete?.title}</span>
                  </Label>
                  <Input
                    id="confirm-name"
                    value={deleteConfirmationName}
                    onChange={(e) => setDeleteConfirmationName(e.target.value)}
                    placeholder={t('typeRequirementTitle')}
                    className="mt-2"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsDeleteDialogOpen(false);
              setRequirementToDelete(null);
              setDeleteConfirmationName('');
            }}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRequirement}
              disabled={deleteConfirmationName.trim().toLowerCase() !== requirementToDelete?.title?.trim().toLowerCase()}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {t('deleteRequirement')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <AlertDialogContent isRTL={isRTL}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              {t('bulkDeleteTitle', { count: selectedIds.size })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('bulkDeleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleBulkDelete(); }}
              disabled={bulkBusy}
              className="bg-red-600 hover:bg-red-700"
            >
              {bulkBusy ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('deleteSelected')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save current view */}
      <Dialog open={isSaveViewOpen} onOpenChange={setIsSaveViewOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('saveCurrentView')}</DialogTitle>
            <DialogDescription>{t('saveViewDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="view-name">{t('viewName')}</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder={t('viewNamePlaceholder')}
                autoFocus
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700">
              <Label htmlFor="view-default" className="text-sm">{t('viewMakeDefault')}</Label>
              <Switch id="view-default" checked={viewDefault} onCheckedChange={setViewDefault} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700">
              <Label htmlFor="view-shared" className="text-sm">{t('viewShareWithTeam')}</Label>
              <Switch id="view-shared" checked={viewShared} onCheckedChange={setViewShared} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveViewOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleSaveView} disabled={savingView || !viewName.trim()}>
              {savingView ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Bookmark className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {totalPages > 1 && filteredRequirements.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row">
          <div className="text-sm text-muted-foreground">
            {t('showingRequirements', { start: startIndex + 1, end: Math.min(startIndex + itemsPerPage, filteredRequirements.length), total: filteredRequirements.length })}
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(itemsPerPage)} onValueChange={(value) => setItemsPerPage(Number(value))}>
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>{t('perPage', { count: size })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
              disabled={safePage === 1}
            >
              {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              {t('previous')}
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t('pageOf', { current: safePage, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage === totalPages}
            >
              {t('next')}
              {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* Folder create / edit dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={(open) => { if (!folderSaving) setFolderDialogOpen(open); }}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{folderDialogMode === 'edit' ? t('editFolder') : t('createFolder')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="folder-name">{t('folderName')}</Label>
              <Input
                id="folder-name"
                value={folderForm.name}
                maxLength={255}
                autoFocus
                placeholder={t('folderNamePlaceholder')}
                onChange={(e) => setFolderForm((p) => ({ ...p, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && folderForm.name.trim()) { e.preventDefault(); handleSaveFolder(); } }}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('parentFolder')}</Label>
              <Select value={folderForm.parent_folder_id} onValueChange={(v) => setFolderForm((p) => ({ ...p, parent_folder_id: v }))}>
                <SelectTrigger><SelectValue placeholder={t('rootLevel')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">{t('rootLevel')}</SelectItem>
                  {folderParentOptions.map(({ folder, depth }) => (
                    <SelectItem key={folder.id} value={String(folder.id)}>{`${'  '.repeat(depth)}${folder.name}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)} disabled={folderSaving}>{t('cancel')}</Button>
            <Button onClick={handleSaveFolder} disabled={folderSaving || !folderForm.name.trim()} className="gap-2">
              {folderSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {folderDialogMode === 'edit' ? t('save') : t('createFolder')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </div>
    </div>
  );
}

/* ── Presentational helpers ──────────────────────────────────────────────── */

type IconType = typeof FileText;

function SummaryChip({ icon: Icon, label, value, tone = 'muted' }: {
  icon: IconType;
  label: string;
  value: string | number;
  tone?: 'muted' | 'emerald' | 'amber' | 'rose';
}) {
  const toneCls: Record<string, string> = {
    muted: 'text-muted-foreground',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
  };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-2.5 py-1 text-xs">
      <Icon className={`h-3.5 w-3.5 ${toneCls[tone]}`} />
      <span className="font-semibold text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function FolderRailItem({ active, icon: Icon, label, count, onClick }: {
  active: boolean;
  icon: IconType;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
        active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate text-start">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

function CollapsedRailItem({ active, icon: Icon, label, count, onClick }: {
  active: boolean;
  icon: IconType;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label} (${count})`}
      aria-label={`${label} (${count})`}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-muted px-1 text-[9px] font-medium leading-none text-muted-foreground ring-1 ring-card">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

function ViewToggleButton({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: IconType;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`flex h-8 items-center justify-center rounded-md px-2.5 text-sm font-medium transition ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function FilterChip({ label, icon: Icon, onClear }: { label: string; icon?: IconType; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 py-1 pe-1 ps-2 text-xs">
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className="max-w-[160px] truncate">{label}</span>
      <button type="button" onClick={onClear} className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function SortableHead({ label, column, sortBy, onSort, SortIndicator, className }: {
  label: string;
  column: any;
  sortBy: any;
  onSort: (c: any) => void;
  SortIndicator: (props: { column: any }) => ReactNode;
  className?: string;
}) {
  const active = sortBy === column;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`flex items-center gap-1 transition hover:text-foreground ${active ? 'text-foreground' : ''}`}
      >
        {label}
        <SortIndicator column={column} />
      </button>
    </TableHead>
  );
}

function RequirementsSkeleton({ viewMode }: { viewMode: 'table' | 'grid' }) {
  if (viewMode === 'grid') {
    return (
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex justify-between">
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              <div className="h-4 w-4 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="flex gap-2 pt-1">
              <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border p-3 last:border-b-0">
          <div className="h-4 w-4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
