import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle, Bug, CheckCircle, ChevronLeft, ChevronRight, FileCheck, Loader2, Play, Plus, Search, TrendingUp,
} from 'lucide-react';
import { ReportsData } from '@/hooks/useReportsData';
import { normalizeStatus, getStatusIcon } from '@/components/reports/reportsUtils';

export function TraceabilityMatrixPanel({ ctx }: { ctx: ReportsData }) {
  const { t } = useTranslation();
  const {
    traceabilityData, traceabilityFilters, setTraceabilityFilters, traceabilityPage,
    setTraceabilityPage, TRACEABILITY_PAGE_SIZE, searchQuery, setSearchQuery, selectedProject,
  } = ctx;
  const isLoading = !!ctx.loadingByTab.traceability;

  // A small inline list of open defects linked to a test case (task: surface
  // open defects directly in the Req→TC area so risk is visible in context).
  const renderDefects = (tc: any) => {
    const count = Number(tc.open_defects_count || 0);
    if (count === 0) {
      return <span className="text-xs text-gray-400">—</span>;
    }
    const defects: any[] = Array.isArray(tc.open_defects) ? tc.open_defects : [];
    return (
      <div className="flex flex-col items-center gap-1">
        <Badge variant="destructive" className="gap-1">
          <Bug className="h-3 w-3" />
          {t('reports_openDefectsCount', { count })}
        </Badge>
        <div className="flex flex-wrap justify-center gap-1">
          {defects.map((defect: any) => (
            <Link
              key={defect.id}
              to={`/projects/${selectedProject}/defects/${defect.id}`}
              title={`${defect.title || ''} (${defect.severity || ''})`}
              className="font-mono text-xs text-red-600 underline-offset-4 hover:underline dark:text-red-400"
            >
              {defect.defect_id || `#${defect.id}`}
            </Link>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_totalRequirements')}</p>
                <p className="text-2xl font-bold mt-1">{traceabilityData?.total_requirements || 0}</p>
              </div>
              <FileCheck className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_coveredLabel')}</p>
                <p className="text-2xl font-bold mt-1 text-green-600">{traceabilityData?.covered_requirements || 0}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_uncoveredLabel')}</p>
                <p className="text-2xl font-bold mt-1 text-red-600">{traceabilityData?.uncovered_requirements || 0}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_coveragePercentLabel')}</p>
                <p className="text-2xl font-bold mt-1">
                  {traceabilityData?.total_requirements
                    ? Math.round((traceabilityData.covered_requirements / traceabilityData.total_requirements) * 100)
                    : 0}%
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_blockedTests')}</p>
                <p className="text-2xl font-bold mt-1 text-yellow-600">
                  {traceabilityData?.requirements?.reduce((total: number, req: any) =>
                    total + (req.test_cases || []).filter((tc: any) => normalizeStatus(tc.status) === 'blocked').length, 0) || 0}
                </p>
              </div>
              <AlertCircle className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_openDefectsLabel')}</p>
                <p className="text-2xl font-bold mt-1 text-red-600">
                  {traceabilityData?.requirements?.reduce((total: number, req: any) =>
                    total + Number(req.open_defects_count || 0), 0) || 0}
                </p>
              </div>
              <Bug className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar — search and dropdowns are server-side; pagination resets on change */}
      <div className="bg-white dark:bg-gray-900 p-4 rounded-lg shadow-xs border dark:border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t('searchRequirementsOrTestCases')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="md:col-span-3">
            <Select
              value={traceabilityFilters.priority}
              onValueChange={(v) => {
                setTraceabilityFilters((prev) => ({ ...prev, priority: v }));
                setTraceabilityPage(0);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('reports_filterPriorityAll')}</SelectItem>
                <SelectItem value="critical">{t('reports_filterPriorityCritical')}</SelectItem>
                <SelectItem value="high">{t('reports_filterPriorityHigh')}</SelectItem>
                <SelectItem value="medium">{t('reports_filterPriorityMedium')}</SelectItem>
                <SelectItem value="low">{t('reports_filterPriorityLow')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Select
              value={traceabilityFilters.coverage_status}
              onValueChange={(v) => {
                setTraceabilityFilters((prev) => ({ ...prev, coverage_status: v }));
                setTraceabilityPage(0);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('reports_filterCoverageAll')}</SelectItem>
                <SelectItem value="covered">{t('reports_coveredLabel')}</SelectItem>
                <SelectItem value="uncovered">{t('reports_uncoveredLabel')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3">
            <Select
              value={traceabilityFilters.test_status}
              onValueChange={(v) => {
                setTraceabilityFilters((prev) => ({ ...prev, test_status: v }));
                setTraceabilityPage(0);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('reports_filterStatusAll')}</SelectItem>
                <SelectItem value="passed">{t('reports_statusPassed')}</SelectItem>
                <SelectItem value="failed">{t('reports_statusFailed')}</SelectItem>
                <SelectItem value="blocked">{t('reports_statusBlocked')}</SelectItem>
                <SelectItem value="skipped">{t('reports_statusSkipped')}</SelectItem>
                <SelectItem value="not_tested">{t('reports_statusNotTested')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {(traceabilityFilters.priority !== 'all' ||
          traceabilityFilters.coverage_status !== 'all' ||
          traceabilityFilters.test_status !== 'all' ||
          searchQuery) && (
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>
              {t('reports_showingMatched', {
                matched: traceabilityData?.matched_requirements ?? 0,
                total: traceabilityData?.total_requirements ?? 0,
              })}
            </span>
            <button
              className="text-blue-600 hover:underline"
              onClick={() => {
                setSearchQuery('');
                setTraceabilityFilters({ priority: 'all', coverage_status: 'all', test_status: 'all', search: '' });
                setTraceabilityPage(0);
              }}
            >
              {t('reports_clearFilters')}
            </button>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
          <span className="text-gray-600 dark:text-gray-400">{t('reports_loadingTraceability')}</span>
        </div>
      )}

      {/* Traceability Matrix — server already filtered/paginated */}
      {!isLoading && traceabilityData && (
        <div className="space-y-4">
          {(traceabilityData?.requirements || []).map((item: any) => (
            <Card key={item.requirement_id} className="overflow-hidden">
              <CardHeader className="bg-linear-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-800/50 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <FileCheck className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-bold text-blue-600">{item.requirement_key || `REQ-${item.requirement_id}`}</span>
                        <Badge variant={item.requirement_status === 'approved' ? 'default' : 'outline-solid'} className="capitalize">
                          {item.requirement_status}
                        </Badge>
                        {item.requirement_priority && (
                          <Badge variant="secondary" className="capitalize">
                            {t('reports_xPriority', { name: item.requirement_priority })}
                          </Badge>
                        )}
                        {Number(item.open_defects_count || 0) > 0 && (
                          <Badge variant="destructive" className="gap-1">
                            <Bug className="h-3 w-3" />
                            {t('reports_openDefectsCount', { count: item.open_defects_count })}
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-base font-semibold wrap-break-word">
                        <Link
                          to={`/projects/${selectedProject}/requirements/${item.requirement_id}`}
                          className="text-gray-900 underline-offset-4 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
                        >
                          {item.requirement_title}
                        </Link>
                      </CardTitle>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-3 text-sm md:flex md:items-center md:gap-4">
                    <div className="text-center">
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatTestCases')}</div>
                      <div className="font-bold">{item.total_test_cases || 0}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatPassed')}</div>
                      <div className="font-bold text-green-600">{item.passed_count || 0}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatFailed')}</div>
                      <div className="font-bold text-red-600">{item.failed_count || 0}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatBlocked')}</div>
                      <div className="font-bold text-yellow-600">{(item.test_cases || []).filter((tc: any) => normalizeStatus(tc.status) === 'blocked').length}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatNotTested')}</div>
                      <div className="font-bold text-gray-600">{(item.test_cases || []).filter((tc: any) => normalizeStatus(tc.status) === 'not_tested').length}</div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {(item.test_cases || []).length > 0 ? (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium">
                          <tr>
                            <th className="px-6 py-3 text-left">{t('reports_colTestCase')}</th>
                            <th className="px-6 py-3 text-left">{t('reports_colTitle')}</th>
                            <th className="px-6 py-3 text-center">{t('reports_colCoverageType')}</th>
                            <th className="px-6 py-3 text-center">{t('reports_colStatus')}</th>
                            <th className="px-6 py-3 text-center">{t('reports_colOpenDefects')}</th>
                            <th className="px-6 py-3 text-right">{t('reports_colLastExecuted')}</th>
                            <th className="px-6 py-3 text-center">{t('reports_colActions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-gray-700">
                          {(item.test_cases || []).map((tc: any) => {
                            const executionPath = tc.test_run_id
                              ? `/projects/${selectedProject}/test-runs/${tc.test_run_id}/test-cases/${tc.id}`
                              : `/projects/${selectedProject}/test-cases/${tc.id}/execute`;
                            const normalizedStatus = normalizeStatus(tc.status);
                            return (
                              <tr key={tc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                <td className="px-6 py-4">
                                  <Link
                                    to={`/projects/${selectedProject}/test-cases/${tc.id}`}
                                    className="font-mono text-sm text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                                  >
                                    TC-{tc.id}
                                  </Link>
                                </td>
                                <td className="px-6 py-4 font-medium">
                                  <Link
                                    to={`/projects/${selectedProject}/test-cases/${tc.id}`}
                                    className="text-gray-900 underline-offset-4 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
                                  >
                                    {tc.title}
                                  </Link>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <Badge variant="outline" className="capitalize text-xs">
                                    {tc.coverage_type || 'functional'}
                                  </Badge>
                                </td>
                                <td className="px-6 py-4">
                                  <Link
                                    to={executionPath}
                                    className="flex items-center justify-center gap-2 rounded-md px-2 py-1 underline-offset-4 hover:bg-blue-50 hover:text-blue-700 hover:underline dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                                  >
                                    {getStatusIcon(tc.status)}
                                    <span className="capitalize text-sm">{normalizedStatus.replace('_', ' ')}</span>
                                  </Link>
                                </td>
                                <td className="px-6 py-4 text-center">{renderDefects(tc)}</td>
                                <td className="px-6 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                                  {tc.last_executed ? new Date(tc.last_executed).toLocaleDateString() : t('reports_never')}
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(executionPath, '_blank')}
                                    className="text-xs"
                                  >
                                    <Play className="h-3 w-3 mr-1" />
                                    {tc.test_run_id ? t('reports_openExecution') : t('reports_execute')}
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile cards */}
                    <div className="md:hidden divide-y dark:divide-gray-700">
                      {(item.test_cases || []).map((tc: any) => {
                        const executionPath = tc.test_run_id
                          ? `/projects/${selectedProject}/test-runs/${tc.test_run_id}/test-cases/${tc.id}`
                          : `/projects/${selectedProject}/test-cases/${tc.id}/execute`;
                        const normalizedStatus = normalizeStatus(tc.status);
                        return (
                          <div key={tc.id} className="p-4 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <Link
                                  to={`/projects/${selectedProject}/test-cases/${tc.id}`}
                                  className="font-mono text-xs text-blue-600 dark:text-blue-400"
                                >
                                  TC-{tc.id}
                                </Link>
                                <div className="font-medium wrap-break-word">
                                  <Link to={`/projects/${selectedProject}/test-cases/${tc.id}`} className="text-gray-900 dark:text-white">
                                    {tc.title}
                                  </Link>
                                </div>
                              </div>
                              <Badge variant="outline" className="capitalize text-xs shrink-0">
                                {tc.coverage_type || 'functional'}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <Link
                                to={executionPath}
                                className="flex items-center gap-1.5 rounded-md px-2 py-1 -ml-2 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                              >
                                {getStatusIcon(tc.status)}
                                <span className="capitalize">{normalizedStatus.replace('_', ' ')}</span>
                              </Link>
                              <span className="text-xs text-gray-500">
                                {tc.last_executed ? new Date(tc.last_executed).toLocaleDateString() : t('reports_never')}
                              </span>
                            </div>
                            {Number(tc.open_defects_count || 0) > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="destructive" className="gap-1">
                                  <Bug className="h-3 w-3" />
                                  {t('reports_openDefectsCount', { count: tc.open_defects_count })}
                                </Badge>
                                {(tc.open_defects || []).map((defect: any) => (
                                  <Link
                                    key={defect.id}
                                    to={`/projects/${selectedProject}/defects/${defect.id}`}
                                    className="font-mono text-xs text-red-600 underline-offset-4 hover:underline dark:text-red-400"
                                  >
                                    {defect.defect_id || `#${defect.id}`}
                                  </Link>
                                ))}
                              </div>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(executionPath, '_blank')}
                              className="text-xs w-full"
                            >
                              <Play className="h-3 w-3 mr-1" />
                              {tc.test_run_id ? t('reports_openExecution') : t('reports_execute')}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                    <AlertCircle className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p className="font-medium">{t('reports_noTCsLinked')}</p>
                    <p className="text-sm mt-1">{t('reports_linkTCsToTrack')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {traceabilityData?.requirements?.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center">
                <FileCheck className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-semibold mb-2">{t('reports_noRequirementsFound')}</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {searchQuery ||
                  traceabilityFilters.priority !== 'all' ||
                  traceabilityFilters.coverage_status !== 'all' ||
                  traceabilityFilters.test_status !== 'all'
                    ? t('reports_noReqsFilteredMsg')
                    : t('reports_noReqsMsg')}
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Link
                    to={`/projects/${selectedProject}/requirements`}
                    className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {t('reports_manageRequirements')}
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pagination controls */}
          {traceabilityData && (traceabilityData.matched_requirements ?? 0) > TRACEABILITY_PAGE_SIZE && (
            <div className="flex items-center justify-between rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                {t('reports_paginationShowing')}{' '}
                <strong>
                  {traceabilityPage * TRACEABILITY_PAGE_SIZE + 1}–
                  {Math.min((traceabilityPage + 1) * TRACEABILITY_PAGE_SIZE, traceabilityData.matched_requirements)}
                </strong>{' '}
                {t('reports_paginationOf')} <strong>{traceabilityData.matched_requirements}</strong>
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={traceabilityPage === 0}
                  onClick={() => setTraceabilityPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  {t('reports_paginationPrevious')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(traceabilityPage + 1) * TRACEABILITY_PAGE_SIZE >= (traceabilityData.matched_requirements ?? 0)}
                  onClick={() => setTraceabilityPage((p) => p + 1)}
                >
                  {t('reports_paginationNext')}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
