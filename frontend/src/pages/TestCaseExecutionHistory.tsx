import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle, Clock, Play, User, XCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { testCasesAPI } from '@/lib/api';
import { formatDurationSeconds } from '@/utils/timeFormat';

const formatDateTime = (value?: string | null) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatLabel = (value?: string | null) => {
  if (!value) return 'Unknown';
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const getStatusClass = (status?: string | null) => {
  const normalized = String(status || '').toLowerCase();
  const variants: Record<string, string> = {
    pass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    passed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    block: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    blocked: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    skip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    skipped: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return variants[normalized] || variants.pending;
};

const getStatusIcon = (status?: string | null) => {
  const normalized = String(status || '').toLowerCase();
  if (['pass', 'passed'].includes(normalized)) return <CheckCircle className="h-4 w-4 text-emerald-600" />;
  if (['fail', 'failed'].includes(normalized)) return <XCircle className="h-4 w-4 text-red-600" />;
  if (['block', 'blocked'].includes(normalized)) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <Clock className="h-4 w-4 text-slate-500" />;
};

export function TestCaseExecutionHistory() {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const navigate = useNavigate();
  const { t, isRTL, language } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testCase, setTestCase] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    let isMounted = true;

    const loadHistory = async () => {
      const testCaseId = Number(id);
      if (!testCaseId || Number.isNaN(testCaseId)) {
        setError(t('invalidTestCaseData'));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [caseData, historyData] = await Promise.all([
          testCasesAPI.getById(testCaseId),
          testCasesAPI.getExecutionHistory(testCaseId, 200),
        ]);

        if (!isMounted) return;
        setTestCase(caseData);
        setHistory(historyData || []);
      } catch (loadError) {
        console.error('Failed to load execution history:', loadError);
        if (isMounted) setError(t('failedToLoadExecutionHistory'));
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [id, language, t]);

  const groupedRuns = useMemo(() => {
    const grouped = new Map<number, any[]>();
    for (const item of history) {
      if (!item?.test_run_id) continue;
      const runId = Number(item.test_run_id);
      if (!grouped.has(runId)) grouped.set(runId, []);
      grouped.get(runId)?.push(item);
    }

    return Array.from(grouped.entries()).map(([runId, entries]) => {
      const latest = entries[0];
      return {
        runId,
        entries,
        latest,
        name: latest?.test_run_name || `${t('testRun')} #${runId}`,
        projectId: latest?.project_id || projectId,
      };
    });
  }, [history, projectId, t]);

  const executorCount = useMemo(() => new Set(
    history.map((item) => item.executed_by_full_name || item.executed_by || item.executed_by_email).filter(Boolean)
  ).size, [history]);

  const totalExecutionSeconds = useMemo(() => (
    history.reduce((total, item) => total + (Number(item.execution_time) || 0), 0)
  ), [history]);

  const backToTestCase = () => {
    if (projectId && id) {
      navigate(`/projects/${projectId}/test-cases/${id}`);
      return;
    }
    navigate(`/test-cases/${id}`);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <div className="h-32 animate-pulse rounded-3xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-96 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="max-w-lg text-center">
          <CardHeader><CardTitle>{t('executionHistory')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={backToTestCase}>{t('backToTestCase')}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-white px-4 py-6 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <Button variant="ghost" onClick={backToTestCase} className="-mx-3 mb-4 h-9 text-slate-600 dark:text-slate-300">
            {isRTL ? <ArrowRight className="ml-2 h-4 w-4" /> : <ArrowLeft className="mr-2 h-4 w-4" />}
            {t('backToTestCase')}
          </Button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Badge variant="outline" className="mb-3 rounded-full">TC-{id}</Badge>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{t('testCaseExecutionHistory')}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                {testCase?.title || t('testCase')} · {t('executionHistoryDescription')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 overflow-x-auto pb-1 text-center sm:grid-cols-4 lg:min-w-xl">
              <Summary label={t('totalRuns')} value={groupedRuns.length.toString()} />
              <Summary label={t('totalExecutions')} value={history.length.toString()} />
              <Summary label={t('uniqueExecutors')} value={executorCount.toString()} />
              <Summary label={t('totalExecutionTime')} value={formatDurationSeconds(totalExecutionSeconds, t)} />
            </div>
          </div>
        </div>

        {groupedRuns.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-slate-500">{t('noExecutionHistory')}</CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groupedRuns.map((run) => (
              <Card key={run.runId} className="overflow-hidden border-slate-200 shadow-xs dark:border-slate-800">
                <CardHeader className="border-b bg-slate-50/80 dark:bg-slate-900/60">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 truncate text-lg">
                        <Play className="h-5 w-5 text-blue-600" />
                        {run.name}
                      </CardTitle>
                      <p className="mt-1 text-xs text-slate-500">
                        {t('runStatusLabel')}: {formatLabel(run.latest?.test_run_status)} · {t('runPriorityLabel')}: {formatLabel(run.latest?.test_run_priority)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/projects/${run.projectId}/test-runs/${run.runId}/test-cases/${id}`)}
                    >
                      {t('openExecution')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
                  {run.entries.map((item) => (
                    <div key={item.id} className="grid gap-4 p-4 md:grid-cols-[180px_minmax(0,1fr)_220px] md:items-start">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(item.status)}
                        <Badge className={getStatusClass(item.status)}>{formatLabel(item.status)}</Badge>
                      </div>
                      <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                        {item.actual_result && <p><span className="font-semibold">{t('actualResultLabel')}:</span> {item.actual_result}</p>}
                        {item.comments && <p><span className="font-semibold">{t('comments')}:</span> {item.comments}</p>}
                        {item.execution_started_at && <p><span className="font-semibold">{t('executionStartedLabel')}:</span> {formatDateTime(item.execution_started_at)}</p>}
                        {item.execution_time != null && <p><span className="font-semibold">{t('executionTimeLabel')}:</span> {formatDurationSeconds(item.execution_time, t)}</p>}
                      </div>
                      <div className="space-y-1 text-xs text-slate-500">
                        <p className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {item.executed_by_full_name || item.executed_by || item.executed_by_email || t('unknown')}</p>
                        <p>{formatDateTime(item.executed_at || item.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-34 rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
      <p className="whitespace-nowrap text-xl font-semibold text-slate-950 dark:text-white">{value}</p>
      <p className="mt-1 whitespace-nowrap text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
