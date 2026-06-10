import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, HeartPulse, Loader2, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getApiErrorMessage, testAssetHealthAPI } from '@/lib/api';
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

const DEBT_TYPES: TestDebtType[] = ['stale', 'duplicate', 'orphan', 'always_pass', 'never_run', 'no_requirement_link'];
const PAGE_SIZE = 25;

export function TestAssetHealth() {
  const { projectId } = useParams<{ projectId: string }>();
  const parsedProjectId = projectId ? Number(projectId) : null;
  const projectIdNum = parsedProjectId && Number.isFinite(parsedProjectId) ? parsedProjectId : null;
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const { canWrite } = usePermissions();

  const [summary, setSummary] = useState<TestAssetHealthSummary | null>(null);
  const [items, setItems] = useState<TestDebtItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
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
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToLoadTestAssetHealth')), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
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

  return (
    <div className="p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-rose-600" /> {t('testAssetHealth')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('testAssetHealthDescription')}</p>
        </div>
        {canWrite && (
          <Button onClick={detectDebt} disabled={detecting}>
            {detecting ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
            {t('runHealthScan')}
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label={t('totalTestCases')} value={summary?.total_cases ?? 0} />
        <MetricCard label={t('activeDebtItems')} value={summary?.active_debt_items ?? 0} tone="warning" />
        <MetricCard label={t('resolvedDebtItems')} value={summary?.resolved_debt_items ?? 0} tone="success" />
        <MetricCard label={t('criticalDebtItems')} value={summary?.by_severity?.critical ?? 0} tone="danger" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('testDebtTypeBreakdown')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            {DEBT_TYPES.map((type) => {
              const count = summary?.by_debt_type?.[type] ?? 0;
              const selected = debtType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setDebtType(selected ? 'all' : type); setPage(0); }}
                  className={`rounded-lg border p-3 text-start transition-colors ${
                    selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-muted/50'
                  }`}
                >
                  <p className="text-xs text-muted-foreground">{t(`debtType_${type}` as any)}</p>
                  <p className="mt-1 text-2xl font-semibold">{count}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
            </div>
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
              <Table>
                <TableHeader>
                  <TableRow>
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
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        <Link className="text-blue-600 hover:underline" to={`/projects/${projectIdNum}/test-cases/${item.test_case?.project_seq || item.test_case_id}`}>
                          {item.test_case?.title || t('testCaseIdValue', { id: String(item.test_case_id) })}
                        </Link>
                      </TableCell>
                      <TableCell>{t(`debtType_${item.debt_type}` as any)}</TableCell>
                      <TableCell><Badge className={severityClass[item.severity]}>{t(item.severity)}</Badge></TableCell>
                      <TableCell>{t(`debtAction_${item.suggested_action}` as any)}</TableCell>
                      <TableCell className="max-w-md text-muted-foreground">{item.details || t('noDetails')}</TableCell>
                      <TableCell>{item.auto_detected ? t('autoDetected') : t('manual')}</TableCell>
                      <TableCell className="text-right">
                        {!item.resolved_at && canWrite ? (
                          <Button variant="outline" size="sm" onClick={() => resolveItem(item)}>{t('resolve')}</Button>
                        ) : item.resolved_at ? (
                          <Badge variant="secondary">{t('resolved')}</Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {t('of')} {total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page === 0}
                    >
                      <ChevronLeft className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                      {t('previous')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={(page + 1) * PAGE_SIZE >= total}
                    >
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

function MetricCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warning' | 'success' | 'danger' }) {
  const toneClass = {
    default: 'text-foreground',
    warning: 'text-amber-600',
    success: 'text-emerald-600',
    danger: 'text-red-600',
  }[tone];
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-2 text-3xl font-bold ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
