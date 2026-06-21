import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CirclePlus,
  ClipboardList,
  Flag,
  Gauge,
  Layers,
  Link2,
  Loader2,
  Pencil,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Target,
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
import { WatchButton } from '@/components/WatchButton';
import { testPlansAPI, testRunsAPI, getApiErrorMessage } from '@/lib/api';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { TestRun } from '@/types';

type TestPlanStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'completed';
type ExecutionStatus = 'not_started' | 'in_progress' | 'blocked' | 'failed' | 'passed';

interface LinkedRequirement {
  id: number;
  requirement_id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  linked: boolean;
}

interface TestPlanDetailData {
  id: number;
  title: string;
  description: string | null;
  project_id: number;
  milestone_id: number | null;
  milestone_title: string | null;
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
  requirement_count?: number | null;
  execution_status?: ExecutionStatus | null;
  execution_progress?: number | null;
  pass_rate?: number | null;
  passed_count?: number | null;
  failed_count?: number | null;
  blocked_count?: number | null;
  created_at: string;
  updated_at: string | null;
}

const EXECUTION_META: Record<ExecutionStatus, { labelKey: string; className: string; dot: string }> = {
  not_started: { labelKey: 'execStatusNotStarted', className: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300', dot: 'bg-slate-400' },
  in_progress: { labelKey: 'execStatusInProgress', className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300', dot: 'bg-blue-500' },
  blocked: { labelKey: 'execStatusBlocked', className: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300', dot: 'bg-orange-500' },
  failed: { labelKey: 'execStatusFailed', className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300', dot: 'bg-red-500' },
  passed: { labelKey: 'execStatusPassed', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
};

const parsePositiveInteger = (value?: string): number | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export function TestPlanDetail() {
  const navigate = useNavigate();
  const { projectId, testPlanId } = useParams<{ projectId: string; testPlanId: string }>();
  const { t, isRTL } = useTranslation();
  const { formatDate: fmtDate } = useDateFormat();
  const formatDate = (value: string | null | undefined, fallback: string): string => {
    if (!value) return fallback;
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (parts) {
      const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12));
      return fmtDate(date, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) || fallback;
    }
    return fmtDate(value, { year: 'numeric', month: 'short', day: 'numeric' }) || fallback;
  };
  const numericProjectId = useMemo(() => parsePositiveInteger(projectId), [projectId]);
  // The URL carries the per-project sequence; resolve it to the global test-plan id.
  const { id: numericPlanId, loading: planIdLoading } = useResolvedEntityId(projectId, 'test-plans', testPlanId);

  const [plan, setPlan] = useState<TestPlanDetailData | null>(null);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Linked requirements (scope) management
  const [linkedRequirements, setLinkedRequirements] = useState<LinkedRequirement[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [candidates, setCandidates] = useState<LinkedRequirement[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [reqSearch, setReqSearch] = useState('');
  const [selectedReqIds, setSelectedReqIds] = useState<number[]>([]);
  const [reqSaving, setReqSaving] = useState(false);

  const loadLinkedRequirements = async (planId: number) => {
    try {
      const data = await testPlansAPI.getRequirements(planId, { linked: true, limit: 500 });
      setLinkedRequirements(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setLinkedRequirements([]);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadPlan = async () => {
      if (planIdLoading) return;  // wait for the seq -> id resolution
      if (!numericProjectId || !numericPlanId) {
        setError(t('invalidProjectId'));
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const [planData, runData] = await Promise.all([
          testPlansAPI.getById(numericPlanId),
          testRunsAPI.getAll(numericProjectId, 0, 500, { test_plan_id: numericPlanId }).catch(() => []),
        ]);

        if (cancelled) return;
        if (planData.project_id !== numericProjectId) {
          setError(t('testPlanNotFound'));
          setPlan(null);
          setRuns([]);
          return;
        }

        setPlan(planData);
        setRuns(Array.isArray(runData) ? runData : []);
        loadLinkedRequirements(numericPlanId);
      } catch (err) {
        if (cancelled) return;
        setError(getApiErrorMessage(err, t('failedToLoadTestPlans')));
        setPlan(null);
        setRuns([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadPlan();
    return () => {
      cancelled = true;
    };
  }, [numericPlanId, planIdLoading, numericProjectId, t]);

  const executedRuns = runs.filter((run) => ['completed', 'passed', 'failed', 'blocked'].includes(run.status || '')).length;
  const latestRun = runs[0];
  const readinessItems = plan
    ? [
        { label: t('linkedMilestone'), done: Boolean(plan.milestone_id) },
        { label: t('testPlanObjectives'), done: Boolean(plan.test_objectives) },
        { label: t('scopeIn'), done: Boolean(plan.scope_inclusions) },
        { label: t('requirements'), done: linkedRequirements.length > 0 },
        { label: t('entryCriteria'), done: Boolean(plan.entry_criteria) },
        { label: t('exitCriteria'), done: Boolean(plan.exit_criteria) },
        { label: t('testRuns'), done: runs.length > 0 },
      ]
    : [];
  const readinessScore = readinessItems.length
    ? Math.round((readinessItems.filter((item) => item.done).length / readinessItems.length) * 100)
    : 0;

  const openManageRequirements = async () => {
    if (!plan) return;
    setManageOpen(true);
    setReqSearch('');
    setCandidatesLoading(true);
    try {
      const data = await testPlansAPI.getRequirements(plan.id, { limit: 500 });
      const items: LinkedRequirement[] = Array.isArray(data?.items) ? data.items : [];
      setCandidates(items);
      setSelectedReqIds(items.filter((item) => item.linked).map((item) => item.id));
    } catch {
      setCandidates([]);
      setSelectedReqIds([]);
    } finally {
      setCandidatesLoading(false);
    }
  };

  const toggleReq = (id: number) => {
    setSelectedReqIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const saveRequirements = async () => {
    if (!plan) return;
    const originallyLinked = new Set(candidates.filter((c) => c.linked).map((c) => c.id));
    const selected = new Set(selectedReqIds);
    const toLink = selectedReqIds.filter((id) => !originallyLinked.has(id));
    const toUnlink = [...originallyLinked].filter((id) => !selected.has(id));
    setReqSaving(true);
    setError(null);
    try {
      if (toLink.length > 0) {
        await testPlansAPI.bulkUpdateRequirements(plan.id, { requirement_ids: toLink, action: 'link' });
      }
      if (toUnlink.length > 0) {
        await testPlansAPI.bulkUpdateRequirements(plan.id, { requirement_ids: toUnlink, action: 'unlink' });
      }
      await loadLinkedRequirements(plan.id);
      setManageOpen(false);
    } catch (err) {
      setError(getApiErrorMessage(err, t('failedToLoadTestPlans')));
    } finally {
      setReqSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRequirements();
    }
  };

  const filteredCandidates = useMemo(() => {
    const q = reqSearch.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => c.title.toLowerCase().includes(q) || c.requirement_id.toLowerCase().includes(q),
    );
  }, [candidates, reqSearch]);

  const goToRuns = (create = false) => {
    if (!plan || !numericProjectId) return;
    const params = new URLSearchParams({ test_plan_id: String(plan.id) });
    if (plan.milestone_id) params.set('milestone_id', String(plan.milestone_id));
    if (create) params.set('create', '1');
    navigate(`/projects/${numericProjectId}/test-runs?${params.toString()}`);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-72 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {t('loadingTestPlans')}
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}/test-plans`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('backToTestPlans')}
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || t('testPlanNotFound')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const statusClass = {
    pending: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    running: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    completed: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    passed: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
    failed: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    skipped: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800',
    blocked: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
  } satisfies Record<TestPlanStatus, string>;
  const statusLabel = {
    pending: t('testPlansPending'),
    running: t('testPlansRunning'),
    completed: t('testPlansCompleted'),
    passed: t('testRunStatusPassed'),
    failed: t('testRunStatusFailed'),
    skipped: t('testRunStatusSkipped'),
    blocked: t('testPlansBlocked'),
  } satisfies Record<TestPlanStatus, string>;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <button
        onClick={() => navigate(`/projects/${projectId}/test-plans${plan.milestone_id ? `?milestone_id=${plan.milestone_id}` : ''}`)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('backToTestPlans')}
      </button>

      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {plan.execution_status && (
              <Badge
                variant="outline"
                className={`flex items-center gap-1 ${EXECUTION_META[plan.execution_status].className}`}
                title={t('derivedFromRuns')}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${EXECUTION_META[plan.execution_status].dot}`} />
                {t(EXECUTION_META[plan.execution_status].labelKey as any)}
              </Badge>
            )}
            <Badge className={statusClass[plan.status] || statusClass.pending} title={t('manualStatus')}>{statusLabel[plan.status] || statusLabel.pending}</Badge>
            {plan.milestone_title ? (
              <Badge variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                <Flag className="h-3 w-3" />
                {plan.milestone_title}
              </Badge>
            ) : (
              <Badge variant="outline">{t('noMilestone')}</Badge>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{plan.title}</h1>
            {plan.description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{plan.description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <WatchButton entityType="test_plan" entityId={plan.id} />
          <Button onClick={() => goToRuns(runs.length === 0)} className="gap-1">
            {runs.length === 0 ? <CirclePlus className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {runs.length === 0 ? t('startNewRun') : t('viewTestRuns')}
          </Button>
          <Button variant="outline" onClick={() => navigate(`/projects/${projectId}/test-plans?edit=${plan.id}`)} className="gap-1">
            <Pencil className="h-4 w-4" />
            {t('edit')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <SummaryCard icon={ClipboardList} label={t('planReadiness')} value={`${readinessScore}%`} />
        <SummaryCard icon={Gauge} label={t('passRate')} value={`${plan.pass_rate ?? 0}%`} />
        <SummaryCard icon={Layers} label={t('testRuns')} value={runs.length} />
        <SummaryCard icon={Target} label={t('executed')} value={`${executedRuns}/${runs.length}`} />
        <SummaryCard icon={Calendar} label={t('targetEndDate')} value={formatDate(plan.target_end_date, t('notSet'))} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('planScope')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailBlock icon={Target} label={t('testPlanObjectives')} value={plan.test_objectives} fallback={t('notSet')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailBlock icon={ShieldCheck} label={t('scopeIn')} value={plan.scope_inclusions} fallback={t('notSet')} />
              <DetailBlock icon={ShieldAlert} label={t('scopeOut')} value={plan.scope_exclusions} fallback={t('notSet')} />
            </div>
            <DetailBlock icon={AlertTriangle} label={t('risksAssumptions')} value={plan.risks_assumptions} fallback={t('notSet')} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('planReadiness')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {readinessItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <span>{item.label}</span>
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Linked requirements — the plan's traceable scope */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Link2 className="h-4 w-4" />
            {t('linkedRequirements')}
            <Badge variant="outline">{linkedRequirements.length}</Badge>
            {linkedRequirements.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {t('verifiedOfTotal', {
                  verified: linkedRequirements.filter((r) => (r.status || '').toLowerCase() === 'verified').length,
                  total: linkedRequirements.length,
                })}
              </span>
            )}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={openManageRequirements} className="gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            {t('manageRequirements')}
          </Button>
        </CardHeader>
        <CardContent>
          {linkedRequirements.length === 0 ? (
            <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <p>{t('noRequirementsLinked')}</p>
              <Button size="sm" variant="outline" onClick={openManageRequirements}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                {t('addRequirements')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {linkedRequirements.map((req) => (
                <button
                  key={req.id}
                  onClick={() => navigate(`/projects/${projectId}/requirements/${req.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{req.title}</p>
                    <p className="text-xs text-muted-foreground">{req.requirement_id}</p>
                  </div>
                  {req.status && <Badge variant="outline" className="shrink-0">{req.status}</Badge>}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('testPlanTabSchedule')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailValue label={t('targetStartDate')} value={formatDate(plan.target_start_date, t('notSet'))} />
            <DetailValue label={t('targetEndDate')} value={formatDate(plan.target_end_date, t('notSet'))} />
            <DetailValue label={t('actualStartDate')} value={formatDate(plan.actual_start_date, t('notSet'))} />
            <DetailValue label={t('actualEndDate')} value={formatDate(plan.actual_end_date, t('notSet'))} />
            <div className="sm:col-span-2">
              <DetailBlock icon={Layers} label={t('testEnvironment')} value={plan.test_environment} fallback={t('notSet')} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('testPlanTabCriteria')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailBlock icon={ShieldCheck} label={t('entryCriteria')} value={plan.entry_criteria} fallback={t('notSet')} />
            <DetailBlock icon={CheckCircle2} label={t('exitCriteria')} value={plan.exit_criteria} fallback={t('notSet')} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('testRuns')}</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <p>{t('noRunsForPlan')}</p>
              <Button size="sm" onClick={() => goToRuns(true)}>
                <CirclePlus className="mr-1.5 h-3.5 w-3.5" />
                {t('startNewRun')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.slice(0, 5).map((run) => (
                <button
                  key={run.id}
                  onClick={() => navigate(`/projects/${projectId}/test-runs/${run.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{run.name}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(run.created_at, t('notSet'))}</p>
                  </div>
                  <Badge variant="outline">{run.status}</Badge>
                </button>
              ))}
              {runs.length > 5 && (
                <Button variant="outline" size="sm" onClick={() => goToRuns(false)}>
                  {t('viewTestRuns')}
                </Button>
              )}
              {latestRun && (
                <p className="text-xs text-muted-foreground">
                  {t('latestRun')}: {latestRun.name}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={manageOpen} onOpenChange={(open) => (open ? null : setManageOpen(false))}>
        <DialogContent isRTL={isRTL} className="max-h-[85vh] overflow-hidden sm:max-w-[560px]" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('manageRequirements')}</DialogTitle>
            <DialogDescription>{t('selectRequirementsToLink')}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isRTL ? 'right-3' : 'left-3'}`} />
            <Input
              value={reqSearch}
              placeholder={t('searchRequirements')}
              className={isRTL ? 'pr-9' : 'pl-9'}
              onChange={(e) => setReqSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
            {candidatesLoading ? (
              <div className="flex min-h-24 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('loading')}
              </div>
            ) : filteredCandidates.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noRequirementsLinked')}</p>
            ) : (
              filteredCandidates.map((req) => (
                <label
                  key={req.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selectedReqIds.includes(req.id)}
                    onCheckedChange={() => toggleReq(req.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{req.title}</p>
                    <p className="text-xs text-muted-foreground">{req.requirement_id}</p>
                  </div>
                  {req.status && <Badge variant="outline" className="shrink-0">{req.status}</Badge>}
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)} disabled={reqSaving}>
              {t('cancel')}
            </Button>
            <Button onClick={saveRequirements} disabled={reqSaving}>
              {reqSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof ClipboardList; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-xl bg-muted p-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailBlock({ icon: Icon, label, value, fallback }: { icon: typeof Target; label: string; value?: string | null; fallback: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{value || fallback}</p>
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
