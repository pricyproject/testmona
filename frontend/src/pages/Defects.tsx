import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useQuery } from '@tanstack/react-query';
import { defectsAPI, enumsAPI, getApiErrorMessage, projectAssignmentsAPI, requirementsAPI, testCasesAPI, testResultsAPI } from '@/lib/api';
import { useDefectsList } from '@/hooks/queries/defects';
import { Checkbox } from '@/components/ui/checkbox';
import { SavedFilters } from '@/components/SavedFilters';
import { BulkEditDefectsDialog } from '@/components/BulkEditDefectsDialog';
import { defectManagementAPI, IssueTrackerIntegration } from '@/lib/defectManagementAPI';
import { SearchableRequirementSelect } from '@/components/Defects/SearchableRequirementSelect';
import { SearchableTestCaseSelect } from '@/components/Defects/SearchableTestCaseSelect';
import { DefectComments } from '@/components/Defects/DefectComments';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppName } from '@/hooks/useAppName';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TestCaseSearchBar, SearchSuggestionGroup } from '@/components/TestCases/TestCaseSearchBar';
import { parseDefectQuery, defectMatchesQuery } from '@/components/Defects/defectsSearchQuery';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Bug, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Edit, Trash2, AlertTriangle, ExternalLink, Settings, RefreshCw, Loader2, CheckCircle2, AlertCircle, FileText, Link2, SlidersHorizontal, MoreHorizontal, Filter, ArrowUpDown, X, Activity, ShieldAlert, Flag, Sparkles, Maximize2, Minimize2, List, Table2, Columns3, GitBranch } from 'lucide-react';

const SEVERITY_STRIPE: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-400',
  medium: 'bg-blue-400',
  low: 'bg-slate-300',
};

// Columns for the board (kanban) view, ordered by typical defect lifecycle.
const BOARD_COLUMNS: Array<{ status: string; dot: string }> = [
  { status: 'open', dot: 'bg-red-500' },
  { status: 'in_progress', dot: 'bg-yellow-500' },
  { status: 'fixed', dot: 'bg-green-500' },
  { status: 'reopened', dot: 'bg-orange-500' },
  { status: 'closed', dot: 'bg-gray-400' },
  { status: 'rejected', dot: 'bg-purple-500' },
];

const LINKED_ENTITY_PAGE_SIZE = 500;

const DEFECT_FIELD_LIMITS = {
  title: 200,
  description: 1000,
  steps: 2000,
  environment: 255,
  tags: 500,
  externalIssueUrl: 500,
};

type PriorityColorOption = {
  value: string;
  label: string;
  color?: string;
};

const DEFECT_SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'];
const DEFECT_PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];

const isSafeHexColor = (value?: string): value is string => /^#[0-9a-f]{6}$/i.test(value || '');

const loadAllProjectTestCases = async (numericProjectId: number) => {
  const allTestCases: any[] = [];
  for (let skip = 0; ; skip += LINKED_ENTITY_PAGE_SIZE) {
    const page = await testCasesAPI.getAll(
      numericProjectId,
      undefined,
      undefined,
      'id',
      'asc',
      skip,
      LINKED_ENTITY_PAGE_SIZE,
    );
    const rows = Array.isArray(page) ? page : [];
    allTestCases.push(...rows);
    if (rows.length < LINKED_ENTITY_PAGE_SIZE) return allTestCases;
  }
};

const loadAllProjectRequirements = async (numericProjectId: number) => {
  const allRequirements: any[] = [];
  for (let skip = 0; ; skip += LINKED_ENTITY_PAGE_SIZE) {
    const page = await requirementsAPI.getAll(numericProjectId, skip, LINKED_ENTITY_PAGE_SIZE);
    const rows = Array.isArray(page) ? page : [];
    allRequirements.push(...rows);
    if (rows.length < LINKED_ENTITY_PAGE_SIZE) return allRequirements;
  }
};

const parsePositiveQueryNumber = (value: string | null): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

function SectionHeader({
  icon,
  title,
  accent,
  isRTL,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  isRTL: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
      <span className={accent}>{icon}</span>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <span className="ml-auto h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

type PillOption = {
  value: string;
  label: string;
  tone: string;
  activeTone: string;
  color?: string;
};

function PillPickerRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: PillOption[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(option.value)}
              className={`inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                isActive ? option.activeTone : option.tone
              }`}
            >
              {option.color && (
                <span
                  className="me-1.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: option.color }}
                  aria-hidden="true"
                />
              )}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type DefectViewMode = 'list' | 'table' | 'board';

function ViewToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      aria-label={label}
      className={`flex h-8 items-center justify-center rounded-md px-2.5 text-sm font-medium transition ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function SummaryStat({
  label,
  value,
  icon,
  accent,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const interactive = typeof onClick === 'function';
  const Wrapper: React.ElementType = interactive ? 'button' : 'div';
  return (
    <Wrapper
      {...(interactive ? { type: 'button', onClick } : {})}
      aria-pressed={interactive ? active : undefined}
      className={`group flex items-center gap-3 rounded-2xl border bg-white p-4 text-left shadow-xs transition dark:bg-slate-900 ${
        active
          ? 'border-slate-900 ring-2 ring-slate-900/10 dark:border-slate-100 dark:ring-slate-100/10'
          : 'border-slate-200 dark:border-slate-800'
      } ${interactive ? 'hover:border-slate-300 hover:shadow-sm dark:hover:border-slate-700' : ''}`}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`} aria-hidden="true">
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{value}</span>
      </span>
    </Wrapper>
  );
}

