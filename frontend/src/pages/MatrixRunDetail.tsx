import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertTriangle, ArrowLeft, ExternalLink, Grid3X3, Loader2, RefreshCw } from 'lucide-react';
import { matrixRunsAPI } from '@/lib/api';
import { MatrixRunDetail as MatrixRunDetailType } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

const matrixStatusClass = (status: string) => {
  if (status === 'completed') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (status === 'in_progress') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
};

const cellStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    block: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    skip: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    not_started: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };
  return classes[status] || classes.not_started;
};

export function MatrixRunDetail() {
  const navigate = useNavigate();
  const { projectId, matrixRunId } = useParams<{ projectId?: string; matrixRunId?: string }>();
  const { t, isRTL } = useTranslation();
  const currentProjectId = projectId ? parseInt(projectId) : null;

  const [matrixRun, setMatrixRun] = useState<MatrixRunDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMatrixRun = useCallback(async () => {
    if (!currentProjectId || !matrixRunId) return;
    try {
      setLoadError(null);
      setMatrixRun(await matrixRunsAPI.getBySeq(currentProjectId, parseInt(matrixRunId)));
    } catch (err) {
      console.error('Failed to load matrix run:', err);
      setLoadError(t('matrixRunNotFound'));
    } finally {
      setIsLoading(false);
    }
  }, [currentProjectId, matrixRunId, t]);

  useEffect(() => {
    void loadMatrixRun();
  }, [loadMatrixRun]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400" dir={isRTL ? 'rtl' : 'ltr'}>
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">{t('loading')}</p>
      </div>
    );
  }

  if (loadError || !matrixRun) {
    return (
      <div className="space-y-4 py-12 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
        <h2 className="text-2xl font-bold">{loadError ?? t('matrixRunNotFound')}</h2>
        <Button variant="outline" onClick={() => navigate(`/projects/${currentProjectId}/matrix-runs`)}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
          {t('backToMatrixRuns')}
        </Button>
      </div>
    );
  }

  const goToRun = (testRunId: number, testRunSeq?: number | null) => {
    navigate(`/projects/${currentProjectId}/test-runs/${testRunSeq ?? testRunId}`);
  };

  const goToExecution = (
    testRunId: number,
    testRunSeq: number | null | undefined,
    testCaseId: number,
    testCaseSeq?: number | null,
  ) => {
    navigate(
      `/projects/${currentProjectId}/test-runs/${testRunSeq ?? testRunId}/test-cases/${testCaseSeq ?? testCaseId}`
    );
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ms-2 text-slate-500"
            onClick={() => navigate(`/projects/${currentProjectId}/matrix-runs`)}
          >
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-1 rotate-180' : 'mr-1'}`} />
            {t('backToMatrixRuns')}
          </Button>
          <div className="flex items-center gap-2">
            <Grid3X3 className="h-6 w-6 shrink-0 text-blue-600 dark:text-blue-400" />
            <h1 className="truncate text-3xl font-bold">{matrixRun.name}</h1>
            <Badge className={`shrink-0 ${matrixStatusClass(matrixRun.status)}`}>
              {t(`matrixStatus_${matrixRun.status}`)}
            </Badge>
          </div>
          {matrixRun.description && <p className="text-gray-600">{matrixRun.description}</p>}
          <p className="text-sm text-slate-500">
            {t('matrixCasesBadge', { count: matrixRun.case_count })}
            {' · '}
            {t('matrixEnvironmentsBadge', { count: matrixRun.environments.length })}
            {' · '}
            {t('matrixProgressBadge', { percent: matrixRun.progress_percent })}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => { setIsLoading(true); void loadMatrixRun(); }}>
          <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
          {t('refresh')}
        </Button>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px]">{t('testCase')}</TableHead>
                {matrixRun.environments.map((col) => (
                  <TableHead key={col.test_run_id} className="min-w-[150px] text-center">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-semibold hover:underline"
                      onClick={() => goToRun(col.test_run_id, col.test_run_seq)}
                      title={t('viewTestRun')}
                    >
                      {col.environment_name}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <div className="mt-1 text-xs font-normal text-slate-500">
                      {col.executed_tests}/{col.total_tests} · {col.progress_percent}%
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrixRun.rows.map((row) => (
                <TableRow key={row.test_case_id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {row.test_case_seq != null && (
                        <Badge variant="secondary" className="shrink-0 text-xs">TC-{row.test_case_seq}</Badge>
                      )}
                      <span className="truncate" title={row.title}>{row.title}</span>
                    </div>
                  </TableCell>
                  {matrixRun.environments.map((col) => {
                    const cell = row.results[String(col.test_run_id)];
                    const status = cell?.status ?? 'not_started';
                    return (
                      <TableCell key={col.test_run_id} className="text-center">
                        <button
                          type="button"
                          className="inline-block"
                          onClick={() =>
                            goToExecution(col.test_run_id, col.test_run_seq, row.test_case_id, row.test_case_seq)
                          }
                          title={t('executeTestCase')}
                        >
                          <Badge className={`cursor-pointer ${cellStatusClass(status)}`}>
                            {t(`resultStatus_${status}`)}
                          </Badge>
                        </button>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
