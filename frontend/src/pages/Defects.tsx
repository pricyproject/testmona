import { useCallback, useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { defectsAPI, getApiErrorMessage, projectAssignmentsAPI, requirementsAPI, testCasesAPI, testResultsAPI } from '@/lib/api';
import { Checkbox } from '@/components/ui/checkbox';
import { SavedFilters } from '@/components/SavedFilters';
import { BulkEditDefectsDialog } from '@/components/BulkEditDefectsDialog';
import { defectManagementAPI, IssueTrackerIntegration } from '@/lib/defectManagementAPI';
import { SearchableRequirementSelect } from '@/components/Defects/SearchableRequirementSelect';
import { SearchableTestCaseSelect } from '@/components/Defects/SearchableTestCaseSelect';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Bug, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Edit, Trash2, AlertTriangle, ExternalLink, Settings, RefreshCw, Loader2, CheckCircle2, AlertCircle, FileText, Link2, SlidersHorizontal, MoreHorizontal, Filter, ArrowUpDown, X, Activity, ShieldAlert, Flag } from 'lucide-react';

const SEVERITY_STRIPE: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-400',
  medium: 'bg-blue-400',
  low: 'bg-slate-300',
};

const formatSnapshotDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
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
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">{title}</h3>
      <span className="ml-auto h-px flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
    </div>
  );
}

