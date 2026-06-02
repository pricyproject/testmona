import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Clock, Bug, RefreshCw, Calendar } from 'lucide-react';
import { formatDurationSeconds } from '@/utils/timeFormat';
import { useExecution } from './ExecutionContext';
import { getStatusOption, getStatusBadgeClass } from './statusConfig';

export function ResultSummaryCard() {
  const {
    t, executionStatus, assignee, users, currentUser,
    elapsedSeconds, executionStartedAt, resultDefectLinks, retestNeeded,
    openDefectDialog, canWrite,
  } = useExecution();

  const option = getStatusOption(executionStatus);
  const Icon = option?.icon;
  const assigneeUser = users.find((u) => u.id?.toString() === assignee) || (assignee === currentUser?.id?.toString() ? currentUser : null);
  const assigneeName = assigneeUser
    ? (assigneeUser.full_name || assigneeUser.username || assigneeUser.email || `User ${assigneeUser.id}`)
    : t('unknown');

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{t('currentStatus')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${getStatusBadgeClass(executionStatus)}`}>
          {Icon && <Icon className="h-6 w-6 shrink-0" />}
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight">{option ? t(option.labelKey) : executionStatus}</p>
            {executionStatus === 'pending' && <p className="text-[11px] opacity-80">{t('notYetRecorded')}</p>}
          </div>
        </div>

        {retestNeeded && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-semibold">{t('retestNeededTitle')}</div>
              <div>{t('retestNeededDescription')}</div>
            </div>
          </div>
        )}

        <dl className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-slate-400"><User className="h-3.5 w-3.5" />{t('assigneeLabel')}</dt>
            <dd className="truncate font-medium text-slate-700 dark:text-slate-200">{assigneeName}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-slate-400"><Clock className="h-3.5 w-3.5" />{t('elapsedTimeLabel')}</dt>
            <dd className="font-mono font-medium tabular-nums text-slate-700 dark:text-slate-200">{formatDurationSeconds(elapsedSeconds, t)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-slate-400"><Calendar className="h-3.5 w-3.5" />{t('executionStartedLabel')}</dt>
            <dd className="truncate font-medium text-slate-700 dark:text-slate-200">
              {executionStartedAt ? new Date(executionStartedAt).toLocaleString() : t('nA')}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-slate-400"><Bug className="h-3.5 w-3.5" />{t('linkedDefects')}</dt>
            <dd className="font-medium text-slate-700 dark:text-slate-200">{resultDefectLinks.length}</dd>
          </div>
        </dl>

        {canWrite && (
          <Button variant="outline" className="h-8 w-full justify-center text-xs" onClick={openDefectDialog}>
            <Bug className="mr-2 h-3.5 w-3.5 text-orange-600" />
            {t('reportDefect')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
