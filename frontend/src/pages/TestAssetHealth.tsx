import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Ghost,
  HeartPulse,
  Link2Off,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getApiErrorMessage, testAssetHealthAPI } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { TestAssetHealthSummary, TestDebtItem, TestDebtSeverity, TestDebtType } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

type ResolvedFilter = 'active' | 'resolved' | 'all';

const severityClass: Record<TestDebtSeverity, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

// Left accent + segment colours, keyed by severity, shared by the rows and the bar.
const severityAccent: Record<TestDebtSeverity, string> = {
  low: 'bg-slate-400',
  medium: 'bg-amber-400',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
};

const SEVERITY_ORDER: TestDebtSeverity[] = ['critical', 'high', 'medium', 'low'];

const debtTypeIcon: Record<TestDebtType, typeof Clock> = {
  stale: Clock,
  duplicate: Copy,
  orphan: Ghost,
  always_pass: CheckCheck,
  never_run: Ban,
  no_requirement_link: Link2Off,
};

const DEBT_TYPES: TestDebtType[] = ['stale', 'duplicate', 'orphan', 'always_pass', 'never_run', 'no_requirement_link'];
const PAGE_SIZE = 25;

export function TestAssetHealth() {
  const { projectId } = useParams<{ projectId: string }>();
  const parsedProjectId = projectId ? Number(projectId) : null;
  const projectIdNum = parsedProjectId && Number.isFinite(parsedProjectId) ? parsedProjectId : null;
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();
  const { canWrite } = usePermissions();

  const [summary, setSummary] = useState<TestAssetHealthSummary | null>(null);
  const [items, setItems] = useState<TestDebtItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [resolvingBulk, setResolvingBulk] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [debtType, setDebtType] = useState<TestDebtType | 'all'>('all');
  const [severity, setSeverity] = useState<TestDebtSeverity | 'all'>('all');
  const [resolved, setResolved] = useState<ResolvedFilter>('active');

  const load = async () => {
    if (!projectIdNum) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextSummary, { items: nextItems, total: nextTotal }] = await Promise.all([
        testAssetHealthAPI.getSummary(projectIdNum),
        testAssetHealthAPI.listDebtItems(projectIdNum, {
          debt_type: debtType,
          severity,
          resolved,
          skip: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        }),
      ]);
      setSummary(nextSummary);
      setItems(nextItems);
      setTotal(nextTotal);
      setSelected(new Set());
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToLoadTestAssetHealth')), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdNum, debtType, severity, resolved, page]);

  const detectDebt = async () => {
    if (!projectIdNum) return;
    setDetecting(true);
    try {
      const result = await testAssetHealthAPI.detect(projectIdNum);
      setSummary(result.summary);
      toast({
        title: t('testAssetDetectionComplete'),
        description: t('testAssetDetectionSummary', {
          created: String(result.created),
          updated: String(result.updated),
          resolved: String(result.auto_resolved),
        }),
      });
      await load();
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToDetectTestAssetDebt')), variant: 'destructive' });
    } finally {
      setDetecting(false);
    }
  };

  const resolveItem = async (item: TestDebtItem) => {
    if (!projectIdNum) return;
    try {
      await testAssetHealthAPI.resolve(projectIdNum, item.id);
      toast({ title: t('success'), description: t('testDebtItemResolved') });
      await load();
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToResolveTestDebtItem')), variant: 'destructive' });
    }
  };

  const resolveSelected = async () => {
    if (!projectIdNum || selected.size === 0) return;
    setResolvingBulk(true);
    try {
      const result = await testAssetHealthAPI.resolveBulk(projectIdNum, Array.from(selected));
      setSummary(result.summary);
      toast({ title: t('success'), description: t('bulkResolveComplete', { count: String(result.resolved) }) });
      await load();
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToBulkResolve')), variant: 'destructive' });
    } finally {
      setResolvingBulk(false);
    }
  };

  const selectableIds = useMemo(
    () => items.filter((item) => !item.resolved_at).map((item) => item.id),
    [items],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));

  const toggleAll = () => {
    setSelected((prev) => {
      if (selectableIds.every((id) => prev.has(id))) return new Set();
      return new Set(selectableIds);
    });
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const lastScan = formatRelativeTime(summary?.last_detected_at, language);

  return (
    <div className="p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-rose-50 via-background to-background p-6 dark:from-rose-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-rose-500/10 p-2.5 text-rose-600 dark:text-rose-400">
              <HeartPulse className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('testAssetHealth')}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('testAssetHealthDescription')}</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {t('lastScan')}: <span className="font-medium text-foreground">{lastScan || t('neverScanned')}</span>
              </p>
            </div>
          </div>
          {canWrite && (
            <Button onClick={detectDebt} disabled={detecting} size="lg" className="shrink-0">
              {detecting ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('runHealthScan')}
            </Button>
          )}
        </div>
      </div>

      {/* Overview: health score + stats + severity bar */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HealthScoreCard score={summary?.health_score ?? 100} t={t} />

        <Card className="lg:col-span-2">
          <CardContent className="grid h-full grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <StatTile icon={Activity} label={t('totalTestCases')} value={summary?.total_cases ?? 0} />
            <StatTile icon={AlertTriangle} label={t('activeDebtItems')} value={summary?.active_debt_items ?? 0} tone="warning" />
            <StatTile icon={ShieldCheck} label={t('healthyCases')} value={summary?.healthy_cases ?? 0} tone="success" />
            <StatTile icon={CheckCircle2} label={t('resolvedDebtItems')} value={summary?.resolved_debt_items ?? 0} tone="muted" />
            <div className="col-span-2 mt-1 sm:col-span-4">
              <SeverityBar summary={summary} t={t} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Debt by type */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('testDebtTypeBreakdown')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            {DEBT_TYPES.map((type) => {
              const count = summary?.by_debt_type?.[type] ?? 0;
              const selectedType = debtType === type;
              const Icon = debtTypeIcon[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setDebtType(selectedType ? 'all' : type); setPage(0); }}
                  className={cn(
                    'group rounded-xl border p-3 text-start transition-all hover:shadow-sm',
                    selectedType
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/30 dark:bg-blue-950/30'
                      : 'hover:border-muted-foreground/30 hover:bg-muted/40',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Icon className={cn('h-4 w-4', count > 0 ? 'text-rose-500' : 'text-muted-foreground/60')} />
                    {count > 0 && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{count}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(`debtType_${type}` as any)}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Backlog */}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> {t('testDebtBacklog')}
            </CardTitle>
            <div className="grid gap-2 sm:grid-cols-3 lg:w-[660px]">
              <Select value={debtType} onValueChange={(value) => { setDebtType(value as TestDebtType | 'all'); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder={t('debtType')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allDebtTypes')}</SelectItem>
                  {DEBT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{t(`debtType_${type}` as any)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={severity} onValueChange={(value) => { setSeverity(value as TestDebtSeverity | 'all'); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder={t('severity')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allSeverities')}</SelectItem>
                  {(['low', 'medium', 'high', 'critical'] as TestDebtSeverity[]).map((level) => (
                    <SelectItem key={level} value={level}>{t(level)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={resolved} onValueChange={(value) => { setResolved(value as ResolvedFilter); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder={t('statusLabel')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('activeDebt')}</SelectItem>
                  <SelectItem value="resolved">{t('resolvedDebt')}</SelectItem>
                  <SelectItem value="all">{t('allDebt')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bulk action toolbar */}
          {canWrite && selected.size > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-900 dark:bg-blue-950/30">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{selected.size}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={resolveSelected} disabled={resolvingBulk}>
                  {resolvingBulk ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <CheckCheck className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                  {t('resolveSelected', { count: String(selected.size) })}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  <X className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} /> {t('clearSelection')}
                </Button>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <BacklogSkeleton />
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
              <p className="font-medium text-foreground">{t('noTestDebtItems')}</p>
              <p className="mx-auto mt-2 max-w-xl text-sm">{t('noTestDebtItemsDescription')}</p>
              {canWrite && (
                <Button className="mt-4" variant="outline" onClick={detectDebt} disabled={detecting}>
                  {detecting ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                  {t('runHealthScan')}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      {canWrite && (
                        <TableHead className="w-10">
                          {selectableIds.length > 0 && (
                            <Checkbox
                              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                              onCheckedChange={toggleAll}
                              aria-label={t('selectAllRows')}
                            />
                          )}
                        </TableHead>
                      )}
                      <TableHead>{t('testCase')}</TableHead>
                      <TableHead>{t('debtType')}</TableHead>
                      <TableHead>{t('severity')}</TableHead>
                      <TableHead>{t('suggestedAction')}</TableHead>
                      <TableHead>{t('details')}</TableHead>
                      <TableHead>{t('source')}</TableHead>
                      <TableHead className="text-right">{t('actionsLabel')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const Icon = debtTypeIcon[item.debt_type];
                      const isResolved = !!item.resolved_at;
                      const checked = selected.has(item.id);
                      return (
                        <TableRow
                          key={item.id}
                          className={cn('relative', checked && 'bg-blue-50/60 dark:bg-blue-950/20', isResolved && 'opacity-60')}
                        >
                          {canWrite && (
                            <TableCell className="relative">
                              <span className={cn('absolute inset-y-0 start-0 w-1', isResolved ? 'bg-transparent' : severityAccent[item.severity])} />
                              {!isResolved && (
                                <Checkbox checked={checked} onCheckedChange={() => toggleOne(item.id)} aria-label={item.test_case?.title || String(item.test_case_id)} />
                              )}
                            </TableCell>
                          )}
                          <TableCell className="font-medium">
                            <Link className="text-blue-600 hover:underline" to={`/projects/${projectIdNum}/test-cases/${item.test_case?.project_seq || item.test_case_id}`}>
                              {item.test_case?.title || t('testCaseIdValue', { id: String(item.test_case_id) })}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              {t(`debtType_${item.debt_type}` as any)}
                            </span>
                          </TableCell>
                          <TableCell><Badge className={severityClass[item.severity]}>{t(item.severity)}</Badge></TableCell>
                          <TableCell className="whitespace-nowrap">{t(`debtAction_${item.suggested_action}` as any)}</TableCell>
                          <TableCell className="max-w-md text-sm text-muted-foreground">{item.details || t('noDetails')}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-normal">{item.auto_detected ? t('autoDetected') : t('manual')}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {!isResolved && canWrite ? (
                              <Button variant="outline" size="sm" onClick={() => resolveItem(item)}>{t('resolve')}</Button>
                            ) : isResolved ? (
                              <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> {t('resolved')}</Badge>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {t('of')} {total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                      <ChevronLeft className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                      {t('previous')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>
                      {t('next')}
                      <ChevronRight className={`h-4 w-4 ${isRTL ? 'mr-1' : 'ml-1'}`} />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Sub-components -------------------------------------------------------

function scoreTone(score: number) {
  if (score >= 90) return { ring: 'text-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'scoreLabel_excellent' };
  if (score >= 75) return { ring: 'text-lime-500', text: 'text-lime-600 dark:text-lime-400', label: 'scoreLabel_good' };
  if (score >= 50) return { ring: 'text-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'scoreLabel_fair' };
  if (score >= 25) return { ring: 'text-orange-500', text: 'text-orange-600 dark:text-orange-400', label: 'scoreLabel_poor' };
  return { ring: 'text-red-500', text: 'text-red-600 dark:text-red-400', label: 'scoreLabel_critical' };
}

function HealthScoreCard({ score, t }: { score: number; t: (k: string) => string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const tone = scoreTone(score);
  return (
    <Card>
      <CardContent className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
        <div className="relative h-36 w-36">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-muted" />
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className={cn('transition-all duration-700 ease-out', tone.ring)}
              stroke="currentColor"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn('text-4xl font-bold tabular-nums', tone.text)}>{score}</span>
            <span className="text-xs text-muted-foreground">/ 100</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold">{t('healthScore')}</p>
          <Badge variant="secondary" className={cn('mt-1', tone.text)}>{t(tone.label)}</Badge>
          <p className="mt-2 text-xs text-muted-foreground">{t('healthScoreCaption')}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'success' | 'muted';
}) {
  const toneClass = {
    default: 'text-foreground',
    warning: 'text-amber-600 dark:text-amber-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    muted: 'text-muted-foreground',
  }[tone];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className={cn('text-3xl font-bold tabular-nums', toneClass)}>{value}</p>
    </div>
  );
}

function SeverityBar({ summary, t }: { summary: TestAssetHealthSummary | null; t: (k: string) => string }) {
  const bySeverity = summary?.by_severity ?? {};
  const totalActive = summary?.active_debt_items ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('severityDistribution')}</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {totalActive === 0 ? null : SEVERITY_ORDER.map((sev) => {
          const count = bySeverity[sev] ?? 0;
          if (count === 0) return null;
          return (
            <div
              key={sev}
              className={cn('h-full transition-all', severityAccent[sev])}
              style={{ width: `${(count / totalActive) * 100}%` }}
              title={`${t(sev)}: ${count}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {totalActive === 0 ? (
          <span className="text-xs text-muted-foreground">{t('noActiveDebt')}</span>
        ) : (
          SEVERITY_ORDER.map((sev) => (
            <span key={sev} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', severityAccent[sev])} />
              {t(sev)} <span className="font-medium text-foreground tabular-nums">{bySeverity[sev] ?? 0}</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function BacklogSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border p-4">
          <div className="h-4 w-4 animate-pulse rounded bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function formatRelativeTime(iso: string | null | undefined, language: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  try {
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
    return date.toLocaleDateString(language);
  } catch {
    return date.toLocaleString();
  }
}
