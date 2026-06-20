import { useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, AlertCircle, BarChart3, Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { ReportsData } from '@/hooks/useReportsData';
import { TraceabilityMatrixPanel } from '@/components/reports/TraceabilityMatrixPanel';

export function CoverageRiskSection({ ctx }: { ctx: ReportsData }) {
  const { t } = useTranslation();
  const {
    coverageReports, testExecutionStatus, handleGenerateCoverageReport, error,
    setTraceabilityFilters, setTraceabilityPage, setSearchQuery,
    granularInsights, granularFilter, setGranularFilter, loadGranularInsights,
  } = ctx;
  const coverageLoading = !!ctx.loadingByTab.coverage;
  const granularLoading = !!ctx.loadingByTab.granular;

  const matrixRef = useRef<HTMLDivElement>(null);
  const latestCoverage = coverageReports[coverageReports.length - 1];

  const drillIntoPriority = (priority: string) => {
    setTraceabilityFilters({ priority, coverage_status: 'all', test_status: 'all', search: '' });
    setTraceabilityPage(0);
    setSearchQuery('');
    matrixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const insights: any[] = granularInsights?.insights || [];

  return (
    <div className="space-y-8">
      {/* Coverage report (requirement coverage) */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t('reportsTabCoverage')}</h2>
            {coverageReports.length > 0 && latestCoverage?.generated_at && (
              <p className="text-sm text-gray-600 mt-1">
                {t('reports_coverageLastUpdated', { time: new Date(latestCoverage.generated_at).toLocaleString() })}
              </p>
            )}
          </div>
          <Button onClick={handleGenerateCoverageReport} disabled={coverageLoading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('reports_generateReport')}
          </Button>
        </div>

        {coverageLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-600">{t('reports_loadingCoverage')}</span>
          </div>
        )}

        {coverageReports.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('reports_overallReqCoverage')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-6">
                  <div className="relative w-48 h-48">
                    <svg className="w-full h-full" viewBox="0 0 36 36">
                      <path
                        className="text-gray-200 dark:text-gray-700 stroke-current"
                        strokeWidth="3"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-blue-600 stroke-current"
                        strokeWidth="3"
                        strokeDasharray={`${latestCoverage?.coverage_percentage || 0}, 100`}
                        strokeLinecap="round"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-4xl font-bold">{latestCoverage?.coverage_percentage || 0}%</span>
                      <span className="text-xs text-gray-500">{t('reports_totalCoverage')}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-8 mt-8 w-full">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-600">{latestCoverage?.covered_requirements || 0}</p>
                      <p className="text-xs text-gray-500 uppercase font-medium">{t('reports_coveredLabel')}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-600">{(latestCoverage?.total_requirements || 0) - (latestCoverage?.covered_requirements || 0)}</p>
                      <p className="text-xs text-gray-500 uppercase font-medium">{t('reports_uncoveredLabel')}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('reports_testExecutionStatus')}</CardTitle>
              </CardHeader>
              <CardContent>
                {testExecutionStatus ? (
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <p className="text-2xl font-bold text-blue-600">{testExecutionStatus.summary.executed_test_cases}</p>
                        <p className="text-xs text-gray-600">{t('reports_executedTests')}</p>
                      </div>
                      <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <p className="text-2xl font-bold text-gray-600">{testExecutionStatus.summary.not_started_test_cases}</p>
                        <p className="text-xs text-gray-600">{t('reports_notStartedLabel')}</p>
                      </div>
                    </div>

                    <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg mb-4">
                      <p className="text-lg font-bold text-green-600">
                        {testExecutionStatus?.execution_rate !== undefined ? Math.round(testExecutionStatus.execution_rate) + '%' : '...'}
                      </p>
                      <p className="text-xs text-gray-600">
                        {t('reports_testsExecutedOf', {
                          executed: testExecutionStatus?.summary?.executed_test_cases || 0,
                          total: testExecutionStatus?.summary?.total_test_cases || 0,
                        })}
                      </p>
                    </div>

                    {testExecutionStatus?.summary?.executed_test_cases > 0 && (
                      <div className="space-y-4">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center mb-2">
                          {t('reports_statusOfExecuted', { n: testExecutionStatus.summary.executed_test_cases })}
                        </p>
                        {Object.entries(testExecutionStatus.status_percentages || {}).map(([status, value]) => (
                          <div key={status} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="capitalize">{status.replace('_', ' ')}</span>
                              <span className="font-bold">{Math.round(Number(value))}% ({Math.round((Number(value) / 100) * testExecutionStatus.summary.executed_test_cases)} tests)</span>
                            </div>
                            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${
                                  status === 'passed' ? 'bg-green-500' :
                                  status === 'failed' ? 'bg-red-500' :
                                  status === 'blocked' ? 'bg-yellow-500' : 'bg-blue-500'
                                }`}
                                style={{ width: `${value}%` }}
                              ></div>
                            </div>
                          </div>
                        ))}

                        <div className="mt-6 pt-4 border-t dark:border-gray-700">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center mb-2">
                            {t('reports_overallTestStatus', { n: testExecutionStatus.summary.total_test_cases })}
                          </p>
                          {Object.entries(testExecutionStatus.overall_percentages || {}).map(([status, value]) => (
                            <div key={status} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="capitalize">{status.replace('_', ' ')}</span>
                                <span className="font-bold">{Math.round(Number(value))}% ({Math.round((Number(value) / 100) * testExecutionStatus.summary.total_test_cases)} tests)</span>
                              </div>
                              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${
                                    status === 'passed' ? 'bg-green-500' :
                                    status === 'failed' ? 'bg-red-500' :
                                    status === 'blocked' ? 'bg-yellow-500' :
                                    status === 'skipped' ? 'bg-blue-500' : 'bg-gray-400'
                                  }`}
                                  style={{ width: `${value}%` }}
                                ></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t dark:border-gray-700 text-xs text-gray-500 text-center">
                      {t('reports_totalTestCases', { n: testExecutionStatus?.summary?.total_test_cases || 0 })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    {coverageLoading ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                        <p>{t('reports_loadingTestExecution')}</p>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                        <p>{error || t('reports_noTestExecutionData')}</p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">{t('reports_priorityWiseCoverage')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {Object.entries(latestCoverage?.report_data?.by_priority || {}).map(([priority, value]) => {
                    const detail = (value && typeof value === 'object'
                      ? value
                      : { coverage: Number(value) || 0, covered: 0, total: 0 }) as { coverage: number; covered: number; total: number };
                    const clickable = detail.total > 0;
                    return (
                      <div
                        key={priority}
                        className={`p-4 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 ${
                          clickable ? 'cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors' : ''
                        }`}
                        onClick={clickable ? () => drillIntoPriority(priority) : undefined}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onKeyDown={(e) => {
                          if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            drillIntoPriority(priority);
                          }
                        }}
                        aria-label={clickable ? t('reports_priorityOpenInTraceability', { priority }) : undefined}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <Badge className="capitalize">{t('reports_xPriority', { name: priority })}</Badge>
                          <span className="text-xl font-bold">{detail.total > 0 ? `${Math.round(detail.coverage)}%` : '—'}</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${detail.total > 0 ? detail.coverage : 0}%` }}></div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          {detail.total > 0
                            ? t('reports_reqsCovered', { covered: detail.covered, total: detail.total })
                            : t('reports_noReqsAtPriority')}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          !coverageLoading && <div className="text-center py-8 text-gray-500">{t('reports_noCoverageReports')}</div>
        )}
      </div>

      {/* Requirement → Test Case traceability matrix (with open defects) */}
      <div ref={matrixRef}>
        <TraceabilityMatrixPanel ctx={ctx} />
      </div>

      {/* Granular quality / risk insights */}
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t('reportsTabGranular')}</h2>
            <p className="text-sm text-gray-600">{t('reports_granularSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={granularFilter} onValueChange={(v) => setGranularFilter(v as 'all' | 'failed' | 'slow')}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('reports_filterAllMetrics')}</SelectItem>
                <SelectItem value="failed">{t('reports_filterFailureRelated')}</SelectItem>
                <SelectItem value="slow">{t('reports_filterExecutionSpeed')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => loadGranularInsights()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('reports_refresh')}
            </Button>
          </div>
        </div>

        {granularLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-600">{t('reports_loadingGranular')}</span>
          </div>
        )}

        {!granularLoading && insights.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BarChart3 className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-600 text-center">{error || t('reports_noInsights')}</p>
            </CardContent>
          </Card>
        )}

        {!granularLoading && insights.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {insights.map((insight, index) => (
              <Card key={`${insight.category}-${insight.metric}-${index}`}>
                <CardHeader className="pb-2">
                  <Badge variant="outline" className="w-fit text-xs">{insight.category}</Badge>
                  <CardTitle className="text-sm font-medium text-gray-600 mt-2">{insight.metric}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">{insight.value}</span>
                    <span className="flex items-center text-gray-400" title={`Trend: ${insight.trend}`}>
                      {insight.trend === 'up' ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : insight.trend === 'down' ? (
                        <TrendingDown className="h-4 w-4" />
                      ) : (
                        <Activity className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                  {insight.details && <p className="text-xs text-gray-500 mt-2">{insight.details}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
