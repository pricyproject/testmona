import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Calendar, CheckCircle2, Clock, CopyCheck, ExternalLink, Eye, EyeOff, FileText, History, ListChecks, Loader2, MoreVertical, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Play, Plus, Settings2, ShieldAlert, Tag, Wand2, X } from 'lucide-react';
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
import { GherkinEditor } from '@/components/requirements/GherkinEditor';
import { isGherkinText } from '@/components/requirements/gherkin';
import { decodeHtmlEntities, decodeEntitiesDeep, htmlToReadableText, isHtmlMarkup } from '@/components/requirements/richText';
import { ContentEditor, htmlToMarkdown, markdownToHtml } from '@/components/ui/content-editor';
import { CustomFieldsPanel } from '@/components/CustomFieldsPanel';
import { RequirementVersionHistory } from '@/components/requirements/RequirementVersionHistory';
import { WatchButton } from '@/components/WatchButton';
import { RequirementComments } from '@/components/requirements/RequirementComments';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useToast } from '@/hooks/use-toast';
import { aiManagerAPI, AIManagerStatus, requirementsAPI, sectionsAPI, testSuitesAPI } from '@/lib/api';
import { sanitizeHtml } from '@/lib/sanitize';
import { Requirement, RequirementLinkedTestCase, RequirementLinkedTestCaseHistoryItem, RequirementRelationshipSummary, RequirementTraceabilitySummary, TestCaseSection, TestSuite } from '@/types';

