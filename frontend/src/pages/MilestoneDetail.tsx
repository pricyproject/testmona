import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Ban,
  Bug,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  FileCheck2,
  Gauge,
  Link2,
  Loader2,
  PlayCircle,
  Plus,
  Search,
  ShieldAlert,
  Target,
  Unlink,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useTranslation } from '@/hooks/useTranslation';
import { milestonesAPI, testPlansAPI, getApiErrorMessage } from '@/lib/api';
import type { Milestone, MilestoneHealth, MilestoneStatus } from '@/types';

type CandidatePlan = { id: number; title: string; status: string | null; milestone_id: number | null };

type RunRow = {
  id: number;
  name: string;
  status?: string;
  test_plan_id?: number | null;
  milestone_id?: number | null;
  total_tests?: number;
  executed_tests?: number;
  passed_tests?: number;
  failed_tests?: number;
  blocked_tests?: number;
  skipped_tests?: number;
  not_tested_tests?: number;
  progress_percent?: number;
  created_at?: string;
  completed_at?: string | null;
};

const HEALTH_TONE: Record<MilestoneHealth, string> = {
  planned: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  at_risk: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const HEALTH_LABEL_KEY: Record<MilestoneHealth, string> = {
  planned: 'milestoneHealthPlanned',
  in_progress: 'milestoneHealthInProgress',
  completed: 'milestoneHealthCompleted',
  at_risk: 'milestoneHealthAtRisk',
  blocked: 'milestoneHealthBlocked',
  cancelled: 'milestoneHealthCancelled',
};

const STATUS_TONE: Record<MilestoneStatus, string> = {
  planned: 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400',
};

const STATUS_LABEL_KEY: Record<MilestoneStatus, string> = {
  planned: 'milestoneStatusPlanned',
  in_progress: 'milestoneStatusInProgress',
  completed: 'milestoneStatusCompleted',
  cancelled: 'milestoneStatusCancelled',
};

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
};

const progressTone = (value: number): string => {
  if (value >= 90) return 'bg-emerald-500';
  if (value >= 60) return 'bg-blue-500';
  if (value >= 30) return 'bg-amber-500';
  return 'bg-slate-400';
};

const passRateTone = (value: number, executed: number): string => {
  if (executed === 0) return 'text-slate-500';
  if (value >= 95) return 'text-emerald-600';
  if (value >= 80) return 'text-blue-600';
  if (value >= 60) return 'text-amber-600';
  return 'text-red-600';
};

const parsePositiveInteger = (value?: string): number | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
};

