import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { History } from 'lucide-react';
import { formatDurationSeconds } from '@/utils/timeFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useExecution } from './ExecutionContext';
import { formatStatusLabel } from './statusConfig';

export function ExecutionHistoryCard() {
  const {
    t, historyByRun, historySummary, historyLoadError, executionHistory, openRunExecution,
  } = useExecution();
  const { formatDateTime } = useDateFormat();

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="border-b border-slate-100 pb-3 dark:border-slate-800">
        <CardTitle className="flex items-center justify-between gap-3 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-400" />
            {t('executionHistory')}
          </span>
          {historyByRun.length > 0 && (
            <Badge variant="outline" className="text-[10px]">{t('totalRuns')}: {historySummary.totalRuns}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {historyLoadError && <p className="text-xs text-red-600">{t('failedToLoadExecutionHistory')}</p>}

        {historyByRun.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400 dark:border-slate-700">
            {t('noExecutionHistory')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/60">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{t('totalExecutions')}</p>
                <p className="text-lg font-semibold">{historySummary.totalExecutions}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/60">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{t('uniqueExecutors')}</p>
                <p className="text-lg font-semibold">{historySummary.uniqueExecutors}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{t('usedInTestRuns')}</p>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {historyByRun.map((run) => (
                  <button
                    key={run.runId}
                    type="button"
                    onClick={() => openRunExecution(run.runId)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-800 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{run.runName}</p>
                      <Badge variant="outline" className="text-[10px]">{formatStatusLabel(run.latestStatus)}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t('lastExecutedByAt', {
                        executor: run.latestExecutor,
                        date: run.lastExecutedAt ? formatDateTime(run.lastExecutedAt) : t('nA'),
                      })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-400">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                        {t('runStatusLabel')}: {formatStatusLabel(run.runStatus)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                        {t('runPriorityLabel')}: {formatStatusLabel(run.runPriority)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto border-t border-slate-100 pr-1 pt-3 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{t('resultDetails')}</p>
              {executionHistory.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium">{item.test_run_name || `${t('testRun')} #${item.test_run_id}`}</p>
                    <Badge variant="outline" className="text-[10px]">{formatStatusLabel(item.status)}</Badge>
                  </div>
                  <div className="mt-1 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <p>
                      {t('executorLabel')}: {item.executed_by_full_name || item.executed_by || t('unknown')}
                      {item.executed_by_email ? ` (${item.executed_by_email})` : ''}
                    </p>
                    <p>{t('executionDateLabel')}: {item.executed_at ? formatDateTime(item.executed_at) : t('nA')}</p>
                    <p>{t('runStatusLabel')}: {item.test_run_status || t('unknown')}</p>
                    {item.execution_started_at && <p>{t('executionStartedLabel')}: {formatDateTime(item.execution_started_at)}</p>}
                    {item.execution_time != null && <p>{t('executionTimeLabel')}: {formatDurationSeconds(item.execution_time, t)}</p>}
                    {item.actual_result && <p>{t('actualResultLabel')}: {item.actual_result}</p>}
                    {item.comments && <p>{t('comments')}: <span className="italic">"{item.comments}"</span></p>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