export function Defects() {
  const navigate = useNavigate();
  const { projectId, defectId: routeDefectId } = useParams();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();
  const { formatDate, formatDateTime } = useDateFormat();
  const formatSnapshotDate = (value?: string | null): string => (value ? formatDateTime(value) || '-' : '-');
  const { canWrite } = usePermissions();
  const { appName } = useAppName(false);
  const linkedMilestoneId = parsePositiveQueryNumber(searchParams.get('milestone_id'));
  
  const numericProjectId = projectId ? parseInt(projectId) : null;
  const [defects, setDefects] = useState<any[]>([]);

  const defectsQuery = useDefectsList(numericProjectId, linkedMilestoneId, numericProjectId != null);
  const isLoading = numericProjectId != null && defectsQuery.isLoading;
  const loadDefects = () => defectsQuery.refetch();

  // Seed the fetched defect list into local state so the page's optimistic
  // create/update/delete mutations keep working unchanged; manual reloads below
  // become query refetches.
  useEffect(() => {
    if (defectsQuery.data) setDefects(defectsQuery.data);
  }, [defectsQuery.data]);

  // Secondary reference data for the create/edit + bulk-edit forms.
  const formDataQuery = useQuery({
    queryKey: ['defects', 'formData', numericProjectId],
    queryFn: async () => {
      const pid = numericProjectId as number;
      const testCasesData = await loadAllProjectTestCases(pid);
      let priorityColors: PriorityColorOption[] = [];
      try {
        const prioritiesData = await enumsAPI.getPriorities(pid);
        priorityColors = (Array.isArray(prioritiesData) ? prioritiesData : [])
          .map((priority: any) => ({
            value: String(priority.name || '').trim().toLowerCase(),
            label: String(priority.name || '').trim(),
            color: isSafeHexColor(priority.color) ? priority.color : undefined,
          }))
          .filter((priority) => priority.value && priority.label);
      } catch (priorityError) {
        console.warn('Failed to load priority colors for defect form:', priorityError);
      }
      let requirementsList: any[] = [];
      try {
        const requirementsData = await loadAllProjectRequirements(pid);
        requirementsList = Array.isArray(requirementsData) ? requirementsData : [];
      } catch (requirementsError) {
        console.warn('Failed to load requirements for defect linking:', requirementsError);
      }
      let members: Array<{ id: number; name: string }> = [];
      try {
        const rows = await projectAssignmentsAPI.listMembers(pid);
        members = (rows as Array<any>).map((m) => ({
          id: m.user_id,
          name: m.full_name || m.username || m.email || `User ${m.user_id}`,
        }));
      } catch (memberError) {
        console.warn('Failed to load project members for bulk edit:', memberError);
      }
      return {
        testCases: Array.isArray(testCasesData) ? testCasesData : [],
        requirements: requirementsList,
        priorityColors,
        members,
      };
    },
    enabled: numericProjectId != null,
  });
  const testCases = formDataQuery.data?.testCases ?? [];
  const requirements = formDataQuery.data?.requirements ?? [];
  const projectMembers = formDataQuery.data?.members ?? [];
  const priorityColorOptions = formDataQuery.data?.priorityColors ?? [];

  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  // Filter/sort + per-row expansion state for the redesigned list view.
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<string>('newest');
  const [viewMode, setViewMode] = useState<DefectViewMode>(() => {
    if (typeof window === 'undefined') return 'list';
    try {
      const stored = window.localStorage.getItem('defects-view-mode');
      return stored === 'table' || stored === 'board' ? stored : 'list';
    } catch {
      return 'list';
    }
  });
  const changeViewMode = (mode: DefectViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem('defects-view-mode', mode);
    } catch {
      // ignore persistence failures (private mode, etc.)
    }
  };
  const [expandedDefectIds, setExpandedDefectIds] = useState<Set<number>>(new Set());
  const [defectResultLinks, setDefectResultLinks] = useState<Record<number, any[]>>({});
  const [loadingDefectResultLinks, setLoadingDefectResultLinks] = useState<Set<number>>(new Set());
  const [correctingSnapshotIds, setCorrectingSnapshotIds] = useState<Set<number>>(new Set());
  const [selectedDefectIds, setSelectedDefectIds] = useState<number[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const toggleDefectSelection = (defectId: number) => {
    setSelectedDefectIds((prev) =>
      prev.includes(defectId) ? prev.filter((id) => id !== defectId) : [...prev, defectId],
    );
  };
  const clearDefectSelection = () => setSelectedDefectIds([]);

  const loadDefectResultLinks = async (defectId: number, force = false) => {
    if (!force && defectResultLinks[defectId]) return;

    setLoadingDefectResultLinks((prev) => new Set(prev).add(defectId));
    try {
      const links = await defectsAPI.getResultLinks(defectId);
      setDefectResultLinks((prev) => ({ ...prev, [defectId]: links }));
    } catch (error) {
      console.error('Failed to load defect result snapshots:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToLoadDefectSnapshots')),
        variant: 'destructive',
      });
    } finally {
      setLoadingDefectResultLinks((prev) => {
        const next = new Set(prev);
        next.delete(defectId);
        return next;
      });
    }
  };

  const handleCorrectDefectSnapshot = async (
    defectId: number,
    link: any,
    clearFailingStep = false,
  ) => {
    if (!link?.id || !link?.test_result_id) return;

    setCorrectingSnapshotIds((prev) => new Set(prev).add(link.id));
    try {
      await testResultsAPI.updateDefectLinkSnapshot(link.test_result_id, link.id, {
        clear_failing_step: clearFailingStep,
      });
      await loadDefectResultLinks(defectId, true);
      toast({ title: t('success'), description: t('snapshotCorrectedSuccessfully') });
    } catch (error) {
      console.error('Failed to correct defect snapshot:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToCorrectSnapshot')),
        variant: 'destructive',
      });
    } finally {
      setCorrectingSnapshotIds((prev) => {
        const next = new Set(prev);
        next.delete(link.id);
        return next;
      });
    }
  };

  const toggleDefectExpansion = (defectId: number) => {
    setExpandedDefectIds((prev) => {
      const next = new Set(prev);
      if (next.has(defectId)) {
        next.delete(defectId);
      } else {
        next.add(defectId);
        void loadDefectResultLinks(defectId);
      }
      return next;
    });
  };
  
  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingDefect, setEditingDefect] = useState<any>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateDialogExpanded, setIsCreateDialogExpanded] = useState(false);
  const defectTitleInputRef = useRef<HTMLInputElement>(null);
  const [isIntegrationDialogOpen, setIsIntegrationDialogOpen] = useState(false);
  const [isIntegrationFormOpen, setIsIntegrationFormOpen] = useState(false);
  
  // Integration states
  const [integrations, setIntegrations] = useState<IssueTrackerIntegration[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<IssueTrackerIntegration | null>(null);
  const [integrationToDelete, setIntegrationToDelete] = useState<IssueTrackerIntegration | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Integration form state
  const [integrationForm, setIntegrationForm] = useState({
    name: '',
    tracker_type: 'jira',
    api_url: '',
    api_token: '',
    username: '',
    project_key: '',
    sync_direction: 'bidirectional',
    is_active: true
  });
  
  // Sync dialog state
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [syncingDefectId, setSyncingDefectId] = useState<number | null>(null);
  const [selectedSyncIntegrationId, setSelectedSyncIntegrationId] = useState<number | null>(null);
  
  // Dynamic placeholders based on tracker type
  const getPlaceholders = () => {
    const placeholders: Record<string, any> = {
      jira: {
        name: t('trackerNameJira'),
        apiUrl: 'https://your-domain.atlassian.net',
        projectKey: 'TEST',
        projectKeyLabel: t('trackerLabelProjectKey'),
        projectKeyDesc: t('trackerDescJira')
      },
      github: {
        name: t('trackerNameGithub'),
        apiUrl: 'https://api.github.com',
        projectKey: 'owner/repo',
        projectKeyLabel: t('trackerLabelRepository'),
        projectKeyDesc: t('trackerDescGithub')
      },
      gitlab: {
        name: t('trackerNameGitlab'),
        apiUrl: 'https://gitlab.com/api/v4',
        projectKey: 'namespace/project',
        projectKeyLabel: t('trackerLabelProjectPath'),
        projectKeyDesc: t('trackerDescGitlab')
      },
      'azure-devops': {
        name: t('trackerNameAzure'),
        apiUrl: 'https://dev.azure.com/your-org',
        projectKey: 'Project Name',
        projectKeyLabel: t('trackerLabelProjectName'),
        projectKeyDesc: t('trackerDescAzure')
      },
      linear: {
        name: t('trackerNameLinear'),
        apiUrl: 'https://api.linear.app',
        projectKey: 'Team Key',
        projectKeyLabel: t('trackerLabelTeamKey'),
        projectKeyDesc: t('trackerDescLinear')
      },
      asana: {
        name: t('trackerNameAsana'),
        apiUrl: 'https://app.asana.com/api/1.0',
        projectKey: 'Project GID',
        projectKeyLabel: t('trackerLabelProjectGid'),
        projectKeyDesc: t('trackerDescAsana')
      }
    };
    return placeholders[integrationForm.tracker_type] || placeholders.jira;
  };
  
  // Validation state
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const nameInputRef = useRef<HTMLInputElement>(null);
  const apiUrlInputRef = useRef<HTMLInputElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const projectKeyInputRef = useRef<HTMLInputElement>(null);
  
  // Form states
  const [defectId, setDefectId] = useState('');
  const [defectTitle, setDefectTitle] = useState('');
  const [defectDescription, setDefectDescription] = useState('');
  const [defectStatus, setDefectStatus] = useState('open');
  const [defectSeverity, setDefectSeverity] = useState('');
  const [defectPriority, setDefectPriority] = useState('');
  const [defectSteps, setDefectSteps] = useState('');
  const [defectEnvironment, setDefectEnvironment] = useState('');
  const [defectTags, setDefectTags] = useState('');
  const [defectJiraLink, setDefectJiraLink] = useState('');
  const [defectTestCaseId, setDefectTestCaseId] = useState('none');
  const [defectRequirementId, setDefectRequirementId] = useState('none');
  const [defectTouchedFields, setDefectTouchedFields] = useState<Record<string, boolean>>({});

  // Draft state
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saved' | 'restored'>('idle');
  const [hasRestorableDraft, setHasRestorableDraft] = useState(false);
  const draftHydratedRef = useRef(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftStorageKey = projectId ? `defects.reportDefectDraft.project-${projectId}` : null;

  const hasUnsavedChanges = defectTitle.trim() !== ''
    || defectDescription.trim() !== ''
    || defectSteps.trim() !== ''
    || defectEnvironment.trim() !== ''
    || defectTags.trim() !== ''
    || defectJiraLink.trim() !== ''
    || defectSeverity !== ''
    || defectPriority !== ''
    || (defectTestCaseId && defectTestCaseId !== 'none')
    || (defectRequirementId && defectRequirementId !== 'none');
  const externalIssueValue = defectJiraLink.trim();
  const isExternalIssueUrlInvalid = externalIssueValue !== '' && !/^https?:\/\/\S+$/i.test(externalIssueValue);
  const selectedDefectTestCase = testCases.find((testCase) => String(testCase.id) === defectTestCaseId) || null;
  const selectedDefectRequirement = requirements.find((requirement) => String(requirement.id) === defectRequirementId) || null;
  const hasDefectTitle = defectTitle.trim() !== '';
  const hasDefectSeverity = defectSeverity.trim() !== '';
  const hasDefectPriority = defectPriority.trim() !== '';
  const linkedContextCount = [selectedDefectTestCase, selectedDefectRequirement, externalIssueValue || null].filter(Boolean).length;
  const defectReadinessChecks = [hasDefectTitle, hasDefectSeverity, hasDefectPriority];
  const defectReadinessCompleted = defectReadinessChecks.filter(Boolean).length;
  const isDefectReadyToSubmit = defectReadinessCompleted === defectReadinessChecks.length && !isExternalIssueUrlInvalid && !!projectId;
  const defectReadinessRatio = defectReadinessCompleted / defectReadinessChecks.length;
  const defectReadinessTitle = isDefectReadyToSubmit ? t('defectModalReady') : t('defectModalNeedsAttention');
  const defectReadinessDescription = isDefectReadyToSubmit ? t('defectModalReadyDesc') : t('defectModalNeedsAttentionDesc');
  const externalIssueStatusLabel = isExternalIssueUrlInvalid
    ? t('defectModalExternalInvalid')
    : externalIssueValue
      ? t('defectModalExternalReady')
      : t('defectModalExternalMissing');
  const priorityColorByValue = (value: string) => {
    const normalizedValue = value.toLowerCase();
    const match = priorityColorOptions.find((priority) => priority.value === normalizedValue)
      || (normalizedValue === 'urgent' ? priorityColorOptions.find((priority) => priority.value === 'critical') : undefined);
    return match?.color;
  };
  const severityPickerOptions = DEFECT_SEVERITY_OPTIONS.map((value) => ({
    value,
    label: t(value),
    tone: 'border-border bg-background text-foreground hover:bg-accent',
    activeTone: 'border-primary bg-primary text-primary-foreground',
  }));
  const priorityPickerOptions = DEFECT_PRIORITY_OPTIONS.map((value) => ({
    value,
    label: t(value),
    color: priorityColorByValue(value),
    tone: 'border-border bg-background text-foreground hover:bg-accent',
    activeTone: 'border-primary bg-primary text-primary-foreground',
  }));
  const resetDefectForm = () => {
    setDefectId('');
    setDefectTitle('');
    setDefectDescription('');
    setDefectStatus('open');
    setDefectSeverity('');
    setDefectPriority('');
    setDefectSteps('');
    setDefectEnvironment('');
    setDefectTags('');
    setDefectJiraLink('');
    setDefectTestCaseId('none');
    setDefectRequirementId('none');
    setDefectTouchedFields({});
  };

  const fetchIntegrations = useCallback(async () => {
    if (!projectId) return;

    setIsLoadingIntegrations(true);
    try {
      const data = await defectManagementAPI.getIssueTrackerIntegrations(parseInt(projectId));
      setIntegrations(data);
    } catch (error) {
      console.error('Failed to fetch integrations:', error);
      toast({
        title: t('error'),
        description: t('failedToLoadIntegrations'),
        variant: 'destructive',
      });
    } finally {
      setIsLoadingIntegrations(false);
    }
  }, [projectId, t, toast]);

  // Defects + form reference data are fetched via react-query above; integrations
  // keep their own self-contained loader.
  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    if (!routeDefectId || defects.length === 0) return;

    const targetDefect = defects.find((defect) =>
      String(defect.id) === routeDefectId || String(defect.defect_id) === routeDefectId,
    );
    if (!targetDefect) return;

    setSearchQuery(String(targetDefect.defect_id || targetDefect.title || routeDefectId));
    setStatusFilter('all');
    setSeverityFilter('all');
    setPriorityFilter('all');
    setCurrentPage(1);
    setExpandedDefectIds((prev) => new Set(prev).add(targetDefect.id));
    void loadDefectResultLinks(targetDefect.id);
  }, [routeDefectId, defects]);

  // Auto-focus on title input when dialog opens
  useEffect(() => {
    if (isCreateDialogOpen && defectTitleInputRef.current) {
      setTimeout(() => defectTitleInputRef.current?.focus(), 100);
    }
  }, [isCreateDialogOpen]);

  // Reset to page 1 whenever filters/search change so users don't see
  // an empty page after narrowing results.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, severityFilter, priorityFilter, sortMode]);

  // Drop any selection carried over from a previous project — those IDs aren't
  // in the new project and would silently land in skipped_ids on a bulk edit.
  useEffect(() => {
    setSelectedDefectIds([]);
  }, [projectId]);

  // Detect a restorable draft so we can offer a "Discard draft" affordance even
  // before the dialog is opened.
  useEffect(() => {
    if (!draftStorageKey || typeof window === 'undefined') {
      setHasRestorableDraft(false);
      return;
    }
    try {
      setHasRestorableDraft(window.localStorage.getItem(draftStorageKey) !== null);
    } catch {
      setHasRestorableDraft(false);
    }
  }, [draftStorageKey, isCreateDialogOpen]);

  // Restore draft when the dialog opens. Skip restoration when editing
  // (the edit handler populates form state from the existing defect).
  useEffect(() => {
    if (!isCreateDialogOpen || !draftStorageKey || typeof window === 'undefined') {
      draftHydratedRef.current = false;
      return;
    }

    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<{
          defectId: string;
          defectTitle: string;
          defectDescription: string;
          defectSeverity: string;
          defectPriority: string;
          defectSteps: string;
          defectEnvironment: string;
          defectTags: string;
          defectJiraLink: string;
          defectTestCaseId: string;
          defectRequirementId: string;
        }>;
        if (typeof draft.defectId === 'string') setDefectId(draft.defectId);
        if (typeof draft.defectTitle === 'string') setDefectTitle(draft.defectTitle);
        if (typeof draft.defectDescription === 'string') setDefectDescription(draft.defectDescription);
        if (typeof draft.defectSeverity === 'string') setDefectSeverity(draft.defectSeverity);
        if (typeof draft.defectPriority === 'string') setDefectPriority(draft.defectPriority);
        if (typeof draft.defectSteps === 'string') setDefectSteps(draft.defectSteps);
        if (typeof draft.defectEnvironment === 'string') setDefectEnvironment(draft.defectEnvironment);
        if (typeof draft.defectTags === 'string') setDefectTags(draft.defectTags);
        if (typeof draft.defectJiraLink === 'string') setDefectJiraLink(draft.defectJiraLink);
        if (typeof draft.defectTestCaseId === 'string') setDefectTestCaseId(draft.defectTestCaseId);
        if (typeof draft.defectRequirementId === 'string') setDefectRequirementId(draft.defectRequirementId);
        setDraftStatus('restored');
      } else {
        setDraftStatus('idle');
      }
    } catch (error) {
      console.warn('Failed to restore defect draft:', error);
      setDraftStatus('idle');
    } finally {
      // Defer flipping the hydrated flag until after the state updates flush.
      setTimeout(() => {
        draftHydratedRef.current = true;
      }, 0);
    }
  }, [isCreateDialogOpen, draftStorageKey]);

  // Persist draft on change (debounced). Only runs once the open-effect has
  // finished its hydration pass, otherwise the restored values would overwrite
  // a newer saved draft.
  useEffect(() => {
    if (!isCreateDialogOpen || !draftStorageKey || typeof window === 'undefined') return;
    if (!draftHydratedRef.current) return;

    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      const payload = {
        defectId,
        defectTitle,
        defectDescription,
        defectSeverity,
        defectPriority,
        defectSteps,
        defectEnvironment,
        defectTags,
        defectJiraLink,
        defectTestCaseId,
        defectRequirementId,
        savedAt: new Date().toISOString(),
      };

      const hasContent = defectTitle.trim() !== ''
        || defectDescription.trim() !== ''
        || defectSteps.trim() !== ''
        || defectEnvironment.trim() !== ''
        || defectTags.trim() !== ''
        || defectJiraLink.trim() !== ''
        || (defectTestCaseId && defectTestCaseId !== 'none')
        || (defectRequirementId && defectRequirementId !== 'none');

      try {
        if (hasContent) {
          window.localStorage.setItem(draftStorageKey, JSON.stringify(payload));
          setHasRestorableDraft(true);
          setDraftStatus('saved');
          if (draftStatusTimerRef.current) clearTimeout(draftStatusTimerRef.current);
          draftStatusTimerRef.current = setTimeout(() => setDraftStatus('idle'), 1500);
        } else {
          window.localStorage.removeItem(draftStorageKey);
          setHasRestorableDraft(false);
          setDraftStatus('idle');
        }
      } catch (error) {
        console.warn('Failed to persist defect draft:', error);
      }
    }, 500);

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [
    isCreateDialogOpen,
    draftStorageKey,
    defectId,
    defectTitle,
    defectDescription,
    defectSeverity,
    defectPriority,
    defectSteps,
    defectEnvironment,
    defectTags,
    defectJiraLink,
    defectTestCaseId,
    defectRequirementId,
  ]);

  useEffect(() => () => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    if (draftStatusTimerRef.current) clearTimeout(draftStatusTimerRef.current);
  }, []);

  const clearDraftStorage = useCallback(() => {
    if (!draftStorageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // ignore
    }
    setHasRestorableDraft(false);
    setDraftStatus('idle');
  }, [draftStorageKey]);

  const handleDiscardDraft = () => {
    clearDraftStorage();
    resetDefectForm();
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      setIsCreateDialogOpen(open);
      if (!open) {
        resetDefectForm();
        setIsCreateDialogExpanded(false);
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      clearDraftStorage();
      resetDefectForm();
      setIsCreateDialogOpen(false);
      setIsCreateDialogExpanded(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateDefect();
    }
  };

  const scrollCreateDialogSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

  // Parse the search box once per keystroke into structured terms + key:value
  // filters so the per-row matcher stays cheap as the result set scales.
  const parsedSearchQuery = useMemo(() => parseDefectQuery(searchQuery), [searchQuery]);

  // Suggestion catalog for the "/" advanced-search palette, derived from the
  // project's real statuses, severities, priorities, tags and environments so
  // completions are always valid against the current data.
  const searchSuggestionGroups = useMemo<SearchSuggestionGroup[]>(() => {
    const tagCounts = new Map<string, number>();
    const envCounts = new Map<string, number>();
    defects.forEach((defect) => {
      (defect.tags || '')
        .split(',')
        .map((tag: string) => tag.trim())
        .filter(Boolean)
        .forEach((tag: string) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
      const env = String(defect.environment || '').trim();
      if (env) envCounts.set(env, (envCounts.get(env) || 0) + 1);
    });
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => ({ value: tag.toLowerCase(), label: tag }));
    const topEnvs = Array.from(envCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([env]) => ({ value: env.toLowerCase(), label: env }));

    return [
      {
        key: 'status',
        label: t('status'),
        values: [
          { value: 'open', label: t('open') },
          { value: 'in_progress', label: t('inProgress') },
          { value: 'fixed', label: t('fixed') },
          { value: 'reopened', label: t('reopened') },
          { value: 'closed', label: t('closed') },
          { value: 'rejected', label: t('rejected') },
        ],
      },
      {
        key: 'severity',
        label: t('defectSeverity'),
        values: [
          { value: 'critical', label: t('critical') },
          { value: 'high', label: t('high') },
          { value: 'medium', label: t('medium') },
          { value: 'low', label: t('low') },
        ],
      },
      {
        key: 'priority',
        label: t('defectPriority'),
        values: [
          { value: 'urgent', label: t('urgent') },
          { value: 'high', label: t('high') },
          { value: 'medium', label: t('medium') },
          { value: 'low', label: t('low') },
        ],
      },
      { key: 'tag', label: t('tags'), values: topTags },
      { key: 'env', label: t('environment'), values: topEnvs },
    ];
  }, [defects, t]);

  const filteredDefects = defects.filter((defect) => {
    if (!defectMatchesQuery(defect, parsedSearchQuery)) return false;
    if (statusFilter !== 'all' && String(defect.status) !== statusFilter) return false;
    if (severityFilter !== 'all' && String(defect.severity) !== severityFilter) return false;
    if (priorityFilter !== 'all' && String(defect.priority) !== priorityFilter) return false;
    return true;
  });

  const sortedDefects = [...filteredDefects].sort((a, b) => {
    switch (sortMode) {
      case 'oldest':
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case 'severity_desc':
        return (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      case 'priority_desc':
        return (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0);
      case 'title_asc':
        return String(a.title || '').localeCompare(String(b.title || ''));
      case 'updated_desc': {
        const aT = new Date(a.updated_at || a.created_at).getTime();
        const bT = new Date(b.updated_at || b.created_at).getTime();
        return bT - aT;
      }
      case 'newest':
      default:
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
  });

  const totalPages = Math.max(1, Math.ceil(sortedDefects.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const paginatedDefects = sortedDefects.slice(startIndex, startIndex + itemsPerPage);

  const summary = defects.reduce(
    (acc, defect) => {
      const status = String(defect.status || '').toLowerCase();
      const severity = String(defect.severity || '').toLowerCase();
      if (status === 'open') acc.open += 1;
      if (status === 'in_progress') acc.inProgress += 1;
      if (status === 'fixed' || status === 'closed') acc.resolved += 1;
      if (severity === 'critical') acc.critical += 1;
      acc.total += 1;
      return acc;
    },
    { total: 0, open: 0, inProgress: 0, resolved: 0, critical: 0 }
  );

  // Safe, locale-aware date formatter — guards against missing or unparsable
  // timestamps so the table/board/list never render "Invalid Date".
  const formatDefectDate = (value?: string | null): string => (value ? formatDate(value) || '-' : '-');

  // Bucket the filtered defects into board (kanban) columns. Any defect whose
  // status isn't one of the known lifecycle states (legacy/custom/empty values)
  // is collected into a trailing "Other" column so nothing silently disappears
  // from the board.
  const boardColumns = (() => {
    const knownStatuses = new Set(BOARD_COLUMNS.map((column) => column.status));
    const columns = BOARD_COLUMNS.map((column) => ({
      key: column.status,
      dot: column.dot,
      isOther: false,
      defects: sortedDefects.filter((defect) => String(defect.status || '').toLowerCase() === column.status),
    }));
    const orphanDefects = sortedDefects.filter(
      (defect) => !knownStatuses.has(String(defect.status || '').toLowerCase()),
    );
    if (orphanDefects.length > 0) {
      columns.push({
        key: 'other',
        dot: 'bg-slate-400',
        isOther: true,
        defects: orphanDefects,
      });
    }
    return columns;
  })();

  const hasActiveFilters = searchQuery.trim() !== ''
    || statusFilter !== 'all'
    || severityFilter !== 'all'
    || priorityFilter !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setSeverityFilter('all');
    setPriorityFilter('all');
    setCurrentPage(1);
  };

  const handleCreateDefect = async () => {
    const trimmedTitle = defectTitle.trim();
    const selectedTestCaseId = defectTestCaseId && defectTestCaseId !== 'none' ? Number(defectTestCaseId) : null;
    const selectedRequirementId = defectRequirementId && defectRequirementId !== 'none' ? Number(defectRequirementId) : null;

    if (!trimmedTitle || !projectId) {
      setDefectTouchedFields((prev) => ({ ...prev, defectTitle: true }));
      toast({
        title: t('error'),
        description: t('defectIdAndTitleRequired'),
        variant: "destructive",
      });
      return;
    }

    if (!DEFECT_SEVERITY_OPTIONS.includes(defectSeverity)) {
      setDefectTouchedFields((prev) => ({ ...prev, defectSeverity: true }));
      toast({
        title: t('validationError'),
        description: t('fieldRequired', { field: t('defectSeverity') }),
        variant: "destructive",
      });
      return;
    }

    if (!DEFECT_PRIORITY_OPTIONS.includes(defectPriority)) {
      setDefectTouchedFields((prev) => ({ ...prev, defectPriority: true }));
      toast({
        title: t('validationError'),
        description: t('priorityRequired'),
        variant: "destructive",
      });
      return;
    }

    if (isExternalIssueUrlInvalid) {
      setDefectTouchedFields((prev) => ({ ...prev, defectJiraLink: true }));
      toast({
        title: t('validationError'),
        description: t('externalIssueUrlInvalid'),
        variant: "destructive",
      });
      return;
    }

    if (selectedTestCaseId !== null && !Number.isFinite(selectedTestCaseId)) {
      toast({
        title: t('validationError'),
        description: t('invalidTestCaseId'),
        variant: "destructive",
      });
      return;
    }

    if (selectedRequirementId !== null && !Number.isFinite(selectedRequirementId)) {
      toast({
        title: t('validationError'),
        description: t('invalidRequirementId'),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreating(true);
      const defectData = {
        title: trimmedTitle,
        description: defectDescription.trim(),
        severity: defectSeverity,
        priority: defectPriority,
        steps_to_reproduce: defectSteps.trim(),
        environment: defectEnvironment.trim(),
        tags: defectTags.trim(),
        external_issue_url: externalIssueValue || null,
        test_case_id: selectedTestCaseId,
        requirement_id: selectedRequirementId,
        project_id: parseInt(projectId),
      };

      const createdDefect = await defectsAPI.create(defectData);
      setDefects(prevDefects => [createdDefect, ...prevDefects]);

      clearDraftStorage();
      resetDefectForm();
      setIsCreateDialogOpen(false);
      setIsCreateDialogExpanded(false);

      toast({
        title: t('success'),
        description: t('defectCreatedSuccessfully'),
      });
    } catch (error) {
      console.error('Failed to create defect:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToCreateDefect')),
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditDefect = (defect: any) => {
    setEditingDefect(defect);
    setDefectId(defect.defect_id || '');
    setDefectTitle(defect.title || '');
    setDefectDescription(defect.description || '');
    setDefectStatus(defect.status || 'open');
    setDefectSeverity(defect.severity || 'medium');
    setDefectPriority(defect.priority || 'medium');
    setDefectSteps(defect.steps_to_reproduce || '');
    setDefectEnvironment(defect.environment || '');
    setDefectTags(defect.tags || '');
    setDefectJiraLink(defect.external_issue_url || defect.jira_link || '');
    setDefectTestCaseId(defect.test_case_id?.toString() || 'none');
    setDefectRequirementId(defect.requirement_id?.toString() || 'none');
    setIsEditDialogOpen(true);
  };

  const handleUpdateDefect = async () => {
    if (!editingDefect || !projectId) return;

    const trimmedDefectId = defectId.trim();
    const trimmedTitle = defectTitle.trim();
    const selectedTestCaseId = defectTestCaseId && defectTestCaseId !== 'none' ? Number(defectTestCaseId) : null;
    const selectedRequirementId = defectRequirementId && defectRequirementId !== 'none' ? Number(defectRequirementId) : null;

    if (!trimmedDefectId || !trimmedTitle) {
      toast({
        title: t('error'),
        description: t('defectIdAndTitleRequired'),
        variant: "destructive",
      });
      return;
    }

    if (selectedTestCaseId !== null && !Number.isFinite(selectedTestCaseId)) {
      toast({
        title: t('validationError'),
        description: t('invalidTestCaseId'),
        variant: "destructive",
      });
      return;
    }

    if (selectedRequirementId !== null && !Number.isFinite(selectedRequirementId)) {
      toast({
        title: t('validationError'),
        description: t('invalidRequirementId'),
        variant: "destructive",
      });
      return;
    }

    try {
      const defectData = {
        defect_id: trimmedDefectId,
        title: trimmedTitle,
        description: defectDescription.trim(),
        status: defectStatus,
        severity: defectSeverity,
        priority: defectPriority,
        steps_to_reproduce: defectSteps.trim(),
        environment: defectEnvironment.trim(),
        tags: defectTags.trim(),
        external_issue_url: defectJiraLink.trim() || null,
        test_case_id: selectedTestCaseId,
        requirement_id: selectedRequirementId,
      };

      const updatedDefect = await defectsAPI.update(editingDefect.id, defectData);
      setDefects(defects.map(d => d.id === editingDefect.id ? updatedDefect : d));
      
      setIsEditDialogOpen(false);
      setEditingDefect(null);

      toast({
        title: t('success'),
        description: t('defectUpdatedSuccessfully'),
      });
    } catch (error) {
      console.error('Failed to update defect:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToUpdateDefect')),
        variant: "destructive",
      });
    }
  };

  const handleDeleteDefect = async (defectId: number) => {
    if (!confirm(t('confirmDeleteDefect'))) return;

    try {
      await defectsAPI.delete(defectId);
      setDefects(defects.filter(d => d.id !== defectId));

      toast({
        title: t('success'),
        description: t('defectDeletedSuccessfully'),
      });
    } catch (error) {
      console.error('Failed to delete defect:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToDeleteDefect')),
        variant: "destructive",
      });
    }
  };

  const handleLinkToTestCase = (defect: any) => {
    if (defect.test_case_id && defect.test_run_id) {
      // Navigate to the specific test execution for this test case
      navigate(`/projects/${projectId}/test-runs/${defect.test_run_id}/test-cases/${defect.test_case_id}`);
    } else if (defect.test_case_id) {
      // If only test case ID, navigate to test case details
      navigate(`/projects/${projectId}/test-cases/${defect.test_case_id}`);
    } else {
      // If no specific test case, navigate to test cases page
      navigate(`/projects/${projectId}/test-cases`);
    }
  };

  const handleLinkToJira = (defect: any) => {
    const externalLink = defect.external_issue_url || defect.jira_link;
    if (externalLink) {
      window.open(externalLink, '_blank', 'noopener,noreferrer');
    } else {
      // Navigate to Jira integration settings
      navigate(`/projects/${projectId}/custom-fields?tab=jira`);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      open: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      fixed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      reopened: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      closed: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      rejected: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
    };
    return variants[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[severity] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      urgent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[priority] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getSyncStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      not_synced: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      syncing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      synced: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getSyncStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      not_synced: t('notSynced'),
      syncing: t('syncing'),
      synced: t('synced'),
      error: t('syncFailed')
    };
    return labels[status] || t('notSynced');
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      open: t('open'),
      in_progress: t('inProgress'),
      fixed: t('fixed'),
      reopened: t('reopened'),
      closed: t('closed'),
      rejected: t('rejected'),
    };
    return labels[status] || String(status || '').replace('_', ' ');
  };

  const getTriageLabel = (value: string) => {
    const labels: Record<string, string> = {
      low: t('low'),
      medium: t('medium'),
      high: t('high'),
      critical: t('critical'),
      urgent: t('urgent'),
    };
    return labels[value] || value;
  };

  const handleOpenSyncDialog = (defectId: number) => {
    if (integrations.length === 0) {
      toast({
        title: t('noIntegrationsAvailable'),
        description: t('pleaseAddIntegrationFirst'),
        variant: 'destructive',
      });
      return;
    }
    setSyncingDefectId(defectId);
    setSelectedSyncIntegrationId(null);
    setIsSyncDialogOpen(true);
  };

  const handleSyncWithExternal = async () => {
    if (!projectId || !syncingDefectId || !selectedSyncIntegrationId) return;

    setIsSyncing(true);
    try {
      const result = await defectManagementAPI.syncDefectWithExternal(
        parseInt(projectId),
        syncingDefectId,
        {
          integration_id: selectedSyncIntegrationId,
          sync_type: 'bidirectional',
          action: 'create'
        }
      );

      if (result.success) {
        toast({
          title: t('syncSuccessful'),
          description: t('syncSuccessfulDesc', { issueId: result.issue_id }),
        });
        setIsSyncDialogOpen(false);
        // Refresh defects to update sync status
        loadDefects();
      } else {
        toast({
          title: t('syncFailed'),
          description: result.message || t('syncFailedDesc'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to sync defect:', error);
      toast({
        title: t('error'),
        description: t('syncFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleViewInExternal = (externalUrl: string) => {
    window.open(externalUrl, '_blank');
  };

  const handleAddIntegration = () => {
    setEditingIntegration(null);
    setIntegrationForm({
      name: '',
      tracker_type: 'jira',
      api_url: '',
      api_token: '',
      username: '',
      project_key: '',
      sync_direction: 'bidirectional',
      is_active: true
    });
    setValidationErrors({});
    setTouchedFields({});
    setIsIntegrationFormOpen(true);
  };

  const handleEditIntegration = (integration: IssueTrackerIntegration) => {
    setEditingIntegration(integration);
    setIntegrationForm({
      name: integration.name,
      tracker_type: integration.tracker_type,
      api_url: integration.api_url,
      api_token: '',
      username: integration.username || '',
      project_key: integration.project_key || '',
      sync_direction: integration.sync_direction,
      is_active: integration.is_active
    });
    setValidationErrors({});
    setTouchedFields({});
    setIsIntegrationFormOpen(true);
  };

  const handleSaveIntegration = async () => {
    if (!projectId) return;
    
    // Mark all fields as touched
    setTouchedFields({
      name: true,
      api_url: true,
      api_token: true,
      project_key: true,
    });

    // Validate form
    const errors: Record<string, string> = {};
    
    // Name validation
    if (!integrationForm.name.trim()) {
      errors.name = t('integrationNameRequired');
    } else if (integrationForm.name.length < 3) {
      errors.name = t('integrationNameMinLength');
    } else if (integrationForm.name.length > 100) {
      errors.name = t('integrationNameMaxLength');
    }

    // API URL validation
    if (!integrationForm.api_url.trim()) {
      errors.api_url = t('apiUrlRequired');
    } else {
      try {
        const url = new URL(integrationForm.api_url);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.api_url = t('apiUrlProtocol');
        }
      } catch {
        errors.api_url = t('apiUrlValidUrl');
      }
    }

    // API Token validation (required for new integrations, optional for edits)
    if (!editingIntegration && !integrationForm.api_token.trim()) {
      errors.api_token = t('apiTokenRequired');
    } else if (integrationForm.api_token && integrationForm.api_token.length < 8) {
      errors.api_token = t('apiTokenMinLength');
    }

    // Project Key validation (required for Jira, GitHub, GitLab)
    if (['jira', 'github', 'gitlab'].includes(integrationForm.tracker_type)) {
      if (!integrationForm.project_key.trim()) {
        errors.project_key = t('projectKeyRequired');
      } else if (integrationForm.project_key.length < 2) {
        errors.project_key = t('projectKeyMinLength');
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      
      // Focus on the first field with an error
      if (errors.name) {
        nameInputRef.current?.focus();
      } else if (errors.api_url) {
        apiUrlInputRef.current?.focus();
      } else if (errors.api_token) {
        tokenInputRef.current?.focus();
      } else if (errors.project_key) {
        projectKeyInputRef.current?.focus();
      }

      toast({
        title: t('validationError'),
        description: t('pleaseFixErrorsBeforeSaving'),
        variant: 'destructive',
      });
      return;
    }

    try {
      if (editingIntegration) {
        await defectManagementAPI.updateIssueTrackerIntegration(
          parseInt(projectId),
          editingIntegration.id,
          integrationForm
        );
        toast({
          title: t('success'),
          description: t('integrationUpdatedSuccessfully'),
        });
      } else {
        await defectManagementAPI.createIssueTrackerIntegration(
          parseInt(projectId),
          integrationForm
        );
        toast({
          title: t('success'),
          description: t('integrationCreatedSuccessfully'),
        });
      }
      setIsIntegrationFormOpen(false);
      setValidationErrors({});
      setTouchedFields({});
      fetchIntegrations();
    } catch (error) {
      console.error('Failed to save integration:', error);
      toast({
        title: t('error'),
        description: t('failedToSaveIntegration'),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteIntegration = (integration: IssueTrackerIntegration) => {
    setIntegrationToDelete(integration);
  };

  const confirmDeleteIntegration = async () => {
    if (!projectId) return;
    if (!integrationToDelete) return;

    try {
      await defectManagementAPI.deleteIssueTrackerIntegration(parseInt(projectId), integrationToDelete.id);
      toast({
        title: t('success'),
        description: t('integrationDeletedSuccessfully'),
      });
      setIntegrationToDelete(null);
      fetchIntegrations();
    } catch (error) {
      console.error('Failed to delete integration:', error);
      toast({
        title: t('error'),
        description: t('failedToDeleteIntegration'),
        variant: 'destructive',
      });
    } finally {
      setIntegrationToDelete(null);
    }
  };

  const handleTestConnection = async (integrationId: number) => {
    if (!projectId) return;
    
    setIsTestingConnection(true);
    try {
      const result = await defectManagementAPI.testIssueTrackerConnection(parseInt(projectId), integrationId);
      if (result.success) {
        toast({
          title: t('success'),
          description: t('connectionTestPassed'),
        });
      } else {
        toast({
          title: t('connectionTestFailed'),
          description: result.message || t('connectionTestFailed'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      toast({
        title: t('error'),
        description: t('connectionTestFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  return (
    <div className="space-y-6 px-4 py-6 lg:px-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-red-50 p-3 dark:bg-red-900/20">
            <Bug className="h-6 w-6 text-red-600 dark:text-red-300" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">{t('defects')}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('defectsDescription')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate(`/projects/${projectId}/defects/root-cause-analysis`)}>
            <GitBranch className="h-4 w-4 mr-2" />
            {t('reportsTabRootCause')}
          </Button>
          <Dialog open={isIntegrationDialogOpen} onOpenChange={setIsIntegrationDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Settings className="h-4 w-4 mr-2" />
                {t('integrations')}
              </Button>
            </DialogTrigger>
            <DialogContent isRTL={isRTL} className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>{t('integrations')}</DialogTitle>
                <DialogDescription>
                  {t('integrationsDesc')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {isLoadingIntegrations ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : integrations.length === 0 ? (
                  <div className="text-center py-8">
                    <Settings className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
                    <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('noIntegrationsAvailable')}</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {t('noIntegrationsDefectsDesc')}
                    </p>
                  </div>
                ) : (
                  integrations.map((integration) => (
                    <Card key={integration.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-semibold">{integration.name}</h4>
                              {!integration.is_active && (
                                <Badge variant="outline" className="text-xs">{t('inactive')}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                              <Badge variant="outline" className="capitalize">
                                {integration.tracker_type}
                              </Badge>
                              {integration.project_key && (
                                <Badge variant="outline">{integration.project_key}</Badge>
                              )}
                              <Badge className={getSyncStatusBadge(integration.sync_status)}>
                                {getSyncStatusLabel(integration.sync_status)}
                              </Badge>
                            </div>
                            {integration.last_sync && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {t('lastSyncLabel')}: {formatDateTime(integration.last_sync)}
                              </p>
                            )}
                            {integration.sync_error && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                <AlertCircle className="h-3 w-3 inline mr-1" />
                                {integration.sync_error}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleTestConnection(integration.id)}
                              disabled={isTestingConnection}
                            >
                              {isTestingConnection ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleEditIntegration(integration)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleDeleteIntegration(integration)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
                <Button 
                  className="w-full" 
                  variant="outline"
                  onClick={handleAddIntegration}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('addIntegration')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={isCreateDialogOpen} onOpenChange={handleDialogClose}>
            {canWrite && (
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('reportDefect')}
                </Button>
              </DialogTrigger>
            )}
          <DialogContent
            isRTL={isRTL}
            className={`p-0 ${isCreateDialogExpanded ? 'h-[calc(100svh-1.5rem)] max-h-[calc(100svh-1.5rem)] overflow-y-auto sm:max-w-[calc(100vw-1.5rem)]' : 'max-h-[92svh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-[900px]'}`}
            onKeyDown={handleKeyDown}
          >
            <DialogHeader className="border-b border-border bg-card px-4 pb-3 pt-4 sm:px-5">
              <div className={`flex min-w-0 items-start gap-3 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Bug className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 space-y-1 pe-8 rtl:pe-0 rtl:ps-8">
                  <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
                    {t('reportNewDefect')}
                  </DialogTitle>
                  <DialogDescription className="max-w-2xl text-xs text-muted-foreground">
                    {t('reportNewDefectDesc')}
                  </DialogDescription>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant={isDefectReadyToSubmit ? 'default' : 'secondary'} className="w-fit shrink-0 gap-1.5 rounded-md px-2 py-1 text-xs">
                  {isDefectReadyToSubmit ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {defectReadinessTitle}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateDialogExpanded((expanded) => !expanded)}
                  className="h-7 gap-1.5 px-2 text-xs"
                  aria-pressed={isCreateDialogExpanded}
                  aria-label={isCreateDialogExpanded ? t('collapse') : t('expand')}
                >
                  {isCreateDialogExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  {isCreateDialogExpanded ? t('collapse') : t('expand')}
                </Button>
                {!hasDefectSeverity && defectTouchedFields.defectSeverity && (
                  <span className="text-xs text-destructive">{t('fieldRequired', { field: t('defectSeverity') })}</span>
                )}
                {!hasDefectPriority && defectTouchedFields.defectPriority && (
                  <span className="text-xs text-destructive">{t('priorityRequired')}</span>
                )}
              </div>

            </DialogHeader>

            <div className={`${isCreateDialogExpanded ? '' : 'min-h-0 flex-1 overflow-y-auto'} bg-muted/30 px-4 py-4 sm:px-5`}>
              {isCreateDialogExpanded && (
                <nav className="-mx-4 mb-3 border-b border-border bg-background px-4 py-2 sm:-mx-5 sm:px-5" aria-label={t('defectModalCoreDetails')}>
                  <div className="flex gap-2 overflow-x-auto">
                    {[
                      { id: 'defect-create-details', label: t('defectModalCoreDetails') },
                      { id: 'defect-create-evidence', label: t('defectModalEvidence') },
                      { id: 'defect-create-triage', label: t('defectModalTriage') },
                      { id: 'defect-create-links', label: t('defectModalLinks') },
                      { id: 'defect-create-summary', label: t('defectModalSummary') },
                    ].map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => scrollCreateDialogSection(item.id)}
                        className="h-7 shrink-0 px-2 text-xs"
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </nav>
              )}
              <div className={`grid gap-3 ${isCreateDialogExpanded ? 'lg:grid-cols-[minmax(560px,1.4fr)_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(460px,1.25fr)_minmax(0,1fr)]'}`}>
                <section id="defect-create-evidence" className="scroll-mt-12 rounded-lg border border-border bg-card p-3 shadow-xs lg:sticky lg:top-3 lg:self-start sm:p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title={t('defectModalEvidence')} accent="text-muted-foreground" isRTL={isRTL} />
                    <p className="max-w-sm text-xs text-muted-foreground">{t('defectModalEvidenceDesc')}</p>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="defectTitle" className="text-xs font-semibold">{t('title')}</Label>
                      <Input
                        ref={defectTitleInputRef}
                        id="defectTitle"
                        value={defectTitle}
                        onChange={(e) => setDefectTitle(e.target.value)}
                        onBlur={() => setDefectTouchedFields({ ...defectTouchedFields, defectTitle: true })}
                        className={`h-10 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring ${
                          defectTouchedFields.defectTitle && !hasDefectTitle ? 'border-destructive focus-visible:ring-destructive' : ''
                        }`}
                        placeholder={t('defectTitlePlaceholder')}
                        maxLength={DEFECT_FIELD_LIMITS.title}
                        aria-invalid={defectTouchedFields.defectTitle && !hasDefectTitle}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className={defectTouchedFields.defectTitle && !hasDefectTitle ? 'text-destructive' : 'text-muted-foreground'}>
                          {defectTouchedFields.defectTitle && !hasDefectTitle ? t('defectTitleRequired') : t('defectModalTitleHint')}
                        </span>
                        <span className="font-medium text-muted-foreground">{defectTitle.length}/{DEFECT_FIELD_LIMITS.title}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="defectDescription" className="text-xs font-semibold">{t('description')}</Label>
                      <Textarea
                        id="defectDescription"
                        value={defectDescription}
                        onChange={(e) => setDefectDescription(e.target.value)}
                        placeholder={t('defectDescriptionPlaceholder')}
                        rows={3}
                        maxLength={DEFECT_FIELD_LIMITS.description}
                        className="min-h-20 resize-y rounded-md border-input bg-background text-sm focus-visible:ring-ring"
                      />
                      <div className="flex justify-end text-xs text-muted-foreground">{defectDescription.length}/{DEFECT_FIELD_LIMITS.description}</div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="defectSteps" className="text-xs font-semibold">{t('stepsToReproduce')}</Label>
                      <Textarea
                        id="defectSteps"
                        value={defectSteps}
                        onChange={(e) => setDefectSteps(e.target.value)}
                        placeholder={t('stepsToReproducePlaceholder')}
                        rows={4}
                        maxLength={DEFECT_FIELD_LIMITS.steps}
                        className="min-h-24 resize-y rounded-md border-input bg-background font-mono text-sm leading-6 focus-visible:ring-ring"
                      />
                      <div className="flex justify-end text-xs text-muted-foreground">{defectSteps.length}/{DEFECT_FIELD_LIMITS.steps}</div>
                    </div>
                  </div>
                </section>
                <div className="space-y-3">
                  <section id="defect-create-details" className="scroll-mt-12 rounded-lg border border-border bg-card p-3 shadow-xs sm:p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <SectionHeader icon={<FileText className="h-4 w-4" />} title={t('defectModalCoreDetails')} accent="text-muted-foreground" isRTL={isRTL} />
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3" aria-live="polite">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{ width: `${Math.round(defectReadinessRatio * 100)}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          {t('defectModalProgress', { completed: defectReadinessCompleted, total: defectReadinessChecks.length })}
                        </span>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                            <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            {t('environment')}
                          </div>
                          <Input
                            id="defectEnvironment"
                            value={defectEnvironment}
                            onChange={(e) => setDefectEnvironment(e.target.value)}
                            placeholder={t('environmentPlaceholder')}
                            maxLength={DEFECT_FIELD_LIMITS.environment}
                            className="h-9 rounded-md bg-background text-sm"
                          />
                        </div>
                        <div>
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            {t('tags')}
                          </div>
                          <Input
                            id="defectTags"
                            value={defectTags}
                            onChange={(e) => setDefectTags(e.target.value)}
                            placeholder={t('tagsPlaceholder')}
                            maxLength={DEFECT_FIELD_LIMITS.tags}
                            className="h-9 rounded-md bg-background text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                  <section id="defect-create-triage" className="scroll-mt-12 rounded-lg border border-border bg-card p-3 shadow-xs sm:p-4">
                    <div className="mb-3 space-y-1">
                      <SectionHeader icon={<SlidersHorizontal className="h-4 w-4" />} title={t('defectModalTriage')} accent="text-muted-foreground" isRTL={isRTL} />
                      <p className="text-xs text-muted-foreground">{t('defectModalTriageDesc')}</p>
                    </div>
                    <div className="space-y-3">
                      <PillPickerRow
                        label={t('defectSeverity')}
                        value={defectSeverity}
                        onChange={(next) => {
                          setDefectSeverity(next);
                          setDefectTouchedFields((prev) => ({ ...prev, defectSeverity: true }));
                        }}
                        options={severityPickerOptions}
                      />
                      <PillPickerRow
                        label={t('defectPriority')}
                        value={defectPriority}
                        onChange={(next) => {
                          setDefectPriority(next);
                          setDefectTouchedFields((prev) => ({ ...prev, defectPriority: true }));
                        }}
                        options={priorityPickerOptions}
                      />
                      <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">{t('status')}</span>
                          <Badge variant="outline">{t('open')}</Badge>
                        </div>
                        {t('defectModalStatusAutoHint')}
                      </div>
                    </div>
                  </section>

                  <section id="defect-create-links" className="scroll-mt-12 rounded-lg border border-border bg-card p-3 shadow-xs sm:p-4">
                    <div className="mb-3 space-y-1">
                      <SectionHeader icon={<Link2 className="h-4 w-4" />} title={t('defectModalLinks')} accent="text-muted-foreground" isRTL={isRTL} />
                      <p className="text-xs text-muted-foreground">{t('defectModalTraceabilityDesc')}</p>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="defectTestCase" className="text-xs font-semibold">{t('testCase')}</Label>
                        <SearchableTestCaseSelect
                          id="defectTestCase"
                          value={defectTestCaseId}
                          onChange={setDefectTestCaseId}
                          testCases={testCases}
                        />
                        {selectedDefectTestCase && (
                          <p className="truncate text-xs text-muted-foreground" title={selectedDefectTestCase.title}>
                            {selectedDefectTestCase.title}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="defectRequirement" className="text-xs font-semibold">{t('requirement')}</Label>
                        <SearchableRequirementSelect
                          id="defectRequirement"
                          value={defectRequirementId}
                          onChange={setDefectRequirementId}
                          requirements={requirements}
                        />
                        {selectedDefectRequirement && (
                          <p className="truncate text-xs text-muted-foreground" title={selectedDefectRequirement.title}>
                            {selectedDefectRequirement.requirement_id}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="defectJiraLink" className="text-xs font-semibold">{t('externalIssue')}</Label>
                        <Input
                          id="defectJiraLink"
                          value={defectJiraLink}
                          onChange={(e) => setDefectJiraLink(e.target.value)}
                          onBlur={() => setDefectTouchedFields({ ...defectTouchedFields, defectJiraLink: true })}
                          className={`h-9 rounded-md bg-background text-sm ${isExternalIssueUrlInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          placeholder={t('jiraLinkPlaceholder')}
                          maxLength={DEFECT_FIELD_LIMITS.externalIssueUrl}
                          aria-invalid={isExternalIssueUrlInvalid}
                        />
                        <div className={`text-xs ${isExternalIssueUrlInvalid ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {externalIssueStatusLabel}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section id="defect-create-summary" className="scroll-mt-12 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-xs sm:p-4">
                    <div className="mb-3 flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('defectModalLivePreview')}</h3>
                        <p className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
                          {defectTitle.trim() || t('defectModalUntitled')}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs">
                      <div className="rounded-md bg-muted/40 p-2.5">
                        <div className="text-muted-foreground">{t('defectModalLinks')}</div>
                        <div className="mt-1 font-semibold">{t('defectModalLinkedCount', { count: linkedContextCount })}</div>
                      </div>
                    </div>
                    <div className="mt-3 rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span>{defectReadinessTitle}</span>
                        <span>{t('defectModalProgress', { completed: defectReadinessCompleted, total: defectReadinessChecks.length })}</span>
                      </div>
                      <p>{defectReadinessDescription}</p>
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <DialogFooter className="border-t border-border bg-card px-4 py-3 sm:px-5">
              <div className={`flex flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground ${isRTL ? 'sm:flex-row-reverse' : ''}`}>
                {draftStatus === 'restored' && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground">
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    {t('defectModalDraftRestored')}
                  </span>
                )}
                {draftStatus === 'saved' && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    {t('defectModalDraftSaved')}
                  </span>
                )}
                <span className="hidden sm:inline-flex items-center gap-2">
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t('defectModalShortcutSubmit')}</kbd>
                  {t('defectModalShortcutSubmitHint')}
                </span>
              </div>
              {hasRestorableDraft && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleDiscardDraft}
                  disabled={isCreating}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2 mr-0' : 'mr-2'}`} />
                  {t('defectModalDiscardDraft')}
                </Button>
              )}
              <Button variant="outline" onClick={() => handleDialogClose(false)}>
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                onClick={handleCreateDefect}
                disabled={!isDefectReadyToSubmit || isCreating}
                className="min-w-36 transition-all duration-200"
              >
                {isCreating ? t('creating') : t('reportDefect')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Unsaved Changes Confirmation Dialog */}
        <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
          <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>{t('unsavedChangesTitle')}</DialogTitle>
              <DialogDescription>
                {t('unsavedChangesModalMessage')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleUnsavedConfirm(false)}>
                {t('keepEditingModal')}
              </Button>
              <Button onClick={() => handleUnsavedConfirm(true)}>
                {t('discardChangesModal')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat
          label={t('defectsStatTotal')}
          value={summary.total}
          icon={<Bug className="h-4 w-4" />}
          accent="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
        <SummaryStat
          label={t('open')}
          value={summary.open}
          icon={<AlertCircle className="h-4 w-4" />}
          accent="bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          active={statusFilter === 'open'}
          onClick={() => setStatusFilter(statusFilter === 'open' ? 'all' : 'open')}
        />
        <SummaryStat
          label={t('inProgress')}
          value={summary.inProgress}
          icon={<Activity className="h-4 w-4" />}
          accent="bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          active={statusFilter === 'in_progress'}
          onClick={() => setStatusFilter(statusFilter === 'in_progress' ? 'all' : 'in_progress')}
        />
        <SummaryStat
          label={t('defectsStatCritical')}
          value={summary.critical}
          icon={<ShieldAlert className="h-4 w-4" />}
          accent="bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
          active={severityFilter === 'critical'}
          onClick={() => setSeverityFilter(severityFilter === 'critical' ? 'all' : 'critical')}
        />
      </div>

      {/* Search and Filters — standard project pattern */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-4 space-y-3">
        {(selectedDefectIds.length > 0 || projectId) && (
          <div className="flex flex-wrap items-center gap-2">
            {projectId && (
              <SavedFilters
                projectId={parseInt(projectId)}
                scope="defects"
                hasActiveFilters={hasActiveFilters || sortMode !== 'newest'}
                currentDefinition={{
                  searchQuery,
                  statusFilter,
                  severityFilter,
                  priorityFilter,
                  sortMode,
                }}
                onApply={(def) => {
                  if (typeof def.searchQuery === 'string') setSearchQuery(def.searchQuery);
                  if (typeof def.statusFilter === 'string') setStatusFilter(def.statusFilter);
                  if (typeof def.severityFilter === 'string') setSeverityFilter(def.severityFilter);
                  if (typeof def.priorityFilter === 'string') setPriorityFilter(def.priorityFilter);
                  if (typeof def.sortMode === 'string') setSortMode(def.sortMode);
                }}
              />
            )}
            {selectedDefectIds.length > 0 && (
              <>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('selectedCount', { count: String(selectedDefectIds.length) })}
                </span>
                <Button variant="outline" size="sm" onClick={() => setBulkEditOpen(true)}>
                  <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('bulkEdit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={clearDefectSelection}>
                  <X className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('cancel')}
                </Button>
              </>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="min-w-[220px] flex-1">
            <TestCaseSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('defectsAdvancedSearchPlaceholder')}
              groups={searchSuggestionGroups}
              isRTL={isRTL}
              resultCount={filteredDefects.length}
              resultLabel={t('defects')}
            />
          </div>
          <div className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
            <ViewToggleButton active={viewMode === 'list'} onClick={() => changeViewMode('list')} icon={List} label={t('listView')} />
            <ViewToggleButton active={viewMode === 'table'} onClick={() => changeViewMode('table')} icon={Table2} label={t('tableView')} />
            <ViewToggleButton active={viewMode === 'board'} onClick={() => changeViewMode('board')} icon={Columns3} label={t('boardView')} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('defectsFilterAllStatus')}</SelectItem>
                <SelectItem value="open">{t('open')}</SelectItem>
                <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
                <SelectItem value="fixed">{t('fixed')}</SelectItem>
                <SelectItem value="reopened">{t('reopened')}</SelectItem>
                <SelectItem value="closed">{t('closed')}</SelectItem>
                <SelectItem value="rejected">{t('rejected')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('defectSeverity')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('defectsFilterAllSeverity')}</SelectItem>
                <SelectItem value="critical">{t('critical')}</SelectItem>
                <SelectItem value="high">{t('high')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="low">{t('low')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('defectPriority')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('defectsFilterAllPriority')}</SelectItem>
                <SelectItem value="urgent">{t('urgent')}</SelectItem>
                <SelectItem value="high">{t('high')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="low">{t('low')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortMode} onValueChange={setSortMode}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t('defectsSortNewest')}</SelectItem>
                <SelectItem value="oldest">{t('defectsSortOldest')}</SelectItem>
                <SelectItem value="updated_desc">{t('defectsSortRecentlyUpdated')}</SelectItem>
                <SelectItem value="severity_desc">{t('defectsSortSeverity')}</SelectItem>
                <SelectItem value="priority_desc">{t('defectsSortPriority')}</SelectItem>
                <SelectItem value="title_asc">{t('defectsSortTitle')}</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                <X className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                {t('defectsClearFilters')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Defects list */}
      <div className="space-y-3">
        {isLoading ? (
          viewMode === 'table' ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900" role="status" aria-busy="true" aria-label={t('loading')}>
              <div className="flex items-center gap-4 border-b border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/40">
                <div className="h-4 w-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 flex-1 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="hidden h-3 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700 sm:block" />
                <div className="hidden h-3 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700 sm:block" />
                <div className="h-3 w-8 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              </div>
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="flex items-center gap-4 border-b border-gray-100 px-4 py-4 last:border-b-0 dark:border-gray-800">
                  <div className="h-4 w-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                  <div className="h-4 w-12 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                  <div className="h-4 flex-1 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                  <div className="hidden h-5 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800 sm:block" />
                  <div className="hidden h-5 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800 sm:block" />
                  <div className="h-4 w-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3" role="status" aria-busy="true" aria-label={t('loading')}>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-5 w-16 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
                  </div>
                  <div className="h-5 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                  <div className="flex gap-2 pt-1">
                    <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                    <div className="h-5 w-24 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          )
        ) : paginatedDefects.length > 0 ? (
          viewMode === 'table' ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow className="border-b border-gray-200 bg-gray-50/80 hover:bg-gray-50/80 dark:border-gray-800 dark:bg-gray-800/40 dark:hover:bg-gray-800/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-gray-500 dark:[&_th]:text-gray-400">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={paginatedDefects.length > 0 && paginatedDefects.every((d) => selectedDefectIds.includes(d.id))}
                        onCheckedChange={(checked) => {
                          const pageIds = paginatedDefects.map((d) => d.id);
                          setSelectedDefectIds((prev) =>
                            checked ? Array.from(new Set([...prev, ...pageIds])) : prev.filter((id) => !pageIds.includes(id)),
                          );
                        }}
                        aria-label={t('selectDefect')}
                      />
                    </TableHead>
                    <TableHead>{t('defectId')}</TableHead>
                    <TableHead>{t('title')}</TableHead>
                    <TableHead>{t('status')}</TableHead>
                    <TableHead>{t('defectSeverity')}</TableHead>
                    <TableHead>{t('defectPriority')}</TableHead>
                    <TableHead>{t('environment')}</TableHead>
                    <TableHead>{t('created')}</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedDefects.map((defect) => {
                    const externalUrl = defect.external_issue_url || defect.jira_link;
                    return (
                      <TableRow key={defect.id} className="border-b border-gray-100 dark:border-gray-800">
                        <TableCell className="py-2">
                          <Checkbox
                            checked={selectedDefectIds.includes(defect.id)}
                            onCheckedChange={() => toggleDefectSelection(defect.id)}
                            aria-label={t('selectDefect')}
                          />
                        </TableCell>
                        <TableCell className="py-2">
                          <Link
                            to={`/projects/${projectId}/defects/${defect.project_seq ?? defect.id}`}
                            className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {defect.defect_id}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[320px] py-2">
                          <Link
                            to={`/projects/${projectId}/defects/${defect.project_seq ?? defect.id}`}
                            className="block truncate font-medium text-slate-900 hover:text-blue-700 hover:underline dark:text-slate-100 dark:hover:text-blue-300"
                            title={defect.title}
                          >
                            {defect.title}
                          </Link>
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge className={getStatusBadge(defect.status)}>{getStatusLabel(defect.status)}</Badge>
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge className={`${getSeverityBadge(defect.severity)} gap-1`}>
                            <ShieldAlert className="h-3 w-3" />{getTriageLabel(defect.severity)}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge className={`${getPriorityBadge(defect.priority)} gap-1`}>
                            <Flag className="h-3 w-3" />{getTriageLabel(defect.priority)}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate py-2 text-sm text-gray-600 dark:text-gray-400" title={defect.environment || undefined}>{defect.environment || '-'}</TableCell>
                        <TableCell className="py-2 text-sm text-gray-500 dark:text-gray-400">
                          {formatDefectDate(defect.created_at)}
                        </TableCell>
                        <TableCell className="py-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" aria-label={t('defectsMoreActions')} className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-52">
                              <DropdownMenuItem onClick={() => handleEditDefect(defect)}>
                                <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('edit')}
                              </DropdownMenuItem>
                              {defect.test_case_id && (
                                <DropdownMenuItem onClick={() => handleLinkToTestCase(defect)}>
                                  <Link2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                  {t('viewTestExecution')}
                                </DropdownMenuItem>
                              )}
                              {externalUrl && (
                                <DropdownMenuItem onClick={() => handleViewInExternal(externalUrl)}>
                                  <ExternalLink className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                  {t('defectsOpenInTracker')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteDefect(defect.id)}
                                className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950/30"
                              >
                                <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : viewMode === 'board' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {boardColumns.map((column) => (
                  <div key={column.key} className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${column.dot}`} aria-hidden="true" />
                        <span className="truncate">{column.isOther ? t('defectsBoardOtherColumn') : getStatusLabel(column.key)}</span>
                      </span>
                      <Badge variant="secondary" className="rounded-full">{column.defects.length}</Badge>
                    </div>
                    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                      {column.defects.length === 0 ? (
                        <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-500">{t('defectsBoardEmptyColumn')}</p>
                      ) : (
                        column.defects.map((defect) => (
                          <Link
                            key={defect.id}
                            to={`/projects/${projectId}/defects/${defect.project_seq ?? defect.id}`}
                            className="block rounded-xl border border-slate-200 bg-white p-3 shadow-xs transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{defect.defect_id}</span>
                              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                {formatDefectDate(defect.created_at)}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">{defect.title}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge className={`${getSeverityBadge(defect.severity)} gap-1 text-[11px]`}>
                                <ShieldAlert className="h-3 w-3" />{getTriageLabel(defect.severity)}
                              </Badge>
                              <Badge className={`${getPriorityBadge(defect.priority)} gap-1 text-[11px]`}>
                                <Flag className="h-3 w-3" />{getTriageLabel(defect.priority)}
                              </Badge>
                            </div>
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
              ))}
            </div>
          ) : (
          paginatedDefects.map((defect) => {
            const isExpanded = expandedDefectIds.has(defect.id);
            const syncStatus = defect.sync_status || defect.external_sync_status;
            const externalUrl = defect.external_issue_url || defect.jira_link;
            const accentClass = SEVERITY_STRIPE[defect.severity] || 'bg-slate-300';
            const linkedRequirement = defect.requirement_id
              ? requirements.find((requirement) => requirement.id === defect.requirement_id)
              : null;
            return (
              <Card key={defect.id} className="group relative overflow-hidden border-slate-200 transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:hover:border-slate-700">
                <div className={`absolute inset-y-0 ${isRTL ? 'right-0' : 'left-0'} w-1 ${accentClass}`} aria-hidden="true" />
                <CardHeader className={`pb-3 ${isRTL ? 'pr-5' : 'pl-5'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          checked={selectedDefectIds.includes(defect.id)}
                          onCheckedChange={() => toggleDefectSelection(defect.id)}
                          aria-label={t('selectDefect')}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Link
                          to={`/projects/${projectId}/defects/${defect.project_seq ?? defect.id}`}
                          className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {defect.defect_id}
                        </Link>
                        <Badge className={`${getStatusBadge(defect.status)} capitalize`}>{String(defect.status || '').replace('_', ' ')}</Badge>
                        <Badge className={`${getSeverityBadge(defect.severity)} gap-1 capitalize`} title={`${t('defectSeverity')}: ${defect.severity}`}>
                          <ShieldAlert className="h-3 w-3" />{defect.severity}
                        </Badge>
                        <Badge className={`${getPriorityBadge(defect.priority)} gap-1 capitalize`} title={`${t('defectPriority')}: ${defect.priority}`}>
                          <Flag className="h-3 w-3" />{defect.priority}
                        </Badge>
                        {syncStatus && syncStatus !== 'not_synced' && (
                          <Badge className={`${getSyncStatusBadge(syncStatus)} capitalize`}>
                            {getSyncStatusLabel(syncStatus)}
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-base font-semibold">
                        <Link
                          to={`/projects/${projectId}/defects/${defect.project_seq ?? defect.id}`}
                          className="text-slate-900 hover:text-blue-700 hover:underline dark:text-slate-50 dark:hover:text-blue-300"
                        >
                          {defect.title}
                        </Link>
                      </CardTitle>
                      {defect.description && (
                        <p className="line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                          {defect.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                        {defect.environment && (
                          <span className="inline-flex items-center gap-1">
                            <Settings className="h-3 w-3" aria-hidden="true" />
                            {defect.environment}
                          </span>
                        )}
                        {defect.tags && (
                          <span className="inline-flex items-center gap-1">
                            <FileText className="h-3 w-3" aria-hidden="true" />
                            {defect.tags}
                          </span>
                        )}
                        {defect.test_case_id && (
                          <button
                            type="button"
                            onClick={() => handleLinkToTestCase(defect)}
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                          >
                            <Link2 className="h-3 w-3" aria-hidden="true" />
                            {t('viewTestExecution')}
                          </button>
                        )}
                        {defect.requirement_id && (
                          <Link
                            to={`/projects/${projectId}/requirements/${defect.requirement_id}`}
                            className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-300"
                          >
                            <FileText className="h-3 w-3" aria-hidden="true" />
                            {linkedRequirement?.requirement_id || `${t('requirement')} #${defect.requirement_id}`}
                          </Link>
                        )}
                        {externalUrl && (
                          <button
                            type="button"
                            onClick={() => handleViewInExternal(externalUrl)}
                            className="inline-flex max-w-[280px] items-center gap-1 truncate text-blue-600 hover:underline dark:text-blue-400"
                            title={externalUrl}
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{externalUrl}</span>
                          </button>
                        )}
                        <span className="ml-auto text-gray-400 dark:text-gray-500">
                          {formatDefectDate(defect.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleDefectExpansion(defect.id)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? t('defectsHideDetails') : t('defectsShowDetails')}
                        className="h-8 gap-1 px-2 text-xs"
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        <span className="hidden sm:inline">
                          {isExpanded ? t('defectsHideDetails') : t('defectsShowDetails')}
                        </span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditDefect(defect)}
                        aria-label={t('edit')}
                        className="h-8 w-8 p-0"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('defectsMoreActions')}
                            className="h-8 w-8 p-0"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-52">
                          <DropdownMenuItem onClick={() => handleEditDefect(defect)}>
                            <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                            {t('edit')}
                          </DropdownMenuItem>
                          {defect.test_case_id && (
                            <DropdownMenuItem onClick={() => handleLinkToTestCase(defect)}>
                              <Link2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                              {t('viewTestExecution')}
                            </DropdownMenuItem>
                          )}
                          {externalUrl && (
                            <DropdownMenuItem onClick={() => handleViewInExternal(externalUrl)}>
                              <ExternalLink className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                              {t('defectsOpenInTracker')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => handleOpenSyncDialog(defect.id)}
                            disabled={integrations.length === 0}
                          >
                            <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                            {t('defectsSyncAction')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDeleteDefect(defect.id)}
                            className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950/30"
                          >
                            <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                            {t('delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className={`pt-0 ${isRTL ? 'pr-5' : 'pl-5'}`}>
                    <div className="space-y-3">
                      {defect.steps_to_reproduce && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t('stepsToReproduce')}
                          </h4>
                          <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{defect.steps_to_reproduce}</pre>
                        </div>
                      )}

                      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t('defectResultSnapshot')}
                          </h4>
                          {loadingDefectResultLinks.has(defect.id) && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t('loading')}
                            </span>
                          )}
                        </div>

                        {!loadingDefectResultLinks.has(defect.id) && (defectResultLinks[defect.id] || []).length === 0 && (
                          <p className="text-sm text-slate-500 dark:text-slate-400">{t('noResultSnapshotsLinked')}</p>
                        )}

                        <div className="space-y-3">
                          {(defectResultLinks[defect.id] || []).map((link) => {
                            const resultSnapshot = link.result_snapshot || {};
                            const testResult = resultSnapshot.test_result || {};
                            const testCase = resultSnapshot.test_case || {};
                            const testRun = resultSnapshot.test_run || {};
                            const failingStep = link.failing_step_snapshot;
                            const isCorrecting = correctingSnapshotIds.has(link.id);

                            return (
                              <div
                                key={link.id}
                                className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm dark:border-slate-800 dark:bg-slate-900/50"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="outline">{testResult.status || '-'}</Badge>
                                      <span className="text-xs text-slate-500">
                                        {t('resultSnapshotCaptured', {
                                          status: testResult.status || '-',
                                          date: formatSnapshotDate(link.snapshot_created_at || resultSnapshot.captured_at),
                                        })}
                                      </span>
                                    </div>
                                    <p className="font-medium text-slate-900 dark:text-slate-100">
                                      {testCase.title || t('testCase')} {testCase.case_id ? `(${testCase.case_id})` : ''}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {t('testRunLabel')}: {testRun.name || '-'}
                                      {testResult.executed_by_name ? ` - ${t('executorLabel')}: ${testResult.executed_by_name}` : ''}
                                    </p>
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleCorrectDefectSnapshot(defect.id, link)}
                                      disabled={isCorrecting}
                                      className="h-8 gap-1 text-xs"
                                    >
                                      {isCorrecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                      {t('correctSnapshot')}
                                    </Button>
                                    {failingStep && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleCorrectDefectSnapshot(defect.id, link, true)}
                                        disabled={isCorrecting}
                                        className="h-8 gap-1 text-xs"
                                      >
                                        <X className="h-3 w-3" />
                                        {t('clearFailingStepSnapshot')}
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {failingStep && (
                                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100">
                                    <p className="font-semibold">
                                      {t('failingStepSnapshot', { number: failingStep.step_number || '-' })}
                                    </p>
                                    {failingStep.action && <p className="mt-1">{failingStep.action}</p>}
                                    {failingStep.expected_result && (
                                      <p className="mt-1 text-red-800/80 dark:text-red-100/80">
                                        {t('expectedResult')}: {failingStep.expected_result}
                                      </p>
                                    )}
                                    {failingStep.actual_result && (
                                      <p className="mt-1 text-red-800/80 dark:text-red-100/80">
                                        {t('actualResultLabel')}: {failingStep.actual_result}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })
          )
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Bug className="h-6 w-6 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
              {hasActiveFilters ? t('noDefectsFound') : t('noDefectsReported')}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {hasActiveFilters ? t('noDefectsFoundDesc') : t('noDefectsReportedDesc')}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {hasActiveFilters ? (
                <Button variant="outline" onClick={resetFilters}>
                  <X className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('defectsClearFilters')}
                </Button>
              ) : canWrite ? (
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('reportDefect')}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Pagination — board view shows every column in full, so it opts out */}
      {viewMode !== 'board' && sortedDefects.length > 0 && totalPages > 1 && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {t('showingDefects', {
              start: startIndex + 1,
              end: Math.min(startIndex + itemsPerPage, sortedDefects.length),
              total: sortedDefects.length,
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
              disabled={safeCurrentPage === 1}
            >
              {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              <span className={isRTL ? 'mr-1' : 'ml-1'}>{t('previous')}</span>
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t('defectsPageOf', { current: safeCurrentPage, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
              disabled={safeCurrentPage === totalPages}
            >
              <span className={isRTL ? 'ml-1' : 'mr-1'}>{t('next')}</span>
              {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* Integration Form Dialog */}
      <Dialog open={isIntegrationFormOpen} onOpenChange={setIsIntegrationFormOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingIntegration ? t('editIntegration') : t('addIntegrationTitle')}
            </DialogTitle>
            <DialogDescription>
              {editingIntegration 
                ? t('updateIntegrationConfiguration')
                : t('configureNewIntegration')
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="integration-name">{t('integrationNameLabel')} *</Label>
                <Input
                  id="integration-name"
                  ref={nameInputRef}
                  placeholder={getPlaceholders().name}
                  value={integrationForm.name}
                  onChange={(e) => setIntegrationForm({...integrationForm, name: e.target.value})}
                  onBlur={() => setTouchedFields({...touchedFields, name: true})}
                  className={touchedFields.name && validationErrors.name ? 'border-red-500' : ''}
                />
                {touchedFields.name && validationErrors.name && (
                  <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.name}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="tracker-type">{t('trackerType')} *</Label>
                <Select
                  value={integrationForm.tracker_type}
                  onValueChange={(value) => {
                    setIntegrationForm({...integrationForm, tracker_type: value});
                    // Clear project key error when changing tracker type
                    if (value !== integrationForm.tracker_type) {
                      setValidationErrors({...validationErrors, project_key: ''});
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jira">Jira</SelectItem>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="gitlab">GitLab</SelectItem>
                    <SelectItem value="azure-devops">Azure DevOps</SelectItem>
                    <SelectItem value="linear">Linear</SelectItem>
                    <SelectItem value="asana">Asana</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-url">{t('apiUrlLabel')} *</Label>
              <Input
                id="api-url"
                ref={apiUrlInputRef}
                placeholder={getPlaceholders().apiUrl}
                value={integrationForm.api_url}
                onChange={(e) => setIntegrationForm({...integrationForm, api_url: e.target.value})}
                onBlur={() => setTouchedFields({...touchedFields, api_url: true})}
                className={touchedFields.api_url && validationErrors.api_url ? 'border-red-500' : ''}
              />
              {touchedFields.api_url && validationErrors.api_url && (
                <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.api_url}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('usernameEmail')}</Label>
                <Input
                  id="username"
                  placeholder={t('usernameEmailPlaceholder')}
                  value={integrationForm.username}
                  onChange={(e) => setIntegrationForm({...integrationForm, username: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-token">{t('apiTokenLabel')} {(!editingIntegration) ? '*' : ''}</Label>
                <Input
                  id="api-token"
                  ref={tokenInputRef}
                  type="password"
                  placeholder={editingIntegration ? t('leaveBlankToKeepExistingToken') : t('enterApiToken')}
                  value={integrationForm.api_token}
                  onChange={(e) => setIntegrationForm({...integrationForm, api_token: e.target.value})}
                  onBlur={() => setTouchedFields({...touchedFields, api_token: true})}
                  className={touchedFields.api_token && validationErrors.api_token ? 'border-red-500' : ''}
                />
                {touchedFields.api_token && validationErrors.api_token && (
                  <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.api_token}</p>
                )}
                <p className="text-xs text-gray-500">
                  {t('tokenEncryptedSecurely')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-key">{getPlaceholders().projectKeyLabel} *</Label>
              <Input
                id="project-key"
                ref={projectKeyInputRef}
                placeholder={getPlaceholders().projectKey}
                value={integrationForm.project_key}
                onChange={(e) => setIntegrationForm({...integrationForm, project_key: e.target.value})}
                onBlur={() => setTouchedFields({...touchedFields, project_key: true})}
                className={touchedFields.project_key && validationErrors.project_key ? 'border-red-500' : ''}
              />
              {touchedFields.project_key && validationErrors.project_key && (
                <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.project_key}</p>
              )}
              <p className="text-xs text-gray-500">
                {getPlaceholders().projectKeyDesc}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sync-direction">{t('syncDirection')}</Label>
              <Select
                value={integrationForm.sync_direction}
                onValueChange={(value) => setIntegrationForm({...integrationForm, sync_direction: value})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="import">{t('importOnly', { appName })}</SelectItem>
                  <SelectItem value="export">{t('exportOnly', { appName })}</SelectItem>
                  <SelectItem value="bidirectional">{t('bidirectional')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is-active"
                checked={integrationForm.is_active}
                onChange={(e) => setIntegrationForm({...integrationForm, is_active: e.target.checked})}
                className="h-4 w-4"
              />
              <Label htmlFor="is-active">{t('enableThisIntegration')}</Label>
            </div>

            {editingIntegration && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <AlertCircle className="h-4 w-4 inline mr-2" />
                  {t('leaveApiTokenBlank')}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsIntegrationFormOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSaveIntegration}>
              {editingIntegration ? t('updateIntegration') : t('createIntegration')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Dialog */}
      <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('syncDefectWithExternal')}</DialogTitle>
            <DialogDescription>
              {t('syncDefectWithExternalDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sync-integration">{t('selectIntegration')} *</Label>
              <Select
                value={selectedSyncIntegrationId?.toString()}
                onValueChange={(value) => setSelectedSyncIntegrationId(parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('selectAnIntegration')} />
                </SelectTrigger>
                <SelectContent>
                  {integrations.map((integration) => (
                    <SelectItem key={integration.id} value={integration.id.toString()}>
                      <div className="flex items-center gap-2">
                        <span className="capitalize">{integration.tracker_type}</span>
                        <span className="text-gray-500">- {integration.name}</span>
                        {!integration.is_active && <Badge variant="outline" className="text-xs ml-2">{t('inactive')}</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {integrations.length === 0 && (
              <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                <p>{t('noIntegrationsAvailable')}</p>
              </div>
            )}

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <AlertCircle className="h-4 w-4 inline mr-2" />
                {t('defectWillBeSynced')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSyncDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSyncWithExternal} disabled={!selectedSyncIntegrationId || isSyncing}>
              {isSyncing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('syncingDefect')}
                </div>
              ) : (
                t('syncDefect')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Defect Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('editDefectTitle', { id: editingDefect?.defect_id || '' })}</DialogTitle>
            <DialogDescription>
              {t('editDefectDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectId" className="text-right">
                {t('defectId')}
              </Label>
              <Input
                id="editDefectId"
                value={defectId}
                onChange={(e) => setDefectId(e.target.value)}
                className="col-span-3"
                placeholder={t('defectIdPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectTitle" className="text-right">
                {t('title')}
              </Label>
              <Input
                id="editDefectTitle"
                value={defectTitle}
                onChange={(e) => setDefectTitle(e.target.value)}
                className="col-span-3"
                placeholder={t('defectTitlePlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="editDefectDescription" className="text-right pt-2">
                {t('description')}
              </Label>
              <Textarea
                id="editDefectDescription"
                value={defectDescription}
                onChange={(e) => setDefectDescription(e.target.value)}
                className="col-span-3"
                placeholder={t('defectDescriptionPlaceholder')}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectStatus" className="text-right">
                {t('status')}
              </Label>
              <Select value={defectStatus} onValueChange={setDefectStatus}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('defectSelectStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{t('open')}</SelectItem>
                  <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
                  <SelectItem value="fixed">{t('fixed')}</SelectItem>
                  <SelectItem value="reopened">{t('reopened')}</SelectItem>
                  <SelectItem value="closed">{t('closed')}</SelectItem>
                  <SelectItem value="rejected">{t('rejected')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectSeverity" className="text-right">
                {t('defectSeverity')}
              </Label>
              <Select value={defectSeverity} onValueChange={setDefectSeverity}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('selectSeverity')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('low')}</SelectItem>
                  <SelectItem value="medium">{t('medium')}</SelectItem>
                  <SelectItem value="high">{t('high')}</SelectItem>
                  <SelectItem value="critical">{t('critical')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectPriority" className="text-right">
                {t('defectPriority')}
              </Label>
              <Select value={defectPriority} onValueChange={setDefectPriority}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('selectPriority')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('low')}</SelectItem>
                  <SelectItem value="medium">{t('medium')}</SelectItem>
                  <SelectItem value="high">{t('high')}</SelectItem>
                  <SelectItem value="urgent">{t('urgent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="editDefectSteps" className="text-right pt-2">
                {t('stepsToReproduce')}
              </Label>
              <Textarea
                id="editDefectSteps"
                value={defectSteps}
                onChange={(e) => setDefectSteps(e.target.value)}
                className="col-span-3"
                placeholder={t('stepsToReproducePlaceholder')}
                rows={4}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectEnvironment" className="text-right">
                {t('environmentLabel')}
              </Label>
              <Input
                id="editDefectEnvironment"
                value={defectEnvironment}
                onChange={(e) => setDefectEnvironment(e.target.value)}
                className="col-span-3"
                placeholder={t('environmentPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectJiraLink" className="text-right">
                {t('jiraLink')}
              </Label>
              <Input
                id="editDefectJiraLink"
                value={defectJiraLink}
                onChange={(e) => setDefectJiraLink(e.target.value)}
                className="col-span-3"
                placeholder={t('jiraLinkPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectTags" className="text-right">
                {t('tags')}
              </Label>
              <Input
                id="editDefectTags"
                value={defectTags}
                onChange={(e) => setDefectTags(e.target.value)}
                className="col-span-3"
                placeholder={t('tagsPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectTestCase" className="text-right">
                {t('testCase')}
              </Label>
              <SearchableTestCaseSelect
                id="editDefectTestCase"
                value={defectTestCaseId}
                onChange={setDefectTestCaseId}
                testCases={testCases}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectRequirement" className="text-right">
                {t('requirement')}
              </Label>
              <SearchableRequirementSelect
                id="editDefectRequirement"
                value={defectRequirementId}
                onChange={setDefectRequirementId}
                requirements={requirements}
                className="col-span-3"
              />
            </div>
          </div>
          {editingDefect?.id && projectId && (
            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <DefectComments
                defectId={editingDefect.id}
                projectId={parseInt(projectId)}
                defectLabel={editingDefect.defect_id || undefined}
                canComment={canWrite}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              onClick={handleUpdateDefect}
              disabled={!defectId.trim() || !defectTitle.trim()}
            >
              {t('updateDefect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!integrationToDelete} onOpenChange={(open) => !open && setIntegrationToDelete(null)}>
        <AlertDialogContent isRTL={isRTL}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDeleteIntegration')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmDeleteIntegrationDesc', { name: integrationToDelete?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteIntegration} className="bg-red-600 hover:bg-red-700">
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkEditDefectsDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        ids={selectedDefectIds}
        statusOptions={[
          { value: 'open', label: t('open') },
          { value: 'in_progress', label: t('inProgress') },
          { value: 'fixed', label: t('fixed') },
          { value: 'reopened', label: t('reopened') },
          { value: 'closed', label: t('closed') },
          { value: 'rejected', label: t('rejected') },
        ]}
        severityOptions={[
          { value: 'critical', label: t('critical') },
          { value: 'high', label: t('high') },
          { value: 'medium', label: t('medium') },
          { value: 'low', label: t('low') },
        ]}
        priorityOptions={[
          { value: 'urgent', label: t('urgent') },
          { value: 'high', label: t('high') },
          { value: 'medium', label: t('medium') },
          { value: 'low', label: t('low') },
        ]}
        userOptions={projectMembers.map((m) => ({ value: String(m.id), label: m.name }))}
        onApplied={() => {
          loadDefects();
          clearDefectSelection();
        }}
      />
    </div>
  );
}
