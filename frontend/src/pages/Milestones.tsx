import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Ban,
  Bug,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Clock,
  FileCheck2,
  Gauge,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  PlayCircle,
  Plus,
  Search,
  ShieldAlert,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { milestonesAPI, testPlansAPI } from '@/lib/api';
import { Milestone, MilestoneHealth, MilestoneStats, MilestoneStatus } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { usePermissions } from '@/hooks/usePermissions';

type TFn = (key: any, params?: Record<string, string | number>) => string;
type ViewMode = 'grid' | 'list';

interface MilestoneFormState {
  title: string;
  description: string;
  targetDate: string;
  actualDate: string;
  status: MilestoneStatus;
}

const emptyStats: MilestoneStats = {
  total: 0,
  planned: 0,
  inProgress: 0,
  completed: 0,
  cancelled: 0,
  overdue: 0,
  atRisk: 0,
  testPlans: 0,
  testRuns: 0,
  testCases: 0,
  openDefects: 0,
  averageExecutionProgress: 0,
};

const defaultForm: MilestoneFormState = {
  title: '',
  description: '',
  targetDate: '',
  actualDate: '',
  status: 'planned',
};

const statusOptions: MilestoneStatus[] = ['planned', 'in_progress', 'completed', 'cancelled'];
const healthOptions: MilestoneHealth[] = ['planned', 'in_progress', 'completed', 'blocked', 'at_risk', 'cancelled'];

// Order used by the portfolio health distribution bar — left (calm) → right (done).
const healthBarOrder: MilestoneHealth[] = ['blocked', 'at_risk', 'in_progress', 'planned', 'completed', 'cancelled'];

