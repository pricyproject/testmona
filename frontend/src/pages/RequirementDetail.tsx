import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Calendar, Clock, ExternalLink, Eye, EyeOff, FileText, History, ListChecks, MoreVertical, Play, Plus, Settings2, Tag, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { GherkinViewer } from '@/components/requirements/GherkinViewer';
import { isGherkinText } from '@/components/requirements/gherkin';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { requirementsAPI, sectionsAPI, testSuitesAPI } from '@/lib/api';
import { Requirement, RequirementLinkedTestCase, RequirementLinkedTestCaseHistoryItem, RequirementRelationshipSummary, RequirementTraceabilitySummary, TestCaseSection, TestSuite } from '@/types';

const decodeHtmlEntities = (value?: string | null): string => {
  if (!value) return '';
  if (typeof window === 'undefined') return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
};

const htmlToReadableText = (value?: string | null): string => {
  const decoded = decodeHtmlEntities(value);
  if (!decoded.trim()) return '';
  if (typeof window === 'undefined' || !/<[a-z][\s\S]*>/i.test(decoded)) {
    return decoded;
  }

  const parser = new DOMParser();
  const documentValue = parser.parseFromString(decoded, 'text/html');
  return documentValue.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() || decoded;
};

const formatDate = (value?: string | null): string => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const getStatusBadge = (status: string) => {
  const variants: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    reviewed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    implemented: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
    verified: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    deprecated: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  };
  return variants[status] || variants.draft;
};

const getPriorityBadge = (priority: string) => {
  const variants: Record<string, string> = {
    low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    high: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    critical: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  };
  return variants[priority] || variants.medium;
};

