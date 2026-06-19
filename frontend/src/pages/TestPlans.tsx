import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  ClipboardList,
  Clock,
  Edit,
  Eye,
  FileText,
  Flag,
  Layers,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { testPlansAPI } from '@/lib/api';
import {
  testPlanKeys,
  useTestPlansList,
  useTestPlanMilestones,
  useTestPlanReqOptions,
  useTestPlanMembers,
  type TestPlanMember,
} from '@/hooks/queries/testPlans';

type TestPlanStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'completed';
type ExecutionStatus = 'not_started' | 'in_progress' | 'blocked' | 'failed' | 'passed';

interface TestPlan {
  id: number;
  project_seq?: number | null;
  title: string;
  description: string | null;
  project_id: number;
  milestone_id: number | null;
  milestone_title: string | null;
  created_by: number;
  assigned_to?: number | null;
  status: TestPlanStatus;
  target_start_date: string | null;
  target_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  test_objectives: string | null;
  scope_inclusions: string | null;
  scope_exclusions: string | null;
  test_environment: string | null;
  entry_criteria: string | null;
  exit_criteria: string | null;
  risks_assumptions: string | null;
  test_run_count: number;
  execution_status?: ExecutionStatus | null;
  execution_progress?: number | null;
  pass_rate?: number | null;
  created_at: string;
  updated_at: string | null;
}

interface Milestone {
  id: number;
  title: string;
  target_date?: string | null;
}

interface FormState {
  title: string;
  description: string;
  objectives: string;
  scopeIn: string;
  scopeOut: string;
  environment: string;
  entryCriteria: string;
  exitCriteria: string;
  risks: string;
  startDate: string;
  endDate: string;
  actualStartDate: string;
  actualEndDate: string;
  status: TestPlanStatus;
  milestoneId: string;
  assigneeId: string;
}

const emptyForm: FormState = {
  title: '',
  description: '',
  objectives: '',
  scopeIn: '',
  scopeOut: '',
  environment: '',
  entryCriteria: '',
  exitCriteria: '',
  risks: '',
  startDate: '',
  endDate: '',
  actualStartDate: '',
  actualEndDate: '',
  status: 'pending',
  milestoneId: '',
  assigneeId: '',
};

const STATUS_OPTIONS: TestPlanStatus[] = ['pending', 'running', 'completed', 'blocked', 'failed', 'passed', 'skipped'];
const ITEMS_PER_PAGE = 10;

const formsEqual = (a: FormState, b: FormState): boolean =>
  (Object.keys(a) as Array<keyof FormState>).every((key) => a[key] === b[key]);

const toDateInputValue = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const head = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : '';
};

const dateInputToIso = (value: string): string | null => {
  if (!value) return null;
  // Anchor at noon UTC so the date round-trips through any local timezone unchanged.
  return `${value}T12:00:00.000Z`;
};

const formatDate = (value: string | null | undefined, fallback: string): string => {
  if (!value) return fallback;
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (parts) {
    const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12));
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  const fallbackDate = new Date(value);
  return Number.isFinite(fallbackDate.getTime()) ? fallbackDate.toLocaleDateString() : fallback;
};

const EXECUTION_META: Record<
  ExecutionStatus,
  { labelKey: string; className: string; dot: string }