export function Milestones() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL } = useTranslation();
  const { canWrite } = usePermissions();
  const currentProjectId = useMemo(() => parsePositiveInteger(projectId), [projectId]);

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [stats, setStats] = useState<MilestoneStats>(emptyStats);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MilestoneStatus>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | MilestoneHealth>('all');
  const [sortBy, setSortBy] = useState<'target' | 'risk' | 'progress'>('risk');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [form, setForm] = useState<MilestoneFormState>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const loadRequestId = useRef(0);

  const loadMilestones = async () => {
    if (!currentProjectId || Number.isNaN(currentProjectId)) {
      setError(t('invalidProjectId'));
      setMilestones([]);
      setStats(emptyStats);
      setIsLoading(false);
      return;
    }

    const requestId = ++loadRequestId.current;
    try {
      setIsLoading(true);
      setError(null);
      const [milestoneData, statsData] = await Promise.all([
        loadAllMilestones(currentProjectId),
        milestonesAPI.getStats(currentProjectId).catch(() => null),
      ]);

      if (requestId !== loadRequestId.current) return;

      const items = Array.isArray(milestoneData) ? milestoneData : [];
      setMilestones(items);
      setStats(statsData || calculateStats(items));
    } catch (err: any) {
      if (requestId !== loadRequestId.current) return;
      console.error('Failed to load milestones:', err);
      if (err.response?.status === 403) {
        setError(t('permissionDeniedViewMilestones'));
      } else if (err.response?.status === 404) {
        setError(t('projectNotFound'));
      } else {
        setError(t('failedToLoadMilestones'));
      }
      setMilestones([]);
      setStats(emptyStats);
    } finally {
      if (requestId === loadRequestId.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadMilestones();
    return () => {
      // Invalidate any in-flight requests when project changes / unmount
      loadRequestId.current++;
    };

  }, [currentProjectId]);

  const hasActiveFilters =
    searchQuery.trim() !== '' || statusFilter !== 'all' || healthFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setHealthFilter('all');
  };

  const filteredMilestones = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return milestones
      .filter((milestone) => {
        const matchesSearch =
          !query ||
          milestone.title.toLowerCase().includes(query) ||
          (milestone.description || '').toLowerCase().includes(query);
        const matchesStatus = statusFilter === 'all' || milestone.status === statusFilter;
        const matchesHealth = healthFilter === 'all' || milestone.health === healthFilter;
        return matchesSearch && matchesStatus && matchesHealth;
      })
      .sort((a, b) => {
        if (sortBy === 'progress') {
          return b.execution_progress - a.execution_progress;
        }
        if (sortBy === 'target') {
          return getDateValue(a.target_date) - getDateValue(b.target_date);
        }
        return getRiskWeight(b) - getRiskWeight(a);
      });
  }, [milestones, searchQuery, statusFilter, healthFilter, sortBy]);

  const healthCounts = useMemo(() => {
    const counts: Record<MilestoneHealth, number> = {
      planned: 0,
      in_progress: 0,
      completed: 0,
      blocked: 0,
      at_risk: 0,
      cancelled: 0,
    };
    for (const milestone of milestones) {
      counts[milestone.health] = (counts[milestone.health] || 0) + 1;
    }
    return counts;
  }, [milestones]);

  const openCreateDialog = () => {
    setEditingMilestone(null);
    setForm(defaultForm);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (milestone: Milestone) => {
    setEditingMilestone(milestone);
    setForm({
      title: milestone.title,
      description: milestone.description || '',
      targetDate: milestone.target_date ? toDateInputValue(milestone.target_date) : '',
      actualDate: milestone.actual_date ? toDateInputValue(milestone.actual_date) : '',
      status: milestone.status,
    });
    setFormError(null);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    if (isSubmitting) return;
    setIsDialogOpen(false);
    setEditingMilestone(null);
    setForm(defaultForm);
    setFormError(null);
  };

  const submitMilestone = async () => {
    if (!currentProjectId) return;

    const trimmedTitle = form.title.trim();
    if (!trimmedTitle) {
      setFormError(t('milestoneTitleRequired'));
      return;
    }

    // Duplicate-title guard — mirror the backend's case-insensitive per-project
    // uniqueness check so the user sees the error inline before the request.
    const lowerTitle = trimmedTitle.toLowerCase();
    const isDuplicate = milestones.some(
      (m) => m.id !== editingMilestone?.id && m.title.trim().toLowerCase() === lowerTitle,
    );
    if (isDuplicate) {
      setFormError(t('duplicateMilestoneTitle'));
      return;
    }

    // Completion guard: the backend hard-rejects (409) completing a milestone
    // while it still carries failed / blocked / not-tested results or open
    // critical defects. Block client-side with a clear reason instead of firing
    // a request that will fail.
    if (
      editingMilestone &&
      form.status === 'completed' &&
      editingMilestone.status !== 'completed' &&
      completionBlockerCount(editingMilestone) > 0
    ) {
      setFormError(t('completeMilestoneBlockedShort'));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      setFormError(null);

      // Build a base payload; only include target_date in update when actually changed
      const description = form.description.trim() || null;
      const targetDateIso = form.targetDate ? dateInputToIso(form.targetDate) : null;
      const actualDateIso = form.actualDate ? dateInputToIso(form.actualDate) : null;

      if (editingMilestone) {
        const previousTargetDate = editingMilestone.target_date ? toDateInputValue(editingMilestone.target_date) : '';
        const updatePayload: Record<string, unknown> = {
          title: trimmedTitle,
          description,
          status: form.status,
          target_date: targetDateIso,
          actual_date: actualDateIso,
        };
        await milestonesAPI.update(editingMilestone.id, updatePayload);
        if (
          form.targetDate &&
          form.targetDate !== previousTargetDate &&
          (editingMilestone.linked_test_plans || []).length > 0 &&
          window.confirm(t('syncMilestonePlanDatesConfirm', { count: editingMilestone.linked_test_plans.length }))
        ) {
          // The milestone itself already saved; a plan-date sync failure (e.g. a
          // plan whose start date is after the new target) must not surface as
          // "failed to save milestone" or block closing the dialog.
          try {
            await Promise.all(
              editingMilestone.linked_test_plans.map((plan) =>
                testPlansAPI.update(plan.id, { target_end_date: targetDateIso }),
              ),
            );
          } catch (syncErr) {
            console.warn('Milestone saved, but syncing linked plan dates failed:', syncErr);
          }
        }
      } else {
        await milestonesAPI.create({
          title: trimmedTitle,
          description: description ?? undefined,
          target_date: targetDateIso ?? undefined,
          actual_date: actualDateIso ?? undefined,
          status: form.status,
          project_id: currentProjectId,
        });
      }

      closeDialog();
      await loadMilestones();
    } catch (err: any) {
      console.error('Failed to save milestone:', err);
      if (err.response?.status === 403) {
        setFormError(t('permissionDeniedSaveMilestone'));
      } else if (err.response?.data?.detail) {
        setFormError(typeof err.response.data.detail === 'string'
          ? err.response.data.detail
          : t('failedToSaveMilestone'));
      } else {
        setFormError(t('failedToSaveMilestone'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteMilestone = async (milestone: Milestone) => {
    if (milestone.test_plan_count > 0 || milestone.test_run_count > 0) {
      setError(t('unlinkMilestoneLinksBeforeDelete'));
      return;
    }

    if (!window.confirm(t('confirmDeleteMilestone', { title: milestone.title }))) return;

    try {
      setError(null);
      await milestonesAPI.delete(milestone.id);
      await loadMilestones();
    } catch (err: any) {
      console.error('Failed to delete milestone:', err);
      if (err.response?.status === 409) {
        setError(err.response?.data?.detail || t('unlinkMilestoneLinksBeforeDelete'));
      } else if (err.response?.status === 403) {
        setError(t('permissionDeniedDeleteMilestone'));
      } else {
        setError(t('failedToDeleteMilestone'));
      }
    }
  };

  const activeCount = Math.max(0, stats.total - stats.completed - stats.cancelled);
  const completedPct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  const sharedCardProps = {
    t,
    isRTL,
    projectId: currentProjectId,
    navigate,
    onEdit: openEditDialog,
    onDelete: deleteMilestone,
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── Hero: identity + portfolio glance ──────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-sm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.10),transparent_36%),radial-gradient(circle_at_bottom_left,hsl(var(--primary)/0.06),transparent_40%)]" />
        <div className="relative space-y-6 p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <Badge className="w-fit gap-1.5 border border-primary/30 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/15">
                <Target className="h-3.5 w-3.5" />
                {t('testProcessMilestones')}
              </Badge>
              <div>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('milestones')}</h1>
                <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t('milestonesProcessSubtitle')}</p>
              </div>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? setIsDialogOpen(true) : closeDialog())}>
              {canWrite && (
                <DialogTrigger asChild>
                  <Button size="lg" className="gap-2 shadow-sm" onClick={openCreateDialog} disabled={!currentProjectId}>
                    <Plus className="h-4 w-4" />
                    {t('addMilestone')}
                  </Button>
                </DialogTrigger>
              )}
              <MilestoneFormDialog
                t={t}
                isRTL={isRTL}
                editing={editingMilestone}
                existingMilestones={milestones}
                form={form}
                setForm={setForm}
                formError={formError}
                isSubmitting={isSubmitting}
                onCancel={closeDialog}
                onSubmit={submitMilestone}
              />
            </Dialog>
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <HeroStat icon={Target} label={t('activeMilestones')} value={activeCount} hint={t('totalMilestonesCount', { count: stats.total })} />
            <HeroStat icon={Gauge} label={t('executionProgress')} value={`${stats.averageExecutionProgress}%`} hint={t('fromLinkedTestRuns')} tone="primary" />
            <HeroStat icon={ShieldAlert} label={t('qualityRisks')} value={stats.atRisk} hint={t('openDefectsCount', { count: stats.openDefects })} tone={stats.atRisk > 0 ? 'amber' : 'default'} />
            <HeroStat icon={Clock} label={t('milestoneOverdue')} value={stats.overdue} hint={t('pastTargetDate')} tone={stats.overdue > 0 ? 'red' : 'default'} />
            <HeroStat icon={CheckCircle2} label={t('milestoneStatusCompleted')} value={stats.completed} hint={t('percentOfPortfolio', { value: completedPct })} tone={stats.completed > 0 ? 'emerald' : 'default'} />
          </div>

          {/* Health distribution bar */}
          {milestones.length > 0 && <HealthDistribution counts={healthCounts} total={milestones.length} t={t} />}
        </div>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Toolbar: search · filters · view ───────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isRTL ? 'right-3' : 'left-3'}`} />
          <Input
            value={searchQuery}
            placeholder={t('searchMilestones')}
            className={`h-10 border-transparent bg-muted/50 focus-visible:bg-background ${isRTL ? 'pr-9' : 'pl-9'}`}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:items-center">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | MilestoneStatus)}>
            <SelectTrigger className="h-10 lg:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatuses')}</SelectItem>
              {statusOptions.map((status) => (
                <SelectItem key={status} value={status}>{statusMeta(status, t).label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={healthFilter} onValueChange={(value) => setHealthFilter(value as 'all' | MilestoneHealth)}>
            <SelectTrigger className="h-10 lg:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allHealthStates')}</SelectItem>
              {healthOptions.map((health) => (
                <SelectItem key={health} value={health}>{healthMeta(health, t).label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'target' | 'risk' | 'progress')}>
            <SelectTrigger className="h-10 lg:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="risk">{t('sortByRisk')}</SelectItem>
              <SelectItem value="target">{t('sortByTargetDate')}</SelectItem>
              <SelectItem value="progress">{t('sortByProgress')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Segmented view toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1 lg:ml-auto">
          <ViewToggleButton active={viewMode === 'grid'} onClick={() => setViewMode('grid')} icon={LayoutGrid} label={t('gridView')} />
          <ViewToggleButton active={viewMode === 'list'} onClick={() => setViewMode('list')} icon={List} label={t('listView')} />
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      {isLoading ? (
        <MilestoneSkeletons viewMode={viewMode} />
      ) : filteredMilestones.length === 0 ? (
        <EmptyState
          t={t}
          hasFilters={hasActiveFilters}
          onCreate={openCreateDialog}
          onClear={clearFilters}
          disabled={!currentProjectId}
        />
      ) : (
        <div className="space-y-3">
          <p className="px-1 text-xs text-muted-foreground">
            {t('showingMilestones', { shown: filteredMilestones.length, total: milestones.length })}
          </p>
          {viewMode === 'grid' ? (
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredMilestones.map((milestone) => (
                <MilestoneCard key={milestone.id} milestone={milestone} {...sharedCardProps} />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border">
              {filteredMilestones.map((milestone) => (
                <MilestoneRow key={milestone.id} milestone={milestone} {...sharedCardProps} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Presentational subcomponents
   ════════════════════════════════════════════════════════════════════════ */

type CardProps = {
  milestone: Milestone;
  t: TFn;
  isRTL: boolean;
  projectId: number | null;
  navigate: (path: string) => void;
  onEdit: (milestone: Milestone) => void;
  onDelete: (milestone: Milestone) => void;
};

function HeroStat({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof Target;
  label: string;
  value: string | number;
  hint: string;
  tone?: 'default' | 'primary' | 'amber' | 'red' | 'emerald';
}) {
  const toneChip: Record<string, string> = {
    default: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/10 text-primary',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  };
  return (
    <div className="rounded-2xl border border-border bg-background/60 p-4 backdrop-blur-sm transition hover:border-foreground/15">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${toneChip[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function HealthDistribution({ counts, total, t }: { counts: Record<MilestoneHealth, number>; total: number; t: TFn }) {
  const present = healthBarOrder.filter((health) => counts[health] > 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('healthDistribution')}</span>
        <span className="text-xs text-muted-foreground">{t('totalMilestonesCount', { count: total })}</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {present.map((health) => (
          <div
            key={health}
            className={`${getHealthBarClass(health)} transition-all`}
            style={{ width: `${(counts[health] / total) * 100}%` }}
            title={`${healthMeta(health, t).label}: ${counts[health]}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {present.map((health) => (
          <span key={health} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${getHealthBarClass(health)}`} />
            {healthMeta(health, t).label}
            <span className="font-semibold text-foreground">{counts[health]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutGrid;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MilestoneActionsMenu({ milestone, t, projectId, navigate, onEdit, onDelete }: CardProps) {
  const linked = milestone.test_plan_count > 0 || milestone.test_run_count > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={t('manageMilestone')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onEdit(milestone)}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          {t('editMilestone')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/milestones/${milestone.project_seq ?? milestone.id}`)}>
          <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
          {t('openMilestoneDetail')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/test-plans?milestone_id=${milestone.id}&create=1`)}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          {t('createTestPlan')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/test-plans?milestone_id=${milestone.id}`)}>
          <ClipboardList className="mr-2 h-3.5 w-3.5" />
          {t('viewTestPlans')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/test-runs?milestone_id=${milestone.id}`)}>
          <PlayCircle className="mr-2 h-3.5 w-3.5" />
          {t('viewTestRuns')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/defects?milestone_id=${milestone.id}`)}>
          <Bug className="mr-2 h-3.5 w-3.5" />
          {t('viewDefects')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/projects/${projectId}/requirements?milestone_id=${milestone.id}`)}>
          <FileCheck2 className="mr-2 h-3.5 w-3.5" />
          {t('viewRequirements')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={linked}
          onClick={() => onDelete(milestone)}
          className="text-red-600 focus:text-red-700 dark:text-red-400"
          title={linked ? t('unlinkMilestoneLinksBeforeDelete') : undefined}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MilestoneCard(props: CardProps) {
  const { milestone, t, isRTL, projectId, navigate } = props;
  const health = healthMeta(milestone.health, t);
  const status = statusMeta(milestone.status, t);
  const HealthIcon = health.icon;
  const days = getDaysRemaining(milestone.target_date);
  const goDetail = () => navigate(`/projects/${projectId}/milestones/${milestone.project_seq ?? milestone.id}`);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1 ${getHealthBarClass(milestone.health)}`} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={`gap-1 ${health.className}`}>
              <HealthIcon className="h-3 w-3" />
              {health.label}
            </Badge>
            <ScheduleBadge days={days} milestone={milestone} t={t} />
          </div>
          <MilestoneActionsMenu {...props} />
        </div>

        {/* Title + description */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={goDetail}
            className={`block w-full ${isRTL ? 'text-right' : 'text-left'}`}
            title={t('openMilestoneDetail')}
          >
            <h3 className="truncate text-lg font-semibold tracking-tight transition group-hover:text-primary">
              {milestone.title}
            </h3>
          </button>
          {milestone.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{milestone.description}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground/60">{status.label}</p>
          )}
        </div>

        {/* Execution */}
        <div className="space-y-2 rounded-xl bg-muted/40 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">{t('executionProgress')}</span>
            <span className="font-semibold text-foreground">{clampPercent(milestone.execution_progress)}%</span>
          </div>
          <ResultBar milestone={milestone} />
          <ResultLegend milestone={milestone} t={t} />
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-4 gap-2">
          <MiniMetric label={t('testPlans')} value={milestone.test_plan_count} icon={ClipboardList} />
          <MiniMetric label={t('testRuns')} value={milestone.test_run_count} icon={PlayCircle} />
          <MiniMetric label={t('testCases')} value={milestone.test_case_count} icon={FileCheck2} />
          <MiniMetric label={t('openDefects')} value={milestone.open_defect_count} icon={Bug} warning={milestone.open_defect_count > 0} />
        </div>

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {milestone.target_date ? formatDate(milestone.target_date) : t('noTargetDate')}
          </span>
          {milestone.test_plan_count === 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => navigate(`/projects/${projectId}/test-plans?milestone_id=${milestone.id}&create=1`)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('createTestPlan')}
            </Button>
          ) : (
            <Button size="sm" className="gap-1.5" onClick={goDetail}>
              {t('openMilestoneDetail')}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function MilestoneRow(props: CardProps) {
  const { milestone, t, isRTL, projectId, navigate } = props;
  const health = healthMeta(milestone.health, t);
  const HealthIcon = health.icon;
  const days = getDaysRemaining(milestone.target_date);
  const goDetail = () => navigate(`/projects/${projectId}/milestones/${milestone.project_seq ?? milestone.id}`);

  return (
    <div className="group flex items-center gap-4 p-4 transition hover:bg-muted/40">
      <span className={`hidden h-10 w-1 shrink-0 rounded-full sm:block ${getHealthBarClass(milestone.health)}`} />

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={goDetail}
          className={`block max-w-full truncate font-semibold tracking-tight transition group-hover:text-primary ${isRTL ? 'text-right' : 'text-left'}`}
          title={t('openMilestoneDetail')}
        >
          {milestone.title}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge className={`gap-1 ${health.className}`}>
            <HealthIcon className="h-3 w-3" />
            {health.label}
          </Badge>
          <ScheduleBadge days={days} milestone={milestone} t={t} />
        </div>
      </div>

      {/* Progress */}
      <div className="hidden w-40 shrink-0 md:block">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t('executionProgress')}</span>
          <span className="font-semibold">{clampPercent(milestone.execution_progress)}%</span>
        </div>
        <ResultBar milestone={milestone} />
      </div>

      {/* Pass rate */}
      <div className="hidden w-16 shrink-0 text-center lg:block">
        <div className="text-base font-bold">{milestone.pass_rate}%</div>
        <div className="text-[11px] text-muted-foreground">{t('passRate')}</div>
      </div>

      {/* Counts */}
      <div className="hidden shrink-0 items-center gap-4 text-sm xl:flex">
        <RowCount value={milestone.test_plan_count} icon={ClipboardList} label={t('testPlans')} />
        <RowCount value={milestone.test_run_count} icon={PlayCircle} label={t('testRuns')} />
        <RowCount value={milestone.open_defect_count} icon={Bug} label={t('openDefects')} warning={milestone.open_defect_count > 0} />
      </div>

      <MilestoneActionsMenu {...props} />
    </div>
  );
}

