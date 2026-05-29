import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity, Bug, Calendar, Edit, FileCheck, FileText, Loader2, Minus, Play, Plus, RefreshCw,
} from 'lucide-react';
import { ReportsData } from '@/hooks/useReportsData';

const getActionIcon = (action: string) => {
  switch (action.toLowerCase()) {
    case 'create': return <Plus className="h-4 w-4 text-green-600" />;
    case 'update': case 'edit': return <Edit className="h-4 w-4 text-blue-600" />;
    case 'delete': return <Minus className="h-4 w-4 text-red-600" />;
    case 'execute': return <Play className="h-4 w-4 text-purple-600" />;
    default: return <Activity className="h-4 w-4 text-gray-600" />;
  }
};

const getEntityIcon = (entityType: string) => {
  switch (entityType.toLowerCase()) {
    case 'test_case': return <FileText className="h-4 w-4" />;
    case 'test_suite': return <FileCheck className="h-4 w-4" />;
    case 'test_run': return <Play className="h-4 w-4" />;
    case 'defect': return <Bug className="h-4 w-4" />;
    default: return <Activity className="h-4 w-4" />;
  }
};

function ActivityStatistics({ ctx }: { ctx: ReportsData }) {
  const { t } = useTranslation();
  const { activityStats, timeRange, setTimeRange, loadActivityStatistics } = ctx;
  const isLoading = !!ctx.loadingByTab.activity;

  const activityCounts = activityStats?.activity_counts || [];
  const entityCounts = activityStats?.entity_counts || [];
  const totalActivities = Math.max(activityStats?.total_activities || 0, 1);
  const maxActionCount = Math.max(1, ...activityCounts.map((item: any) => Number(item.count || 0)));
  const maxEntityCount = Math.max(1, ...entityCounts.map((item: any) => Number(item.count || 0)));
  const getActionCount = (...actions: string[]) =>
    activityCounts
      .filter((item: any) => actions.includes(String(item.action || '').toLowerCase()))
      .reduce((sum: number, item: any) => sum + Number(item.count || 0), 0);
  const getShare = (count: number) => Math.round((Number(count || 0) / totalActivities) * 100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t('reportsTabActivityStats')}</h2>
          <p className="text-sm text-gray-600">{t('reports_activityStatsSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">{t('reports_timeLast24h')}</SelectItem>
              <SelectItem value="7d">{t('reports_timeLast7d')}</SelectItem>
              <SelectItem value="30d">{t('reports_timeLast30d')}</SelectItem>
              <SelectItem value="90d">{t('reports_timeLast90d')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => loadActivityStatistics()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('reports_refresh')}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
          <span className="text-gray-600">{t('reports_loadingActivityStats')}</span>
        </div>
      )}

      {!isLoading && activityStats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">{t('reports_totalActivities')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{activityStats.total_activities || 0}</div>
                <p className="text-xs text-gray-500 mt-1">{t('reports_lastNDays', { days: activityStats.days })}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">{t('reports_createdActivities')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-green-600" />
                  <div className="text-2xl font-bold">{getActionCount('create')}</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">{t('reports_newRecordsCreated')}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">{t('reports_updatedActivities')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Edit className="h-5 w-5 text-blue-600" />
                  <div className="text-2xl font-bold">{getActionCount('update', 'edit')}</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">{t('reports_recordsModified')}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">{t('reports_deletedActivities')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Minus className="h-5 w-5 text-red-600" />
                  <div className="text-2xl font-bold">{getActionCount('delete')}</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">{t('reports_recordsRemoved')}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('reports_breakdownByAction')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {activityCounts.length === 0 && <p className="text-sm text-gray-500">{t('reports_noActionsRecorded')}</p>}
                  {activityCounts.map((activity: any) => {
                    const count = Number(activity.count || 0);
                    const share = getShare(count);
                    return (
                      <div key={activity.action} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {getActionIcon(activity.action)}
                            <span className="text-sm capitalize truncate">{String(activity.action || '').replace('_', ' ')}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-gray-500">{share}%</span>
                            <Badge variant="secondary" className="min-w-12 justify-center">{count}</Badge>
                          </div>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700" title={`${count} of ${activityStats.total_activities || 0} activities (${share}%)`}>
                          <div className="h-2.5 rounded-full bg-blue-600" style={{ width: `${Math.max(4, Math.min(100, (count / maxActionCount) * 100))}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('reports_breakdownByEntity')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {entityCounts.length === 0 && <p className="text-sm text-gray-500">{t('reports_noEntitiesRecorded')}</p>}
                  {entityCounts.map((entity: any) => {
                    const count = Number(entity.count || 0);
                    const share = getShare(count);
                    return (
                      <div key={entity.entity_type} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {getEntityIcon(entity.entity_type)}
                            <span className="text-sm capitalize truncate">{String(entity.entity_type || '').replace('_', ' ')}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-gray-500">{share}%</span>
                            <Badge variant="secondary" className="min-w-12 justify-center">{count}</Badge>
                          </div>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700" title={`${count} of ${activityStats.total_activities || 0} activities (${share}%)`}>
                          <div className="h-2.5 rounded-full bg-green-600" style={{ width: `${Math.max(4, Math.min(100, (count / maxEntityCount) * 100))}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {activityStats.top_users && activityStats.top_users.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('reports_topContributors')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {activityStats.top_users.map((user: any, index: number) => (
                    <div key={user.user_id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-medium">
                          #{index + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{user.full_name || user.username || `User ${user.user_id}`}</p>
                          <p className="text-xs text-gray-500">{user.activity_count} {t('reports_activitiesCountLabel')}</p>
                        </div>
                      </div>
                      <Badge variant="outline">{user.activity_count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-blue-900 dark:text-blue-100">
                <Calendar className="h-4 w-4" />
                <span>
                  {t('reports_showingActivities', {
                    start: activityStats.date_from ? new Date(activityStats.date_from).toLocaleDateString() : 'N/A',
                    end: activityStats.date_to ? new Date(activityStats.date_to).toLocaleDateString() : 'N/A',
                  })}
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!isLoading && !activityStats && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Activity className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 text-center">{t('reports_noActivityData')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TestActivity({ ctx }: { ctx: ReportsData }) {
  const { t } = useTranslation();
  const { testActivity, timeRange, setTimeRange, loadTestActivity } = ctx;
  const isLoading = !!ctx.loadingByTab['test-activity'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const activitySource = testActivity?.activity || testActivity?.activity_data || [];
  const activity = Array.isArray(activitySource) ? activitySource : [];
  const summary = testActivity?.summary || {
    total_added: activity.reduce((sum: number, item: any) => sum + Number(item.added || 0), 0),
    total_modified: activity.reduce((sum: number, item: any) => sum + Number(item.modified || 0), 0),
    total_executed: activity.reduce((sum: number, item: any) => sum + Number(item.executed || 0), 0),
    total_deleted: activity.reduce((sum: number, item: any) => sum + Number(item.deleted || 0), 0),
  };
  const maxActivityTotal = Math.max(
    1,
    ...activity.map((day: any) => Number(day.added || 0) + Number(day.modified || 0) + Number(day.executed || 0))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t('reportsTabTestActivity')}</h2>
          <p className="text-sm text-gray-600">{t('reports_testActivitySubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">{t('reports_timeLast24h')}</SelectItem>
              <SelectItem value="7d">{t('reports_timeLast7d')}</SelectItem>
              <SelectItem value="30d">{t('reports_timeLast30d')}</SelectItem>
              <SelectItem value="90d">{t('reports_timeLast90d')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => loadTestActivity()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('reports_refresh')}
          </Button>
        </div>
      </div>

      {!testActivity && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-gray-500">{t('reports_noTestActivity')}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t('reports_testsAdded')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{summary.total_added}</div>
            <p className="text-xs text-gray-500">{t('reports_newRecordsCreated')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t('reports_testsModifiedLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{summary.total_modified}</div>
            <p className="text-xs text-gray-500">{t('reports_testCasesUpdated')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t('reports_testsExecutedLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{summary.total_executed}</div>
            <p className="text-xs text-gray-500">{t('reports_testExecutions')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t('reports_testsDeleted')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{summary.total_deleted}</div>
            <p className="text-xs text-gray-500">{t('reports_recordsRemoved')}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('reports_testActivityOverTime')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <div className="space-y-2">
              {activity.length === 0 && (
                <div className="flex h-48 items-center justify-center text-sm text-gray-500">{t('reports_noActivityInPeriod')}</div>
              )}
              {activity.slice(-14).map((day: any) => (
                <div key={day.date} className="flex items-center gap-2">
                  <div className="w-24 text-xs text-gray-600">{new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  <div className="flex-1 flex gap-1">
                    {day.added > 0 && (
                      <div className="bg-green-500 h-6 flex items-center justify-center text-xs text-white rounded" style={{ width: `${(Number(day.added || 0) / maxActivityTotal) * 100}%`, minWidth: '20px' }} title={`${day.added} added`}>
                        {day.added}
                      </div>
                    )}
                    {day.modified > 0 && (
                      <div className="bg-blue-500 h-6 flex items-center justify-center text-xs text-white rounded" style={{ width: `${(Number(day.modified || 0) / maxActivityTotal) * 100}%`, minWidth: '20px' }} title={`${day.modified} modified`}>
                        {day.modified}
                      </div>
                    )}
                    {day.executed > 0 && (
                      <div className="bg-purple-500 h-6 flex items-center justify-center text-xs text-white rounded" style={{ width: `${(Number(day.executed || 0) / maxActivityTotal) * 100}%`, minWidth: '20px' }} title={`${day.executed} executed`}>
                        {day.executed}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-500 rounded"></div>
              <span className="text-sm">{t('reports_legendAdded')}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-500 rounded"></div>
              <span className="text-sm">{t('reports_legendModified')}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-purple-500 rounded"></div>
              <span className="text-sm">{t('reports_legendExecuted')}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ActivitySection({ ctx }: { ctx: ReportsData }) {
  return (
    <div className="space-y-8">
      <ActivityStatistics ctx={ctx} />
      <TestActivity ctx={ctx} />
    </div>
  );
}