> = {
  not_started: { labelKey: 'execStatusNotStarted', className: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300', dot: 'bg-slate-400' },
  in_progress: { labelKey: 'execStatusInProgress', className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300', dot: 'bg-blue-500' },
  blocked: { labelKey: 'execStatusBlocked', className: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300', dot: 'bg-orange-500' },
  failed: { labelKey: 'execStatusFailed', className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300', dot: 'bg-red-500' },
  passed: { labelKey: 'execStatusPassed', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
};

export function TestPlans() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  // Test plans are project planning artifacts: testers can create/edit but
  // deletion is a manager+ action.
  const { canManageProject } = useProjectPermissions(projectId ? parseInt(projectId) : null);
  const [searchParams] = useSearchParams();
  const fromMilestoneIdParam = searchParams.get('milestone_id');
  const createFromQuery = searchParams.get('create') === '1';
  const editIdFromQuery = searchParams.get('edit');
  const { t, isRTL } = useTranslation();
  const { canWrite } = usePermissions();

  const numericProjectId = useMemo(() => {
    if (!projectId) return null;
    const parsed = Number(projectId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [projectId]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters & sort (kept in state so they're easily reset/serialised)
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [milestoneFilter, setMilestoneFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPlanIds, setSelectedPlanIds] = useState<number[]>([]);
  const [bulkMilestoneId, setBulkMilestoneId] = useState<string>('none');

  // Dialogs
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TestPlan | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<TestPlan | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState<'create' | 'edit' | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'scope' | 'requirements' | 'schedule' | 'criteria'>('overview');

  // Form
  const [form, setForm] = useState<FormState>(emptyForm);
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm);
  const [validationErrors, setValidationErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const titleInputRef = useRef<HTMLInputElement>(null);
  const deepLinkCreateHandled = useRef(false);
  const deepLinkEditHandled = useRef(false);

  // Requirement scope linking inside the create/edit modal (parity with the detail page)
  const [selectedReqIds, setSelectedReqIds] = useState<number[]>([]);
  const [initialReqIds, setInitialReqIds] = useState<number[]>([]);
  const [reqSearch, setReqSearch] = useState('');

  const sameIdSet = (a: number[], b: number[]) => {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((id) => setB.has(id));
  };
  const reqDirty = !sameIdSet(selectedReqIds, initialReqIds);
  const isDirty = !formsEqual(form, initialForm) || reqDirty;

  const queryClient = useQueryClient();
  const listFilters = { sortBy, sortOrder, statusFilter, searchQuery, milestoneFilter };
  const testPlansQuery = useTestPlansList(numericProjectId, listFilters, numericProjectId != null);
  const milestonesQuery = useTestPlanMilestones(numericProjectId, numericProjectId != null);
  // Stable references: `?? []` would otherwise mint a fresh array every render
  // while the query is pending, retriggering array-keyed effects in a loop.
  const testPlans: TestPlan[] = useMemo(() => testPlansQuery.data ?? [], [testPlansQuery.data]);
  const milestones: Milestone[] = useMemo(() => milestonesQuery.data ?? [], [milestonesQuery.data]);
  const isLoading = numericProjectId != null && testPlansQuery.isLoading;

  // Project members for the assignee picker (loaded only while a dialog is open).
  const membersQuery = useTestPlanMembers(numericProjectId, numericProjectId != null && (isCreateOpen || isEditOpen));
  const members: TestPlanMember[] = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  // Requirement options for the create/edit scope picker (fetched while a dialog is open).
  const reqOptionsQuery = useTestPlanReqOptions(numericProjectId, numericProjectId != null && (isCreateOpen || isEditOpen));
  const reqOptions = reqOptionsQuery.data ?? [];
  const reqOptionsLoading = reqOptionsQuery.isLoading;

  const invalidatePlans = useCallback(
    () => queryClient.invalidateQueries({ queryKey: testPlanKeys.listRoot(numericProjectId) }),
    [queryClient, numericProjectId],
  );

  // Map list-load failures to the same status-specific messages as before.
  useEffect(() => {
    if (!numericProjectId) {
      setError(t('invalidProjectId'));
      return;
    }
    if (testPlansQuery.isError) {
      const status = (testPlansQuery.error as any)?.response?.status;
      if (status === 401) setError(t('authenticationRequired'));
      else if (status === 403) setError(t('permissionDeniedViewTestPlans'));
      else if (status === 404) setError(t('projectNotFound'));
      else setError(t('failedToLoadTestPlans'));
    } else if (testPlansQuery.isSuccess) {
      setError(null);
    }
  }, [numericProjectId, testPlansQuery.status, testPlansQuery.isError, testPlansQuery.isSuccess, testPlansQuery.error, t]);

  // Apply the milestone deep-link, but only if that milestone actually exists in this project
  useEffect(() => {
    if (!fromMilestoneIdParam) return;
    if (milestones.some((m) => String(m.id) === fromMilestoneIdParam)) {
      setMilestoneFilter(fromMilestoneIdParam);
    }
  }, [fromMilestoneIdParam, milestones]);

  // Focus the title input when the create dialog opens
  useEffect(() => {
    if (!isCreateOpen) return;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [isCreateOpen]);

  // Client-side filter is now only used to apply the "no milestone" case (server param doesn't exist for that)
  const filtered = useMemo(() => {
    if (milestoneFilter !== 'none') return testPlans;
    return testPlans.filter((plan) => plan.milestone_id === null);
  }, [testPlans, milestoneFilter]);

  useEffect(() => {
    setSelectedPlanIds((current) => {
      const next = current.filter((id) => testPlans.some((plan) => plan.id === id));
      // Preserve the reference when nothing was pruned so setState bails out.
      return next.length === current.length ? current : next;
    });
  }, [testPlans]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginated = filtered.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const stats = useMemo(
    () => ({
      total: testPlans.length,
      pending: testPlans.filter((p) => p.status === 'pending').length,
      running: testPlans.filter((p) => p.status === 'running').length,
      completed: testPlans.filter((p) => p.status === 'completed').length,
    }),
    [testPlans],
  );

  const hasActiveFilters =
    statusFilter !== 'all' || milestoneFilter !== 'all' || searchQuery.trim() !== '';

  const clearFilters = () => {
    setStatusFilter('all');
    setMilestoneFilter('all');
    setSearchQuery('');
    setCurrentPage(1);
  };

  const validateForm = (requireMilestone = false): boolean => {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.title.trim()) errors.title = t('testPlanNameRequired');
    if (requireMilestone && !form.milestoneId) errors.milestoneId = t('milestoneRequired');
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      errors.endDate = t('endDateAfterStartDate');
    }
    setValidationErrors(errors);
    if (errors.title || errors.milestoneId) setActiveTab('overview');
    else if (errors.endDate) setActiveTab('schedule');
    return Object.keys(errors).length === 0;
  };

  const buildPayload = (includeStatus = false) => ({
    title: form.title.trim(),
    description: form.description.trim() || null,
    test_objectives: form.objectives.trim() || null,
    scope_inclusions: form.scopeIn.trim() || null,
    scope_exclusions: form.scopeOut.trim() || null,
    test_environment: form.environment.trim() || null,
    entry_criteria: form.entryCriteria.trim() || null,
    exit_criteria: form.exitCriteria.trim() || null,
    risks_assumptions: form.risks.trim() || null,
    target_start_date: dateInputToIso(form.startDate),
    target_end_date: dateInputToIso(form.endDate),
    actual_start_date: dateInputToIso(form.actualStartDate),
    actual_end_date: dateInputToIso(form.actualEndDate),
    milestone_id: form.milestoneId ? Number(form.milestoneId) : null,
    assigned_to: form.assigneeId ? Number(form.assigneeId) : null,
    ...(includeStatus ? { status: form.status } : {}),
  });

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    window.setTimeout(() => setSuccessMessage(null), 3500);
  };

  const extractApiError = (err: any): string | null => {
    const detail = err?.response?.data?.detail;
    if (!detail) return null;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: any) => d?.msg || String(d)).join(' · ');
    return null;
  };

  const resetForm = () => {
    setForm(emptyForm);
    setInitialForm(emptyForm);
    setValidationErrors({});
    setActiveTab('overview');
    setSelectedReqIds([]);
    setInitialReqIds([]);
    setReqSearch('');
  };

  const syncPlanRequirements = async (planId: number) => {
    const toLink = selectedReqIds.filter((id) => !initialReqIds.includes(id));
    const toUnlink = initialReqIds.filter((id) => !selectedReqIds.includes(id));
    if (toLink.length > 0) {
      await testPlansAPI.bulkUpdateRequirements(planId, { requirement_ids: toLink, action: 'link' });
    }
    if (toUnlink.length > 0) {
      await testPlansAPI.bulkUpdateRequirements(planId, { requirement_ids: toUnlink, action: 'unlink' });
    }
  };

  const toggleReqOption = (id: number) => {
    setSelectedReqIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const handleCreate = async () => {
    if (!numericProjectId) return;
    if (!validateForm(false)) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await testPlansAPI.create({
        project_id: numericProjectId,
        created_by: 0, // backend overrides with the authenticated user id
        status: 'pending',
        ...buildPayload(),
      });
      // The plan now exists; a failure to link requirements must not be reported
      // as a failed creation. Surface it as a non-blocking warning instead.
      let linkWarning = false;
      if (created?.id && selectedReqIds.length > 0) {
        try {
          await testPlansAPI.bulkUpdateRequirements(created.id, { requirement_ids: selectedReqIds, action: 'link' });
        } catch {
          linkWarning = true;
        }
      }
      showSuccess(linkWarning ? t('testPlanCreatedRequirementsFailed') : t('testPlanCreatedSuccessfully'));
      setIsCreateOpen(false);
      resetForm();
      await invalidatePlans();
    } catch (err: any) {
      const status = err?.response?.status;
      const apiMsg = extractApiError(err);
      if (status === 403) setError(t('permissionDeniedCreateTestPlans'));
      else if (status === 400 || status === 422) setError(apiMsg || t('invalidDataProvided'));
      else setError(t('failedToCreateTestPlan'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedPlan) return;
    if (!validateForm()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await testPlansAPI.update(selectedPlan.id, buildPayload(true));
      // Plan saved; requirement-link failures are reported separately so a link
      // error doesn't masquerade as a failed update.
      let linkWarning = false;
      try {
        await syncPlanRequirements(selectedPlan.id);
      } catch {
        linkWarning = true;
      }
      showSuccess(linkWarning ? t('testPlanCreatedRequirementsFailed') : t('testPlanUpdatedSuccessfully'));
      setIsEditOpen(false);
      setSelectedPlan(null);
      resetForm();
      await invalidatePlans();
    } catch (err: any) {
      const status = err?.response?.status;
      const apiMsg = extractApiError(err);
      if (status === 403) setError(t('permissionDeniedUpdateTestPlans'));
      else if (status === 404) setError(t('testPlanNotFound'));
      else if (status === 400 || status === 422) setError(apiMsg || t('invalidDataProvided'));
      else setError(t('failedToUpdateTestPlan'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setIsDeleting(targetId);
    setError(null);
    try {
      await testPlansAPI.delete(targetId);
      showSuccess(t('testPlanDeletedSuccessfully'));
      setDeleteTarget(null);
      setCurrentPage(1);
      await invalidatePlans();
    } catch (err: any) {
      const status = err?.response?.status;
      const apiMsg = extractApiError(err);
      if (status === 403) setError(t('permissionDeniedDeleteTestPlans'));
      else if (status === 404) setError(t('testPlanAlreadyDeleted'));
      else if (status === 400 || status === 422) setError(apiMsg || t('invalidDataProvided'));
      else setError(t('failedToDeleteTestPlan'));
      setDeleteTarget(null);
    } finally {
      setIsDeleting(null);
    }
  };

  const openCreateDialog = () => {
    const initial: FormState = {
      ...emptyForm,
      milestoneId:
        fromMilestoneIdParam && milestones.some((m) => String(m.id) === fromMilestoneIdParam)
          ? fromMilestoneIdParam
          : '',
    };
    setForm(initial);
    setInitialForm(initial);
    setValidationErrors({});
    setActiveTab('overview');
    setSelectedReqIds([]);
    setInitialReqIds([]);
    setReqSearch('');
    
    setIsCreateOpen(true);
  };

  useEffect(() => {
    if (!createFromQuery || deepLinkCreateHandled.current || !numericProjectId || isLoading) return;
    if (fromMilestoneIdParam && milestones.length === 0) return;
    deepLinkCreateHandled.current = true;
    openCreateDialog();
  }, [createFromQuery, fromMilestoneIdParam, isLoading, milestones.length, numericProjectId]);

  // Deep-link edit: ?edit=<id> opens the editor for that plan once data has loaded
  // (used by the "Edit" action on the test plan detail page). The plan may be
  // outside the current filter/page, so fall back to fetching it by id.
  useEffect(() => {
    if (!editIdFromQuery || deepLinkEditHandled.current || isLoading || !numericProjectId) return;
    deepLinkEditHandled.current = true;
    const inList = testPlans.find((p) => String(p.id) === editIdFromQuery);
    if (inList) {
      openEdit(inList);
      return;
    }
    const id = Number(editIdFromQuery);
    if (!Number.isInteger(id) || id <= 0) return;
    testPlansAPI
      .getById(id)
      .then((plan) => {
        if (plan && plan.project_id === numericProjectId) openEdit(plan as TestPlan);
      })
      .catch(() => {
        /* invalid/forbidden edit id — leave the list as-is */
      });
  }, [editIdFromQuery, isLoading, testPlans, numericProjectId]);

  const openEdit = (plan: TestPlan) => {
    setSelectedPlan(plan);
    setReqSearch('');
    
    // Seed the requirement selection from the plan's currently-linked requirements.
    testPlansAPI
      .getRequirements(plan.id, { linked: true, limit: 500 })
      .then((data) => {
        const ids = Array.isArray(data?.items) ? data.items.map((r: any) => r.id) : [];
        setSelectedReqIds(ids);
        setInitialReqIds(ids);
      })
      .catch(() => {
        setSelectedReqIds([]);
        setInitialReqIds([]);
      });
    const next: FormState = {
      title: plan.title || '',
      description: plan.description || '',
      objectives: plan.test_objectives || '',
      scopeIn: plan.scope_inclusions || '',
      scopeOut: plan.scope_exclusions || '',
      environment: plan.test_environment || '',
      entryCriteria: plan.entry_criteria || '',
      exitCriteria: plan.exit_criteria || '',
      risks: plan.risks_assumptions || '',
      startDate: toDateInputValue(plan.target_start_date),
      endDate: toDateInputValue(plan.target_end_date),
      actualStartDate: toDateInputValue(plan.actual_start_date),
      actualEndDate: toDateInputValue(plan.actual_end_date),
      status: plan.status,
      milestoneId: plan.milestone_id ? String(plan.milestone_id) : '',
      assigneeId: plan.assigned_to ? String(plan.assigned_to) : '',
    };
    setForm(next);
    setInitialForm(next);
    setValidationErrors({});
    setActiveTab('overview');
    setIsEditOpen(true);
  };

  const closeCreateDialog = (force = false) => {
    if (!force && isDirty) {
      setShowUnsavedDialog('create');
      return;
    }
    setIsCreateOpen(false);
    resetForm();
  };

  const closeEditDialog = (force = false) => {
    if (!force && isDirty) {
      setShowUnsavedDialog('edit');
      return;
    }
    setIsEditOpen(false);
    setSelectedPlan(null);
    resetForm();
  };

  const onUnsavedConfirm = (discard: boolean) => {
    const which = showUnsavedDialog;
    setShowUnsavedDialog(null);
    if (!discard) return;
    if (which === 'create') closeCreateDialog(true);
    else if (which === 'edit') closeEditDialog(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      if (isEditOpen) handleUpdate();
      else if (isCreateOpen) handleCreate();
    }
  };

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setValidationErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const setMilestoneField = (value: string) => {
    const nextMilestoneId = value === 'none' ? '' : value;
    const selectedMilestone = milestones.find((m) => String(m.id) === nextMilestoneId);
    setForm((prev) => ({
      ...prev,
      milestoneId: nextMilestoneId,
      endDate: selectedMilestone?.target_date && !prev.endDate
        ? toDateInputValue(selectedMilestone.target_date)
        : prev.endDate,
    }));
    setValidationErrors((prev) => (prev.milestoneId ? { ...prev, milestoneId: undefined } : prev));
  };

  const togglePlanSelection = (planId: number) => {
    setSelectedPlanIds((current) =>
      current.includes(planId) ? current.filter((id) => id !== planId) : [...current, planId],
    );
  };

  const clearSelection = () => {
    setSelectedPlanIds([]);
    setBulkMilestoneId('none');
  };

  const handleBulkMove = async () => {
    if (selectedPlanIds.length === 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const milestone_id = bulkMilestoneId === 'none' ? null : Number(bulkMilestoneId);
      await Promise.all(selectedPlanIds.map((id) => testPlansAPI.update(id, { milestone_id })));
      showSuccess(t('testPlansMovedSuccessfully', { count: selectedPlanIds.length }));
      clearSelection();
      await invalidatePlans();
    } catch (err: any) {
      const apiMsg = extractApiError(err);
      setError(apiMsg || t('failedToUpdateTestPlan'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { label: string; className: string; barClass: string; icon: React.ReactNode }> = {
      pending: {
        label: t('testPlansPending'),
        className: 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        barClass: 'bg-slate-400',
        icon: <Clock className="h-3 w-3" />,
      },
      running: {
        label: t('testPlansRunning'),
        className: 'bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
        barClass: 'bg-blue-500',
        icon: <Play className="h-3 w-3" />,
      },
      completed: {
        label: t('testPlansCompleted'),
        className: 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
        barClass: 'bg-emerald-500',
        icon: <CheckCircle2 className="h-3 w-3" />,
      },
      passed: {
        label: t('testRunStatusPassed'),
        className: 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
        barClass: 'bg-green-500',
        icon: <CheckCircle2 className="h-3 w-3" />,
      },
      failed: {
        label: t('testRunStatusFailed'),
        className: 'bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
        barClass: 'bg-red-500',
        icon: <AlertCircle className="h-3 w-3" />,
      },
      skipped: {
        label: t('testRunStatusSkipped'),
        className: 'bg-yellow-100 text-yellow-700 border border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800',
        barClass: 'bg-yellow-400',
        icon: <Ban className="h-3 w-3" />,
      },
      blocked: {
        label: t('testPlansBlocked'),
        className: 'bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
        barClass: 'bg-orange-500',
        icon: <ShieldAlert className="h-3 w-3" />,
      },
    };
    return configs[status] || configs.pending;
  };

  const fromMilestone = useMemo(
    () =>
      fromMilestoneIdParam
        ? milestones.find((m) => String(m.id) === fromMilestoneIdParam) || null
        : null,
    [fromMilestoneIdParam, milestones],
  );

  const renderPlanForm = (mode: 'create' | 'edit') => {
    const isEdit = mode === 'edit';
    // Bidirectional date awareness: warn if the plan's target end is past the
    // linked milestone's target date.
    const linkedMilestone = milestones.find((m) => String(m.id) === form.milestoneId);
    const milestoneOverrun = Boolean(
      linkedMilestone?.target_date &&
        form.endDate &&
        form.endDate > toDateInputValue(linkedMilestone.target_date),
    );
    return (
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} onKeyDown={handleKeyDown}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">{t('testPlanTabOverview')}</TabsTrigger>
          <TabsTrigger value="scope">{t('testPlanTabScope')}</TabsTrigger>
          <TabsTrigger value="requirements">{t('testPlanTabRequirements')}</TabsTrigger>
          <TabsTrigger value="schedule">{t('testPlanTabSchedule')}</TabsTrigger>
          <TabsTrigger value="criteria">{t('testPlanTabCriteria')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="fp-title">
              {t('name')} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="fp-title"
              ref={!isEdit ? titleInputRef : undefined}
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              className={validationErrors.title ? 'border-red-400 focus-visible:ring-red-300' : ''}
              placeholder={t('enterTestPlanName')}
              maxLength={255}
              autoComplete="off"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-red-500">{validationErrors.title || ' '}</p>
              <p className="text-xs text-muted-foreground">{form.title.length}/255</p>
            </div>
          </div>

          <div className={`grid gap-4 ${isEdit ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
            {isEdit && (
              <div className="space-y-1.5">
                <Label>{t('testPlanStatusLabel')}</Label>
                <Select value={form.status} onValueChange={(v) => setField('status', v as TestPlanStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {getStatusConfig(s).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>
                {t('linkedMilestone')}
              </Label>
              <Select
                value={form.milestoneId || 'none'}
                onValueChange={setMilestoneField}
              >
                <SelectTrigger
                  className={validationErrors.milestoneId ? 'border-red-400 focus-visible:ring-red-300' : ''}
                >
                  <SelectValue placeholder={t('noMilestone')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('noMilestone')}</SelectItem>
                  {milestones.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {validationErrors.milestoneId && (
                <p className="text-xs text-red-500">{validationErrors.milestoneId}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t('assigneeLabel')}</Label>
              <Select
                value={form.assigneeId || 'none'}
                onValueChange={(value) => setField('assigneeId', value === 'none' ? '' : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('unassigned')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('unassigned')}</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={String(m.user_id)}>
                      {m.full_name || m.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fp-desc">{t('description')}</Label>
            <Textarea
              id="fp-desc"
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder={t('testPlanDescribe')}
              rows={3}
              maxLength={1000}
            />
            <p className="text-right text-xs text-muted-foreground">{form.description.length}/1000</p>
          </div>
        </TabsContent>

        <TabsContent value="scope" className="space-y-4 pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="fp-obj">{t('testPlanObjectivesLabel')}</Label>
            <Textarea
              id="fp-obj"
              value={form.objectives}
              onChange={(e) => setField('objectives', e.target.value)}
              placeholder={t('testPlanGoals')}
              rows={3}
              maxLength={2000}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fp-scopein" className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                {t('scopeIn')}
              </Label>
              <Textarea
                id="fp-scopein"
                value={form.scopeIn}
                onChange={(e) => setField('scopeIn', e.target.value)}
                placeholder={t('scopeInPlaceholder')}
                rows={4}
                maxLength={2000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-scopeout" className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-orange-500" />
                {t('scopeOut')}
              </Label>
              <Textarea
                id="fp-scopeout"
                value={form.scopeOut}
                onChange={(e) => setField('scopeOut', e.target.value)}
                placeholder={t('scopeOutPlaceholder')}
                rows={4}
                maxLength={2000}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="requirements" className="space-y-3 pt-4">
          <div className="flex items-center justify-between">
            <Label>{t('linkedRequirements')}</Label>
            <Badge variant="outline">{selectedReqIds.length}</Badge>
          </div>
          <div className="relative">
            <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isRTL ? 'right-3' : 'left-3'}`} />
            <Input
              value={reqSearch}
              placeholder={t('searchRequirements')}
              className={isRTL ? 'pr-9' : 'pl-9'}
              onChange={(e) => setReqSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[40vh] space-y-1.5 overflow-y-auto rounded-lg border p-2">
            {reqOptionsLoading ? (
              <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('loading')}
              </div>
            ) : reqOptions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noRequirementsLinked')}</p>
            ) : (
              reqOptions
                .filter((r) => {
                  const q = reqSearch.trim().toLowerCase();
                  return !q || r.title.toLowerCase().includes(q) || r.requirement_id.toLowerCase().includes(q);
                })
                .map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md p-2 text-sm hover:bg-muted/60"
                  >
                    <Checkbox checked={selectedReqIds.includes(r.id)} onCheckedChange={() => toggleReqOption(r.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">{r.requirement_id}</p>
                    </div>
                    {r.status && <Badge variant="outline" className="shrink-0">{r.status}</Badge>}
                  </label>
                ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fp-start">{t('targetStartDate')}</Label>
              <Input
                id="fp-start"
                type="date"
                value={form.startDate}
                max={form.endDate || undefined}
                onChange={(e) => setField('startDate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-end">{t('targetEndDate')}</Label>
              <Input
                id="fp-end"
                type="date"
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={(e) => setField('endDate', e.target.value)}
                className={validationErrors.endDate ? 'border-red-400 focus-visible:ring-red-300' : ''}
              />
              {validationErrors.endDate && (
                <p className="text-xs text-red-500">{validationErrors.endDate}</p>
              )}
            </div>
          </div>
          {milestoneOverrun && (
            <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t('planEndExceedsMilestone')}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fp-actual-start">{t('actualStartDate')}</Label>
              <Input
                id="fp-actual-start"
                type="date"
                value={form.actualStartDate}
                max={form.actualEndDate || undefined}
                onChange={(e) => setField('actualStartDate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-actual-end">{t('actualEndDate')}</Label>
              <Input
                id="fp-actual-end"
                type="date"
                value={form.actualEndDate}
                min={form.actualStartDate || undefined}
                onChange={(e) => setField('actualEndDate', e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-env">{t('testEnvironment')}</Label>
            <Textarea
              id="fp-env"
              value={form.environment}
              onChange={(e) => setField('environment', e.target.value)}
              placeholder={t('testPlanEnvironmentPlaceholder')}
              rows={4}
              maxLength={2000}
            />
          </div>
        </TabsContent>

        <TabsContent value="criteria" className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fp-entry">{t('entryCriteria')}</Label>
              <Textarea
                id="fp-entry"
                value={form.entryCriteria}
                onChange={(e) => setField('entryCriteria', e.target.value)}
                placeholder={t('testPlanEntryCriteriaPlaceholder')}
                rows={4}
                maxLength={2000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-exit">{t('exitCriteria')}</Label>
              <Textarea
                id="fp-exit"
                value={form.exitCriteria}
                onChange={(e) => setField('exitCriteria', e.target.value)}
                placeholder={t('testPlanExitCriteriaPlaceholder')}
                rows={4}
                maxLength={2000}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-risks" className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              {t('risksAssumptions')}
            </Label>
            <Textarea
              id="fp-risks"
              value={form.risks}
              onChange={(e) => setField('risks', e.target.value)}
              placeholder={t('testPlanRisksPlaceholder')}
              rows={4}
              maxLength={2000}
            />
          </div>
        </TabsContent>
      </Tabs>
    );
  };

  const PageNumbers = () => {
    const pages: number[] = [];
    const delta = 2;
    for (let i = Math.max(1, safeCurrentPage - delta); i <= Math.min(totalPages, safeCurrentPage + delta); i++) {
      pages.push(i);
    }
    return (
      <div className="flex items-center gap-1">
        {safeCurrentPage - delta > 1 && (
          <>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(1)}>
              1
            </Button>
            {safeCurrentPage - delta > 2 && <span className="px-1 text-muted-foreground">…</span>}
          </>
        )}
        {pages.map((p) => (
          <Button
            key={p}
            variant={p === safeCurrentPage ? 'default' : 'outline'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setCurrentPage(p)}
          >
            {p}
          </Button>
        ))}
        {safeCurrentPage + delta < totalPages && (
          <>
            {safeCurrentPage + delta < totalPages - 1 && <span className="px-1 text-muted-foreground">…</span>}
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setCurrentPage(totalPages)}
            >
              {totalPages}
            </Button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {fromMilestone && (
        <button
          onClick={() => navigate(`/projects/${projectId}/milestones`)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <Flag className="h-3.5 w-3.5 text-indigo-500" />
          <span>
            {t('backToMilestone')}: <span className="font-medium text-foreground">{fromMilestone.title}</span>
          </span>
        </button>
      )}

      {/* Hero header */}
      <div className="relative overflow-hidden rounded-4xl border border-border bg-card text-card-foreground shadow-xs">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.10),transparent_30%),radial-gradient(circle_at_bottom_left,hsl(var(--accent)/0.15),transparent_32%)]" />
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge className="w-fit border border-primary/30 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/15">
              <ClipboardList className="mr-2 h-3.5 w-3.5" />
              {t('testPlansTitle')}
            </Badge>
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('testPlansTitle')}</h1>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t('testPlansDescription')}</p>
            </div>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={(open) => (open ? openCreateDialog() : closeCreateDialog())}>
            {canWrite && (
              <DialogTrigger asChild>
                <Button disabled={!numericProjectId} className="shrink-0">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('createTestPlan')}
                </Button>
              </DialogTrigger>
            )}
            <DialogContent isRTL={isRTL} className="max-h-[88vh] overflow-y-auto sm:max-w-[760px]">
              <DialogHeader>
                <DialogTitle>{t('createNewTestPlan')}</DialogTitle>
                <DialogDescription>{t('createTestPlanDescription')}</DialogDescription>
              </DialogHeader>
              {renderPlanForm('create')}
              <DialogFooter className="gap-2 pt-2">
                <span className="me-auto text-xs text-muted-foreground">{t('ctrlEnterToSubmit')}</span>
                <Button variant="outline" onClick={() => closeCreateDialog()} disabled={isSubmitting}>
                  {t('cancel')}
                </Button>
                <Button onClick={handleCreate} disabled={!form.title.trim() || isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('creating')}
                    </>
                  ) : (
                    t('createTestPlan')
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      {!isLoading && testPlans.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: t('total'),
              value: stats.total,
              icon: <ClipboardList className="h-4 w-4" />,
              color: 'text-slate-600 bg-slate-50 dark:bg-slate-900/40 dark:text-slate-300 border-slate-200 dark:border-slate-700',
            },
            {
              label: t('testPlansPending'),
              value: stats.pending,
              icon: <Clock className="h-4 w-4" />,
              color: 'text-slate-600 bg-slate-50 dark:bg-slate-900/40 dark:text-slate-300 border-slate-200 dark:border-slate-700',
            },
            {
              label: t('testPlansRunning'),
              value: stats.running,
              icon: <Play className="h-4 w-4" />,
              color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300 border-blue-200 dark:border-blue-800',
            },
            {
              label: t('testPlansCompleted'),
              value: stats.completed,
              icon: <CheckCircle2 className="h-4 w-4" />,
              color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
            },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${color}`}>
              <div className="rounded-xl bg-white/70 p-2 dark:bg-slate-900/40">{icon}</div>
              <div>
                <p className="text-xs leading-none text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_200px_200px_auto]">
            <div className="relative">
              <Search
                className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none ${isRTL ? 'right-3' : 'left-3'}`}
              />
              <Input
                placeholder={t('searchTestPlans')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className={isRTL ? 'pr-9' : 'pl-9'}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label={t('clearFilters')}
                  className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground ${isRTL ? 'left-2' : 'right-2'}`}
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {getStatusConfig(s).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={milestoneFilter}
              onValueChange={(v) => {
                setMilestoneFilter(v);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('allMilestones')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allMilestones')}</SelectItem>
                <SelectItem value="none">{t('noMilestone')}</SelectItem>
                {milestones.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={`${sortBy}:${sortOrder}`}
              onValueChange={(v) => {
                const [col, ord] = v.split(':');
                setSortBy(col);
                setSortOrder(ord as 'asc' | 'desc');
                setCurrentPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at:desc">{t('sortByDateCreated')} ↓</SelectItem>
                <SelectItem value="created_at:asc">{t('sortByDateCreated')} ↑</SelectItem>
                <SelectItem value="title:asc">{t('sortByName')} A→Z</SelectItem>
                <SelectItem value="title:desc">{t('sortByName')} Z→A</SelectItem>
                <SelectItem value="status:asc">{t('sortByStatusLabel')} ↑</SelectItem>
                <SelectItem value="target_start_date:asc">{t('sortByStartDate')} ↑</SelectItem>
                <SelectItem value="target_start_date:desc">{t('sortByStartDate')} ↓</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
                <X className="h-3.5 w-3.5" /> {t('clearFilters')}
              </Button>
            ) : (
              <span />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {!isLoading && selectedPlanIds.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-medium">
              {t('selectedTestPlansCount', { count: selectedPlanIds.length })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={bulkMilestoneId} onValueChange={setBulkMilestoneId}>
                <SelectTrigger className="sm:w-[240px]">
                  <SelectValue placeholder={t('moveToMilestone')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('noMilestone')}</SelectItem>
                  {milestones.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleBulkMove} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {t('moveToMilestone')}
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                {t('clearSelection')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="flex min-h-72 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t('loadingTestPlans')}
          </CardContent>
        </Card>
      ) : paginated.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40" />
            <div>
              <h2 className="text-lg font-semibold">
                {hasActiveFilters ? t('noTestPlansMatchFilter') : t('noTestPlansFound')}
              </h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {hasActiveFilters ? t('tryAdjustingSearchTerms') : t('createFirstTestPlan')}
              </p>
            </div>
            {hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                {t('clearFilters')}
              </Button>
            ) : canWrite ? (
              <Button onClick={openCreateDialog} disabled={!numericProjectId}>
                <Plus className="mr-2 h-4 w-4" />
                {t('createTestPlan')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {paginated.map((plan) => {
            const statusCfg = getStatusConfig(plan.status);
            return (
              <Card
                key={plan.id}
                className="overflow-hidden border-border transition-shadow duration-200 hover:shadow-md"
              >
                <div className={`h-1 ${statusCfg.barClass}`} />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Checkbox
                      checked={selectedPlanIds.includes(plan.id)}
                      onCheckedChange={() => togglePlanSelection(plan.id)}
                      aria-label={t('selectTestPlan')}
                      className="mt-1 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {plan.execution_status && (
                          <Badge
                            variant="outline"
                            className={`flex items-center gap-1 px-2 py-0.5 text-xs ${EXECUTION_META[plan.execution_status].className}`}
                            title={t('derivedFromRuns')}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${EXECUTION_META[plan.execution_status].dot}`} />
                            {t(EXECUTION_META[plan.execution_status].labelKey as any)}
                          </Badge>
                        )}
                        <Badge
                          className={`flex items-center gap-1 px-2 py-0.5 text-xs ${statusCfg.className}`}
                          title={t('manualStatus')}
                        >
                          {statusCfg.icon}
                          {statusCfg.label}
                        </Badge>
                        {plan.milestone_title && (
                          <Badge
                            variant="outline"
                            className="flex items-center gap-1 border-indigo-200 bg-indigo-50 text-xs text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
                          >
                            <Flag className="h-3 w-3" />
                            {plan.milestone_title}
                          </Badge>
                        )}
                        {plan.test_run_count > 0 && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Layers className="h-3 w-3" />
                            {t('testRunCount').replace('{count}', String(plan.test_run_count))}
                          </span>
                        )}
                      </div>
                      <h3
                        className="truncate text-base font-semibold leading-tight cursor-pointer hover:underline"
                        onClick={() => navigate(`/projects/${projectId}/test-plans/${plan.project_seq ?? plan.id}`)}
                        title={t('openTestPlan')}
                      >
                        {plan.title}
                      </h3>
                      {plan.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{plan.description}</p>
                      )}
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      {t('testPlanCreated')} {formatDate(plan.created_at, t('notSet'))}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(plan.target_start_date, t('notSet'))}
                      <span aria-hidden="true">→</span>
                      {formatDate(plan.target_end_date, t('notSet'))}
                    </span>
                    {plan.actual_end_date && (
                      <span className="flex items-center gap-1.5">
                        <Target className="h-3.5 w-3.5" />
                        {t('completed')} {formatDate(plan.actual_end_date, t('notSet'))}
                      </span>
                    )}
                  </div>

                  {(plan.test_objectives ||
                    plan.scope_inclusions ||
                    plan.scope_exclusions ||
                    plan.test_environment ||
                    plan.risks_assumptions) && (
                    <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                      {plan.test_objectives && (
                        <DetailRow icon={null} label={t('testPlanObjectives')} value={plan.test_objectives} fullWidth />
                      )}
                      {plan.scope_inclusions && (
                        <DetailRow
                          icon={<ShieldCheck className="h-3 w-3 text-emerald-500" />}
                          label={t('scopeIn')}
                          value={plan.scope_inclusions}
                        />
                      )}
                      {plan.scope_exclusions && (
                        <DetailRow
                          icon={<ShieldAlert className="h-3 w-3 text-orange-500" />}
                          label={t('scopeOut')}
                          value={plan.scope_exclusions}
                        />
                      )}
                      {plan.test_environment && (
                        <DetailRow label={t('testEnvironment')} value={plan.test_environment} />
                      )}
                      {plan.risks_assumptions && (
                        <DetailRow
                          icon={<AlertTriangle className="h-3 w-3 text-amber-500" />}
                          label={t('risksAssumptions')}
                          value={plan.risks_assumptions}
                        />
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                    {/* Primary action is driven by run state, not the manual status. */}
                    <Button
                      size="sm"
                      onClick={() => navigate(`/projects/${projectId}/test-runs?test_plan_id=${plan.id}${plan.milestone_id ? `&milestone_id=${plan.milestone_id}` : ''}${plan.test_run_count === 0 ? '&create=1' : ''}`)}
                    >
                      {plan.test_run_count === 0 ? (
                        <CirclePlus className="mr-1.5 h-3.5 w-3.5" />
                      ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {plan.test_run_count === 0 ? t('startNewRun') : t('viewTestRuns')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}/test-plans/${plan.project_seq ?? plan.id}`)}>
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      {t('openTestPlan')}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" aria-label={t('moreActions')} disabled={isDeleting === plan.id}>
                          {isDeleting === plan.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(plan)}>
                          <Edit className="mr-2 h-3.5 w-3.5" />
                          {t('edit')}
                        </DropdownMenuItem>
                        {canManageProject && (<>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(plan)}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          {t('delete')}
                        </DropdownMenuItem>
                        </>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && totalPages > 1 && (
        <Card>
          <CardContent className="flex items-center justify-between p-3">
            <p className="text-sm text-muted-foreground">
              {t('showing', {
                start: startIndex + 1,
                end: Math.min(startIndex + ITEMS_PER_PAGE, filtered.length),
                total: filtered.length,
              })}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <PageNumbers />
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={isEditOpen} onOpenChange={(open) => (open ? null : closeEditDialog())}>
        <DialogContent isRTL={isRTL} className="max-h-[88vh] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>{t('editTestPlan')}</DialogTitle>
            <DialogDescription>{t('editTestPlanDescription')}</DialogDescription>
          </DialogHeader>
          {renderPlanForm('edit')}
          <DialogFooter className="gap-2 pt-2">
            <span className="me-auto text-xs text-muted-foreground">{t('ctrlEnterToSubmit')}</span>
            <Button variant="outline" onClick={() => closeEditDialog()} disabled={isSubmitting}>
              {t('cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={!form.title.trim() || isSubmitting || !isDirty}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('updating')}
                </>
              ) : (
                t('updateTestPlan')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved-changes guard */}
      <Dialog open={showUnsavedDialog !== null} onOpenChange={(open) => (open ? null : setShowUnsavedDialog(null))}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('unsavedChanges')}</DialogTitle>
            <DialogDescription>{t('unsavedChangesMessage')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onUnsavedConfirm(false)}>
              {t('continueEditing')}
            </Button>
            <Button variant="destructive" onClick={() => onUnsavedConfirm(true)}>
              {t('discardChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => (open ? null : setDeleteTarget(null))}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('deleteTestPlanTitle')}
            </DialogTitle>
            <DialogDescription className="pt-1">
              {t('deleteTestPlanMessage').replace('{title}', deleteTarget?.title || '')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting !== null}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting !== null}>
              {isDeleting !== null ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('deleting')}
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
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

function DetailRow({
  icon,
  label,
  value,
  fullWidth = false,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : ''}>
      <p className="mb-0.5 flex items-center gap-1 text-xs font-medium text-foreground">
        {icon}
        {label}
      </p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{value}</p>
    </div>
  );
}