export function MilestoneDetail() {
  const { projectId, milestoneId } = useParams<{ projectId: string; milestoneId: string }>();
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();

  const numericProjectId = useMemo(() => parsePositiveInteger(projectId), [projectId]);
  const numericMilestoneId = useMemo(() => parsePositiveInteger(milestoneId), [milestoneId]);

  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Link/unlink plan management
  const [linkOpen, setLinkOpen] = useState(false);
  const [candidatePlans, setCandidatePlans] = useState<CandidatePlan[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [planSearch, setPlanSearch] = useState('');
  const [selectedPlanIds, setSelectedPlanIds] = useState<number[]>([]);
  const [linkSaving, setLinkSaving] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!numericProjectId || !numericMilestoneId || !Number.isFinite(numericMilestoneId)) return;
    const [milestoneData, runsData] = await Promise.all([
      milestonesAPI.getById(numericMilestoneId),
      milestonesAPI.getRuns(numericMilestoneId).catch(() => []),
    ]);
    if (milestoneData.project_id !== numericProjectId) {
      setError(t('milestoneNotInProject'));
      setMilestone(null);
      setRuns([]);
      return;
    }
    setMilestone(milestoneData);
    setRuns(Array.isArray(runsData) ? runsData : []);
  }, [numericProjectId, numericMilestoneId, t]);

  useEffect(() => {
    if (!numericProjectId) {
      setError(t('invalidProjectId'));
      setIsLoading(false);
      return;
    }
    if (!numericMilestoneId || !Number.isFinite(numericMilestoneId)) {
      setError(t('invalidMilestoneId'));
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        await reload();
      } catch (err) {
        if (cancelled) return;
        setError(getApiErrorMessage(err, t('failedToLoadMilestone')));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numericProjectId, numericMilestoneId, t, reload]);

  const openLinkDialog = async () => {
    if (!numericProjectId || !numericMilestoneId) return;
    setLinkOpen(true);
    setPlanSearch('');
    setSelectedPlanIds([]);
    setCandidatesLoading(true);
    try {
      const plans = await testPlansAPI.getAll(numericProjectId, { limit: 500 });
      // Only offer plans not already attached to a milestone. Re-assigning a plan
      // that already belongs to another milestone is the job of the bulk "move"
      // action on the Test Plans page, so we don't silently steal it here.
      const list: CandidatePlan[] = (Array.isArray(plans) ? plans : []).filter(
        (p: CandidatePlan) => p.milestone_id == null,
      );
      setCandidatePlans(list);
    } catch {
      setCandidatePlans([]);
    } finally {
      setCandidatesLoading(false);
    }
  };

  const togglePlan = (id: number) => {
    setSelectedPlanIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const saveLinks = async () => {
    if (!numericMilestoneId || selectedPlanIds.length === 0) return;
    setLinkSaving(true);
    setError(null);
    try {
      await Promise.all(
        selectedPlanIds.map((id) => testPlansAPI.update(id, { milestone_id: numericMilestoneId })),
      );
      setLinkOpen(false);
      await reload();
    } catch (err) {
      setError(getApiErrorMessage(err, t('failedToLoadMilestone')));
    } finally {
      setLinkSaving(false);
    }
  };

  const unlinkPlan = async (planId: number) => {
    setUnlinkingId(planId);
    setError(null);
    try {
      await testPlansAPI.update(planId, { milestone_id: null });
      await reload();
    } catch (err) {
      setError(getApiErrorMessage(err, t('failedToLoadMilestone')));
    } finally {
      setUnlinkingId(null);
    }
  };

  const filteredCandidatePlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return candidatePlans;
    return candidatePlans.filter((p) => p.title.toLowerCase().includes(q));
  }, [candidatePlans, planSearch]);

  // Per-plan rollup: aggregate the runs returned for this milestone, grouped
  // by their test_plan_id. Runs not linked to any plan (direct milestone
  // attachments) collapse into a synthetic "unassigned" row so the user can
  // still see them.
  const planRollups = useMemo(() => {
    if (!milestone) return [];
    const planById = new Map<number, { id: number; title: string; status?: string }>();
    for (const plan of milestone.linked_test_plans || []) {
      planById.set(plan.id, { id: plan.id, title: plan.title, status: plan.status });
    }

    const accum = new Map<number | 'unassigned', {
      planId: number | null;
      title: string;
      status?: string;
      runCount: number;
      totalTests: number;
      executedTests: number;
      passed: number;
      failed: number;
      blocked: number;
      skipped: number;
      notTested: number;
    }>();
    for (const run of runs) {
      const key: number | 'unassigned' = run.test_plan_id ?? 'unassigned';
      const entry = accum.get(key) ?? {
        planId: typeof key === 'number' ? key : null,
        title: typeof key === 'number'
          ? planById.get(key)?.title || `Plan ${key}`
          : t('directlyLinkedRuns'),
        status: typeof key === 'number' ? planById.get(key)?.status : undefined,
        runCount: 0,
        totalTests: 0,
        executedTests: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
        notTested: 0,
      };
      entry.runCount += 1;
      entry.totalTests += run.total_tests || 0;
      entry.executedTests += run.executed_tests || 0;
      entry.passed += run.passed_tests || 0;
      entry.failed += run.failed_tests || 0;
      entry.blocked += run.blocked_tests || 0;
      entry.skipped += run.skipped_tests || 0;
      entry.notTested += run.not_tested_tests || 0;
      accum.set(key, entry);
    }

    // Ensure plans that have NO runs yet still appear so the user can see them.
    for (const plan of milestone.linked_test_plans || []) {
      if (!accum.has(plan.id)) {
        accum.set(plan.id, {
          planId: plan.id,
          title: plan.title,
          status: plan.status,
          runCount: 0,
          totalTests: 0,
          executedTests: 0,
          passed: 0,
          failed: 0,
          blocked: 0,
          skipped: 0,
          notTested: 0,
        });
      }
    }

    return Array.from(accum.values()).map((entry) => ({
      ...entry,
      passRate: entry.executedTests > 0 ? Math.round((entry.passed / entry.executedTests) * 100) : 0,
      executionProgress: entry.totalTests > 0 ? Math.round((entry.executedTests / entry.totalTests) * 100) : 0,
    }));
  }, [milestone, runs, t]);

  const goBack = () => navigate(`/projects/${projectId}/milestones`);
  const textEnd = isRTL ? 'text-left' : 'text-right';

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  if (error || !milestone) {
    return (
      <div className="space-y-4 p-6">
        <Button variant="ghost" size="sm" onClick={goBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          {t('milestones')}
        </Button>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error || t('milestoneNotFound')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const passRateColor = passRateTone(milestone.pass_rate, milestone.passed_count + milestone.failed_count + milestone.blocked_count + milestone.skipped_count);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={goBack} className="gap-1">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t('milestones')}
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{milestone.title}</h1>
            {milestone.description && (
              <p className="text-sm text-muted-foreground max-w-2xl">{milestone.description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={HEALTH_TONE[milestone.health]}>{t(HEALTH_LABEL_KEY[milestone.health] as any)}</Badge>
          <Badge variant="outline" className={STATUS_TONE[milestone.status]}>{t(STATUS_LABEL_KEY[milestone.status] as any)}</Badge>
          {milestone.is_overdue && (
            <Badge variant="destructive" className="gap-1">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t('milestoneOverdue')}
            </Badge>
          )}
        </div>
      </div>

      {/* Hero — the "ship readiness" rollup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            {t('readinessRollup')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">{t('passRate')}</p>
              <p className={`mt-1 text-3xl font-bold ${passRateColor}`}>{milestone.pass_rate}%</p>
              <p className="text-xs text-muted-foreground">
                {milestone.passed_count} / {milestone.passed_count + milestone.failed_count + milestone.blocked_count + milestone.skipped_count} {t('executed').toLowerCase()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('executionProgress')}</p>
              <p className="mt-1 text-3xl font-bold">{clampPercent(milestone.execution_progress)}%</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div className={`h-full rounded-full ${progressTone(milestone.execution_progress)}`} style={{ width: `${clampPercent(milestone.execution_progress)}%` }} />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('targetDate')}</p>
              <p className="mt-1 text-lg font-semibold">{formatDate(milestone.target_date)}</p>
              {milestone.actual_date && (
                <p className="text-xs text-muted-foreground">
                  {t('completedLabel')}: {formatDate(milestone.actual_date)}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('openDefects')}</p>
              <p className={`mt-1 text-3xl font-bold ${milestone.open_defect_count > 0 ? 'text-red-600' : ''}`}>{milestone.open_defect_count}</p>
              {milestone.critical_defect_count > 0 && (
                <p className="text-xs text-red-600">
                  {milestone.critical_defect_count} {t('critical').toLowerCase()}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <ResultPill icon={CheckCircle2} label={t('passed')} value={milestone.passed_count} tone="emerald" />
            <ResultPill icon={XCircle} label={t('failed')} value={milestone.failed_count} tone="red" />
            <ResultPill icon={Ban} label={t('blocked')} value={milestone.blocked_count} tone="amber" />
            <ResultPill icon={CircleDashed} label={t('skipped')} value={milestone.skipped_count} tone="slate" />
            <ResultPill icon={Activity} label={t('notTested')} value={milestone.not_tested_count} tone="slate" />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button size="sm" onClick={() => navigate(`/projects/${projectId}/test-plans?milestone_id=${milestone.id}`)} className="gap-1">
              <ClipboardList className="h-3.5 w-3.5" />
              {t('viewTestPlans')}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/projects/${projectId}/test-plans?milestone_id=${milestone.id}&create=1`)} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              {t('createTestPlan')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/projects/${projectId}/test-runs?milestone_id=${milestone.id}`)} className="gap-1">
              <PlayCircle className="h-3.5 w-3.5" />
              {t('viewTestRuns')}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/projects/${projectId}/defects?milestone_id=${milestone.id}`)} className="gap-1">
              <Bug className="h-3.5 w-3.5" />
              {t('viewDefects')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Per-plan breakdown — answers "which plan is dragging us down?" */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            {t('planBreakdown')}
          </CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {milestone.test_plan_count} {milestone.test_plan_count === 1 ? t('testPlanSingular') : t('testPlans').toLowerCase()}
            </span>
            <Button size="sm" variant="outline" onClick={openLinkDialog} className="gap-1.5">
              <Link2 className="h-3.5 w-3.5" />
              {t('linkExistingPlan')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {planRollups.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">{t('noTestPlansLinked')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('testPlanSingular')}</TableHead>
                  <TableHead className={textEnd}>{t('testRuns')}</TableHead>
                  <TableHead className={textEnd}>{t('passRate')}</TableHead>
                  <TableHead className={textEnd}>{t('executionProgress')}</TableHead>
                  <TableHead className={textEnd}>{t('passed')}/{t('failed')}/{t('blocked')}</TableHead>
                  <TableHead className={textEnd}>{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planRollups.map((row) => {
                  const executed = row.passed + row.failed + row.blocked + row.skipped;
                  return (
                    <TableRow key={row.planId ?? 'unassigned'}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{row.title}</span>
                          {row.status && (
                            <span className="text-xs text-muted-foreground">{row.status}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={textEnd}>{row.runCount}</TableCell>
                      <TableCell className={`${textEnd} font-semibold ${passRateTone(row.passRate, executed)}`}>
                        {executed > 0 ? `${row.passRate}%` : '-'}
                      </TableCell>
                      <TableCell className={textEnd}>
                        <div className={`flex items-center gap-2 ${isRTL ? 'justify-start' : 'justify-end'}`}>
                          <span className="text-sm">{row.executionProgress}%</span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div className={`h-full ${progressTone(row.executionProgress)}`} style={{ width: `${clampPercent(row.executionProgress)}%` }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={`${textEnd} text-sm`}>
                        <span className="text-emerald-600">{row.passed}</span>
                        {' / '}
                        <span className="text-red-600">{row.failed}</span>
                        {' / '}
                        <span className="text-amber-600">{row.blocked}</span>
                      </TableCell>
                      <TableCell className={textEnd}>
                        {row.planId != null ? (
                          <div className={`flex items-center gap-1 ${isRTL ? 'justify-start' : 'justify-end'}`}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/projects/${projectId}/test-runs?test_plan_id=${row.planId}`)}
                              className="gap-1"
                            >
                              {t('viewTestRuns')}
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive"
                              title={t('unlinkPlan')}
                              disabled={unlinkingId === row.planId}
                              onClick={() => unlinkPlan(row.planId as number)}
                            >
                              {unlinkingId === row.planId ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Unlink className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Per-run table for drilldown */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PlayCircle className="h-4 w-4" />
            {t('testRuns')}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {runs.length} {runs.length === 1 ? t('testRunSingular') : t('testRuns').toLowerCase()}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">{t('noTestRunsLinked')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('testRunSingular')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className={textEnd}>{t('passRate')}</TableHead>
                  <TableHead className={textEnd}>{t('executionProgress')}</TableHead>
                  <TableHead className={textEnd}>{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const executed = (run.passed_tests || 0) + (run.failed_tests || 0) + (run.blocked_tests || 0) + (run.skipped_tests || 0);
                  const passRate = executed > 0 ? Math.round(((run.passed_tests || 0) / executed) * 100) : 0;
                  const progress = run.progress_percent ?? 0;
                  return (
                    <TableRow key={run.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/projects/${projectId}/test-runs/${run.id}`)}>
                      <TableCell>
                        <div className="font-medium">{run.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {run.test_plan_id ? `${t('testPlanSingular')} ${run.test_plan_id}` : t('directlyLinkedRuns')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{run.status || '—'}</Badge>
                      </TableCell>
                      <TableCell className={`${textEnd} font-semibold ${passRateTone(passRate, executed)}`}>
                        {executed > 0 ? `${passRate}%` : '-'}
                      </TableCell>
                      <TableCell className={textEnd}>
                        <div className={`flex items-center gap-2 ${isRTL ? 'justify-start' : 'justify-end'}`}>
                          <span className="text-sm">{clampPercent(progress)}%</span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div className={`h-full ${progressTone(progress)}`} style={{ width: `${clampPercent(progress)}%` }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={textEnd}>
                        <Button size="sm" variant="ghost" className="gap-1" onClick={(e) => { e.stopPropagation(); navigate(`/projects/${projectId}/test-runs/${run.id}`); }}>
                          {t('open')}
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            {t('coverage')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t('requirements')}</p>
              <p className="mt-1 text-2xl font-semibold">{milestone.verified_requirement_count} / {milestone.requirement_count}</p>
              <p className="text-xs text-muted-foreground">{t('verified').toLowerCase()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('testCases')}</p>
              <p className="mt-1 text-2xl font-semibold">{milestone.test_case_count}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                <FileCheck2 className="mr-1 inline h-3.5 w-3.5" />
                {t('testPlans')}
              </p>
              <p className="mt-1 text-2xl font-semibold">{milestone.test_plan_count}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
                {t('created')}
              </p>
              <p className="mt-1 text-sm">{formatDate(milestone.created_at)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={linkOpen} onOpenChange={(open) => (open ? null : setLinkOpen(false))}>
        <DialogContent isRTL={isRTL} className="max-h-[85vh] overflow-hidden sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t('linkExistingPlan')}</DialogTitle>
            <DialogDescription>{t('viewTestPlans')}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isRTL ? 'right-3' : 'left-3'}`} />
            <Input
              value={planSearch}
              placeholder={t('searchTestPlans')}
              className={isRTL ? 'pr-9' : 'pl-9'}
              onChange={(e) => setPlanSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
            {candidatesLoading ? (
              <div className="flex min-h-24 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('loading')}
              </div>
            ) : filteredCandidatePlans.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noUnlinkedPlans')}</p>
            ) : (
              filteredCandidatePlans.map((plan) => (
                <label
                  key={plan.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selectedPlanIds.includes(plan.id)}
                    onCheckedChange={() => togglePlan(plan.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{plan.title}</p>
                  </div>
                  {plan.status && <Badge variant="outline" className="shrink-0">{plan.status}</Badge>}
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)} disabled={linkSaving}>
              {t('cancel')}
            </Button>
            <Button onClick={saveLinks} disabled={linkSaving || selectedPlanIds.length === 0}>
              {linkSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('linkPlanToMilestone')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResultPill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: 'emerald' | 'red' | 'amber' | 'slate';
}) {
  const toneClasses: Record<typeof tone, string> = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300',
  } as const;
  return (
    <div className={`rounded-lg ${toneClasses[tone]} p-3 flex items-center gap-3`}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide opacity-80">{label}</span>
        <span className="text-xl font-bold leading-tight">{value}</span>
      </div>
    </div>
  );
}