type PillOption = {
  value: string;
  label: string;
  tone: string;
  activeTone: string;
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
      <Label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</Label>
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
              className={`inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium ring-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 ${
                isActive ? option.activeTone : `${option.tone} hover:ring-2`
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
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
  const { appName } = useAppName(false);
  const linkedMilestoneId = parsePositiveQueryNumber(searchParams.get('milestone_id'));
  
  const [defects, setDefects] = useState<any[]>([]);
  const [testCases, setTestCases] = useState<any[]>([]);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  // Filter/sort + per-row expansion state for the redesigned list view.
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<string>('newest');
  const [expandedDefectIds, setExpandedDefectIds] = useState<Set<number>>(new Set());
  const [defectResultLinks, setDefectResultLinks] = useState<Record<number, any[]>>({});
  const [loadingDefectResultLinks, setLoadingDefectResultLinks] = useState<Set<number>>(new Set());
  const [correctingSnapshotIds, setCorrectingSnapshotIds] = useState<Set<number>>(new Set());
  const [selectedDefectIds, setSelectedDefectIds] = useState<number[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [projectMembers, setProjectMembers] = useState<Array<{ id: number; name: string }>>([]);

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
        name: 'My Jira Integration',
        apiUrl: 'https://your-domain.atlassian.net',
        projectKey: 'TEST',
        projectKeyLabel: 'Project Key',
        projectKeyDesc: 'The project key from your Jira instance (e.g., TEST, PROJ)'
      },
      github: {
        name: 'My GitHub Integration',
        apiUrl: 'https://api.github.com',
        projectKey: 'owner/repo',
        projectKeyLabel: 'Repository',
        projectKeyDesc: 'GitHub repository in format: owner/repo'
      },
      gitlab: {
        name: 'My GitLab Integration',
        apiUrl: 'https://gitlab.com/api/v4',
        projectKey: 'namespace/project',
        projectKeyLabel: 'Project Path',
        projectKeyDesc: 'GitLab project path (e.g., namespace/project)'
      },
      'azure-devops': {
        name: 'My Azure DevOps Integration',
        apiUrl: 'https://dev.azure.com/your-org',
        projectKey: 'Project Name',
        projectKeyLabel: 'Project Name',
        projectKeyDesc: 'Azure DevOps project name'
      },
      linear: {
        name: 'My Linear Integration',
        apiUrl: 'https://api.linear.app',
        projectKey: 'Team Key',
        projectKeyLabel: 'Team Key',
        projectKeyDesc: 'Linear team key (e.g., ENG, PROD)'
      },
      asana: {
        name: 'My Asana Integration',
        apiUrl: 'https://app.asana.com/api/1.0',
        projectKey: 'Project GID',
        projectKeyLabel: 'Project GID',
        projectKeyDesc: 'Asana project GID (numeric ID)'
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
  const [defectSeverity, setDefectSeverity] = useState('medium');
  const [defectPriority, setDefectPriority] = useState('medium');
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
    || (defectRequirementId && defectRequirementId !== 'none');
  const externalIssueValue = defectJiraLink.trim();
  const isExternalIssueUrlInvalid = externalIssueValue !== '' && !/^https?:\/\/\S+$/i.test(externalIssueValue);
  const selectedDefectTestCase = testCases.find((testCase) => String(testCase.id) === defectTestCaseId) || null;
  const selectedDefectRequirement = requirements.find((requirement) => String(requirement.id) === defectRequirementId) || null;
  const isDuplicateDefectId = defectId.trim() !== '' && defects.some((defect) =>
    String(defect.defect_id || '').toLowerCase() === defectId.trim().toLowerCase()
  );

  const getNextDefectId = () => {
    const numericProjectId = Number(projectId);
    const prefix = `P${Number.isFinite(numericProjectId) ? numericProjectId : 'X'}-DEF-`;
    const highest = defects.reduce((max, defect) => {
      const rawId = String(defect?.defect_id || '');
      if (!rawId.startsWith(prefix)) return max;
      const suffix = Number(rawId.slice(prefix.length));
      return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
    }, 0);
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  };

  const resetDefectForm = () => {
    setDefectId('');
    setDefectTitle('');
    setDefectDescription('');
    setDefectStatus('open');
    setDefectSeverity('medium');
    setDefectPriority('medium');
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

  const loadDefects = async () => {
    if (!projectId) return;

    try {
      setIsLoading(true);
      const defectsData = await defectsAPI.getAll(parseInt(projectId), 0, 500, {
        milestoneId: linkedMilestoneId,
      });
      setDefects(defectsData);
    } catch (error) {
      console.error('Failed to load defects:', error);
      toast({
        title: t('error'),
        description: t('failedToLoadDefects'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Load defects and test cases
  useEffect(() => {
    const loadData = async () => {
      if (!projectId) return;

      try {
        setIsLoading(true);
        
        // Load defects
        const defectsData = await defectsAPI.getAll(parseInt(projectId), 0, 500, {
          milestoneId: linkedMilestoneId,
        });
        setDefects(defectsData);
        
        // Load test cases for dropdown
        const testCasesData = await testCasesAPI.getAll(parseInt(projectId));
        setTestCases(testCasesData);

        // Load requirements for defect traceability links. Keep the defect
        // list usable even if this secondary relationship data fails.
        try {
          const requirementsData = await requirementsAPI.getAll(parseInt(projectId), 0, 500);
          setRequirements(Array.isArray(requirementsData) ? requirementsData : []);
        } catch (requirementsError) {
          console.warn('Failed to load requirements for defect linking:', requirementsError);
          setRequirements([]);
          toast({
            title: t('error'),
            description: getApiErrorMessage(requirementsError, t('failedToLoadRequirements')),
            variant: 'destructive',
          });
        }

        // Load project members so the bulk-edit assignee dropdown can show
        // real users instead of relying on whatever ids happen to appear on
        // existing defects.
        try {
          const members = await projectAssignmentsAPI.listMembers(parseInt(projectId));
          setProjectMembers(
            (members as Array<any>).map((m) => ({
              id: m.user_id,
              name: m.full_name || m.username || m.email || `User ${m.user_id}`,
            })),
          );
        } catch (memberError) {
          console.warn('Failed to load project members for bulk edit:', memberError);
        }
        
        // Load integrations
        fetchIntegrations();
        
      } catch (error) {
        console.error('Failed to load data:', error);
        toast({
          title: t('error'),
          description: t('failedToLoadData'),
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [projectId, linkedMilestoneId, fetchIntegrations, t, toast]);

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
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      clearDraftStorage();
      resetDefectForm();
      setIsCreateDialogOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateDefect();
    }
  };

  const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

  const filteredDefects = (() => {
    const query = searchQuery.trim().toLowerCase();
    return defects.filter((defect) => {
      if (query) {
        const haystack = [
          defect.title,
          defect.description,
          defect.defect_id,
          defect.tags,
          defect.environment,
          defect.requirement_id,
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ');
        if (!haystack.includes(query)) return false;
      }
      if (statusFilter !== 'all' && String(defect.status) !== statusFilter) return false;
      if (severityFilter !== 'all' && String(defect.severity) !== severityFilter) return false;
      if (priorityFilter !== 'all' && String(defect.priority) !== priorityFilter) return false;
      return true;
    });
  })();

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
    const trimmedDefectId = defectId.trim() || getNextDefectId();
    const trimmedTitle = defectTitle.trim();
    const selectedTestCaseId = defectTestCaseId && defectTestCaseId !== 'none' ? Number(defectTestCaseId) : null;
    const selectedRequirementId = defectRequirementId && defectRequirementId !== 'none' ? Number(defectRequirementId) : null;

    if (!trimmedDefectId || !trimmedTitle || !projectId) {
      toast({
        title: t('error'),
        description: t('defectIdAndTitleRequired'),
        variant: "destructive",
      });
      return;
    }

    if (defects.some((defect) => String(defect.defect_id || '').toLowerCase() === trimmedDefectId.toLowerCase())) {
      toast({
        title: t('validationError'),
        description: t('defectIdAlreadyExists'),
        variant: "destructive",
      });
      return;
    }

    if (isExternalIssueUrlInvalid) {
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
        defect_id: trimmedDefectId,
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
        description: 'Please add an integration first before syncing defects',
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
                                <Badge variant="outline" className="text-xs">Inactive</Badge>
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
                                {integration.sync_status}
                              </Badge>
                            </div>
                            {integration.last_sync && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Last sync: {new Date(integration.last_sync).toLocaleString()}
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
            <DialogTrigger asChild>
              <Button onClick={() => {
                // Only auto-fill the defect id when there's no restored draft;
                // the draft-restore effect populates it from localStorage.
                if (!defectId.trim()) setDefectId(getNextDefectId());
              }}>
                <Plus className="h-4 w-4 mr-2" />
                {t('reportDefect')}
              </Button>
            </DialogTrigger>
          <DialogContent isRTL={isRTL} className="max-h-[92vh] overflow-y-auto sm:max-w-[780px] p-0" onKeyDown={handleKeyDown}>
            <DialogHeader className="space-y-4 border-b bg-gradient-to-br from-red-50/60 via-white to-white px-6 pb-5 pt-6 dark:border-gray-800 dark:from-red-950/20 dark:via-gray-950 dark:to-gray-950">
              <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">
                  <Bug className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <DialogTitle className="text-xl font-semibold leading-tight">
                    {t('reportNewDefect')}
                  </DialogTitle>
                  <DialogDescription className="text-sm">
                    {t('reportNewDefectDesc')}
                  </DialogDescription>
                </div>
                <Badge variant="outline" className="mt-1 shrink-0 font-mono text-xs">
                  {defectId || getNextDefectId()}
                </Badge>
              </div>

              {/* Hero title input — promoted to the prominent surface */}
              <div className="space-y-1.5">
                <Input
                  ref={defectTitleInputRef}
                  id="defectTitle"
                  value={defectTitle}
                  onChange={(e) => setDefectTitle(e.target.value)}
                  onBlur={() => setDefectTouchedFields({ ...defectTouchedFields, defectTitle: true })}
                  className={`h-12 border-0 bg-white/80 px-4 text-lg font-medium shadow-xs ring-1 ring-slate-200 transition focus-visible:ring-2 focus-visible:ring-red-500 dark:bg-slate-900/60 dark:ring-slate-700 ${
                    defectTouchedFields.defectTitle && defectTitle.trim() === '' ? 'ring-red-400 focus-visible:ring-red-500' : ''
                  }`}
                  placeholder={t('defectTitlePlaceholder')}
                  maxLength={200}
                  aria-invalid={defectTouchedFields.defectTitle && defectTitle.trim() === ''}
                />
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={defectTouchedFields.defectTitle && defectTitle.trim() === '' ? 'text-red-600' : 'text-gray-500'}>
                    {defectTouchedFields.defectTitle && !defectTitle.trim() ? t('defectTitleRequired') : t('defectModalTitleHint')}
                  </span>
                  <span className="text-gray-500">{defectTitle.length}/200</span>
                </div>
              </div>

              {/* Inline progress: completed-required count */}
              {(() => {
                const requiredChecks = [
                  defectId.trim() !== '' && !isDuplicateDefectId,
                  defectTitle.trim() !== '',
                  defectDescription.trim() !== '' || defectSteps.trim() !== '',
                  !isExternalIssueUrlInvalid,
                ];
                const completed = requiredChecks.filter(Boolean).length;
                const total = requiredChecks.length;
                const ratio = completed / total;
                return (
                  <div className="flex items-center gap-3" aria-live="polite">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-red-500 via-orange-400 to-emerald-500 transition-[width] duration-300"
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-xs font-medium text-gray-600 dark:text-gray-300">
                      {t('defectModalProgress', { completed, total })}
                    </span>
                  </div>
                );
              })()}
            </DialogHeader>

            <div className="space-y-6 px-6 py-6">
              {/* Defect ID — secondary, but easy to override */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                <Label htmlFor="defectId" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('defectId')}
                </Label>
                <Input
                  id="defectId"
                  value={defectId}
                  disabled
                  className="h-8 max-w-[200px] flex-1 border-0 bg-transparent px-1 font-mono text-sm shadow-none"
                  placeholder={t('defectIdPlaceholder')}
                  maxLength={50}
                />
                <span className={`ml-auto text-xs ${isDuplicateDefectId || (defectTouchedFields.defectId && !defectId.trim()) ? 'text-red-600' : 'text-gray-500'}`}>
                  {defectTouchedFields.defectId && !defectId.trim()
                    ? t('required')
                    : isDuplicateDefectId ? t('defectIdAlreadyExists') : t('generatedIdHint')}
                </span>
              </div>

              {/* Triage — visual pill selectors */}
              <section className="space-y-4">
                <SectionHeader icon={<SlidersHorizontal className="h-4 w-4" />} title={t('defectModalTriage')} accent="text-amber-600" isRTL={isRTL} />
                <div className="space-y-3">
                  <PillPickerRow
                    label={t('defectSeverity')}
                    value={defectSeverity}
                    onChange={setDefectSeverity}
                    options={[
                      { value: 'low', label: t('low'), tone: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700', activeTone: 'bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-100' },
                      { value: 'medium', label: t('medium'), tone: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900', activeTone: 'bg-blue-600 text-white ring-blue-600' },
                      { value: 'high', label: t('high'), tone: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900', activeTone: 'bg-orange-500 text-white ring-orange-500' },
                      { value: 'critical', label: t('critical'), tone: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900', activeTone: 'bg-red-600 text-white ring-red-600' },
                    ]}
                  />
                  <PillPickerRow
                    label={t('defectPriority')}
                    value={defectPriority}
                    onChange={setDefectPriority}
                    options={[
                      { value: 'low', label: t('low'), tone: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700', activeTone: 'bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-100' },
                      { value: 'medium', label: t('medium'), tone: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900', activeTone: 'bg-blue-600 text-white ring-blue-600' },
                      { value: 'high', label: t('high'), tone: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900', activeTone: 'bg-orange-500 text-white ring-orange-500' },
                      { value: 'urgent', label: t('urgent'), tone: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900', activeTone: 'bg-red-600 text-white ring-red-600' },
                    ]}
                  />
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="font-medium">{t('status')}:</span>
                    <Badge className={getStatusBadge('open')}>{t('open')}</Badge>
                    <span className="text-gray-400">{t('defectModalStatusAutoHint')}</span>
                  </div>
                </div>
              </section>

              {/* Evidence */}
              <section className="space-y-4">
                <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title={t('defectModalEvidence')} accent="text-red-600" isRTL={isRTL} />
                <div className="space-y-2">
                  <Label htmlFor="defectDescription" className="text-sm">{t('description')}</Label>
                  <Textarea
                    id="defectDescription"
                    value={defectDescription}
                    onChange={(e) => setDefectDescription(e.target.value)}
                    placeholder={t('defectDescriptionPlaceholder')}
                    rows={4}
                    maxLength={1000}
                    className="resize-none"
                  />
                  <div className="flex justify-end text-xs text-gray-500">{defectDescription.length}/1000</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="defectSteps" className="text-sm">{t('stepsToReproduce')}</Label>
                    <Textarea
                      id="defectSteps"
                      value={defectSteps}
                      onChange={(e) => setDefectSteps(e.target.value)}
                      placeholder={t('stepsToReproducePlaceholder')}
                      rows={5}
                      maxLength={2000}
                      className="resize-none"
                    />
                    <div className="flex justify-end text-xs text-gray-500">{defectSteps.length}/2000</div>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="defectEnvironment" className="text-sm">{t('environment')}</Label>
                      <Input
                        id="defectEnvironment"
                        value={defectEnvironment}
                        onChange={(e) => setDefectEnvironment(e.target.value)}
                        placeholder={t('environmentPlaceholder')}
                        maxLength={255}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="defectTags" className="text-sm">{t('tags')}</Label>
                      <Input
                        id="defectTags"
                        value={defectTags}
                        onChange={(e) => setDefectTags(e.target.value)}
                        placeholder={t('tagsPlaceholder')}
                        maxLength={500}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Links */}
              <section className="space-y-4">
                <SectionHeader icon={<Link2 className="h-4 w-4" />} title={t('defectModalLinks')} accent="text-emerald-600" isRTL={isRTL} />
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="defectTestCase" className="text-sm">{t('testCase')}</Label>
                    <SearchableTestCaseSelect
                      id="defectTestCase"
                      value={defectTestCaseId}
                      onChange={setDefectTestCaseId}
                      testCases={testCases}
                    />
                    {selectedDefectTestCase && (
                      <p className="truncate text-xs text-gray-500" title={selectedDefectTestCase.title}>
                        {selectedDefectTestCase.title}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="defectRequirement" className="text-sm">{t('requirement')}</Label>
                    <SearchableRequirementSelect
                      id="defectRequirement"
                      value={defectRequirementId}
                      onChange={setDefectRequirementId}
                      requirements={requirements}
                    />
                    {selectedDefectRequirement && (
                      <p className="truncate text-xs text-gray-500" title={selectedDefectRequirement.title}>
                        {selectedDefectRequirement.requirement_id}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="defectJiraLink" className="text-sm">{t('externalIssue')}</Label>
                    <Input
                      id="defectJiraLink"
                      value={defectJiraLink}
                      onChange={(e) => setDefectJiraLink(e.target.value)}
                      onBlur={() => setDefectTouchedFields({ ...defectTouchedFields, defectJiraLink: true })}
                      className={isExternalIssueUrlInvalid ? 'border-red-300 focus:border-red-500' : ''}
                      placeholder={t('jiraLinkPlaceholder')}
                      maxLength={500}
                    />
                    {isExternalIssueUrlInvalid && (
                      <div className="text-xs text-red-600">{t('externalIssueUrlInvalid')}</div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <DialogFooter className="border-t px-6 py-4 dark:border-gray-800">
              <div className={`flex flex-1 flex-wrap items-center gap-2 text-xs text-gray-500 ${isRTL ? 'sm:flex-row-reverse' : ''}`}>
                {draftStatus === 'restored' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    {t('defectModalDraftRestored')}
                  </span>
                )}
                {draftStatus === 'saved' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    {t('defectModalDraftSaved')}
                  </span>
                )}
                <span className="hidden sm:inline-flex items-center gap-2">
                  <kbd className="rounded border bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{t('defectModalShortcutSubmit')}</kbd>
                  {t('defectModalShortcutSubmitHint')}
                </span>
              </div>
              {hasRestorableDraft && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleDiscardDraft}
                  disabled={isCreating}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
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
                disabled={!defectId.trim() || !defectTitle.trim() || isDuplicateDefectId || isExternalIssueUrlInvalid || isCreating}
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
        <div className="flex gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder={t('searchDefects')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
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
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
          ))
        ) : paginatedDefects.length > 0 ? (
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
                          {new Date(defect.created_at).toLocaleDateString()}
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
              ) : (
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('reportDefect')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {sortedDefects.length > 0 && totalPages > 1 && (
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
