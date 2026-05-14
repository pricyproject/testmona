import { useEffect, useMemo, useState } from 'react';
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
  FileCheck2,
  Gauge,
  Loader2,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { milestonesAPI } from '@/lib/api';
import { Milestone, MilestoneHealth, MilestoneStats, MilestoneStatus } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

interface MilestoneFormState {
  title: string;
  description: string;
  targetDate: string;
  status: MilestoneStatus;
  progress: number;
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
  status: 'planned',
  progress: 0,
};

const statusOptions: MilestoneStatus[] = ['planned', 'in_progress', 'completed', 'cancelled'];
const healthOptions: MilestoneHealth[] = ['planned', 'in_progress', 'completed', 'blocked', 'at_risk', 'cancelled'];

export function Milestones() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL } = useTranslation();
  const currentProjectId = projectId ? Number(projectId) : null;

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [stats, setStats] = useState<MilestoneStats>(emptyStats);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MilestoneStatus>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | MilestoneHealth>('all');
  const [sortBy, setSortBy] = useState<'target' | 'risk' | 'progress'>('risk');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [form, setForm] = useState<MilestoneFormState>(defaultForm);

  const loadMilestones = async () => {
    if (!currentProjectId || Number.isNaN(currentProjectId)) {
      setError(t('invalidProjectId'));
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const [milestoneData, statsData] = await Promise.all([
        milestonesAPI.getAll(currentProjectId, 0, 500),
        milestonesAPI.getStats(currentProjectId).catch(() => null),
      ]);

      setMilestones(milestoneData || []);
      setStats(statsData || calculateStats(milestoneData || []));
    } catch (err: any) {
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
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMilestones();
  }, [currentProjectId]);

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

  const openCreateDialog = () => {
    setEditingMilestone(null);
    setForm(defaultForm);
    setIsDialogOpen(true);
  };

  const openEditDialog = (milestone: Milestone) => {
    setEditingMilestone(milestone);
    setForm({
      title: milestone.title,
      description: milestone.description || '',
      targetDate: milestone.target_date ? milestone.target_date.slice(0, 10) : '',
      status: milestone.status,
      progress: milestone.progress_percentage || milestone.execution_progress || 0,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    if (isSubmitting) return;
    setIsDialogOpen(false);
    setEditingMilestone(null);
    setForm(defaultForm);
  };

  const submitMilestone = async () => {
    if (!currentProjectId || !form.title.trim()) return;

    try {
      setIsSubmitting(true);
      setError(null);
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        target_date: form.targetDate ? new Date(form.targetDate).toISOString() : undefined,
        status: form.status,
        progress_percentage: form.progress,
      };

      if (editingMilestone) {
        await milestonesAPI.update(editingMilestone.id, payload);
      } else {
        await milestonesAPI.create({
          ...payload,
          project_id: currentProjectId,
        });
      }

      closeDialog();
      await loadMilestones();
    } catch (err: any) {
      console.error('Failed to save milestone:', err);
      if (err.response?.status === 403) {
        setError(t('permissionDeniedSaveMilestone'));
      } else if (err.response?.data?.detail) {
        setError(String(err.response.data.detail));
      } else {
        setError(t('failedToSaveMilestone'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteMilestone = async (milestone: Milestone) => {
    if (milestone.test_plan_count > 0) {
      setError(t('unlinkPlansBeforeDelete'));
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
        setError(t('unlinkPlansBeforeDelete'));
      } else if (err.response?.status === 403) {
        setError(t('permissionDeniedDeleteMilestone'));
      } else {
        setError(t('failedToDeleteMilestone'));
      }
    }
  };

  const statusMeta = (status: MilestoneStatus) => {
    const map = {
      planned: { label: t('milestoneStatusPlanned'), className: 'bg-slate-100 text-slate-700 border-slate-200', icon: CircleDashed },
      in_progress: { label: t('milestoneStatusInProgress'), className: 'bg-blue-100 text-blue-700 border-blue-200', icon: PlayCircle },
      completed: { label: t('milestoneStatusCompleted'), className: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
      cancelled: { label: t('milestoneStatusCancelled'), className: 'bg-zinc-100 text-zinc-700 border-zinc-200', icon: Ban },
    } satisfies Record<MilestoneStatus, { label: string; className: string; icon: typeof CircleDashed }>;

    return map[status];
  };

  const healthMeta = (health: MilestoneHealth) => {
    const map = {
      planned: { label: t('milestoneHealthPlanned'), className: 'bg-slate-500 text-white', icon: CircleDashed },
      in_progress: { label: t('milestoneHealthInProgress'), className: 'bg-blue-600 text-white', icon: Activity },
      completed: { label: t('milestoneHealthCompleted'), className: 'bg-emerald-600 text-white', icon: CheckCircle2 },
      blocked: { label: t('milestoneHealthBlocked'), className: 'bg-red-600 text-white', icon: ShieldAlert },
      at_risk: { label: t('milestoneHealthAtRisk'), className: 'bg-amber-500 text-white', icon: AlertCircle },
      cancelled: { label: t('milestoneHealthCancelled'), className: 'bg-zinc-500 text-white', icon: XCircle },
    } satisfies Record<MilestoneHealth, { label: string; className: string; icon: typeof CircleDashed }>;

    return map[health] || map.planned;
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="relative overflow-hidden rounded-[2rem] border border-border bg-card text-card-foreground shadow-sm">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.12),transparent_30%),radial-gradient(circle_at_bottom_left,hsl(var(--accent)/0.18),transparent_32%)]" />
        <div className="relative p-6 sm:p-8">
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <Badge className="w-fit border border-primary/30 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/15">
                <Target className="mr-2 h-3.5 w-3.5" />
                {t('testProcessMilestones')}
              </Badge>
              <div>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('milestones')}</h1>
                <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t('milestonesProcessSubtitle')}</p>
              </div>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? setIsDialogOpen(true) : closeDialog())}>
              <DialogTrigger asChild>
                <Button onClick={openCreateDialog} disabled={!currentProjectId}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('addMilestone')}
                </Button>
              </DialogTrigger>
              <DialogContent isRTL={isRTL} className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{editingMilestone ? t('editMilestone') : t('createMilestone')}</DialogTitle>
                  <DialogDescription>{t('milestoneDialogDescription')}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="milestone-title">{t('milestoneTitle')}</Label>
                    <Input
                      id="milestone-title"
                      value={form.title}
                      maxLength={255}
                      placeholder={t('milestoneTitlePlaceholder')}
                      onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="milestone-description">{t('description')}</Label>
                    <Textarea
                      id="milestone-description"
                      value={form.description}
                      maxLength={5000}
                      placeholder={t('milestoneDescriptionPlaceholder')}
                      rows={4}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="milestone-target">{t('targetDate')}</Label>
                      <Input
                        id="milestone-target"
                        type="date"
                        value={form.targetDate}
                        onChange={(event) => setForm((current) => ({ ...current, targetDate: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('status')}</Label>
                      <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value as MilestoneStatus }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((status) => (
                            <SelectItem key={status} value={status}>{statusMeta(status).label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="milestone-progress">{t('manualProgress')}</Label>
                      <Input
                        id="milestone-progress"
                        type="number"
                        min={0}
                        max={100}
                        value={form.progress}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          progress: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                        }))}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={closeDialog} disabled={isSubmitting}>{t('cancel')}</Button>
                  <Button onClick={submitMilestone} disabled={!form.title.trim() || isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingMilestone ? t('updateMilestone') : t('createMilestone')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard title={t('activeMilestones')} value={stats.total - stats.completed - stats.cancelled} detail={t('totalMilestonesCount', { count: stats.total })} icon={Target} />
        <MetricCard title={t('executionProgress')} value={`${stats.averageExecutionProgress}%`} detail={t('fromLinkedTestRuns')} icon={Gauge} />
        <MetricCard title={t('linkedTestPlans')} value={stats.testPlans} detail={t('testRunsCount', { count: stats.testRuns })} icon={ClipboardList} />
        <MetricCard title={t('coveredTestCases')} value={stats.testCases} detail={t('requirementsCount', { count: getTotalRequirements(milestones) })} icon={FileCheck2} />
        <MetricCard title={t('qualityRisks')} value={stats.atRisk} detail={t('openDefectsCount', { count: stats.openDefects })} icon={ShieldAlert} tone="risk" />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_180px]">
            <div className="relative">
              <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
              <Input
                value={searchQuery}
                placeholder={t('searchMilestones')}
                className={isRTL ? 'pr-9' : 'pl-9'}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | MilestoneStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>{statusMeta(status).label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={healthFilter} onValueChange={(value) => setHealthFilter(value as 'all' | MilestoneHealth)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allHealthStates')}</SelectItem>
                {healthOptions.map((health) => (
                  <SelectItem key={health} value={health}>{healthMeta(health).label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'target' | 'risk' | 'progress')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="risk">{t('sortByRisk')}</SelectItem>
                <SelectItem value="target">{t('sortByTargetDate')}</SelectItem>
                <SelectItem value="progress">{t('sortByProgress')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="flex min-h-72 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t('loadingMilestones')}
          </CardContent>
        </Card>
      ) : filteredMilestones.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
            <Target className="h-12 w-12 text-slate-300" />
            <div>
              <h2 className="text-lg font-semibold">{t('noMilestonesFound')}</h2>
              <p className="text-sm text-slate-500">{t('noMilestonesFoundDescription')}</p>
            </div>
            <Button onClick={openCreateDialog}>{t('addMilestone')}</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredMilestones.map((milestone) => {
            const health = healthMeta(milestone.health);
            const status = statusMeta(milestone.status);
            const HealthIcon = health.icon;
            const StatusIcon = status.icon;
            const days = getDaysRemaining(milestone.target_date);

            return (
              <Card key={milestone.id} className="overflow-hidden border-slate-200 shadow-sm">
                <div className={`h-1.5 ${getHealthBarClass(milestone.health)}`} />
                <CardHeader className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={health.className}>
                          <HealthIcon className="mr-1.5 h-3.5 w-3.5" />
                          {health.label}
                        </Badge>
                        <Badge variant="outline" className={status.className}>
                          <StatusIcon className="mr-1.5 h-3.5 w-3.5" />
                          {status.label}
                        </Badge>
                      </div>
                      <CardTitle className="truncate text-xl">{milestone.title}</CardTitle>
                      {milestone.description && <p className="line-clamp-2 text-sm text-slate-500">{milestone.description}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(milestone)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={milestone.test_plan_count > 0}
                        onClick={() => deleteMilestone(milestone)}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700 disabled:text-slate-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">{t('executionProgress')}</span>
                      <span className="font-semibold text-slate-900">{milestone.execution_progress}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                      <div className={`h-full rounded-full ${getProgressClass(milestone.execution_progress)}`} style={{ width: `${milestone.execution_progress}%` }} />
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                      <ResultPill label={t('passed')} value={milestone.passed_count} className="bg-emerald-100 text-emerald-700" />
                      <ResultPill label={t('failed')} value={milestone.failed_count} className="bg-red-100 text-red-700" />
                      <ResultPill label={t('blocked')} value={milestone.blocked_count} className="bg-orange-100 text-orange-700" />
                      <ResultPill label={t('notTested')} value={milestone.not_tested_count} className="bg-slate-100 text-slate-700" />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MiniStat label={t('testPlans')} value={milestone.test_plan_count} icon={ClipboardList} />
                    <MiniStat label={t('testRuns')} value={milestone.test_run_count} icon={PlayCircle} />
                    <MiniStat label={t('testCases')} value={milestone.test_case_count} icon={FileCheck2} />
                    <MiniStat label={t('openDefects')} value={milestone.open_defect_count} icon={Bug} warning={milestone.open_defect_count > 0} />
                  </div>

                  <div className="grid gap-3 rounded-2xl border p-4 text-sm sm:grid-cols-3">
                    <div className="flex items-center gap-2 text-slate-600">
                      <CalendarDays className="h-4 w-4" />
                      <span>{milestone.target_date ? formatDate(milestone.target_date) : t('noTargetDate')}</span>
                    </div>
                    <div className={milestone.is_overdue ? 'font-medium text-red-600' : 'text-slate-600'}>
                      {getScheduleText(days, milestone, t)}
                    </div>
                    <div className="text-slate-600">
                      {t('passRateValue', { value: milestone.pass_rate })}
                    </div>
                  </div>

                  {milestone.linked_test_plans.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700">{t('linkedTestPlans')}</p>
                      <div className="flex flex-wrap gap-2">
                        {milestone.linked_test_plans.slice(0, 3).map((plan) => (
                          <Badge key={plan.id} variant="outline" className="max-w-full truncate">
                            {plan.title}
                          </Badge>
                        ))}
                        {milestone.linked_test_plans.length > 3 && (
                          <Badge variant="outline">+{milestone.linked_test_plans.length - 3}</Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${currentProjectId}/test-plans?milestone_id=${milestone.id}`)}>
                      {t('viewTestPlans')}
                      <ArrowUpRight className="ml-2 h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${currentProjectId}/test-runs?milestone_id=${milestone.id}`)}>
                      {t('viewTestRuns')}
                      <ArrowUpRight className="ml-2 h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${currentProjectId}/defects`)}>
                      {t('viewDefects')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${currentProjectId}/requirements`)}>
                      {t('viewRequirements')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value, detail, icon: Icon, tone = 'default' }: {
  title: string;
  value: string | number;
  detail: string;
  icon: typeof Target;
  tone?: 'default' | 'risk';
}) {
  return (
    <Card className={tone === 'risk' ? 'border-amber-200 bg-amber-50/60' : ''}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">{title}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
          </div>
          <div className={`rounded-2xl p-3 ${tone === 'risk' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, icon: Icon, warning = false }: { label: string; value: number; icon: typeof Target; warning?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${warning ? 'border-red-200 bg-red-50' : 'bg-white'}`}>
      <Icon className={`mb-2 h-4 w-4 ${warning ? 'text-red-600' : 'text-slate-500'}`} />
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function ResultPill({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-xl px-2 py-1 ${className}`}>
      <div className="font-semibold">{value}</div>
      <div>{label}</div>
    </div>
  );
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

function getDateValue(value?: string) {
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function getScheduleText(days: number | null, milestone: Milestone, t: (key: any, params?: Record<string, string | number>) => string) {
  if (milestone.status === 'completed') return t('completed');
  if (milestone.status === 'cancelled') return t('cancelled');
  if (days === null) return t('noTargetDate');
  if (days < 0) return t('daysOverdue', { count: Math.abs(days) });
  if (days === 0) return t('dueToday');
  return t('daysRemaining', { count: days });
}

function getProgressClass(value: number) {
  if (value >= 80) return 'bg-emerald-500';
  if (value >= 50) return 'bg-blue-500';
  if (value >= 25) return 'bg-amber-500';
  return 'bg-red-500';
}

function getHealthBarClass(health: MilestoneHealth) {
  const map: Record<MilestoneHealth, string> = {
    planned: 'bg-slate-400',
    in_progress: 'bg-blue-500',
    completed: 'bg-emerald-500',
    blocked: 'bg-red-600',
    at_risk: 'bg-amber-500',
    cancelled: 'bg-zinc-500',
  };
  return map[health] || map.planned;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function getTotalRequirements(milestones: Milestone[]) {
  return milestones.reduce((max, milestone) => Math.max(max, milestone.requirement_count), 0);
}
