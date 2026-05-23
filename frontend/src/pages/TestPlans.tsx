import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Plus,
  FileText,
  Search,
  ChevronLeft,
  ChevronRight,
  Edit,
  Trash2,
  Calendar,
  Target,
  Loader2,
  Play,
  FileCheck,
  AlertCircle,
  CheckCircle2,
  X,
  Link2,
  Layers,
  ClipboardList,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Ban,
  BarChart3,
  SortAsc,
  SortDesc,
  Flag,
  ArrowLeft,
} from 'lucide-react';
import { testPlansAPI, milestonesAPI } from '@/lib/api';

type TestPlanStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'completed';

interface TestPlan {
  id: number;
  title: string;
  description: string | null;
  project_id: number;
  milestone_id: number | null;
  milestone_title: string | null;
  created_by: number;
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
  created_at: string;
  updated_at: string | null;
}

interface Milestone {
  id: number;
  title: string;
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
  status: TestPlanStatus;
  milestoneId: string;
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
  status: 'pending',
  milestoneId: '',
};

const STATUS_OPTIONS: TestPlanStatus[] = ['pending', 'running', 'completed', 'blocked', 'failed', 'passed', 'skipped'];
const ITEMS_PER_PAGE = 10;

export function TestPlans() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const fromMilestoneId = searchParams.get('milestone_id');
  const { t, isRTL } = useTranslation();

  const [testPlans, setTestPlans] = useState<TestPlan[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters & sort
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [milestoneFilter, setMilestoneFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  // Dialogs
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TestPlan | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<TestPlan | null>(null);
  const [showEditUnsavedDialog, setShowEditUnsavedDialog] = useState(false);
  const [isEditDirty, setIsEditDirty] = useState(false);

  // Form
  const [form, setForm] = useState<FormState>(emptyForm);
  const [validationErrors, setValidationErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const numericProjectId = projectId ? parseInt(projectId) : null;

  const loadData = useCallback(async () => {
    if (!numericProjectId) {
      setError(t('invalidProjectId'));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [plans, milestoneList] = await Promise.all([
        testPlansAPI.getAll(numericProjectId, { sortBy, sortOrder }),
        milestonesAPI.getAll(numericProjectId),
      ]);
      setTestPlans(plans || []);
      setMilestones(milestoneList || []);
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 403) setError(t('permissionDeniedViewTestPlans'));
      else if (status === 404) setError(t('projectNotFound'));
      else if (status === 401) setError(t('authenticationRequired'));
      else setError(t('failedToLoadTestPlans'));
      setTestPlans([]);
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId, sortBy, sortOrder]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (fromMilestoneId) setMilestoneFilter(fromMilestoneId);
  }, [fromMilestoneId]);

  useEffect(() => {
    if (isCreateOpen) {
      if (fromMilestoneId) setForm(prev => ({ ...prev, milestoneId: fromMilestoneId }));
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [isCreateOpen]);

  useEffect(() => {
    const { title, description, objectives, scopeIn, scopeOut, environment, entryCriteria, exitCriteria, risks } = form;
    setHasUnsaved([title, description, objectives, scopeIn, scopeOut, environment, entryCriteria, exitCriteria, risks].some(v => v.trim() !== ''));
  }, [form]);

  // Client-side filter on top of server-sorted data
  const filtered = testPlans.filter(plan => {
    if (statusFilter !== 'all' && plan.status !== statusFilter) return false;
    if (milestoneFilter !== 'all') {
      if (milestoneFilter === 'none' && plan.milestone_id !== null) return false;
      if (milestoneFilter !== 'none' && String(plan.milestone_id) !== milestoneFilter) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        (plan.title || '').toLowerCase().includes(q) ||
        (plan.description || '').toLowerCase().includes(q) ||
        (plan.test_objectives || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginated = filtered.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const stats = {
    total: testPlans.length,
    pending: testPlans.filter(p => p.status === 'pending').length,
    running: testPlans.filter(p => p.status === 'running').length,
    completed: testPlans.filter(p => p.status === 'completed').length,
    blocked: testPlans.filter(p => p.status === 'blocked').length,
  };

  const hasActiveFilters = statusFilter !== 'all' || milestoneFilter !== 'all' || searchQuery.trim() !== '';

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
    if (form.startDate && form.endDate && new Date(form.endDate) < new Date(form.startDate)) {
      errors.endDate = t('endDateAfterStartDate');
    }
    setValidationErrors(errors);
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
    target_start_date: form.startDate || null,
    target_end_date: form.endDate || null,
    milestone_id: form.milestoneId ? parseInt(form.milestoneId) : null,
    ...(includeStatus ? { status: form.status } : {}),
  });

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3500);
  };

  // Extract human-readable message from FastAPI/Pydantic error responses (400 and 422)
  const extractApiError = (err: any): string | null => {
    const detail = err.response?.data?.detail;
    if (!detail) return null;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: any) => d.msg || String(d)).join(' · ');
    return null;
  };

  const handleCreate = async () => {
    if (!numericProjectId) return;
    if (!validateForm(true)) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await testPlansAPI.create({
        project_id: numericProjectId,
        created_by: 0, // backend overrides from auth token
        status: 'pending',
        ...buildPayload(),
      });
      showSuccess(t('testPlanCreatedSuccessfully'));
      setIsCreateOpen(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      const status = err.response?.status;
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
      showSuccess(t('testPlanUpdatedSuccessfully'));
      setIsEditOpen(false);
      setSelectedPlan(null);
      setIsEditDirty(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      const status = err.response?.status;
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
    setIsDeleting(deleteTarget.id);
    setError(null);
    try {
      await testPlansAPI.delete(deleteTarget.id);
      showSuccess(t('testPlanDeletedSuccessfully'));
      setDeleteTarget(null);
      setCurrentPage(1); // Reset to first page after deletion to avoid empty-page edge case
      await loadData();
    } catch (err: any) {
      const status = err.response?.status;
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

  const openEdit = (plan: TestPlan) => {
    setSelectedPlan(plan);
    setForm({
      title: plan.title || '',
      description: plan.description || '',
      objectives: plan.test_objectives || '',
      scopeIn: plan.scope_inclusions || '',
      scopeOut: plan.scope_exclusions || '',
      environment: plan.test_environment || '',
      entryCriteria: plan.entry_criteria || '',
      exitCriteria: plan.exit_criteria || '',
      risks: plan.risks_assumptions || '',
      startDate: plan.target_start_date ? plan.target_start_date.split('T')[0] : '',
      endDate: plan.target_end_date ? plan.target_end_date.split('T')[0] : '',
      status: plan.status,
      milestoneId: plan.milestone_id ? String(plan.milestone_id) : '',
    });
    setValidationErrors({});
    setIsEditDirty(false);
    setIsEditOpen(true);
  };

  const handleEditDialogClose = (open: boolean) => {
    if (!open && isEditDirty) {
      setShowEditUnsavedDialog(true);
    } else {
      setIsEditOpen(open);
      if (!open) {
        setSelectedPlan(null);
        resetForm();
        setIsEditDirty(false);
      }
    }
  };

  const handleEditUnsavedConfirm = (discard: boolean) => {
    setShowEditUnsavedDialog(false);
    if (discard) {
      setIsEditOpen(false);
      setSelectedPlan(null);
      resetForm();
      setIsEditDirty(false);
    }
  };

  const resetForm = () => {
    setForm(emptyForm);
    setValidationErrors({});
    setHasUnsaved(false);
  };

  const handleCreateDialogClose = (open: boolean) => {
    if (!open && hasUnsaved) {
      setShowUnsavedDialog(true);
    } else {
      setIsCreateOpen(open);
      if (!open) resetForm();
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      resetForm();
      setIsCreateOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      isEditOpen ? handleUpdate() : handleCreate();
    }
  };

  const setField = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    if (validationErrors[field]) setValidationErrors(prev => ({ ...prev, [field]: undefined }));
    if (isEditOpen) setIsEditDirty(true);
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
      pending:   { label: t('testPlansPending'),   className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', icon: <Clock className="h-3 w-3" /> },
      running:   { label: t('testPlansRunning'),   className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: <Play className="h-3 w-3" /> },
      completed: { label: t('testPlansCompleted'), className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400', icon: <CheckCircle2 className="h-3 w-3" /> },
      passed:    { label: t('testRunStatusPassed'), className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: <CheckCircle2 className="h-3 w-3" /> },
      failed:    { label: t('testRunStatusFailed'), className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: <AlertCircle className="h-3 w-3" /> },
      skipped:   { label: t('testRunStatusSkipped'), className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', icon: <Ban className="h-3 w-3" /> },
      blocked:   { label: t('testPlansBlocked'), className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', icon: <ShieldAlert className="h-3 w-3" /> },
    };
    return configs[status] || configs.pending;
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return t('notSet');
    try { return new Date(d).toLocaleDateString(); } catch { return t('invalidDate'); }
  };

  const renderPlanForm = (isEdit = false) => (
    <div className="grid gap-4 py-4" onKeyDown={handleKeyDown}>
      {/* Title */}
      <div className="space-y-1">
        <Label htmlFor="fp-title">{t('name')} <span className="text-red-500">*</span></Label>
        <Input
          id="fp-title"
          ref={isEdit ? undefined : titleInputRef}
          value={form.title}
          onChange={setField('title')}
          onBlur={() => { if (!form.title.trim()) setValidationErrors(p => ({ ...p, title: t('testPlanNameRequired') })); }}
          className={validationErrors.title ? 'border-red-400' : ''}
          placeholder={t('enterTestPlanName')}
          maxLength={255}
        />
        {validationErrors.title && <p className="text-xs text-red-500">{validationErrors.title}</p>}
        <p className="text-xs text-muted-foreground text-right">{form.title.length}/255</p>
      </div>

      {/* Status (edit only) + Milestone — side by side */}
      <div className="grid grid-cols-2 gap-4">
        {isEdit && (
          <div className="space-y-1">
            <Label>{t('testPlanStatusLabel')}</Label>
            <Select value={form.status} onValueChange={(v) => { setForm(p => ({ ...p, status: v as TestPlanStatus })); if (isEditOpen) setIsEditDirty(true); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => {
                  const cfg = getStatusConfig(s);
                  return <SelectItem key={s} value={s}>{cfg.label}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className={`space-y-1 ${!isEdit ? 'col-span-2' : ''}`}>
          <Label>{t('linkedMilestone')}{!isEdit && <span className="text-red-500 ml-1">*</span>}</Label>
          <Select value={form.milestoneId || 'none'} onValueChange={(v) => { setForm(p => ({ ...p, milestoneId: v === 'none' ? '' : v })); if (validationErrors.milestoneId) setValidationErrors(prev => ({ ...prev, milestoneId: undefined })); if (isEditOpen) setIsEditDirty(true); }}>
            <SelectTrigger className={validationErrors.milestoneId ? 'border-red-400' : ''}><SelectValue placeholder={t('noMilestone')} /></SelectTrigger>
            <SelectContent>
              {!isEdit && <SelectItem value="none">{t('selectMilestone')}</SelectItem>}
              {isEdit && <SelectItem value="none">{t('noMilestone')}</SelectItem>}
              {milestones.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.title}</SelectItem>)}
            </SelectContent>
          </Select>
          {validationErrors.milestoneId && <p className="text-xs text-red-500">{validationErrors.milestoneId}</p>}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <Label htmlFor="fp-desc">{t('description')}</Label>
        <Textarea id="fp-desc" value={form.description} onChange={setField('description')} placeholder={t('testPlanDescribe')} rows={2} maxLength={1000} />
        <p className="text-xs text-muted-foreground text-right">{form.description.length}/1000</p>
      </div>

      {/* Objectives */}
      <div className="space-y-1">
        <Label htmlFor="fp-obj">{t('testPlanObjectivesLabel')}</Label>
        <Textarea id="fp-obj" value={form.objectives} onChange={setField('objectives')} placeholder={t('testPlanGoals')} rows={2} maxLength={2000} />
      </div>

      {/* Scope side-by-side */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="fp-scopein">{t('scopeIn')}</Label>
          <Textarea id="fp-scopein" value={form.scopeIn} onChange={setField('scopeIn')} placeholder={t('scopeInPlaceholder')} rows={2} maxLength={2000} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fp-scopeout">{t('scopeOut')}</Label>
          <Textarea id="fp-scopeout" value={form.scopeOut} onChange={setField('scopeOut')} placeholder={t('scopeOutPlaceholder')} rows={2} maxLength={2000} />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="fp-start">{t('targetStartDate')}</Label>
          <Input id="fp-start" type="date" value={form.startDate} onChange={(e) => { setForm(p => ({ ...p, startDate: e.target.value })); setValidationErrors(p => ({ ...p, endDate: undefined })); }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fp-end">{t('targetEndDate')}</Label>
          <Input id="fp-end" type="date" value={form.endDate} onChange={(e) => { setForm(p => ({ ...p, endDate: e.target.value })); setValidationErrors(p => ({ ...p, endDate: undefined })); }} className={validationErrors.endDate ? 'border-red-400' : ''} />
          {validationErrors.endDate && <p className="text-xs text-red-500">{validationErrors.endDate}</p>}
        </div>
      </div>

      <Separator />

      {/* Advanced fields */}
      <div className="space-y-1">
        <Label htmlFor="fp-env">{t('testEnvironment')}</Label>
        <Textarea id="fp-env" value={form.environment} onChange={setField('environment')} placeholder={t('testPlanEnvironmentPlaceholder')} rows={2} maxLength={2000} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="fp-entry">{t('entryCriteria')}</Label>
          <Textarea id="fp-entry" value={form.entryCriteria} onChange={setField('entryCriteria')} placeholder={t('testPlanEntryCriteriaPlaceholder')} rows={2} maxLength={2000} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fp-exit">{t('exitCriteria')}</Label>
          <Textarea id="fp-exit" value={form.exitCriteria} onChange={setField('exitCriteria')} placeholder={t('testPlanExitCriteriaPlaceholder')} rows={2} maxLength={2000} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="fp-risks">{t('risksAssumptions')}</Label>
        <Textarea id="fp-risks" value={form.risks} onChange={setField('risks')} placeholder={t('testPlanRisksPlaceholder')} rows={2} maxLength={2000} />
      </div>
    </div>
  );

  const PageNumbers = () => {
    const pages: number[] = [];
    const delta = 2;
    for (let i = Math.max(1, safeCurrentPage - delta); i <= Math.min(totalPages, safeCurrentPage + delta); i++) pages.push(i);
    return (
      <div className="flex items-center gap-1">
        {safeCurrentPage - delta > 1 && (
          <>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(1)}>1</Button>
            {safeCurrentPage - delta > 2 && <span className="text-muted-foreground px-1">…</span>}
          </>
        )}
        {pages.map(p => (
          <Button key={p} variant={p === safeCurrentPage ? 'default' : 'outline-solid'} size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(p)}>{p}</Button>
        ))}
        {safeCurrentPage + delta < totalPages && (
          <>
            {safeCurrentPage + delta < totalPages - 1 && <span className="text-muted-foreground px-1">…</span>}
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(totalPages)}>{totalPages}</Button>
          </>
        )}
      </div>
    );
  };

  const fromMilestone = fromMilestoneId ? milestones.find(m => String(m.id) === fromMilestoneId) : null;

  return (
    <div className="space-y-5">
      {/* Back to milestone link */}
      {fromMilestone && (
        <button
          onClick={() => navigate(`/projects/${projectId}/milestones`)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <Flag className="h-3.5 w-3.5 text-indigo-500" />
          {t('backToMilestone')}: <span className="font-medium text-foreground">{fromMilestone.title}</span>
        </button>
      )}

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && (
        <Alert className="bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('testPlansTitle')}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t('testPlansDescription')}</p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={handleCreateDialogClose}>
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <Plus className="h-4 w-4 mr-2" />
              {t('createTestPlan')}
            </Button>
          </DialogTrigger>
          <DialogContent isRTL={isRTL} className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('createNewTestPlan')}</DialogTitle>
              <DialogDescription>{t('createTestPlanDescription')}</DialogDescription>
            </DialogHeader>
            {renderPlanForm()}
            <DialogFooter className="gap-2">
              <span className="text-xs text-muted-foreground mr-auto">{t('ctrlEnterToSubmit')}</span>
              <Button variant="outline" onClick={() => handleCreateDialogClose(false)}>{t('cancel')}</Button>
              <Button onClick={handleCreate} disabled={!form.title.trim() || isSubmitting}>
                {isSubmitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('creating')}</> : t('createTestPlan')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Unsaved changes guard */}
        <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
          <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>{t('unsavedChanges')}</DialogTitle>
              <DialogDescription>{t('unsavedChangesMessage')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleUnsavedConfirm(false)}>{t('continueEditing')}</Button>
              <Button variant="destructive" onClick={() => handleUnsavedConfirm(true)}>{t('discardChanges')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats bar */}
      {!isLoading && testPlans.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: t('total'), value: stats.total, icon: <ClipboardList className="h-4 w-4 text-slate-500" />, color: 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700' },
            { label: t('testPlansPending'), value: stats.pending, icon: <Clock className="h-4 w-4 text-slate-500" />, color: 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700' },
            { label: t('testPlansRunning'), value: stats.running, icon: <Play className="h-4 w-4 text-blue-500" />, color: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' },
            { label: t('testPlansCompleted'), value: stats.completed, icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, color: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${color}`}>
              {icon}
              <div>
                <p className="text-xs text-muted-foreground leading-none">{label}</p>
                <p className="text-xl font-semibold mt-0.5">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('searchTestPlans')}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="pl-9"
          />
          {searchQuery && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => { setSearchQuery(''); setCurrentPage(1); }}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
          <SelectTrigger className="w-[160px] shrink-0">
            <SelectValue placeholder={t('allStatuses')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatuses')}</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{getStatusConfig(s).label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={milestoneFilter} onValueChange={(v) => { setMilestoneFilter(v); setCurrentPage(1); }}>
          <SelectTrigger className="w-[180px] shrink-0">
            <SelectValue placeholder={t('allMilestones')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allMilestones')}</SelectItem>
            <SelectItem value="none">{t('noMilestone')}</SelectItem>
            {milestones.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.title}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={`${sortBy}:${sortOrder}`} onValueChange={(v) => {
          const [col, ord] = v.split(':');
          setSortBy(col);
          setSortOrder(ord as 'asc' | 'desc');
        }}>
          <SelectTrigger className="w-[190px] shrink-0">
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

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0 text-muted-foreground gap-1">
            <X className="h-3.5 w-3.5" /> {t('clearFilters')}
          </Button>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-primary mr-3" />
          <span className="text-muted-foreground">{t('loadingTestPlans')}</span>
        </div>
      )}

      {/* Plans list */}
      {!isLoading && (
        <div className="space-y-3">
          {paginated.length > 0 ? paginated.map(plan => {
            const statusCfg = getStatusConfig(plan.status);
            return (
              <Card key={plan.id} className="hover:shadow-md transition-shadow duration-200 border">
                <CardHeader className="pb-2 pt-4 px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <Badge className={`flex items-center gap-1 text-xs px-2 py-0.5 ${statusCfg.className}`}>
                          {statusCfg.icon}
                          {statusCfg.label}
                        </Badge>
                        {plan.milestone_title && (
                          <Badge className="flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
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
                      <h3 className="font-semibold text-base leading-tight truncate">{plan.title}</h3>
                      {plan.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{plan.description}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 mt-0.5">
                      {t('testPlanCreated')} {new Date(plan.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="px-5 pb-4">
                  {/* Date range */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{formatDate(plan.target_start_date)} → {formatDate(plan.target_end_date)}</span>
                    </div>
                    {plan.actual_end_date && (
                      <div className="flex items-center gap-1.5">
                        <Target className="h-3.5 w-3.5" />
                        <span>{t('completed')} {formatDate(plan.actual_end_date)}</span>
                      </div>
                    )}
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mb-4">
                    {plan.test_objectives && (
                      <div className="sm:col-span-2">
                        <p className="text-xs font-medium text-foreground mb-0.5">{t('testPlanObjectives')}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{plan.test_objectives}</p>
                      </div>
                    )}
                    {plan.scope_inclusions && (
                      <div>
                        <p className="text-xs font-medium text-foreground mb-0.5 flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-500" />{t('scopeIn')}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{plan.scope_inclusions}</p>
                      </div>
                    )}
                    {plan.scope_exclusions && (
                      <div>
                        <p className="text-xs font-medium text-foreground mb-0.5 flex items-center gap-1"><ShieldAlert className="h-3 w-3 text-orange-500" />{t('scopeOut')}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{plan.scope_exclusions}</p>
                      </div>
                    )}
                    {plan.test_environment && (
                      <div>
                        <p className="text-xs font-medium text-foreground mb-0.5">{t('testEnvironment')}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">{plan.test_environment}</p>
                      </div>
                    )}
                    {plan.risks_assumptions && (
                      <div>
                        <p className="text-xs font-medium text-foreground mb-0.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" />{t('risksAssumptions')}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">{plan.risks_assumptions}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t">
                    <Button variant="outline" size="sm" onClick={() => openEdit(plan)}>
                      <Edit className="h-3.5 w-3.5 mr-1.5" />{t('edit')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}/test-runs?test_plan_id=${plan.id}`)}>
                      <Play className="h-3.5 w-3.5 mr-1.5" />{t('viewTestRuns')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}/reports?test_plan_id=${plan.id}`)}>
                      <BarChart3 className="h-3.5 w-3.5 mr-1.5" />{t('generateReport')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                      onClick={() => setDeleteTarget(plan)}
                      disabled={isDeleting === plan.id}
                    >
                      {isDeleting === plan.id
                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t('deleting')}</>
                        : <><Trash2 className="h-3.5 w-3.5 mr-1.5" />{t('delete')}</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          }) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <h3 className="text-sm font-semibold text-foreground">
                {hasActiveFilters ? t('noTestPlansMatchFilter') : t('noTestPlansFound')}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                {hasActiveFilters ? t('tryAdjustingSearchTerms') : t('createFirstTestPlan')}
              </p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5 mr-1.5" />{t('clearFilters')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between bg-background border rounded-lg px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {t('showing', { start: startIndex + 1, end: Math.min(startIndex + ITEMS_PER_PAGE, filtered.length), total: filtered.length })}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safeCurrentPage === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <PageNumbers />
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safeCurrentPage === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={isEditOpen} onOpenChange={handleEditDialogClose}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('editTestPlan')}</DialogTitle>
            <DialogDescription>{t('editTestPlanDescription')}</DialogDescription>
          </DialogHeader>
          {renderPlanForm(true)}
          <DialogFooter className="gap-2">
            <span className="text-xs text-muted-foreground mr-auto">{t('ctrlEnterToSubmit')}</span>
            <Button variant="outline" onClick={() => handleEditDialogClose(false)}>{t('cancel')}</Button>
            <Button onClick={handleUpdate} disabled={!form.title.trim() || isSubmitting}>
              {isSubmitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('updating')}</> : t('updateTestPlan')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit unsaved changes guard */}
      <Dialog open={showEditUnsavedDialog} onOpenChange={setShowEditUnsavedDialog}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('unsavedChanges')}</DialogTitle>
            <DialogDescription>{t('unsavedChangesMessage')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleEditUnsavedConfirm(false)}>{t('continueEditing')}</Button>
            <Button variant="destructive" onClick={() => handleEditUnsavedConfirm(true)}>{t('discardChanges')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
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
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting !== null}>{t('cancel')}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting !== null}>
              {isDeleting !== null ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('deleting')}</> : <><Trash2 className="h-4 w-4 mr-2" />{t('delete')}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