const getReferenceTokens = (value?: string | null): string[] =>
  Array.from(new Set([
    ...(value || '')
    .split(/[\s,;|]+/)
    .map((token) => token.replace(/^[([{"']+|[\])}"'.,]+$/g, '').trim().toLowerCase()),
    ...((value || '').match(/[a-z]+-\d+/gi) || []).map((token) => token.toLowerCase()),
  ].filter(Boolean)));

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const addRequirementReference = (value: string | undefined, requirementRef: string): string => {
  const existing = (value || '').trim();
  if (getReferenceTokens(existing).includes(requirementRef.toLowerCase())) return existing;
  return existing ? `${existing}, ${requirementRef}` : requirementRef;
};

const removeRequirementReference = (value: string | undefined, requirementRef: string): string => {
  const pattern = new RegExp(`(^|[\\s,;|])${escapeRegExp(requirementRef)}(?=$|[\\s,;|])`, 'gi');
  return (value || '')
    .replace(pattern, (_match, prefix: string) => (prefix.trim() ? prefix : ''))
    .replace(/\s*([,;|])\s*/g, '$1 ')
    .replace(/^[,;|\s]+|[,;|\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const TEST_CASE_STATUSES = ['active', 'inactive', 'archived'];
const TEST_CASE_PRIORITIES = ['low', 'medium', 'high', 'critical'];

const emptyTraceabilitySummary: RequirementTraceabilitySummary = {
  linked_count: 0,
  active_count: 0,
  missing_coverage: 1,
  failed_related_runs: 0,
  blocked_related_runs: 0,
};

type SourceDoc = {
  heading: string;
  sourceUrl: string;
  body: string;
  intro: string;
};

const extractSourceDocument = (rawDescription?: string | null): SourceDoc | null => {
  const decoded = decodeHtmlEntities(rawDescription);
  if (typeof window !== 'undefined' && /data-requirement-source=/i.test(decoded)) {
    const parser = new DOMParser();
    const documentValue = parser.parseFromString(decoded, 'text/html');
    const sourceElement = documentValue.querySelector<HTMLElement>('[data-requirement-source="true"]');
    if (sourceElement) {
      const heading = sourceElement.querySelector('h1,h2,h3')?.textContent?.trim() || 'Source document';
      const sourceUrl = sourceElement.getAttribute('data-requirement-source-url') || '';
      const body = sourceElement.querySelector('pre')?.textContent?.trim() || '';
      sourceElement.remove();
      const intro = documentValue.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() || '';
      return { heading, sourceUrl, body, intro };
    }
  }

  const description = htmlToReadableText(rawDescription);
  const lines = description.split(/\r?\n/);
  const sourceIndex = lines.findIndex((line) => /^Source:\s*https?:\/\//i.test(line.trim()));
  if (sourceIndex === -1) return null;

  const headingIndex = [...lines.slice(0, sourceIndex).keys()]
    .reverse()
    .find((index) => lines[index].trim() && !/^Key:\s*/i.test(lines[index].trim()) && lines[index].trim() !== '---');
  const heading = headingIndex !== undefined ? lines[headingIndex].trim() : 'Source document';
  const sourceUrl = lines[sourceIndex].replace(/^Source:\s*/i, '').trim();
  const bodyStart = lines.findIndex((line, index) => index > sourceIndex && line.trim() === '');
  const body = lines.slice(bodyStart === -1 ? sourceIndex + 1 : bodyStart + 1).join('\n').trim();
  const intro = lines.slice(0, headingIndex ?? 0).join('\n').replace(/---\s*$/g, '').trim();
  return { heading, sourceUrl, body, intro };
};

export function RequirementDetail() {
  const { projectId, requirementId } = useParams<{ projectId: string; requirementId: string }>();
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [testSuites, setTestSuites] = useState<TestSuite[]>([]);
  const [sections, setSections] = useState<TestCaseSection[]>([]);
  const [linkedTestCases, setLinkedTestCases] = useState<RequirementLinkedTestCase[]>([]);
  const [linkedTestCasesTotal, setLinkedTestCasesTotal] = useState(0);
  const [availableTestCases, setAvailableTestCases] = useState<RequirementLinkedTestCase[]>([]);
  const [availableTestCasesTotal, setAvailableTestCasesTotal] = useState(0);
  const [linkedTestCasesLoading, setLinkedTestCasesLoading] = useState(false);
  const [availableTestCasesLoading, setAvailableTestCasesLoading] = useState(false);
  const [linkedTestCasesError, setLinkedTestCasesError] = useState('');
  const [relationshipError, setRelationshipError] = useState('');
  const [traceabilitySummary, setTraceabilitySummary] = useState<RequirementTraceabilitySummary>(emptyTraceabilitySummary);
  const [linkHistory, setLinkHistory] = useState<RequirementLinkedTestCaseHistoryItem[]>([]);
  const [linkHistoryTotal, setLinkHistoryTotal] = useState(0);
  const [relationships, setRelationships] = useState<RequirementRelationshipSummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showLinkHistory, setShowLinkHistory] = useState(false);
  const [visibleLinkedTestCasesCount, setVisibleLinkedTestCasesCount] = useState(10);
  const [selectedAvailableTestCaseIds, setSelectedAvailableTestCaseIds] = useState<number[]>([]);
  const [testCaseSearchQuery, setTestCaseSearchQuery] = useState('');
  const [linkedSearchQuery, setLinkedSearchQuery] = useState('');
  const [linkedStatusFilter, setLinkedStatusFilter] = useState('all');
  const [linkedPriorityFilter, setLinkedPriorityFilter] = useState('all');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [refreshLinkedKey, setRefreshLinkedKey] = useState(0);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creatingTestCase, setCreatingTestCase] = useState(false);
  const [newTestCaseForm, setNewTestCaseForm] = useState({
    title: '',
    description: '',
    test_suite_id: '',
    section_id: 'none',
    priority: 'medium',
    status: 'active',
    expected_result: '',
  });
  const [showMetadata, setShowMetadata] = useState(true);
  const [showSourceDocument, setShowSourceDocument] = useState(true);
  const [showAcceptanceCriteria, setShowAcceptanceCriteria] = useState(true);
  const [showLinkedTestCases, setShowLinkedTestCases] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadRequirement = async () => {
      if (!projectId || !requirementId) return;
      setLoading(true);
      try {
        const numericId = Number(requirementId);
        let data: Requirement | null = null;

        if (Number.isInteger(numericId) && numericId > 0) {
          data = await requirementsAPI.getById(numericId);
        } else {
          const requirements = await requirementsAPI.getAll(Number(projectId), 0, 1000);
          data = requirements.find((item: Requirement) => item.requirement_id.toLowerCase() === decodeURIComponent(requirementId).toLowerCase()) || null;
        }

        if (!isMounted) return;
        if (data && Number(data.project_id) === Number(projectId)) {
          setRequirement(data);
          setVisibleLinkedTestCasesCount(10);
          setSelectedAvailableTestCaseIds([]);
          setTestCaseSearchQuery('');
          setLinkedSearchQuery('');
          setLinkedStatusFilter('all');
          setLinkedPriorityFilter('all');
          setShowLinkHistory(false);
          setRelationships(null);
          setRelationshipError('');
        } else {
          setRequirement(null);
        }
      } catch (error: any) {
        console.error('Failed to load requirement:', error);
        if (isMounted) setRequirement(null);
        toast({
          title: t('error'),
          description: error.response?.data?.detail || t('failedToLoadRequirements'),
          variant: 'destructive',
        });
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadRequirement();
    return () => {
      isMounted = false;
    };
  }, [projectId, requirementId, t, toast]);

  useEffect(() => {
    let isMounted = true;

    const loadRequirementOptions = async () => {
      if (!projectId || !requirement?.id) {
        setTestSuites([]);
        setSections([]);
        return;
      }

      try {
        const [loadedSuites, loadedSections] = await Promise.all([
          testSuitesAPI.getAll(Number(projectId), 0, 500),
          sectionsAPI.getByProject(Number(projectId), 0, 1000),
        ]);
        if (!isMounted) return;
        setTestSuites(loadedSuites || []);
        setSections(loadedSections || []);
        setNewTestCaseForm((current) => (
          current.test_suite_id || !loadedSuites?.[0]?.id
            ? current
            : { ...current, test_suite_id: String(loadedSuites[0].id) }
        ));
      } catch (error) {
        console.error('Failed to load requirement test case options:', error);
        if (!isMounted) return;
        setTestSuites([]);
        setSections([]);
      }
    };

    loadRequirementOptions();
    return () => {
      isMounted = false;
    };
  }, [projectId, requirement?.id]);

  useEffect(() => {
    let isMounted = true;

    const loadLinkedTestCases = async () => {
      if (!requirement?.id) {
        setLinkedTestCases([]);
        setLinkedTestCasesTotal(0);
        setTraceabilitySummary(emptyTraceabilitySummary);
        return;
      }

      setLinkedTestCasesLoading(true);
      setLinkedTestCasesError('');
      try {
        const data = await requirementsAPI.searchTestCases(requirement.id, {
          linked: true,
          search: linkedSearchQuery.trim() || undefined,
          status: linkedStatusFilter === 'all' ? undefined : linkedStatusFilter,
          priority: linkedPriorityFilter === 'all' ? undefined : linkedPriorityFilter,
          skip: 0,
          limit: visibleLinkedTestCasesCount,
        });
        if (!isMounted) return;
        setLinkedTestCases(data.items || []);
        setLinkedTestCasesTotal(data.total || 0);
        setTraceabilitySummary(data.summary || emptyTraceabilitySummary);
      } catch (error) {
        console.error('Failed to load linked test cases:', error);
        if (!isMounted) return;
        setLinkedTestCases([]);
        setLinkedTestCasesTotal(0);
        setLinkedTestCasesError(t('failedToLoadLinkedTestCases'));
      } finally {
        if (isMounted) setLinkedTestCasesLoading(false);
      }
    };

    loadLinkedTestCases();
    return () => {
      isMounted = false;
    };
  }, [requirement?.id, linkedSearchQuery, linkedStatusFilter, linkedPriorityFilter, visibleLinkedTestCasesCount, refreshLinkedKey, t]);

  useEffect(() => {
    let isMounted = true;

    const loadAvailableTestCases = async () => {
      if (!requirement?.id) {
        setAvailableTestCases([]);
        setAvailableTestCasesTotal(0);
        return;
      }

      const searchValue = testCaseSearchQuery.trim();
      if (searchValue.length < 2) {
        setAvailableTestCases([]);
        setAvailableTestCasesTotal(0);
        setSelectedAvailableTestCaseIds([]);
        return;
      }

      setAvailableTestCasesLoading(true);
      try {
        const data = await requirementsAPI.searchTestCases(requirement.id, {
          linked: false,
          search: searchValue,
          skip: 0,
          limit: 10,
        });
        if (!isMounted) return;
        setAvailableTestCases(data.items || []);
        setAvailableTestCasesTotal(data.total || 0);
        setSelectedAvailableTestCaseIds((current) => current.filter((id) => (data.items || []).some((testCase: RequirementLinkedTestCase) => testCase.id === id)));
      } catch (error) {
        console.error('Failed to load available test cases:', error);
        if (isMounted) {
          setAvailableTestCases([]);
          setAvailableTestCasesTotal(0);
        }
      } finally {
        if (isMounted) setAvailableTestCasesLoading(false);
      }
    };

    loadAvailableTestCases();
    return () => {
      isMounted = false;
    };
  }, [requirement?.id, testCaseSearchQuery, refreshLinkedKey]);

  useEffect(() => {
    let isMounted = true;

    const loadRequirementRelationships = async () => {
      if (!requirement?.id) {
        setRelationships(null);
        setRelationshipError('');
        return;
      }

      try {
        const data = await requirementsAPI.getRelationships(requirement.id);
        if (isMounted) {
          setRelationships(data);
          setRelationshipError('');
        }
      } catch (error) {
        console.error('Failed to load requirement relationships:', error);
        if (isMounted) {
          setRelationships(null);
          setRelationshipError(t('failedToLoadRequirementRelationships'));
        }
      }
    };

    loadRequirementRelationships();
    return () => {
      isMounted = false;
    };
  }, [requirement?.id, refreshLinkedKey, t]);

  useEffect(() => {
    let isMounted = true;

    const loadLinkHistory = async () => {
      if (!requirement?.id) {
        setLinkHistory([]);
        setLinkHistoryTotal(0);
        return;
      }
      if (!showLinkHistory) {
        setLinkHistory([]);
        setLinkHistoryTotal(0);
        return;
      }

      setHistoryLoading(true);
      try {
        const data = await requirementsAPI.getTestCaseHistory(requirement.id, 0, 20);
        if (isMounted) {
          setLinkHistory(data.items || []);
          setLinkHistoryTotal(data.total || 0);
        }
      } catch (error) {
        console.error('Failed to load requirement test case history:', error);
        if (isMounted) {
          setLinkHistory([]);
          setLinkHistoryTotal(0);
        }
      } finally {
        if (isMounted) setHistoryLoading(false);
      }
    };

    loadLinkHistory();
    return () => {
      isMounted = false;
    };
  }, [requirement?.id, refreshLinkedKey, showLinkHistory]);

  const description = useMemo(() => htmlToReadableText(requirement?.description), [requirement?.description]);
  const acceptanceCriteria = useMemo(() => htmlToReadableText(requirement?.acceptance_criteria), [requirement?.acceptance_criteria]);
  const sourceDocument = useMemo(() => extractSourceDocument(requirement?.description), [requirement?.description]);
  const tags = useMemo(() => requirement?.tags?.split(',').map((tag) => tag.trim()).filter(Boolean) || [], [requirement?.tags]);
  const hasGherkin = isGherkinText(acceptanceCriteria);
  const visibleLinkedTestCases = linkedTestCases;
  const hasMoreLinkedTestCases = linkedTestCasesTotal > visibleLinkedTestCases.length;
  const newTestCaseSections = useMemo(() => {
    if (!newTestCaseForm.test_suite_id) return [];
    return sections.filter((section) => String(section.test_suite_id) === newTestCaseForm.test_suite_id);
  }, [newTestCaseForm.test_suite_id, sections]);

  const backPath = projectId ? `/projects/${projectId}/requirements` : '/projects';

  const refreshRequirementLinks = () => setRefreshLinkedKey((current) => current + 1);

  const handleBulkLink = async (testCaseIds: number[]) => {
    if (!requirement || testCaseIds.length === 0) return;
    setBulkUpdating(true);
    try {
      await requirementsAPI.bulkUpdateTestCases(requirement.id, { test_case_ids: testCaseIds, action: 'link' });
      setSelectedAvailableTestCaseIds([]);
      refreshRequirementLinks();
      toast({ title: t('success'), description: t('testCasesLinkedToRequirement', { count: testCaseIds.length }) });
    } catch (error: any) {
      console.error('Failed to link test cases:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToUpdateLinkedTestCase'),
        variant: 'destructive',
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkUnlink = async (testCaseIds: number[]) => {
    if (!requirement || testCaseIds.length === 0) return;
    setBulkUpdating(true);
    try {
      await requirementsAPI.bulkUpdateTestCases(requirement.id, { test_case_ids: testCaseIds, action: 'unlink' });
      refreshRequirementLinks();
      toast({ title: t('success'), description: t('testCasesUnlinkedFromRequirement', { count: testCaseIds.length }) });
    } catch (error: any) {
      console.error('Failed to unlink test cases:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToUpdateLinkedTestCase'),
        variant: 'destructive',
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  const toggleAvailableSelection = (testCaseId: number) => {
    setSelectedAvailableTestCaseIds((current) => (
      current.includes(testCaseId) ? current.filter((id) => id !== testCaseId) : [...current, testCaseId]
    ));
  };

  const resetCreateForm = () => {
    setNewTestCaseForm({
      title: '',
      description: '',
      test_suite_id: testSuites[0]?.id ? String(testSuites[0].id) : '',
      section_id: 'none',
      priority: 'medium',
      status: 'active',
      expected_result: '',
    });
  };

  const handleCreateAndLinkTestCase = async () => {
    if (!requirement) return;
    if (!newTestCaseForm.title.trim() || !newTestCaseForm.test_suite_id) {
      toast({
        title: t('error'),
        description: t('testCaseTitleAndSuiteRequired'),
        variant: 'destructive',
      });
      return;
    }

    setCreatingTestCase(true);
    try {
      await requirementsAPI.createAndLinkTestCase(requirement.id, {
        title: newTestCaseForm.title.trim(),
        description: newTestCaseForm.description.trim() || undefined,
        test_type: 'manual',
        preconditions: 'No preconditions defined',
        steps: 'No steps defined',
        expected_result: newTestCaseForm.expected_result.trim() || 'No expected results defined',
        priority: newTestCaseForm.priority,
        status: newTestCaseForm.status,
        reference: requirement.requirement_id,
        test_suite_id: Number(newTestCaseForm.test_suite_id),
        section_id: newTestCaseForm.section_id === 'none' ? undefined : Number(newTestCaseForm.section_id),
      });
      resetCreateForm();
      setCreateDialogOpen(false);
      refreshRequirementLinks();
      toast({ title: t('success'), description: t('testCaseCreatedAndLinked') });
    } catch (error: any) {
      console.error('Failed to create and link test case:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToCreateAndLinkTestCase'),
        variant: 'destructive',
      });
    } finally {
      setCreatingTestCase(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="h-40 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="h-96 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
          <div className="h-96 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  if (!requirement) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <Card className="max-w-lg text-center">
          <CardHeader>
            <CardTitle>{t('requirementNotFound')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-500">{t('requirementNotFoundDesc')}</p>
            <Button onClick={() => navigate(backPath)}>{t('backToRequirements')}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 dark:bg-slate-950" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mx-auto max-w-6xl space-y-6">
        <Button variant="ghost" className="-mx-3 text-slate-600 dark:text-slate-300" onClick={() => navigate(backPath)}>
          {isRTL ? <ArrowRight className="ml-2 h-4 w-4" /> : <ArrowLeft className="mr-2 h-4 w-4" />}
          {t('backToRequirements')}
        </Button>

        <header className="rounded-md border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">{requirement.requirement_id}</Badge>
                <Badge className={getStatusBadge(requirement.status)}>{requirement.status}</Badge>
                <Badge className={getPriorityBadge(requirement.priority)}>{requirement.priority}</Badge>
                {hasGherkin && <Badge className="bg-indigo-600 text-white">{t('gherkinSyntax')}</Badge>}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('readingView')}</p>
                <h1 className="max-w-4xl break-words text-3xl font-semibold tracking-tight text-slate-950 dark:text-white lg:text-4xl">
                  {requirement.title}
                </h1>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <Settings2 className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                    {t('displayOptions')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-56">
                  <DropdownMenuLabel>{t('requirementView')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {sourceDocument && (
                    <DropdownMenuCheckboxItem
                      checked={showSourceDocument}
                      onCheckedChange={setShowSourceDocument}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {showSourceDocument ? <Eye className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} /> : <EyeOff className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />}
                      {t('sourceDocument')}
                    </DropdownMenuCheckboxItem>
                  )}
                  <DropdownMenuCheckboxItem
                    checked={showAcceptanceCriteria}
                    onCheckedChange={setShowAcceptanceCriteria}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {showAcceptanceCriteria ? <Eye className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} /> : <EyeOff className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />}
                    {t('acceptanceCriteria')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showLinkedTestCases}
                    onCheckedChange={setShowLinkedTestCases}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <ListChecks className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                    {t('linkedTestCases')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showLinkHistory}
                    onCheckedChange={setShowLinkHistory}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <History className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                    {t('linkHistory')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showMetadata}
                    onCheckedChange={setShowMetadata}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {showMetadata ? <Eye className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} /> : <EyeOff className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />}
                    {t('metadata')}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={() => navigate(backPath)}>
                {t('viewAll')}
              </Button>
            </div>
          </div>
        </header>

        <div className={`grid gap-6 ${showMetadata ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
          <main className="space-y-6">
            {sourceDocument && showSourceDocument && (
              <section className="rounded-md border border-blue-200 bg-blue-50/70 p-5 dark:border-blue-900/60 dark:bg-blue-950/30">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{t('sourceDocument')}</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{sourceDocument.heading}</h2>
                  </div>
                  <a
                    href={sourceDocument.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-950 dark:text-blue-300 dark:hover:bg-blue-950"
                  >
                    <ExternalLink className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                    {t('openSource')}
                  </a>
                </div>
                {sourceDocument.body && (
                  <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                    {sourceDocument.body}
                  </p>
                )}
              </section>
            )}

            <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-950 dark:text-white">
                <FileText className="h-5 w-5 text-slate-500" />
                {t('description')}
              </h2>
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                {sourceDocument ? sourceDocument.intro || t('sourceDocumentImported') : description || t('noDescriptionProvided')}
              </p>
            </section>

            {showAcceptanceCriteria && (
              <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-4 text-xl font-semibold text-slate-950 dark:text-white">{t('acceptanceCriteria')}</h2>
                {hasGherkin ? (
                  <GherkinViewer value={acceptanceCriteria} emptyLabel={t('noAcceptanceCriteriaProvided')} />
                ) : (
                  <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                    {acceptanceCriteria || t('noAcceptanceCriteriaProvided')}
                  </p>
                )}
              </section>
            )}

            {showLinkedTestCases && (
              <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-950 dark:text-white">
                      <ListChecks className="h-5 w-5 text-slate-500" />
                      {t('linkedTestCases')}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {t('showingLinkedTestCases', { shown: Math.min(visibleLinkedTestCases.length, linkedTestCasesTotal), total: linkedTestCasesTotal })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)}>
                      <Plus className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                      {t('createAndLinkTestCase')}
                    </Button>
                    <Badge variant="secondary">{traceabilitySummary.linked_count}</Badge>
                  </div>
                </div>

                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryTile label={t('linkedCount')} value={traceabilitySummary.linked_count} />
                  <SummaryTile label={t('activeCount')} value={traceabilitySummary.active_count} />
                  <SummaryTile label={t('relatedDefects')} value={relationships?.defects.total ?? 0} />
                  <SummaryTile label={t('relatedTestRuns')} value={relationships?.test_runs.total ?? 0} />
                </div>
                {relationshipError && (
                  <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                    {relationshipError}
                  </p>
                )}

                <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_170px]">
                    <Input
                      value={linkedSearchQuery}
                      onChange={(event) => {
                        setLinkedSearchQuery(event.target.value);
                        setVisibleLinkedTestCasesCount(10);
                      }}
                      placeholder={t('searchLinkedTestCases')}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={linkedStatusFilter} onValueChange={(value) => { setLinkedStatusFilter(value); setVisibleLinkedTestCasesCount(10); }}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('status')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('allStatuses')}</SelectItem>
                          {TEST_CASE_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={linkedPriorityFilter} onValueChange={(value) => { setLinkedPriorityFilter(value); setVisibleLinkedTestCasesCount(10); }}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('priority')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('allPriorities')}</SelectItem>
                          {TEST_CASE_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setLinkDialogOpen(true)}
                    >
                      <Plus className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                      {t('linkExistingTestCases')}
                    </Button>
                  </div>
                </div>

                {linkedTestCasesLoading ? (
                  <div className="space-y-2">
                    <div className="h-14 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                    <div className="h-14 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                  </div>
                ) : linkedTestCasesError ? (
                  <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                    {linkedTestCasesError}
                  </p>
                ) : linkedTestCases.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
                    {t('noLinkedTestCasesForRequirement')}
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                      <div className="hidden grid-cols-[minmax(260px,1.5fr)_minmax(180px,0.75fr)_minmax(150px,0.65fr)] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 xl:grid">
                        <span className="whitespace-nowrap">{t('testCase')}</span>
                        <span className="whitespace-nowrap">{t('status')}</span>
                        <span className="whitespace-nowrap">{t('suite')}</span>
                      </div>
                      {visibleLinkedTestCases.map((testCase) => (
                        <div key={testCase.id} className={`relative grid gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 dark:border-slate-800 xl:grid-cols-[minmax(260px,1.5fr)_minmax(180px,0.75fr)_minmax(150px,0.65fr)] xl:items-start xl:gap-4 ${isRTL ? 'pl-14' : 'pr-14'}`}>
                          <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="font-mono">TC-{String(testCase.id).padStart(3, '0')}</Badge>
                              {testCase.reference && <span className="max-w-full truncate text-xs text-slate-500">{testCase.reference}</span>}
                            </div>
                            <button
                              type="button"
                              className={`block min-w-0 break-words text-sm font-medium leading-6 text-blue-700 [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-offset-slate-900 ${isRTL ? 'text-right' : 'text-left'}`}
                              onClick={() => navigate(`/projects/${projectId}/test-cases/${testCase.id}`)}
                            >
                              {testCase.title}
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={getPriorityBadge(testCase.priority)}>{testCase.priority}</Badge>
                            <Badge variant="secondary">{testCase.status}</Badge>
                            {testCase.latest_run_status && <Badge variant="outline">{testCase.latest_run_status}</Badge>}
                          </div>
                          <p className="min-w-0 break-words text-xs leading-5 text-slate-500 xl:truncate">
                            {testCase.suite_name || t('suite')}{testCase.section_name ? ` / ${testCase.section_name}` : ''}
                          </p>
                          <div className={`absolute top-3 ${isRTL ? 'left-3' : 'right-3'}`}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('actions')}>
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-48">
                                <DropdownMenuLabel>{t('actions')}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/test-cases/${testCase.id}/execute`)}>
                                  <Play className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                                  {t('execute')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/test-cases/${testCase.id}/execution-history`)}>
                                  <History className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                                  {t('executionHistory')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-rose-600 focus:bg-rose-50 focus:text-rose-700 dark:text-rose-300 dark:focus:bg-rose-950/30"
                                  onClick={() => handleBulkUnlink([testCase.id])}
                                  disabled={bulkUpdating}
                                >
                                  <X className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                                  {bulkUpdating ? t('removing') : t('remove')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                    {hasMoreLinkedTestCases && (
                      <div className="flex justify-center pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setVisibleLinkedTestCasesCount((current) => current + 10)}
                        >
                          {t('loadMore')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-6 rounded-md border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <History className="h-4 w-4 text-slate-500" />
                      {t('linkHistory')}
                      {showLinkHistory && linkHistoryTotal > 0 && <Badge variant="secondary">{linkHistoryTotal}</Badge>}
                    </h3>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="link-history-toggle" className="text-sm text-slate-600 dark:text-slate-300">
                        {showLinkHistory ? t('hideLinkHistory') : t('showLinkHistory')}
                      </Label>
                      <Switch
                        id="link-history-toggle"
                        checked={showLinkHistory}
                        onCheckedChange={setShowLinkHistory}
                      />
                    </div>
                  </div>
                  {showLinkHistory && (
                    <div className="mt-3">
                      {historyLoading ? (
                        <div className="h-12 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                      ) : linkHistory.length === 0 ? (
                        <p className="text-sm text-slate-500">{t('noLinkHistory')}</p>
                      ) : (
                        <div className="space-y-2">
                          {linkHistory.map((item) => (
                            <div key={item.id} className="flex flex-col gap-1 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-950/50 sm:flex-row sm:items-center sm:justify-between">
                              <span className="text-slate-700 dark:text-slate-300">
                                <Badge variant={item.action === 'link' ? 'default' : 'secondary'} className={isRTL ? 'ml-2' : 'mr-2'}>
                                  {item.action === 'link' ? t('linked') : t('unlinked')}
                                </Badge>
                                {item.test_case_id ? `TC-${String(item.test_case_id).padStart(3, '0')}` : t('testCase')} {item.test_case_title || ''}
                              </span>
                              <span className="text-xs text-slate-500">
                                {item.full_name || item.username || `${t('auditUser')} ${item.user_id}`} - {formatDate(item.created_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>

          {showMetadata && (
          <aside className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('metadata')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <MetaRow label={t('requirementId')} value={requirement.requirement_id} />
                <MetaRow label={t('status')} value={requirement.status} />
                <MetaRow label={t('priority')} value={requirement.priority} />
                <MetaRow label={t('created')} value={formatDate(requirement.created_at)} icon={<Calendar className="h-4 w-4" />} />
                <MetaRow label={t('updated')} value={formatDate(requirement.updated_at)} icon={<Calendar className="h-4 w-4" />} />
                {requirement.estimated_effort !== undefined && requirement.estimated_effort !== null && (
                  <MetaRow label={t('estimatedEffortHours')} value={`${requirement.estimated_effort}h`} icon={<Clock className="h-4 w-4" />} />
                )}
              </CardContent>
            </Card>

            {tags.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Tag className="h-4 w-4 text-slate-500" />
                    {t('tags')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                </CardContent>
              </Card>
            )}
          </aside>
          )}
        </div>

        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogContent isRTL={isRTL} className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('linkExistingTestCases')}</DialogTitle>
              <DialogDescription>{t('searchTestCasesToLink')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <Input
                value={testCaseSearchQuery}
                onChange={(event) => setTestCaseSearchQuery(event.target.value)}
                placeholder={t('searchTestCasesToLink')}
                disabled={availableTestCasesLoading}
              />
              {testCaseSearchQuery.trim().length < 2 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
                  {t('typeToSearchTestCases')}
                </p>
              ) : availableTestCasesLoading ? (
                <div className="space-y-2">
                  <div className="h-14 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                  <div className="h-14 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                </div>
              ) : availableTestCases.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
                  {testCaseSearchQuery.trim() ? t('noTestCasesMatchSearch') : t('noTestCasesAvailableToLink')}
                </p>
              ) : (
                <div className="max-h-[360px] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                  {availableTestCases.map((testCase) => (
                    <label key={testCase.id} className="flex min-w-0 cursor-pointer items-start gap-3 border-b border-slate-100 p-3 text-sm last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950/50">
                      <Checkbox
                        checked={selectedAvailableTestCaseIds.includes(testCase.id)}
                        onCheckedChange={() => toggleAvailableSelection(testCase.id)}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-900 dark:text-white">TC-{String(testCase.id).padStart(3, '0')} - {testCase.title}</span>
                        <span className="mt-1 block text-xs text-slate-500">{testCase.suite_name || t('suite')} {testCase.section_name ? ` / ${testCase.section_name}` : ''}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {availableTestCasesTotal > availableTestCases.length && (
                <p className="text-xs text-slate-500">{t('showingTopTestCaseMatches', { shown: availableTestCases.length, total: availableTestCasesTotal })}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)}>{t('cancel')}</Button>
              <Button
                type="button"
                onClick={async () => {
                  await handleBulkLink(selectedAvailableTestCaseIds);
                  setLinkDialogOpen(false);
                }}
                disabled={selectedAvailableTestCaseIds.length === 0 || bulkUpdating}
              >
                {t('linkSelected', { count: selectedAvailableTestCaseIds.length })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent isRTL={isRTL} className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('createAndLinkTestCase')}</DialogTitle>
              <DialogDescription>{t('createAndLinkTestCaseDesc')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="new-test-case-title">{t('title')}</Label>
                <Input
                  id="new-test-case-title"
                  value={newTestCaseForm.title}
                  onChange={(event) => setNewTestCaseForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder={t('testCaseTitlePlaceholder')}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('suite')}</Label>
                  <Select
                    value={newTestCaseForm.test_suite_id}
                    onValueChange={(value) => setNewTestCaseForm((current) => ({ ...current, test_suite_id: value, section_id: 'none' }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('selectTestSuite')} />
                    </SelectTrigger>
                    <SelectContent>
                      {testSuites.map((suite) => <SelectItem key={suite.id} value={String(suite.id)}>{suite.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('section')}</Label>
                  <Select
                    value={newTestCaseForm.section_id}
                    onValueChange={(value) => setNewTestCaseForm((current) => ({ ...current, section_id: value }))}
                    disabled={!newTestCaseForm.test_suite_id}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('section')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('noSection')}</SelectItem>
                      {newTestCaseSections.map((section) => <SelectItem key={section.id} value={String(section.id)}>{section.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('priority')}</Label>
                  <Select value={newTestCaseForm.priority} onValueChange={(value) => setNewTestCaseForm((current) => ({ ...current, priority: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEST_CASE_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('status')}</Label>
                  <Select value={newTestCaseForm.status} onValueChange={(value) => setNewTestCaseForm((current) => ({ ...current, status: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEST_CASE_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-test-case-description">{t('description')}</Label>
                <Textarea
                  id="new-test-case-description"
                  value={newTestCaseForm.description}
                  onChange={(event) => setNewTestCaseForm((current) => ({ ...current, description: event.target.value }))}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-test-case-expected">{t('expectedResult')}</Label>
                <Textarea
                  id="new-test-case-expected"
                  value={newTestCaseForm.expected_result}
                  onChange={(event) => setNewTestCaseForm((current) => ({ ...current, expected_result: event.target.value }))}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>{t('cancel')}</Button>
              <Button type="button" onClick={handleCreateAndLinkTestCase} disabled={creatingTestCase || !testSuites.length}>
                {creatingTestCase ? t('saving') : t('createAndLinkTestCase')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function MetaRow({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
      <span className="flex items-center gap-2 text-slate-500">
        {icon}
        {label}
      </span>
      <span className="max-w-[160px] break-words text-end font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}
