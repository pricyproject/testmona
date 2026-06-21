import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, Printer, ShieldCheck } from 'lucide-react';
import { analyticsAPI } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';

const activityValue = (activity: any, key: string, legacyKey?: string) =>
  activity?.[key] ?? (legacyKey ? activity?.[legacyKey] : undefined) ?? 0;

const upcomingCount = (upcoming: any, countKey: string, listKey: string) =>
  upcoming?.[countKey] ?? (Array.isArray(upcoming?.[listKey]) ? upcoming[listKey].length : 0);

/**
 * Public shared-report viewer. Works for both authenticated and anonymous users —
 * the share token in the URL is the only access gate (enforced server-side).
 */
export function SharedReportViewer() {
  const { token } = useParams<{ token: string }>();
  const { t, isRTL } = useTranslation();
  const { formatDate, formatDateTime } = useDateFormat();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);

  useEffect(() => {
    if (!token) {
      setError(t('reports_sharedMissingToken'));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    analyticsAPI
      .getSharedReport(token)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setLoading(false);
      })
      .catch((err: any) => {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 404) setError(t('reports_sharedNotFound'));
        else if (status === 410) setError(t('reports_sharedExpired'));
        else if (status === 401) setError(t('reports_sharedRestricted'));
        else setError(t('reports_sharedLoadFailed'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900" dir={isRTL ? 'rtl' : 'ltr'}>
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center py-10 text-center">
            <AlertCircle className="h-10 w-10 text-red-500 mb-3" />
            <p className="text-gray-700 dark:text-gray-200">{error || t('reports_sharedUnavailable')}</p>
            {error === t('reports_sharedRestricted') && (
              <Button className="mt-4" onClick={() => { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`; }}>
                {t('reports_sharedSignIn')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const content = report.report_content || {};
  const kpis = content.kpis || {};
  const summary = content.summary || {};
  const recent = content.recent_activity || {};
  const periodLabel = content.period?.label || t('reports_periodLast30d');
  const snapshotMode = content.snapshot_mode || 'snapshot';
  const accessLevel = report.access_level === 'edit' ? 'read-only' : report.access_level;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 print:bg-white print:py-0" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 print:hidden">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">{t('reports_sharedReportEyebrow')}</p>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{report.title}</h1>
          </div>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            {t('reports_printPdf')}
          </Button>
        </div>

        {/* Header card */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <CardTitle className="text-xl">{report.title}</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{t(`reports_reportType_${report.report_type}`)}</Badge>
                <Badge variant="outline"><ShieldCheck className="h-3 w-3 mr-1" />{t(`reports_access_${accessLevel}`)}</Badge>
                <Badge variant="outline">{periodLabel}</Badge>
                <Badge variant="outline">{t(`reports_snapshotMode_${snapshotMode}`)}</Badge>
                <Badge variant="outline">{t('reports_viewsCount', { count: report.view_count || 0 })}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {content.project_name ? (
                <>
                  {t('reports_projectLabel')} <span className="font-medium">{content.project_name}</span>
                  {' · '}
                </>
              ) : null}
              {t('reports_previewGeneratedBy', { user: content.generated_by || 'system' })}
              {content.generated_at ? t('reports_previewGeneratedAt', { time: formatDateTime(content.generated_at) }) : ''}
              {report.expires_at ? ` · ${t('reports_expiresLabel')} ${formatDate(report.expires_at)}` : ''}
            </p>
          </CardContent>
        </Card>

        {content.kpis && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('reports_previewKeyMetrics')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {([
                  ['coverage_percent', 'reports_metricCoverage', '%'],
                  ['pass_rate_percent', 'reports_metricPassRate', '%'],
                  ['failure_rate_percent', 'reports_metricFailureRate', '%'],
                  ['flakiness_percent', 'reports_metricFlakiness', '%'],
                  ['cycle_time_hours', 'reports_metricCycleTime', 'h'],
                  ['defect_density', 'reports_metricDefectDensity', ''],
                ] as [string, string, string][]).map(([key, label, unit]) => (
                  <div key={key} className="rounded-lg border dark:border-gray-700 p-3">
                    <div className="text-xs text-gray-500">{t(label)}</div>
                    <div className="text-2xl font-semibold">
                      {kpis[key] ?? 0}
                      {unit}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {content.summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('reports_previewProjectInventory')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {([
                  ['total_test_cases', 'reports_summaryTestCases'],
                  ['total_test_suites', 'reports_summaryTestSuites'],
                  ['total_test_runs', 'reports_summaryTestRuns'],
                  ['total_requirements', 'reports_summaryRequirements'],
                  ['total_defects', 'reports_summaryDefects'],
                ] as [string, string][]).map(([key, label]) => (
                  <div
                    key={key}
                    className="flex justify-between border-b border-gray-100 dark:border-gray-800 py-1.5"
                  >
                    <span className="text-gray-600 dark:text-gray-300">{t(label)}</span>
                    <span className="font-semibold">{summary[key] ?? 0}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {content.recent_activity && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('reports_previewPeriodActivity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 text-center">
                {([
                  ['test_runs_started', 'test_runs_today', 'reports_activityRunsStarted'],
                  ['tests_executed', '', 'reports_activityTestsExecuted'],
                  ['defects_found', '', 'reports_activityDefectsFound'],
                ] as [string, string, string][]).map(([key, legacyKey, label]) => (
                  <div key={key} className="rounded-lg border dark:border-gray-700 p-3">
                    <div className="text-2xl font-semibold">{activityValue(recent, key, legacyKey)}</div>
                    <div className="text-xs text-gray-500">{t(label)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {content.kpi_trends && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('reports_previewTrends')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {([
                  ['coverage', 'reports_metricCoverage', '%'],
                  ['passRate', 'reports_metricPassRate', '%'],
                  ['failureTrends', 'reports_metricFailureRate', '%'],
                  ['flakiness', 'reports_metricFlakiness', '%'],
                  ['cycleTime', 'reports_metricCycleTime', 'h'],
                  ['defectDensity', 'reports_metricDefectDensity', ''],
                ] as [string, string, string][]).map(([key, label, unit]) => {
                  const trend = content.kpi_trends[key] || {};
                  return (
                    <div key={key} className="flex items-center justify-between rounded-lg border dark:border-gray-700 px-3 py-2">
                      <span className="text-gray-600 dark:text-gray-300">{t(label)}</span>
                      <span className="font-semibold">
                        {trend.current ?? 0}{unit} · {t(`reports_trend_${trend.trend || 'stable'}`)} {trend.change ?? 0}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {content.team_performance && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('reports_previewTeamPerformance')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 text-center">
                {([
                  ['active_testers', 'reports_teamActiveTesters'],
                  ['avg_execution_time', 'reports_teamAvgExecutionTime'],
                  ['productivity_score', 'reports_teamProductivityScore'],
                ] as [string, string][]).map(([key, label]) => (
                  <div key={key} className="rounded-lg border dark:border-gray-700 p-3">
                    <div className="text-2xl font-semibold">{content.team_performance[key] ?? 0}</div>
                    <div className="text-xs text-gray-500">{t(label)}</div>
                  </div>
                ))}
              </div>
              {Array.isArray(content.team_performance.members) && content.team_performance.members.length > 0 && (
                <div className="mt-3 divide-y rounded-lg border dark:border-gray-700">
                  {content.team_performance.members.map((member: any) => (
                    <div key={member.user_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2">
                      <span className="truncate font-medium">{member.name}</span>
                      <span className="text-gray-600 dark:text-gray-300">
                        {t('reports_teamMemberStats', {
                          executed: member.executed,
                          passed: member.passed,
                          failed: member.failed,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {content.upcoming && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('reports_previewUpcoming')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 text-center">
                {([
                  { key: 'scheduled_runs_count', listKey: 'scheduled_runs', label: 'reports_upcomingScheduledRuns' },
                  { key: 'pending_reviews_count', listKey: 'pending_reviews', label: 'reports_upcomingPendingReviews' },
                  { key: 'release_deadline', label: 'reports_upcomingReleaseDeadline' },
                ]).map((item) => (
                  <div key={item.key} className="rounded-lg border dark:border-gray-700 p-3">
                    <div className="text-2xl font-semibold">
                      {item.key === 'release_deadline'
                        ? (content.upcoming[item.key] ?? 'N/A')
                        : upcomingCount(content.upcoming, item.key, item.listKey || '')}
                    </div>
                    <div className="text-xs text-gray-500">{t(item.label)}</div>
                  </div>
                ))}
              </div>
              {content.upcoming.milestone && (
                <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  {t('reports_upcomingMilestone', {
                    title: content.upcoming.milestone.title,
                    date: content.upcoming.milestone.target_date ? formatDate(content.upcoming.milestone.target_date) : 'N/A',
                  })}
                </p>
              )}
              {Array.isArray(content.upcoming.scheduled_runs) && content.upcoming.scheduled_runs.length > 0 && (
                <div className="mt-3 space-y-1">
                  {content.upcoming.scheduled_runs.slice(0, 5).map((run: any) => (
                    <div key={run.id} className="flex justify-between rounded border dark:border-gray-700 px-2 py-1">
                      <span className="truncate">{run.name}</span>
                      <span className="text-gray-500">{run.assigned_to || run.priority || ''}</span>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(content.upcoming.pending_reviews) && content.upcoming.pending_reviews.length > 0 && (
                <div className="mt-3 space-y-1">
                  {content.upcoming.pending_reviews.slice(0, 5).map((testCase: any) => (
                    <div key={testCase.id} className="flex justify-between rounded border dark:border-gray-700 px-2 py-1">
                      <span className="truncate">{testCase.title}</span>
                      <span className="text-gray-500">{testCase.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {content.data_available === false && (
          <p className="text-sm text-gray-500 text-center">
            {t('reports_previewDataUnavailable')}
          </p>
        )}
      </div>
    </div>
  );
}