const hasRenderableContent = (decodedHtml: string): boolean => {
  if (!decodedHtml.trim()) return false;
  if (typeof window === 'undefined' || !isHtmlMarkup(decodedHtml)) return Boolean(decodedHtml.trim());
  const documentValue = new DOMParser().parseFromString(decodedHtml, 'text/html');
  return Boolean(documentValue.body.textContent?.trim())
    || Boolean(documentValue.body.querySelector('img, table, hr'));
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

// Turns raw enum values like "not_started" into readable text ("not tested").
const humanizeStatus = (value?: string | null): string =>
  (value || '').replace(/[_-]+/g, ' ').trim();

const getRunStatusBadge = (status: string) => {
  const key = status.toLowerCase();
  if (['passed', 'pass'].includes(key)) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (['failed', 'fail'].includes(key)) return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300';
  if (['blocked'].includes(key)) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  if (['skipped', 'retest', 'in_progress'].includes(key)) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
};

const TEST_CASE_STATUSES = ['active', 'inactive', 'archived'];
const TEST_CASE_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const REQUIREMENT_STATUSES = ['draft', 'reviewed', 'approved', 'implemented', 'verified', 'deprecated'] as const;
const REQUIREMENT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const GHERKIN_TEMPLATE = [
  'Feature: ',
  '',
  '  Scenario: ',
  '    Given ',
  '    When ',
  '    Then ',
].join('\n');
const RIGHT_SIDEBAR_VISIBLE_STORAGE_KEY = 'requirementDetail.showRightSidebar';
const TOON_PAYLOAD_STORAGE_KEY = 'requirementDetail.useToonPayload';

const GHERKIN_BACKGROUND_TEMPLATE = ['  Background:', '    Given '].join('\n');
const GHERKIN_SCENARIO_OUTLINE_TEMPLATE = [
  '  Scenario Outline: ',
  '    Given ',
  '    When ',
  '    Then ',
  '',
  '    Examples:',
  '      | input | result |',
  '      | value | expected |',
].join('\n');

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

type AIDraftStep = {
  step_number: number;
  action: string;
  expected_result: string;
  step_type: string;
};

type AIDraftTestCase = {
  title: string;
  description: string;
  preconditions: string;
  steps: string;
  expected_result: string;
  priority: string;
  test_type: string;
  tags: string;
  confidence?: number | null;
  test_steps: AIDraftStep[];
  selected?: boolean;
};

type DuplicateStatus = 'unique' | 'similar' | 'duplicate';

type DuplicateMatch = {
  kind: 'existing' | 'draft';
  score: number;
  title_score: number;
  body_score: number;
  status: DuplicateStatus;
  title: string;
  test_case_id?: number | null;
  reference?: string | null;
  section_name?: string | null;
  in_target_section?: boolean;
  draft_index?: number | null;
};

type DuplicateFinding = {
  index: number;
  status: DuplicateStatus;
  score: number;
  matches: DuplicateMatch[];
};

type DuplicateCheckResult = {
  findings: DuplicateFinding[];
  duplicate_count: number;
  similar_count: number;
  existing_compared: number;
  existing_truncated: boolean;
  scope: string;
  thresholds: { duplicate: number; similar: number };
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
  const [searchParams] = useSearchParams();
  // Watch notifications deep-link here with ?compare=1 to open the version
  // history straight into diff mode and scroll the reader to it.
  const compareDeepLink = searchParams.get('compare') === '1';
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();
  const { formatDate: fmtDate } = useDateFormat();
  const formatDate = (value?: string | null): string =>
    value ? fmtDate(value, { year: 'numeric', month: 'short', day: 'numeric' }) || 'N/A' : 'N/A';
  const { toast } = useToast();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [requirementRefreshKey, setRequirementRefreshKey] = useState(0);
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
  const [testCaseSearchInput, setTestCaseSearchInput] = useState('');
  const [testCaseSearchQuery, setTestCaseSearchQuery] = useState('');
  const [linkedSearchQuery, setLinkedSearchQuery] = useState('');
  const [linkedStatusFilter, setLinkedStatusFilter] = useState('all');
  const [linkedPriorityFilter, setLinkedPriorityFilter] = useState('all');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [refreshLinkedKey, setRefreshLinkedKey] = useState(0);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creatingTestCase, setCreatingTestCase] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [savingAIDrafts, setSavingAIDrafts] = useState(false);
  const [aiDrafts, setAiDrafts] = useState<AIDraftTestCase[]>([]);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiGenerationError, setAiGenerationError] = useState('');
  const [aiStatus, setAiStatus] = useState<AIManagerStatus | null>(null);
  const [loadingAIStatus, setLoadingAIStatus] = useState(false);
  const [aiGenerationForm, setAiGenerationForm] = useState({ count: 5, instructions: '' });
  const [useToonPayload, setUseToonPayload] = useState(() => {
    try {
      return localStorage.getItem(TOON_PAYLOAD_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [lastPromptTokens, setLastPromptTokens] = useState<number | null>(null);
  const [activeAIDraftIndex, setActiveAIDraftIndex] = useState(0);
  const [dupFindings, setDupFindings] = useState<Record<number, DuplicateFinding>>({});
  const [dupSummary, setDupSummary] = useState<Pick<DuplicateCheckResult, 'duplicate_count' | 'similar_count' | 'existing_compared' | 'existing_truncated'> | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [dupScope, setDupScope] = useState<'suite' | 'section'>('suite');
  const [allowDuplicates, setAllowDuplicates] = useState(false);
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
  const [showRightSidebar, setShowRightSidebar] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem(RIGHT_SIDEBAR_VISIBLE_STORAGE_KEY);
      return stored === null ? true : stored !== 'false';
    } catch {
      return true;
    }
  });
  const [showSourceDocument, setShowSourceDocument] = useState(true);
  const [showAcceptanceCriteria, setShowAcceptanceCriteria] = useState(true);
  const [showLinkedTestCases, setShowLinkedTestCases] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [savingRequirement, setSavingRequirement] = useState(false);
  const [editGherkin, setEditGherkin] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    acceptance_criteria: '',
    status: 'draft',
    priority: 'medium',
    tags: '',
    estimated_effort: '',
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(RIGHT_SIDEBAR_VISIBLE_STORAGE_KEY, showRightSidebar ? 'true' : 'false');
    } catch {
      // localStorage may be unavailable (private mode, quota); ignore.
    }
  }, [showRightSidebar]);

  useEffect(() => {
    let isMounted = true;

    const loadRequirement = async () => {
      if (!projectId || !requirementId) return;
      setLoading(true);
      try {
        const numericId = Number(requirementId);
        let data: Requirement | null = null;

        if (Number.isInteger(numericId) && numericId > 0) {
          // URL carries the per-project sequence (REQ-001 -> /requirements/1);
          // getBySeq resolves it within the project, falling back to a global id.
          data = await requirementsAPI.getBySeq(Number(projectId), numericId);
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
  }, [projectId, requirementId, requirementRefreshKey, t, toast]);

  useEffect(() => {
    let isMounted = true;

    const loadAIStatus = async () => {
      setLoadingAIStatus(true);
      try {
        const status = await aiManagerAPI.getStatus();
        if (isMounted) {
          setAiStatus(status);
          // Seed admin defaults: count always, TOON toggle only when the user
          // has no saved preference (localStorage still overrides).
          if (typeof status.test_case_default_count === 'number') {
            setAiGenerationForm((current) => ({ ...current, count: status.test_case_default_count as number }));
          }
          try {
            if (localStorage.getItem(TOON_PAYLOAD_STORAGE_KEY) === null && typeof status.compact_payload_default === 'boolean') {
              setUseToonPayload(status.compact_payload_default);
            }
          } catch {
            // localStorage unavailable; keep current toggle value.
          }
        }
      } catch (error) {
        console.error('Failed to load AI status:', error);
        if (isMounted) setAiStatus({ active_provider: 'openai', available: false, reason: 'active_provider_not_configured' });
      } finally {
        if (isMounted) setLoadingAIStatus(false);
      }
    };

    loadAIStatus();
    return () => {
      isMounted = false;
    };
  }, []);

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

  // Arriving from a watch notification (?compare=1): once the requirement is
  // loaded, bring the version-history diff into view.
  useEffect(() => {
    if (!compareDeepLink || !requirement?.id) return;
    const timer = window.setTimeout(() => {
      document.getElementById('version-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [compareDeepLink, requirement?.id]);

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

  // Debounce the raw search box into the committed query that drives the fetch,
  // so typing doesn't fire one request per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setTestCaseSearchQuery(testCaseSearchInput), 300);
    return () => window.clearTimeout(handle);
  }, [testCaseSearchInput]);

  const availableSearchRequestId = useRef(0);

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

      // Guard against out-of-order responses overwriting newer results.
      const requestId = ++availableSearchRequestId.current;
      setAvailableTestCasesLoading(true);
      try {
        const data = await requirementsAPI.searchTestCases(requirement.id, {
          linked: false,
          search: searchValue,
          skip: 0,
          limit: 10,
        });
        if (!isMounted || requestId !== availableSearchRequestId.current) return;
        setAvailableTestCases(data.items || []);
        setAvailableTestCasesTotal(data.total || 0);
        setSelectedAvailableTestCaseIds((current) => current.filter((id) => (data.items || []).some((testCase: RequirementLinkedTestCase) => testCase.id === id)));
      } catch (error) {
        console.error('Failed to load available test cases:', error);
        if (isMounted && requestId === availableSearchRequestId.current) {
          setAvailableTestCases([]);
          setAvailableTestCasesTotal(0);
        }
      } finally {
        if (isMounted && requestId === availableSearchRequestId.current) setAvailableTestCasesLoading(false);
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
      if (!requirement?.id || !showLinkHistory) {
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

  useEffect(() => {
    setActiveAIDraftIndex((current) => Math.min(current, Math.max(aiDrafts.length - 1, 0)));
  }, [aiDrafts.length]);

  const descriptionHtml = useMemo(() => decodeEntitiesDeep(requirement?.description), [requirement?.description]);
  const acceptanceHtml = useMemo(() => decodeEntitiesDeep(requirement?.acceptance_criteria), [requirement?.acceptance_criteria]);
  const acceptanceText = useMemo(() => htmlToReadableText(requirement?.acceptance_criteria), [requirement?.acceptance_criteria]);
  const sourceDocument = useMemo(() => extractSourceDocument(requirement?.description), [requirement?.description]);
  const tags = useMemo(() => requirement?.tags?.split(',').map((tag) => tag.trim()).filter(Boolean) || [], [requirement?.tags]);
  const hasGherkin = isGherkinText(acceptanceText);
  const hasDescription = useMemo(
    () => (sourceDocument ? Boolean(sourceDocument.intro) : hasRenderableContent(descriptionHtml)),
    [sourceDocument, descriptionHtml],
  );
  const hasAcceptanceCriteria = useMemo(
    () => hasGherkin || hasRenderableContent(acceptanceHtml),
    [hasGherkin, acceptanceHtml],
  );
  const hasRightSidebarCards = showMetadata || tags.length > 0;
  const shouldShowRightSidebar = showRightSidebar && hasRightSidebarCards;
  const visibleLinkedTestCases = linkedTestCases;
  const hasMoreLinkedTestCases = linkedTestCasesTotal > visibleLinkedTestCases.length;
  const newTestCaseSections = useMemo(() => {
    if (!newTestCaseForm.test_suite_id) return [];
    return sections.filter((section) => String(section.test_suite_id) === newTestCaseForm.test_suite_id);
  }, [newTestCaseForm.test_suite_id, sections]);
  const selectedAIDraftsCount = aiDrafts.filter((draft) => draft.selected !== false && draft.title.trim()).length;
  const activeAIDraft = aiDrafts[activeAIDraftIndex];
  const activeDuplicateFinding = dupFindings[activeAIDraftIndex];
  const duplicateCounts = useMemo(() => {
    let duplicate = 0;
    let similar = 0;
    Object.values(dupFindings).forEach((finding) => {
      if (finding.status === 'duplicate') duplicate += 1;
      else if (finding.status === 'similar') similar += 1;
    });
    return { duplicate, similar };
  }, [dupFindings]);
  // Number of selected drafts that would be blocked as duplicates on save.
  const selectedDuplicateCount = useMemo(() => (
    aiDrafts.reduce((count, draft, index) => (
      draft.selected !== false && draft.title.trim() && dupFindings[index]?.status === 'duplicate'
        ? count + 1
        : count
    ), 0)
  ), [aiDrafts, dupFindings]);
  const creatableSelectedCount = allowDuplicates ? selectedAIDraftsCount : selectedAIDraftsCount - selectedDuplicateCount;

  const backPath = projectId ? `/projects/${projectId}/requirements` : '/projects';
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  const ToggleRightSidebarIcon = showRightSidebar
    ? (isRTL ? PanelLeftClose : PanelRightClose)
    : (isRTL ? PanelLeftOpen : PanelRightOpen);

  const refreshRequirementLinks = () => setRefreshLinkedKey((current) => current + 1);

  const editEffortNumber = editForm.estimated_effort.trim() ? Number(editForm.estimated_effort) : undefined;
  const editEffortInvalid = editEffortNumber !== undefined && (!Number.isFinite(editEffortNumber) || editEffortNumber < 0);
  const canSaveRequirement = Boolean(editForm.title.trim()) && !editEffortInvalid && !savingRequirement;

  const openEditDialog = () => {
    if (!requirement) return;
    const decodedDescription = decodeEntitiesDeep(requirement.description);
    const decodedAcceptanceHtml = decodeEntitiesDeep(requirement.acceptance_criteria);
    const readableAcceptance = htmlToReadableText(requirement.acceptance_criteria);
    const shouldEditAsGherkin = isGherkinText(readableAcceptance);
    setEditForm({
      title: requirement.title,
      description: isHtmlMarkup(decodedDescription) ? htmlToMarkdown(decodedDescription) : decodedDescription,
      acceptance_criteria: shouldEditAsGherkin
        ? readableAcceptance
        : isHtmlMarkup(decodedAcceptanceHtml)
          ? htmlToMarkdown(decodedAcceptanceHtml)
          : decodedAcceptanceHtml,
      status: requirement.status,
      priority: requirement.priority,
      tags: requirement.tags || '',
      estimated_effort: requirement.estimated_effort !== undefined && requirement.estimated_effort !== null
        ? String(requirement.estimated_effort)
        : '',
    });
    setEditGherkin(shouldEditAsGherkin);
    setEditDialogOpen(true);
  };

  const insertEditGherkinSnippet = (snippet: string) => {
    setEditForm((current) => ({
      ...current,
      acceptance_criteria: current.acceptance_criteria.trim()
        ? `${current.acceptance_criteria.trim()}\n\n${snippet}`
        : snippet,
    }));
  };

  const handleUpdateRequirement = async () => {
    if (!requirement) return;
    if (!editForm.title.trim()) {
      toast({ title: t('error'), description: t('fieldRequired', { field: t('title') }), variant: 'destructive' });
      return;
    }
    if (editEffortInvalid) {
      toast({ title: t('error'), description: t('estimatedEffortInvalid'), variant: 'destructive' });
      return;
    }

    setSavingRequirement(true);
    try {
      const updated = await requirementsAPI.update(requirement.id, {
        title: editForm.title.trim(),
        description: markdownToHtml(editForm.description),
        acceptance_criteria: editGherkin ? editForm.acceptance_criteria : markdownToHtml(editForm.acceptance_criteria),
        status: editForm.status,
        priority: editForm.priority,
        tags: editForm.tags.trim(),
        estimated_effort: editEffortNumber,
      });
      setRequirement(updated);
      setEditDialogOpen(false);
      toast({ title: t('success'), description: t('requirementUpdated') });
    } catch (error: any) {
      console.error('Failed to update requirement:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToUpdateRequirement'),
        variant: 'destructive',
      });
    } finally {
      setSavingRequirement(false);
    }
  };

  const handleBulkLink = async (testCaseIds: number[]): Promise<boolean> => {
    if (!requirement || testCaseIds.length === 0) return false;
    setBulkUpdating(true);
    try {
      const result = await requirementsAPI.bulkUpdateTestCases(requirement.id, { test_case_ids: testCaseIds, action: 'link' });
      setSelectedAvailableTestCaseIds([]);
      refreshRequirementLinks();
      // Report what actually got linked — some may have been skipped (already linked elsewhere).
      const linkedCount = typeof result?.linked_count === 'number' ? result.linked_count : testCaseIds.length;
      toast({ title: t('success'), description: t('testCasesLinkedToRequirement', { count: linkedCount }) });
      return true;
    } catch (error: any) {
      console.error('Failed to link test cases:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToUpdateLinkedTestCase'),
        variant: 'destructive',
      });
      return false;
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

  // A draft's similarity verdict is stale once its content changes; drop it so
  // the badge clears until the next (authoritative) re-check before saving.
  const clearDuplicateFinding = (index: number) => {
    setDupFindings((current) => {
      if (!(index in current)) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
  };

  const updateAIDraft = (index: number, updates: Partial<AIDraftTestCase>) => {
    // Toggling selection does not change content, so keep the finding in that case.
    const contentChanged = Object.keys(updates).some((key) => key !== 'selected');
    setAiDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, ...updates } : draft
    )));
    if (contentChanged) clearDuplicateFinding(index);
  };

  const updateAIDraftStep = (draftIndex: number, stepIndex: number, updates: Partial<AIDraftStep>) => {
    setAiDrafts((current) => current.map((draft, index) => {
      if (index !== draftIndex) return draft;
      return {
        ...draft,
        test_steps: draft.test_steps.map((step, currentStepIndex) => (
          currentStepIndex === stepIndex ? { ...step, ...updates } : step
        )),
      };
    }));
    clearDuplicateFinding(draftIndex);
  };

  const addAIDraftStep = (draftIndex: number) => {
    setAiDrafts((current) => current.map((draft, index) => {
      if (index !== draftIndex) return draft;
      return {
        ...draft,
        test_steps: [
          ...(draft.test_steps || []),
          {
            step_number: (draft.test_steps || []).length + 1,
            action: '',
            expected_result: '',
            step_type: 'manual',
          },
        ],
      };
    }));
    clearDuplicateFinding(draftIndex);
  };

  const removeAIDraftStep = (draftIndex: number, stepIndex: number) => {
    setAiDrafts((current) => current.map((draft, index) => {
      if (index !== draftIndex) return draft;
      return {
        ...draft,
        test_steps: (draft.test_steps || [])
          .filter((_, currentStepIndex) => currentStepIndex !== stepIndex)
          .map((step, currentStepIndex) => ({ ...step, step_number: currentStepIndex + 1 })),
      };
    }));
    clearDuplicateFinding(draftIndex);
  };

  // Target suite / section / scope changes invalidate every verdict because the
  // comparison set differs; clear so the user knows a re-check is needed.
  const invalidateDuplicateFindings = () => {
    setDupFindings({});
    setDupSummary(null);
    setAllowDuplicates(false);
  };

  const buildDuplicatePayloadDrafts = (draftsToCheck: AIDraftTestCase[]) =>
    draftsToCheck
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => draft.title?.trim())
      .map(({ draft, index }) => ({
        index,
        title: draft.title?.trim() || '',
        description: draft.description?.trim() || '',
        preconditions: draft.preconditions?.trim() || '',
        steps: draft.steps?.trim() || '',
        expected_result: draft.expected_result?.trim() || '',
        test_steps: (draft.test_steps || [])
          .filter((step) => step.action?.trim() || step.expected_result?.trim())
          .map((step) => ({ action: step.action || '', expected_result: step.expected_result || '' })),
      }));

  const runDuplicateCheck = async (
    draftsToCheck: AIDraftTestCase[],
    options: { silent?: boolean } = {},
  ): Promise<{ map: Record<number, DuplicateFinding>; result: DuplicateCheckResult | null }> => {
    if (!requirement) return { map: {}, result: null };
    const suiteId = Number(newTestCaseForm.test_suite_id || testSuites[0]?.id);
    const payloadDrafts = buildDuplicatePayloadDrafts(draftsToCheck);
    if (!suiteId || !payloadDrafts.length) {
      setDupFindings({});
      setDupSummary(null);
      return { map: {}, result: null };
    }
    setCheckingDuplicates(true);
    try {
      const result: DuplicateCheckResult = await requirementsAPI.checkTestCaseDuplicates(requirement.id, {
        test_suite_id: suiteId,
        section_id: newTestCaseForm.section_id === 'none' ? undefined : Number(newTestCaseForm.section_id),
        scope: dupScope,
        drafts: payloadDrafts,
      });
      const map: Record<number, DuplicateFinding> = {};
      (result.findings || []).forEach((finding) => { map[finding.index] = finding; });
      setDupFindings(map);
      setDupSummary({
        duplicate_count: result.duplicate_count,
        similar_count: result.similar_count,
        existing_compared: result.existing_compared,
        existing_truncated: result.existing_truncated,
      });
      return { map, result };
    } catch (error: any) {
      console.error('Failed to check for duplicate test cases:', error);
      if (!options.silent) {
        toast({
          title: t('error'),
          description: error.response?.data?.detail || t('failedToCheckDuplicates'),
          variant: 'destructive',
        });
      }
      return { map: dupFindings, result: null };
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const handleGenerateRequirementTestCases = async () => {
    if (!requirement) return;
    if (!testSuites.length) {
      toast({
        title: t('validationError'),
        description: t('targetSuiteRequiredForAIGeneration'),
        variant: 'destructive',
      });
      return;
    }
    setGeneratingAI(true);
    setAiWarnings([]);
    invalidateDuplicateFindings();
    try {
      const result = await requirementsAPI.generateTestCases(requirement.id, {
        count: aiGenerationForm.count,
        instructions: aiGenerationForm.instructions.trim() || undefined,
        payload_format: useToonPayload ? 'toon' : 'text',
      });
      const generatedDrafts: AIDraftTestCase[] = (result.drafts || []).map((draft: AIDraftTestCase) => ({ ...draft, selected: true }));
      setAiDrafts(generatedDrafts);
      setLastPromptTokens(typeof result.prompt_tokens === 'number' ? result.prompt_tokens : null);
      setActiveAIDraftIndex(0);
      setAiWarnings(result.warnings || []);
      toast({ title: t('success'), description: t('aiDraftsGenerated', { count: result.drafts?.length || 0 }) });

      // Immediately screen the fresh drafts and auto-deselect outright duplicates
      // so the user does not inject them by simply clicking "Create Selected".
      const { map, result: checkResult } = await runDuplicateCheck(generatedDrafts, { silent: true });
      if (checkResult && checkResult.duplicate_count > 0) {
        setAiDrafts((current) => current.map((draft, index) => (
          map[index]?.status === 'duplicate' ? { ...draft, selected: false } : draft
        )));
        toast({
          title: t('duplicatesDetectedTitle'),
          description: t('duplicatesAutoDeselected', { count: checkResult.duplicate_count }),
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Failed to generate requirement test cases:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToGenerateAITestCases'),
        variant: 'destructive',
      });
    } finally {
      setGeneratingAI(false);
    }
  };

  const handleCreateSelectedAIDrafts = async () => {
    if (!requirement) return;
    const selectedEntries = aiDrafts
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => draft.selected !== false && draft.title.trim());
    if (!selectedEntries.length || !testSuites.length) {
      toast({
        title: t('validationError'),
        description: t('selectAtLeastOneDraft'),
        variant: 'destructive',
      });
      return;
    }
    setSavingAIDrafts(true);
    try {
      // Authoritative re-check against the *current* target suite/section right
      // before persisting, so edits or section changes since the last check are
      // honored and we never silently inject a duplicate.
      const { map: findingMap } = await runDuplicateCheck(aiDrafts, { silent: true });
      let entriesToCreate = selectedEntries;
      let skippedDuplicates = 0;
      if (!allowDuplicates) {
        entriesToCreate = selectedEntries.filter(({ index }) => findingMap[index]?.status !== 'duplicate');
        skippedDuplicates = selectedEntries.length - entriesToCreate.length;
      }
      if (!entriesToCreate.length) {
        toast({
          title: t('duplicatesDetectedTitle'),
          description: t('allSelectedDraftsAreDuplicates'),
          variant: 'destructive',
        });
        return;
      }
      for (const { draft } of entriesToCreate) {
        await requirementsAPI.createAndLinkTestCase(requirement.id, {
          title: draft.title.trim(),
          description: draft.description?.trim() || undefined,
          test_type: draft.test_type || 'manual',
          preconditions: draft.preconditions?.trim() || 'No preconditions defined',
          steps: draft.steps?.trim() || 'No steps defined',
          expected_result: draft.expected_result?.trim() || 'No expected results defined',
          priority: draft.priority || 'medium',
          status: 'active',
          reference: requirement.requirement_id,
          tags: draft.tags?.trim() || undefined,
          test_suite_id: Number(newTestCaseForm.test_suite_id || testSuites[0].id),
          section_id: newTestCaseForm.section_id === 'none' ? undefined : Number(newTestCaseForm.section_id),
          test_steps: (draft.test_steps || []).map((step, index) => ({
            step_number: index + 1,
            action: step.action,
            expected_result: step.expected_result,
            step_type: step.step_type || 'manual',
          })),
        });
      }
      setAiDialogOpen(false);
      setAiDrafts([]);
      invalidateDuplicateFindings();
      refreshRequirementLinks();
      if (skippedDuplicates > 0) {
        toast({
          title: t('success'),
          description: t('aiDraftsCreatedSkippedDuplicates', { created: entriesToCreate.length, skipped: skippedDuplicates }),
        });
      } else {
        toast({ title: t('success'), description: t('aiDraftsCreatedAndLinked', { count: entriesToCreate.length }) });
      }
    } catch (error: any) {
      console.error('Failed to create AI test case drafts:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToCreateAndLinkTestCase'),
        variant: 'destructive',
      });
    } finally {
      setSavingAIDrafts(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="h-9 w-44 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
        <div className="h-36 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
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
        <Button variant="ghost" size="sm" className="-mx-2 text-slate-600 dark:text-slate-300" onClick={() => navigate(backPath)}>
          <BackIcon className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
          {t('backToRequirements')}
        </Button>

        <header className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">{requirement.requirement_id}</Badge>
                <Badge className={`capitalize ${getStatusBadge(requirement.status)}`}>{requirement.status}</Badge>
                <Badge className={`capitalize ${getPriorityBadge(requirement.priority)}`}>{requirement.priority}</Badge>
                {hasGherkin && <Badge className="bg-indigo-600 text-white hover:bg-indigo-600">{t('gherkinSyntax')}</Badge>}
              </div>
              <h1 className="max-w-3xl wrap-break-word text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                {requirement.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {t('created')} {formatDate(requirement.created_at)}
                </span>
                {requirement.updated_at && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {t('updated')} {formatDate(requirement.updated_at)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <WatchButton entityType="requirement" entityId={requirement.id} />
              <Button type="button" size="sm" variant="outline" onClick={() => setAiDialogOpen(true)}>
                <Wand2 className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                {t('generateTestCases')}
              </Button>
              <Button type="button" size="sm" onClick={openEditDialog}>
                <Pencil className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                {t('edit')}
              </Button>
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
                    {showLinkedTestCases ? <Eye className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} /> : <EyeOff className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />}
                    {t('linkedTestCases')}
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
            </div>
          </div>
        </header>

        <div className={`grid gap-6 ${shouldShowRightSidebar ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
          <main className="min-w-0 space-y-6">
            {sourceDocument && showSourceDocument && (
              <section className="rounded-md border border-blue-200 bg-blue-50/70 p-5 dark:border-blue-900/60 dark:bg-blue-950/30">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{t('sourceDocument')}</p>
                    <h2 className="mt-1 wrap-break-word text-lg font-semibold text-slate-950 dark:text-white">{sourceDocument.heading}</h2>
                  </div>
                  {sourceDocument.sourceUrl && (
                    <a
                      href={sourceDocument.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-950 dark:text-blue-300 dark:hover:bg-blue-950"
                    >
                      <ExternalLink className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                      {t('openSource')}
                    </a>
                  )}
                </div>
                {sourceDocument.body && (
                  <p className="max-w-[72ch] whitespace-pre-wrap text-[15px] leading-[1.8] text-slate-700 wrap-anywhere dark:text-slate-300">
                    {sourceDocument.body}
                  </p>
                )}
              </section>
            )}

            <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate">{t('description')}</span>
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowRightSidebar((current) => !current)}
                  className="h-9 w-9 shrink-0 rounded-full border-slate-300 bg-slate-50 text-slate-600 shadow-xs hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
                  aria-label={showRightSidebar ? t('hideSidebar') : t('showSidebar')}
                  aria-pressed={showRightSidebar}
                  title={showRightSidebar ? t('hideSidebar') : t('showSidebar')}
                >
                  <ToggleRightSidebarIcon className="h-4 w-4" />
                </Button>
              </div>
              {hasDescription ? (
                sourceDocument ? (
                  <p className="max-w-[72ch] whitespace-pre-wrap text-[15px] leading-[1.8] text-slate-700 wrap-anywhere dark:text-slate-300">
                    {sourceDocument.intro}
                  </p>
                ) : (
                  <RichTextContent html={descriptionHtml} />
                )
              ) : (
                <EmptyState label={sourceDocument ? t('sourceDocumentImported') : t('noDescriptionProvided')} />
              )}
            </section>

            {showAcceptanceCriteria && (
              <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                  <CheckCircle2 className="h-4 w-4 text-slate-400" />
                  {t('acceptanceCriteria')}
                </h2>
                {hasGherkin ? (
                  <GherkinViewer value={acceptanceText} emptyLabel={t('noAcceptanceCriteriaProvided')} featureFallback={requirement?.title} />
                ) : hasAcceptanceCriteria ? (
                  <RichTextContent html={acceptanceHtml} />
                ) : (
                  <EmptyState label={t('noAcceptanceCriteriaProvided')} />
                )}
              </section>
            )}

            {showLinkedTestCases && (
              <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                      <ListChecks className="h-4 w-4 text-slate-400" />
                      {t('linkedTestCases')}
                      <Badge variant="secondary">{traceabilitySummary.linked_count}</Badge>
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {t('showingLinkedTestCases', { shown: Math.min(visibleLinkedTestCases.length, linkedTestCasesTotal), total: linkedTestCasesTotal })}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                    {t('createAndLinkTestCase')}
                  </Button>
                </div>

                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {t('traceabilitySnapshot')}
                </p>
                <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
                  <SummaryTile label={t('linkedCount')} value={traceabilitySummary.linked_count} />
                  <SummaryTile label={t('activeCount')} value={traceabilitySummary.active_count} />
                  <SummaryTile label={t('failedResults')} value={traceabilitySummary.failed_related_runs} tone="danger" />
                  <SummaryTile label={t('blockedResults')} value={traceabilitySummary.blocked_related_runs} tone="warning" />
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
                          {TEST_CASE_STATUSES.map((status) => <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={linkedPriorityFilter} onValueChange={(value) => { setLinkedPriorityFilter(value); setVisibleLinkedTestCasesCount(10); }}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('priority')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('allPriorities')}</SelectItem>
                          {TEST_CASE_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority} className="capitalize">{priority}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        // Open with a clean slate so a prior search/selection
                        // doesn't carry over into a new linking session.
                        setTestCaseSearchInput('');
                        setTestCaseSearchQuery('');
                        setSelectedAvailableTestCaseIds([]);
                        setLinkDialogOpen(true);
                      }}
                    >
                      <Plus className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                      {t('linkExistingTestCases')}
                    </Button>
                  </div>
                </div>

                {linkedTestCasesLoading ? (
                  <div className="space-y-2">
                    <div className="h-16 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                    <div className="h-16 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                  </div>
                ) : linkedTestCasesError ? (
                  <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                    {linkedTestCasesError}
                  </p>
                ) : linkedTestCases.length === 0 ? (
                  <EmptyState label={t('noLinkedTestCasesForRequirement')} />
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
                      <div className="hidden grid-cols-[minmax(260px,1.5fr)_minmax(180px,0.75fr)_minmax(150px,0.65fr)] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 xl:grid">
                        <span className="whitespace-nowrap">{t('testCase')}</span>
                        <span className="whitespace-nowrap">{t('status')}</span>
                        <span className="whitespace-nowrap">{t('suite')}</span>
                      </div>
                      {visibleLinkedTestCases.map((testCase) => (
                        <div key={testCase.id} className={`relative grid gap-3 border-b border-slate-100 px-4 py-4 transition-colors last:border-b-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-950/40 xl:grid-cols-[minmax(260px,1.5fr)_minmax(180px,0.75fr)_minmax(150px,0.65fr)] xl:items-start xl:gap-4 ${isRTL ? 'pl-14' : 'pr-14'}`}>
                          <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="font-mono">TC-{String(testCase.id).padStart(3, '0')}</Badge>
                              {testCase.reference && <span className="max-w-full truncate text-xs text-slate-500">{testCase.reference}</span>}
                            </div>
                            <button
                              type="button"
                              className={`block min-w-0 wrap-break-word text-sm font-medium leading-6 text-blue-700 wrap-anywhere hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-offset-slate-900 ${isRTL ? 'text-right' : 'text-left'}`}
                              onClick={() => navigate(`/projects/${projectId}/test-cases/${testCase.id}`)}
                            >
                              {testCase.title}
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={`capitalize ${getPriorityBadge(testCase.priority)}`}>{testCase.priority}</Badge>
                            <Badge variant="secondary" className="capitalize">{testCase.status}</Badge>
                            {testCase.latest_run_status && (
                              <Badge className={`capitalize ${getRunStatusBadge(testCase.latest_run_status)}`}>
                                {humanizeStatus(testCase.latest_run_status)}
                              </Badge>
                            )}
                          </div>
                          <p className="min-w-0 wrap-break-word text-xs leading-5 text-slate-500 xl:truncate">
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
                                <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/test-cases/${testCase.id}`)}>
                                  <FileText className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                                  {t('viewTestCase')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/test-cases/${testCase.id}/edit`)}>
                                  <Pencil className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                                  {t('edit')}
                                </DropdownMenuItem>
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
                      <div className="flex justify-center pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setVisibleLinkedTestCasesCount((current) => current + 10)}
                        >
                          {t('loadMore')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-6 rounded-md border border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <History className="h-4 w-4 text-slate-400" />
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
                    <div className="border-t border-slate-200 p-4 dark:border-slate-800">
                      {historyLoading ? (
                        <div className="h-12 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                      ) : linkHistory.length === 0 ? (
                        <p className="text-sm text-slate-500">{t('noLinkHistory')}</p>
                      ) : (
                        <div className="space-y-2">
                          {linkHistory.map((item) => (
                            <div key={item.id} className="flex flex-col gap-1 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-950/50 sm:flex-row sm:items-center sm:justify-between">
                              <span className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
                                <Badge variant={item.action === 'link' ? 'default' : 'secondary'}>
                                  {item.action === 'link' ? t('linked') : t('unlinked')}
                                </Badge>
                                <span className="wrap-break-word wrap-anywhere">
                                  {item.test_case_id ? `TC-${String(item.test_case_id).padStart(3, '0')}` : t('testCase')} {item.test_case_title || ''}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs text-slate-500">
                                {item.full_name || item.username || `${t('auditUser')} ${item.user_id}`} · {formatDate(item.created_at)}
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

            {requirement && (
              <RequirementVersionHistory
                requirementId={requirement.id}
                canEdit
                defaultCompare={compareDeepLink}
                onRestored={() => setRequirementRefreshKey((key) => key + 1)}
              />
            )}

            {requirement && (
              <RequirementComments requirementId={requirement.id} projectId={requirement.project_id} canComment />
            )}
          </main>

          {shouldShowRightSidebar && (
            <aside className="space-y-6">
              {showMetadata && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('metadata')}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <MetaRow label={t('requirementId')} value={<span className="font-mono">{requirement.requirement_id}</span>} />
                    <MetaRow
                      label={t('status')}
                      value={<Badge className={`capitalize ${getStatusBadge(requirement.status)}`}>{requirement.status}</Badge>}
                    />
                    <MetaRow
                      label={t('priority')}
                      value={<Badge className={`capitalize ${getPriorityBadge(requirement.priority)}`}>{requirement.priority}</Badge>}
                    />
                    <MetaRow label={t('created')} value={formatDate(requirement.created_at)} icon={<Calendar className="h-4 w-4" />} />
                    <MetaRow label={t('updated')} value={formatDate(requirement.updated_at)} icon={<Calendar className="h-4 w-4" />} />
                    {requirement.estimated_effort !== undefined && requirement.estimated_effort !== null && (
                      <MetaRow label={t('estimatedEffortHours')} value={`${requirement.estimated_effort}h`} icon={<Clock className="h-4 w-4" />} />
                    )}
                  </CardContent>
                </Card>
              )}

              {tags.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Tag className="h-4 w-4 text-slate-400" />
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

        <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
          <DialogContent isRTL={isRTL} className="max-w-6xl">
            <DialogHeader>
              <DialogTitle>{t('generateTestCases')}</DialogTitle>
              <DialogDescription>{t('aiRequirementGenerationDesc')}</DialogDescription>
            </DialogHeader>
            <div className="-mx-1 max-h-[70vh] space-y-5 overflow-y-auto px-1 py-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                {t('aiDraftReviewRequired')}
              </div>
              {loadingAIStatus ? (
                <div className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('loading')}
                </div>
              ) : aiStatus && !aiStatus.available ? (
                <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {t('aiEnabledTokenMissing')}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLoadingAIStatus(true);
                      aiManagerAPI.getStatus()
                        .then(setAiStatus)
                        .catch((error) => console.error('Failed to refresh AI status:', error))
                        .finally(() => setLoadingAIStatus(false));
                    }}
                  >
                    {t('retry')}
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-[120px_minmax(0,1fr)]">
                <div className="space-y-2">
                  <Label>{t('count')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={aiGenerationForm.count}
                    onChange={(event) => setAiGenerationForm((current) => ({
                      ...current,
                      count: Math.min(10, Math.max(1, Number(event.target.value) || 5)),
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('additionalInstructions')}</Label>
                  <Input
                    value={aiGenerationForm.instructions}
                    onChange={(event) => setAiGenerationForm((current) => ({ ...current, instructions: event.target.value }))}
                    placeholder={t('aiInstructionsPlaceholder')}
                    maxLength={2000}
                  />
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="space-y-0.5">
                  <Label htmlFor="toon-payload" className="flex items-center gap-2">
                    {t('toonPayloadLabel')}
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      {t('toonPayloadBadge')}
                    </span>
                  </Label>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t('toonPayloadHint')}</p>
                  {lastPromptTokens !== null && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('toonPromptTokens', { count: lastPromptTokens })}
                    </p>
                  )}
                </div>
                <Switch
                  id="toon-payload"
                  checked={useToonPayload}
                  onCheckedChange={(checked) => {
                    setUseToonPayload(checked);
                    try {
                      localStorage.setItem(TOON_PAYLOAD_STORAGE_KEY, String(checked));
                    } catch {
                      // localStorage may be unavailable (private mode, quota); ignore.
                    }
                  }}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('targetSuite')}</Label>
                  <Select
                    value={newTestCaseForm.test_suite_id}
                    onValueChange={(value) => {
                      setNewTestCaseForm((current) => ({ ...current, test_suite_id: value, section_id: 'none' }));
                      invalidateDuplicateFindings();
                    }}
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
                  <Label>{t('targetSection')}</Label>
                  <Select
                    value={newTestCaseForm.section_id}
                    onValueChange={(value) => {
                      setNewTestCaseForm((current) => ({ ...current, section_id: value }));
                      invalidateDuplicateFindings();
                    }}
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
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={handleGenerateRequirementTestCases} disabled={generatingAI || !testSuites.length || loadingAIStatus || aiStatus?.available === false}>
                  {generatingAI ? <Loader2 className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4 animate-spin`} /> : <Wand2 className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />}
                  {generatingAI ? t('generating') : t('generateDrafts')}
                </Button>
                {aiDrafts.length > 0 && (
                  <>
                    <Button type="button" variant="outline" onClick={() => setAiDrafts((current) => current.map((draft) => ({ ...draft, selected: true })))}>
                      {t('selectAll')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setAiDrafts((current) => current.map((draft) => ({ ...draft, selected: false })))}>
                      {t('clearSelection')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => runDuplicateCheck(aiDrafts)}
                      disabled={checkingDuplicates}
                    >
                      {checkingDuplicates
                        ? <Loader2 className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4 animate-spin`} />
                        : <ShieldAlert className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />}
                      {checkingDuplicates ? t('checkingDuplicates') : t('recheckDuplicates')}
                    </Button>
                    <Badge variant="secondary" className="self-center">
                      {t('selectedDraftsCount', { count: selectedAIDraftsCount })}
                    </Badge>
                  </>
                )}
              </div>
              {aiDrafts.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
                    <span className="font-medium">{t('duplicateScope')}:</span>
                    <Select
                      value={dupScope}
                      onValueChange={(value) => { setDupScope(value as 'suite' | 'section'); invalidateDuplicateFindings(); }}
                    >
                      <SelectTrigger className="h-8 w-[200px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="suite">{t('duplicateScopeSuite')}</SelectItem>
                        <SelectItem value="section">{t('duplicateScopeSection')}</SelectItem>
                      </SelectContent>
                    </Select>
                    {dupSummary && (
                      <span className="text-xs text-slate-500">
                        {t('duplicateCheckSummary', {
                          duplicates: duplicateCounts.duplicate,
                          similar: duplicateCounts.similar,
                          compared: dupSummary.existing_compared,
                        })}
                        {dupSummary.existing_truncated ? ` ${t('duplicateScanTruncated')}` : ''}
                      </span>
                    )}
                  </div>
                  {selectedDuplicateCount > 0 && (
                    <label className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                      <Checkbox checked={allowDuplicates} onCheckedChange={(checked) => setAllowDuplicates(checked === true)} />
                      {t('allowDuplicateCreation')}
                    </label>
                  )}
                </div>
              )}
              {aiWarnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {aiWarnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
                </div>
              )}
              {aiDrafts.length > 0 && activeAIDraft && (
                <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
                  <div className="rounded-md border border-slate-200 dark:border-slate-800">
                    <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('generatedDrafts')}</p>
                      <p className="text-xs text-slate-500">{t('selectDraftToPreview')}</p>
                    </div>
                    <div className="max-h-[480px] overflow-y-auto">
                      {aiDrafts.map((draft, draftIndex) => (
                        <div
                          key={draftIndex}
                          className={`flex gap-2 border-b border-slate-100 p-3 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950 ${activeAIDraftIndex === draftIndex ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                        >
                          <Checkbox
                            checked={draft.selected !== false}
                            onCheckedChange={(checked) => updateAIDraft(draftIndex, { selected: checked === true })}
                          />
                          <button
                            type="button"
                            className={`min-w-0 flex-1 ${isRTL ? 'text-right' : 'text-left'}`}
                            onClick={() => setActiveAIDraftIndex(draftIndex)}
                          >
                            <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{draft.title || t('untitled')}</span>
                            <span className="mt-1 flex flex-wrap gap-1">
                              <Badge variant="outline" className="capitalize">{draft.priority || t('priority')}</Badge>
                              {typeof draft.confidence === 'number' && (
                                <Badge variant="secondary">{t('aiConfidence', { confidence: Math.round(draft.confidence * 100) })}</Badge>
                              )}
                              {dupFindings[draftIndex]?.status === 'duplicate' && (
                                <Badge variant="destructive">{t('duplicateBadge')}</Badge>
                              )}
                              {dupFindings[draftIndex]?.status === 'similar' && (
                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200">{t('similarBadge')}</Badge>
                              )}
                            </span>
                            <span className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                              {draft.description || draft.expected_result || t('noDescriptionProvided')}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0 space-y-4 rounded-md border border-slate-200 p-4 dark:border-slate-800">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('draftPreview')}</p>
                        <h3 className="mt-1 wrap-break-word text-lg font-semibold text-slate-950 dark:text-white">
                          {activeAIDraft.title || t('untitled')}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={activeAIDraft.selected !== false ? 'default' : 'outline'}>
                          {activeAIDraft.selected !== false ? t('selected') : t('notSelected')}
                        </Badge>
                        {typeof activeAIDraft.confidence === 'number' && (
                          <Badge variant="outline">{t('aiConfidence', { confidence: Math.round(activeAIDraft.confidence * 100) })}</Badge>
                        )}
                        {activeDuplicateFinding?.status === 'duplicate' && (
                          <Badge variant="destructive">{t('duplicateBadge')}</Badge>
                        )}
                        {activeDuplicateFinding?.status === 'similar' && (
                          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200">{t('similarBadge')}</Badge>
                        )}
                      </div>
                    </div>

                    {activeDuplicateFinding && activeDuplicateFinding.matches.length > 0 && (
                      <div className={`rounded-md border p-3 text-sm ${
                        activeDuplicateFinding.status === 'duplicate'
                          ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
                          : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
                      }`}>
                        <p className="flex items-center gap-2 font-medium">
                          {activeDuplicateFinding.status === 'duplicate'
                            ? <CopyCheck className="h-4 w-4" />
                            : <ShieldAlert className="h-4 w-4" />}
                          {activeDuplicateFinding.status === 'duplicate' ? t('duplicateFindingTitle') : t('similarFindingTitle')}
                        </p>
                        <ul className="mt-2 space-y-1">
                          {activeDuplicateFinding.matches.map((match, matchIndex) => (
                            <li key={`${match.kind}-${match.test_case_id ?? match.draft_index}-${matchIndex}`} className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="text-[10px]">{Math.round(match.score * 100)}%</Badge>
                              {match.kind === 'existing' ? (
                                <span className="wrap-anywhere">
                                  {match.reference ? `${match.reference} · ` : ''}{match.title || t('untitled')}
                                  {match.section_name ? ` — ${match.section_name}` : ` — ${t('noSection')}`}
                                </span>
                              ) : (
                                <span className="wrap-anywhere">
                                  {t('matchesDraftNumber', { number: (match.draft_index ?? 0) + 1 })}: {match.title || t('untitled')}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-2 sm:col-span-3">
                        <Label>{t('title')}</Label>
                        <Input value={activeAIDraft.title} onChange={(event) => updateAIDraft(activeAIDraftIndex, { title: event.target.value })} maxLength={255} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('priority')}</Label>
                        <Select value={activeAIDraft.priority} onValueChange={(value) => updateAIDraft(activeAIDraftIndex, { priority: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{TEST_CASE_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}>{t(priority as any)}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>{t('testType')}</Label>
                        <Input value={activeAIDraft.test_type} onChange={(event) => updateAIDraft(activeAIDraftIndex, { test_type: event.target.value })} maxLength={40} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('tags')}</Label>
                        <Input value={activeAIDraft.tags || ''} onChange={(event) => updateAIDraft(activeAIDraftIndex, { tags: event.target.value })} maxLength={500} />
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('description')}</Label>
                        <Textarea value={activeAIDraft.description || ''} onChange={(event) => updateAIDraft(activeAIDraftIndex, { description: event.target.value })} rows={4} maxLength={4000} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('expectedResult')}</Label>
                        <Textarea value={activeAIDraft.expected_result || ''} onChange={(event) => updateAIDraft(activeAIDraftIndex, { expected_result: event.target.value })} rows={4} maxLength={4000} />
                      </div>
                      <div className="space-y-2 lg:col-span-2">
                        <Label>{t('preconditions')}</Label>
                        <Textarea value={activeAIDraft.preconditions || ''} onChange={(event) => updateAIDraft(activeAIDraftIndex, { preconditions: event.target.value })} rows={2} maxLength={4000} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label>{t('testSteps')}</Label>
                        <Button type="button" variant="outline" size="sm" onClick={() => addAIDraftStep(activeAIDraftIndex)}>
                          <Plus className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                          {t('addStep')}
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {(activeAIDraft.test_steps || []).length === 0 ? (
                          <EmptyState label={t('noTestSteps')} />
                        ) : (
                          (activeAIDraft.test_steps || []).map((step, stepIndex) => (
                            <div key={stepIndex} className="grid gap-2 rounded-md bg-slate-50 p-3 dark:bg-slate-900 lg:grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)_40px]">
                              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-xs font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                                {stepIndex + 1}
                              </span>
                              <Textarea value={step.action} onChange={(event) => updateAIDraftStep(activeAIDraftIndex, stepIndex, { action: event.target.value })} rows={2} placeholder={t('action')} maxLength={2000} />
                              <Textarea value={step.expected_result} onChange={(event) => updateAIDraftStep(activeAIDraftIndex, stepIndex, { expected_result: event.target.value })} rows={2} placeholder={t('expectedResult')} maxLength={2000} />
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeAIDraftStep(activeAIDraftIndex, stepIndex)} aria-label={t('remove')}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="sm:items-center">
              {selectedDuplicateCount > 0 && !allowDuplicates && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  {t('duplicatesWillBeSkipped', { count: selectedDuplicateCount })}
                </span>
              )}
              <Button type="button" variant="outline" onClick={() => setAiDialogOpen(false)}>{t('cancel')}</Button>
              <Button
                type="button"
                onClick={handleCreateSelectedAIDrafts}
                disabled={savingAIDrafts || checkingDuplicates || creatableSelectedCount === 0 || !testSuites.length}
              >
                {savingAIDrafts ? t('saving') : t('createSelectedDraftsCount', { count: creatableSelectedCount })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={linkDialogOpen} onOpenChange={(open) => { if (!bulkUpdating) setLinkDialogOpen(open); }}>
          <DialogContent
            isRTL={isRTL}
            className="max-w-2xl"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && selectedAvailableTestCaseIds.length > 0 && !bulkUpdating) {
                e.preventDefault();
                void (async () => {
                  const ok = await handleBulkLink(selectedAvailableTestCaseIds);
                  if (ok) setLinkDialogOpen(false);
                })();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('linkExistingTestCases')}</DialogTitle>
              <DialogDescription>{t('searchTestCasesToLink')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="relative">
                <Input
                  value={testCaseSearchInput}
                  onChange={(event) => setTestCaseSearchInput(event.target.value)}
                  placeholder={t('searchTestCasesToLink')}
                  aria-label={t('searchTestCasesToLink')}
                  maxLength={100}
                  className={isRTL ? 'pl-9' : 'pr-9'}
                />
                {availableTestCasesLoading && (
                  <Loader2 className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400 ${isRTL ? 'left-3' : 'right-3'}`} />
                )}
              </div>
              {testCaseSearchInput.trim().length < 2 ? (
                <EmptyState label={t('typeToSearchTestCases')} />
              ) : (availableTestCasesLoading || testCaseSearchInput.trim() !== testCaseSearchQuery.trim()) ? (
                <div className="space-y-2">
                  <div className="h-14 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                  <div className="h-14 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                </div>
              ) : availableTestCases.length === 0 ? (
                <EmptyState label={t('noTestCasesMatchSearch')} />
              ) : (
                <div className="max-h-[360px] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                  {availableTestCases.map((testCase) => (
                    <label key={testCase.id} className="flex min-w-0 cursor-pointer items-start gap-3 border-b border-slate-100 p-3 text-sm last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950/50">
                      <Checkbox
                        checked={selectedAvailableTestCaseIds.includes(testCase.id)}
                        onCheckedChange={() => toggleAvailableSelection(testCase.id)}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-900 wrap-anywhere dark:text-white">TC-{String(testCase.id).padStart(3, '0')} · {testCase.title}</span>
                        <span className="mt-1 block text-xs text-slate-500">{testCase.suite_name || t('suite')}{testCase.section_name ? ` / ${testCase.section_name}` : ''}</span>
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
              <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)} disabled={bulkUpdating}>{t('cancel')}</Button>
              <Button
                type="button"
                onClick={async () => {
                  // Keep the dialog (and the user's selection) open if linking fails.
                  const ok = await handleBulkLink(selectedAvailableTestCaseIds);
                  if (ok) setLinkDialogOpen(false);
                }}
                disabled={selectedAvailableTestCaseIds.length === 0 || bulkUpdating}
              >
                {bulkUpdating && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('linkSelected', { count: selectedAvailableTestCaseIds.length })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent
            isRTL={isRTL}
            className="max-w-2xl"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && !creatingTestCase && testSuites.length > 0) {
                e.preventDefault();
                void handleCreateAndLinkTestCase();
              }
            }}
          >
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
                      {TEST_CASE_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority} className="capitalize">{priority}</SelectItem>)}
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
                      {TEST_CASE_STATUSES.map((status) => <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>)}
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

        <Dialog
          open={editDialogOpen}
          onOpenChange={(open) => {
            if (!open && savingRequirement) return;
            setEditDialogOpen(open);
          }}
        >
          <DialogContent
            isRTL={isRTL}
            className="max-w-3xl"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && canSaveRequirement) {
                e.preventDefault();
                void handleUpdateRequirement();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('editRequirement')}</DialogTitle>
              <DialogDescription>{t('updateRequirementInfo')}</DialogDescription>
            </DialogHeader>
            <div className="-mx-1 max-h-[65vh] space-y-5 overflow-y-auto px-1 py-1">
              <div className="space-y-2">
                <Label htmlFor="edit-requirement-title">
                  {t('title')} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="edit-requirement-title"
                  value={editForm.title}
                  onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder={t('enterRequirementTitle')}
                />
                <p className="text-xs text-slate-500">{t('titleHelper')}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('status')}</Label>
                  <Select value={editForm.status} onValueChange={(value) => setEditForm((current) => ({ ...current, status: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUIREMENT_STATUSES.map((status) => <SelectItem key={status} value={status}>{t(status)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('priority')}</Label>
                  <Select value={editForm.priority} onValueChange={(value) => setEditForm((current) => ({ ...current, priority: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUIREMENT_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}>{t(priority)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('description')}</Label>
                <ContentEditor
                  value={editForm.description}
                  onChange={(value) => setEditForm((current) => ({ ...current, description: value }))}
                  placeholder={t('enterRequirementDescription')}
                  format="markdown"
                  dir={isRTL ? 'rtl' : 'ltr'}
                  minHeight="200px"
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>{t('acceptanceCriteria')}</Label>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="edit-requirement-gherkin" className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {t('gherkinSyntax')}
                    </Label>
                    <Switch
                      id="edit-requirement-gherkin"
                      checked={editGherkin}
                      onCheckedChange={(checked) => {
                        setEditGherkin(checked);
                        if (checked && !editForm.acceptance_criteria.trim()) {
                          setEditForm((current) => ({ ...current, acceptance_criteria: GHERKIN_TEMPLATE }));
                        }
                      }}
                    />
                  </div>
                </div>
                {editGherkin ? (
                  <GherkinEditor
                    ariaLabel={t('acceptanceCriteria')}
                    value={editForm.acceptance_criteria}
                    onChange={(value) => setEditForm((current) => ({ ...current, acceptance_criteria: value }))}
                    placeholder={t('gherkinAcceptancePlaceholder')}
                    minHeight="200px"
                    emptyPreviewLabel={t('noAcceptanceCriteriaProvided')}
                  />
                ) : (
                  <ContentEditor
                    value={editForm.acceptance_criteria}
                    onChange={(value) => setEditForm((current) => ({ ...current, acceptance_criteria: value }))}
                    placeholder={t('enterAcceptanceCriteria')}
                    format="markdown"
                    dir={isRTL ? 'rtl' : 'ltr'}
                    minHeight="160px"
                  />
                )}
                <p className="text-xs text-slate-500">
                  {editGherkin ? t('gherkinAcceptanceHelper') : t('acceptanceCriteriaHelper')}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-requirement-effort">{t('estimatedEffortHours')}</Label>
                  <Input
                    id="edit-requirement-effort"
                    type="number"
                    step="0.5"
                    min="0"
                    value={editForm.estimated_effort}
                    onChange={(event) => setEditForm((current) => ({ ...current, estimated_effort: event.target.value }))}
                    placeholder="8.0"
                  />
                  <p className={`text-xs ${editEffortInvalid ? 'text-rose-500' : 'text-slate-500'}`}>
                    {editEffortInvalid ? t('estimatedEffortInvalid') : t('estimatedEffortHelper')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-requirement-tags">{t('tags')}</Label>
                  <Input
                    id="edit-requirement-tags"
                    value={editForm.tags}
                    onChange={(event) => setEditForm((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="security, authentication"
                  />
                  <p className="text-xs text-slate-500">{t('tagsHelper')}</p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} disabled={savingRequirement}>
                {t('cancel')}
              </Button>
              <Button type="button" onClick={handleUpdateRequirement} disabled={!canSaveRequirement}>
                {savingRequirement ? t('saving') : t('updateRequirement')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {requirement?.project_id && requirement?.id && (
          <CustomFieldsPanel
            projectId={Number(requirement.project_id)}
            entityType="requirement"
            entityId={Number(requirement.id)}
            hideWhenEmpty
            className="mt-6"
          />
        )}
      </div>
    </div>
  );
}

function RichTextContent({ html }: { html: string }) {
  const isHtml = isHtmlMarkup(html);
  const safeHtml = useMemo(() => (isHtml ? sanitizeHtml(html) : ''), [isHtml, html]);

  if (!isHtml) {
    return (
      <p className="max-w-[72ch] whitespace-pre-wrap text-[15px] leading-[1.8] text-slate-700 wrap-anywhere dark:text-slate-300">
        {html}
      </p>
    );
  }
  return (
    <div data-rich-text-editor>
      <div
        className="rich-text-preview max-w-[72ch] text-[15px] leading-[1.8] text-slate-700 wrap-anywhere dark:text-slate-300"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {label}
    </p>
  );
}

function SummaryTile({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'danger' | 'warning' }) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  const isAlert = (tone === 'danger' || tone === 'warning') && Number.isFinite(numericValue) && numericValue > 0;

  const containerTone = !isAlert
    ? 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50'
    : tone === 'danger'
      ? 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30'
      : 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30';
  const valueTone = !isAlert
    ? 'text-slate-950 dark:text-white'
    : tone === 'danger'
      ? 'text-rose-700 dark:text-rose-300'
      : 'text-amber-700 dark:text-amber-300';

  return (
    <div className={`flex min-w-0 flex-col rounded-md border p-3 ${containerTone}`}>
      <p className="text-xs font-medium leading-tight text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-auto pt-1 text-2xl font-semibold leading-none ${valueTone}`}>{value}</p>
    </div>
  );
}

function MetaRow({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0 dark:border-slate-800">
      <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </span>
      <span className="max-w-[170px] wrap-break-word text-end font-medium text-slate-900 wrap-anywhere dark:text-white">{value}</span>
    </div>
  );
}