function ResultBar({ milestone }: { milestone: Milestone }) {
  const { passed_count: passed, failed_count: failed, blocked_count: blocked, not_started_count: notStarted } = milestone;
  const total = passed + failed + blocked + notStarted;
  if (total === 0) {
    return <div className="h-2 w-full rounded-full bg-muted" />;
  }
  const seg = (value: number, className: string, key: string) =>
    value > 0 ? <div key={key} className={className} style={{ width: `${(value / total) * 100}%` }} /> : null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {seg(passed, 'bg-emerald-500', 'p')}
      {seg(failed, 'bg-red-500', 'f')}
      {seg(blocked, 'bg-amber-500', 'b')}
      {seg(notStarted, 'bg-slate-300 dark:bg-slate-600', 'n')}
    </div>
  );
}

function ResultLegend({ milestone, t }: { milestone: Milestone; t: TFn }) {
  const items = [
    { color: 'bg-emerald-500', label: t('passed'), value: milestone.passed_count },
    { color: 'bg-red-500', label: t('failed'), value: milestone.failed_count },
    { color: 'bg-amber-500', label: t('blocked'), value: milestone.blocked_count },
    { color: 'bg-slate-300 dark:bg-slate-600', label: t('notStarted'), value: milestone.not_started_count },
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${item.color}`} />
          {item.label}
          <span className="font-semibold text-foreground">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

function MiniMetric({ label, value, icon: Icon, warning = false }: { label: string; value: number; icon: typeof Target; warning?: boolean }) {
  return (
    <div className={`rounded-xl border p-2.5 ${warning ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30' : 'border-border bg-background'}`}>
      <Icon className={`mb-1.5 h-3.5 w-3.5 ${warning ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`} />
      <div className="text-base font-semibold leading-none">{value}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function RowCount({ value, icon: Icon, label, warning = false }: { value: number; icon: typeof Target; label: string; warning?: boolean }) {
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <Icon className={`h-4 w-4 ${warning && value > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`} />
      <span className={`font-semibold ${warning && value > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</span>
    </span>
  );
}

function ScheduleBadge({ days, milestone, t }: { days: number | null; milestone: Milestone; t: TFn }) {
  if (milestone.status === 'completed') {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        {milestone.actual_date ? t('completedOn', { date: formatDate(milestone.actual_date) }) : t('completed')}
      </Badge>
    );
  }
  if (milestone.status === 'cancelled') {
    return <Badge variant="outline" className="gap-1 text-muted-foreground"><Ban className="h-3 w-3" />{t('cancelled')}</Badge>;
  }
  if (days === null) {
    return <Badge variant="outline" className="gap-1 text-muted-foreground"><CalendarDays className="h-3 w-3" />{t('noTargetDate')}</Badge>;
  }
  if (days < 0) {
    return (
      <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
        <Clock className="h-3 w-3" />
        {t('daysOverdue', { count: Math.abs(days) })}
      </Badge>
    );
  }
  const soon = days <= 7;
  return (
    <Badge
      variant="outline"
      className={`gap-1 ${soon ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300' : 'text-muted-foreground'}`}
    >
      <Clock className="h-3 w-3" />
      {days === 0 ? t('dueToday') : t('daysRemaining', { count: days })}
    </Badge>
  );
}

function EmptyState({
  t,
  hasFilters,
  onCreate,
  onClear,
  disabled,
}: {
  t: TFn;
  hasFilters: boolean;
  onCreate: () => void;
  onClear: () => void;
  disabled: boolean;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-72 flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <Target className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('noMilestonesFound')}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {hasFilters ? t('noMilestonesMatchFilters') : t('noMilestonesFoundDescription')}
          </p>
        </div>
        {hasFilters ? (
          <Button variant="outline" onClick={onClear}>{t('clearFilters')}</Button>
        ) : (
          <Button className="gap-2" onClick={onCreate} disabled={disabled}>
            <Plus className="h-4 w-4" />
            {t('addMilestone')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function MilestoneSkeletons({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'list') {
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <div className="h-10 w-1 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="hidden h-2 w-40 animate-pulse rounded-full bg-muted md:block" />
            <div className="h-8 w-8 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex justify-between">
            <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MilestoneFormDialog({
  t,
  isRTL,
  editing,
  existingMilestones,
  form,
  setForm,
  formError,
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  t: TFn;
  isRTL: boolean;
  editing: Milestone | null;
  existingMilestones: Milestone[];
  form: MilestoneFormState;
  setForm: React.Dispatch<React.SetStateAction<MilestoneFormState>>;
  formError: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const TITLE_MAX = 255;
  const DESC_MAX = 5000;
  const trimmedTitle = form.title.trim();

  // Live duplicate check — mirror the backend's case-insensitive per-project rule.
  const isDuplicate =
    trimmedTitle.length > 0 &&
    existingMilestones.some(
      (m) => m.id !== editing?.id && m.title.trim().toLowerCase() === trimmedTitle.toLowerCase(),
    );

  // Completion readiness — only meaningful when transitioning an existing
  // milestone to "completed"; the backend rejects it while work remains.
  const isCompleting = !!editing && form.status === 'completed' && editing.status !== 'completed';
  const blockers = editing ? completionBlockers(editing).filter((b) => b.value > 0) : [];
  const completionBlocked = isCompleting && blockers.length > 0;

  const targetDays = form.targetDate ? getDaysRemaining(form.targetDate) : null;
  const submitDisabled = !trimmedTitle || isSubmitting || isDuplicate || completionBlocked;

  const update = (patch: Partial<MilestoneFormState>) => setForm((current) => ({ ...current, ...patch }));

  const blockerLabel: Record<string, string> = {
    failed: t('failed'),
    blocked: t('blocked'),
    notStarted: t('notStarted'),
    critical: t('critical'),
  };

  return (
    <DialogContent isRTL={isRTL} className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
      {/* Header */}
      <DialogHeader className="space-y-0 border-b border-border p-6">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Target className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <DialogTitle className="text-lg">{editing ? t('editMilestone') : t('createMilestone')}</DialogTitle>
            <DialogDescription className="text-sm">{t('milestoneDialogDescription')}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {/* Body */}
      <div className="space-y-5 p-6">
        {/* Title */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="milestone-title">{t('milestoneTitle')}</Label>
            <span className={`text-xs tabular-nums ${form.title.length >= TITLE_MAX ? 'text-red-600' : 'text-muted-foreground'}`}>
              {form.title.length}/{TITLE_MAX}
            </span>
          </div>
          <Input
            id="milestone-title"
            value={form.title}
            maxLength={TITLE_MAX}
            placeholder={t('milestoneTitlePlaceholder')}
            aria-invalid={isDuplicate}
            className={isDuplicate ? 'border-red-400 focus-visible:ring-red-400/40' : undefined}
            onChange={(event) => update({ title: event.target.value })}
          />
          {isDuplicate && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-red-600">
              <AlertCircle className="h-3.5 w-3.5" />
              {t('duplicateMilestoneTitle')}
            </p>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="milestone-description" className="flex items-center gap-2">
              {t('description')}
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                {t('milestoneFormOptional')}
              </span>
            </Label>
            <span className={`text-xs tabular-nums ${form.description.length >= DESC_MAX ? 'text-red-600' : 'text-muted-foreground'}`}>
              {form.description.length}/{DESC_MAX}
            </span>
          </div>
          <Textarea
            id="milestone-description"
            value={form.description}
            maxLength={DESC_MAX}
            placeholder={t('milestoneDescriptionPlaceholder')}
            rows={3}
            onChange={(event) => update({ description: event.target.value })}
          />
        </div>

        {/* Status — segmented selector */}
        <div className="space-y-2">
          <Label>{t('pickStatus')}</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {statusOptions.map((status) => {
              const meta = statusMeta(status, t);
              const StatusIcon = meta.icon;
              const active = form.status === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => update({ status })}
                  aria-pressed={active}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs font-medium transition ${
                    active
                      ? `${meta.className} ring-2 ring-primary/30`
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <StatusIcon className="h-4 w-4" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dates */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="milestone-target">{t('targetDate')}</Label>
            <div className="relative">
              <CalendarDays className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isRTL ? 'right-3' : 'left-3'}`} />
              <Input
                id="milestone-target"
                type="date"
                value={form.targetDate}
                className={isRTL ? 'pr-9' : 'pl-9'}
                onChange={(event) => update({ targetDate: event.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {targetDays !== null && form.status !== 'completed' && form.status !== 'cancelled'
                ? scheduleHint(targetDays, t)
                : t('targetDateHint')}
            </p>
          </div>

          {(form.status === 'completed' || form.actualDate) && (
            <div className="space-y-2">
              <Label htmlFor="milestone-actual">{t('actualDate')}</Label>
              <div className="relative">
                <CheckCircle2 className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isRTL ? 'right-3' : 'left-3'}`} />
                <Input
                  id="milestone-actual"
                  type="date"
                  value={form.actualDate}
                  className={isRTL ? 'pr-9' : 'pl-9'}
                  onChange={(event) => update({ actualDate: event.target.value })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Completion readiness */}
        {isCompleting && (
          <div
            className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm ${
              completionBlocked
                ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30'
                : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30'
            }`}
          >
            {completionBlocked ? (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <div className="space-y-2">
              <p className={`font-medium ${completionBlocked ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
                {t('completionReadiness')}
              </p>
              {completionBlocked ? (
                <>
                  <p className="text-amber-700 dark:text-amber-300/90">{t('completeMilestoneBlockedShort')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {blockers.map((b) => (
                      <span
                        key={b.key}
                        className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      >
                        {b.value} {blockerLabel[b.key]}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-emerald-700 dark:text-emerald-300/90">{t('readyToComplete')}</p>
              )}
            </div>
          </div>
        )}

        {formError && !isDuplicate && !completionBlocked && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Footer */}
      <DialogFooter className="border-t border-border p-6">
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>{t('cancel')}</Button>
        <Button onClick={onSubmit} disabled={submitDisabled} className="gap-2">
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? t('updateMilestone') : t('createMilestone')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function scheduleHint(days: number, t: TFn): string {
  if (days < 0) return t('daysOverdue', { count: Math.abs(days) });
  if (days === 0) return t('dueToday');
  return t('daysRemaining', { count: days });
}

/* ════════════════════════════════════════════════════════════════════════
   Meta + helpers
   ════════════════════════════════════════════════════════════════════════ */

function statusMeta(status: MilestoneStatus, t: TFn) {
  const map = {
    planned: { label: t('milestoneStatusPlanned'), className: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700', icon: CircleDashed },
    in_progress: { label: t('milestoneStatusInProgress'), className: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800', icon: PlayCircle },
    completed: { label: t('milestoneStatusCompleted'), className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800', icon: CheckCircle2 },
    cancelled: { label: t('milestoneStatusCancelled'), className: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/50 dark:text-zinc-400 dark:border-zinc-700', icon: Ban },
  } satisfies Record<MilestoneStatus, { label: string; className: string; icon: typeof CircleDashed }>;
  return map[status];
}

function healthMeta(health: MilestoneHealth, t: TFn) {
  const map = {
    planned: { label: t('milestoneHealthPlanned'), className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', icon: CircleDashed },
    in_progress: { label: t('milestoneHealthInProgress'), className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: Activity },
    completed: { label: t('milestoneHealthCompleted'), className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: CheckCircle2 },
    blocked: { label: t('milestoneHealthBlocked'), className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: ShieldAlert },
    at_risk: { label: t('milestoneHealthAtRisk'), className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: AlertCircle },
    cancelled: { label: t('milestoneHealthCancelled'), className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400', icon: XCircle },
  } satisfies Record<MilestoneHealth, { label: string; className: string; icon: typeof CircleDashed }>;
  return map[health] || map.planned;
}

function calculateStats(milestones: Milestone[]): MilestoneStats {
  const active = milestones.filter((milestone) => milestone.status !== 'cancelled');
  return {
    total: milestones.length,
    planned: milestones.filter((milestone) => milestone.status === 'planned').length,
    inProgress: milestones.filter((milestone) => milestone.status === 'in_progress').length,
    completed: milestones.filter((milestone) => milestone.status === 'completed').length,
    cancelled: milestones.filter((milestone) => milestone.status === 'cancelled').length,
    overdue: milestones.filter((milestone) => milestone.is_overdue).length,
    atRisk: milestones.filter((milestone) => ['at_risk', 'blocked'].includes(milestone.health)).length,
    testPlans: milestones.reduce((sum, milestone) => sum + milestone.test_plan_count, 0),
    testRuns: milestones.reduce((sum, milestone) => sum + milestone.test_run_count, 0),
    testCases: milestones.reduce((sum, milestone) => sum + milestone.test_case_count, 0),
    openDefects: milestones.reduce((sum, milestone) => sum + milestone.open_defect_count, 0),
    averageExecutionProgress: active.length
      ? Math.round(active.reduce((sum, milestone) => sum + milestone.execution_progress, 0) / active.length)
      : 0,
  };
}

function parsePositiveInteger(value?: string): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadAllMilestones(projectId: number): Promise<Milestone[]> {
  const pageSize = 500;
  const items: Milestone[] = [];
  for (let skip = 0; skip < 5000; skip += pageSize) {
    const page = await milestonesAPI.getAll(projectId, skip, pageSize);
    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...page);
    if (page.length < pageSize) break;
  }
  return items;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

// Mirrors the backend completion guard: a milestone may only be marked
// completed once it has no failed / blocked / not-tested results and no open
// critical defects.
function completionBlockers(milestone: Milestone) {
  return [
    { key: 'failed', value: milestone.failed_count },
    { key: 'blocked', value: milestone.blocked_count },
    { key: 'notStarted', value: milestone.not_started_count },
    { key: 'critical', value: milestone.critical_defect_count },
  ] as const;
}

function completionBlockerCount(milestone: Milestone) {
  return completionBlockers(milestone).reduce((sum, item) => sum + (item.value || 0), 0);
}

function getDateValue(value?: string) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

/**
 * Convert an ISO timestamp from the API into a YYYY-MM-DD value for an <input type="date">,
 * using the date portion of the original UTC timestamp so the value round-trips unchanged.
 */
function toDateInputValue(isoString: string): string {
  // Server stores target_date as midnight UTC of the chosen day; slicing avoids local-tz drift
  const head = isoString.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : '';
}

/**
 * Convert a date-input value (YYYY-MM-DD) to an ISO timestamp anchored at noon UTC so that
 * formatting it back to a local date never crosses a day boundary in either direction.
 */
function dateInputToIso(value: string): string {
  return `${value}T12:00:00.000Z`;
}

function getRiskWeight(milestone: Milestone) {
  const healthWeight: Record<MilestoneHealth, number> = {
    blocked: 6,
    at_risk: 5,
    in_progress: 4,
    planned: 3,
    completed: 2,
    cancelled: 1,
  };
  return (healthWeight[milestone.health] || 0) + (milestone.is_overdue ? 2 : 0) + Math.min(milestone.critical_defect_count, 3);
}

function getDaysRemaining(targetDate?: string) {
  if (!targetDate) return null;
  // Compare against the date portion in UTC so a target stored at UTC midnight
  // isn't shown as "yesterday" / overdue for users west of UTC.
  const datePart = targetDate.slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(datePart);
  if (!parts) return null;
  const targetUtc = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((targetUtc - todayUtc) / 86400000);
}

function getHealthBarClass(health: MilestoneHealth) {
  const map: Record<MilestoneHealth, string> = {
    planned: 'bg-slate-400',
    in_progress: 'bg-blue-500',
    completed: 'bg-emerald-500',
    blocked: 'bg-red-600',
    at_risk: 'bg-amber-500',
    cancelled: 'bg-zinc-400',
  };
  return map[health] || map.planned;
}

function formatDate(value: string) {
  // Render the UTC date portion in the user's locale without tz-shifting day boundaries
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (parts) {
    const utcMidday = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12));
    return utcMidday.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  const fallback = new Date(value);
  return Number.isFinite(fallback.getTime()) ? fallback.toLocaleDateString() : '';
}
