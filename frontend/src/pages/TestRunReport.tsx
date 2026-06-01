import { useCallback, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  ArrowLeft, Download, CheckCircle, XCircle, AlertTriangle, 
  Clock, FileText
} from 'lucide-react';
import { customFieldsAPI, projectsAPI, testRunsAPI, testResultsAPI, usersAPI } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { CustomFieldDefinition } from '@/types';
import { formatDurationSeconds } from '@/utils/timeFormat';
import type { TranslationKey } from '@/locales/translations';

type ReportCustomFieldValue = {
  id: number;
  name: string;
  value: string;
};

type NormalizedResultStatus = 'pass' | 'fail' | 'block' | 'skip' | 'not_tested';

const normalizeResultStatus = (status?: string): NormalizedResultStatus => {
  const normalizedStatus = (status || '').toLowerCase().replace(/[\s-]+/g, '_');
  const statusMap: Record<string, NormalizedResultStatus> = {
    pass: 'pass',
    passed: 'pass',
    fail: 'fail',
    failed: 'fail',
    block: 'block',
    blocked: 'block',
    skip: 'skip',
    skipped: 'skip',
    pending: 'not_tested',
    not_tested: 'not_tested',
  };

  return statusMap[normalizedStatus] || 'not_tested';
};

export function TestRunReport() {
  const navigate = useNavigate();
  const { projectId, testRunId } = useParams();
  const { t, isRTL } = useTranslation();
  const [testRun, setTestRun] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [testResults, setTestResults] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const parsedProjectId = projectId ? parseInt(projectId, 10) : undefined;
      const parsedTestRunId = parseInt(testRunId!);
      // The report is an authoritative, complete document, so it must include
      // every result — not just the first page. Walk pages until one comes back
      // short, rather than relying on the API's default 100-row cap.
      const fetchAllResults = async () => {
        const pageSize = 200;
        const all: any[] = [];
        for (let skip = 0; ; skip += pageSize) {
          const page = await testResultsAPI.getAll(parsedTestRunId, undefined, skip, pageSize);
          if (!Array.isArray(page) || page.length === 0) break;
          all.push(...page);
          if (page.length < pageSize) break;
        }
        return all;
      };
      const [runData, resultsData, usersData, customFieldsData, projectData] = await Promise.all([
        testRunsAPI.getById(parsedTestRunId),
        fetchAllResults(),
        usersAPI.getAll(),
        parsedProjectId ? customFieldsAPI.getDefinitions(parsedProjectId, 'test_case').catch(() => []) : Promise.resolve([]),
        parsedProjectId ? projectsAPI.getById(parsedProjectId).catch(() => null) : Promise.resolve(null),
      ]);
      setTestRun(runData);
      setProject(projectData);
      setTestResults(resultsData);
      setUsers(usersData);
      setCustomFields(Array.isArray(customFieldsData) ? customFieldsData : []);
    } catch (error) {
      console.error('Failed to load report data:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, testRunId]);

  useEffect(() => {
    loadData();
    // Note: the report page is a snapshot — it does not poll. The previous
    // implementation issued a hidden PUT to mark the run completed just from
    // viewing the page, which raced between concurrent viewers and silently
    // mutated state. Auto-completion belongs on the run detail page.
  }, [loadData]);

  const getUserName = (userId: number | null) => {
    if (!userId) return t('notAvailableShort');
    const user = users.find(u => u.id === userId);
    if (!user) return `User ${userId}`;
    return user.full_name || user.username || user.email || `User ${userId}`;
  };

  const getCustomFieldName = (fieldDefinitionId: number) => {
    const field = customFields.find((customField) => customField.id === fieldDefinitionId);
    return field?.name || t('customFieldFallbackName', { id: fieldDefinitionId });
  };

  const getResultCustomFields = (result: any): ReportCustomFieldValue[] => {
    const values = result.test_case?.custom_field_values || [];
    return values
      .filter((fieldValue: any) => fieldValue.value !== undefined && fieldValue.value !== null && String(fieldValue.value).trim() !== '')
      .map((fieldValue: any) => ({
        id: fieldValue.field_definition_id,
        name: getCustomFieldName(fieldValue.field_definition_id),
        value: String(fieldValue.value),
      }));
  };

  const getResultCustomFieldMap = (result: any): Record<string, string> => {
    return getResultCustomFields(result).reduce<Record<string, string>>((fields, field) => {
      fields[field.name] = field.value;
      return fields;
    }, {});
  };

  const getStatusLabel = (status?: string) => {
    const statusKeyMap: Record<NormalizedResultStatus, TranslationKey> = {
      pass: 'passed',
      fail: 'failed',
      block: 'blocked',
      skip: 'skipped',
      not_tested: 'notTested',
    };

    return t(statusKeyMap[normalizeResultStatus(status)]);
  };

  const getRunStatusLabel = (status?: string) => {
    const normalizedStatus = (status || '').toLowerCase().replace(/[\s-]+/g, '_');
    const statusKeyMap: Record<string, TranslationKey> = {
      pending: 'testRunStatusPending',
      running: 'testRunStatusRunning',
      in_progress: 'testRunStatusInProgress',
      completed: 'testRunStatusCompleted',
      passed: 'testRunStatusPassed',
      failed: 'testRunStatusFailed',
      skipped: 'testRunStatusSkipped',
      blocked: 'testRunStatusBlocked',
    };

    return statusKeyMap[normalizedStatus] ? t(statusKeyMap[normalizedStatus]) : (status || t('notAvailableShort'));
  };

  const getStatusBadgeVariant = (status?: string): 'default' | 'destructive' | 'secondary' | 'outline' => {
    const normalizedStatus = normalizeResultStatus(status);
    if (normalizedStatus === 'pass') return 'default';
    if (normalizedStatus === 'fail') return 'destructive';
    if (normalizedStatus === 'block') return 'outline';
    return 'secondary';
  };

  const statusCounts = testResults.reduce<Record<NormalizedResultStatus, number>>((acc, result) => {
    const status = normalizeResultStatus(result.status);
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { pass: 0, fail: 0, block: 0, skip: 0, not_tested: 0 });

  const totalTests = testResults.length;
  const passedTests = statusCounts.pass;
  const failedTests = statusCounts.fail;
  const blockedTests = statusCounts.block;
  const skippedTests = statusCounts.skip;
  const notTestedTests = statusCounts.not_tested;
  const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;

  // Only count results that were actually executed when computing
  // total/average execution time, so a stale execution_time on a not_tested
  // row doesn't inflate the numerator while the denominator excludes it.
  const executedResults = testResults.filter(
    (result) => result.execution_time != null && normalizeResultStatus(result.status) !== 'not_tested',
  );
  const totalExecutionSeconds = executedResults.reduce(
    (total, result) => total + (Number(result.execution_time) || 0),
    0,
  );
  const executedResultsCount = executedResults.length;
  const averageExecutionSeconds = executedResultsCount > 0 ? Math.round(totalExecutionSeconds / executedResultsCount) : 0;

  const handleDownloadJSON = () => {
    if (!testRun) return;

    // Wall-clock duration from when the run actually started (fallback to
    // created_at) until completion. ``null`` while the run is still in
    // progress — downstream tools shouldn't see a mixed number/string field.
    const startedAtRaw = testRun.started_at || testRun.created_at;
    const startTime = startedAtRaw ? new Date(startedAtRaw).getTime() : NaN;
    const endTime = testRun.completed_at ? new Date(testRun.completed_at).getTime() : NaN;
    const wallClockSeconds = Number.isFinite(startTime) && Number.isFinite(endTime)
      ? Math.max(0, Math.round((endTime - startTime) / 1000))
      : null;

    const report = {
      testRunName: testRun.name,
      testRunId: testRun.id,
      projectId: project?.id ?? (projectId ? Number(projectId) : null),
      projectName: project?.name ?? null,
      status: testRun.status ?? null,
      createdAt: testRun.created_at ?? null,
      startedAt: testRun.started_at ?? null,
      completedAt: testRun.completed_at ?? null,
      generatedAt: new Date().toISOString(),
      summary: {
        totalTests,
        passedTests,
        failedTests,
        blockedTests,
        skippedTests,
        notTestedTests,
        passRate,
        totalExecutionTimeSeconds: totalExecutionSeconds,
        averageExecutionTimeSeconds: averageExecutionSeconds,
        wallClockSeconds,
      },
      results: testResults.map(result => ({
        testCaseId: result.test_case_id,
        testCaseTitle: result.test_case?.title ?? null,
        sectionId: result.test_case?.section_id ?? null,
        sectionName: result.test_case?.section?.name ?? null,
        priority: result.test_case?.priority ?? null,
        // Stable enum so downstream tooling can branch on status regardless
        // of the viewer's UI locale.
        status: normalizeResultStatus(result.status),
        statusLabel: getStatusLabel(result.status),
        executedById: result.executed_by ?? null,
        executedByName: result.executed_by ? getUserName(result.executed_by) : null,
        executionStartedAt: result.execution_started_at ?? null,
        executedAt: result.executed_at ?? null,
        executionTimeSeconds: result.execution_time ?? null,
        customFields: getResultCustomFieldMap(result),
        comments: result.comments ?? null,
      })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-run-${testRun.id}-report.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPDF = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">{t('loadingReport')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 bg-gray-50 p-6 print:bg-white print:p-0 print:text-black" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate(`/projects/${projectId}/test-runs/${testRunId}`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('backToTestRun')}
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{t('testRunReport')}</h1>
            <p className="text-sm text-gray-600">{testRun?.name}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadJSON}>
            <Download className="h-4 w-4 mr-2" />
            {t('downloadJsonReport')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadPDF}>
            <FileText className="h-4 w-4 mr-2" />
            {t('printPdf')}
          </Button>
        </div>
      </div>

      {/* Report Header - Print Visible */}
      <div className="hidden print:block print:border-b print:border-gray-300 print:pb-4">
        <div className="print:flex print:items-start print:justify-between print:gap-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">{t('testRunReport')}</h1>
            <p className="text-lg text-gray-700">{testRun?.name}</p>
          </div>
          <div className="text-sm text-gray-600 print:min-w-56">
            <p>{t('generatedAt')}: {new Date().toLocaleString()}</p>
            <p>{t('projectNameLabel')}: {project?.name || t('notAvailableShort')}</p>
            <p>{t('projectIdLabel')}: {project?.id || projectId || t('notAvailableShort')}</p>
            <p>{t('runId')}: {testRun?.id || t('notAvailableShort')}</p>
            <p>{t('statusLabel')}: {testRun?.status ? getRunStatusLabel(testRun.status) : t('notAvailableShort')}</p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4 print:grid-cols-3 print:gap-2">
        <Card className="print:break-inside-avoid print:rounded print:border-gray-300 print:shadow-none">
          <CardHeader className="pb-2 print:p-3 print:pb-1">
            <CardTitle className="text-sm font-medium text-gray-600 print:text-xs print:text-gray-700">{t('totalTests')}</CardTitle>
          </CardHeader>
          <CardContent className="print:p-3 print:pt-0">
            <div className="text-2xl font-bold print:text-xl">{totalTests}</div>
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid print:rounded print:border-gray-300 print:shadow-none">
          <CardHeader className="pb-2 print:p-3 print:pb-1">
            <CardTitle className="text-sm font-medium text-gray-600 print:text-xs print:text-gray-700">{t('passRate')}</CardTitle>
          </CardHeader>
          <CardContent className="print:p-3 print:pt-0">
            <div className="text-2xl font-bold text-green-600 print:text-xl print:text-black">{passRate}%</div>
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid print:rounded print:border-gray-300 print:shadow-none">
          <CardHeader className="pb-2 print:p-3 print:pb-1">
            <CardTitle className="text-sm font-medium text-gray-600 print:text-xs print:text-gray-700">{t('passed')}</CardTitle>
          </CardHeader>
          <CardContent className="print:p-3 print:pt-0">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600 print:hidden" />
              <div className="text-2xl font-bold print:text-xl">{passedTests}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid print:rounded print:border-gray-300 print:shadow-none">
          <CardHeader className="pb-2 print:p-3 print:pb-1">
            <CardTitle className="text-sm font-medium text-gray-600 print:text-xs print:text-gray-700">{t('failed')}</CardTitle>
          </CardHeader>
          <CardContent className="print:p-3 print:pt-0">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600 print:hidden" />
              <div className="text-2xl font-bold print:text-xl">{failedTests}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid print:rounded print:border-gray-300 print:shadow-none">
          <CardHeader className="pb-2 print:p-3 print:pb-1">
            <CardTitle className="text-sm font-medium text-gray-600 print:text-xs print:text-gray-700">{t('totalExecutionTime')}</CardTitle>
          </CardHeader>
          <CardContent className="print:p-3 print:pt-0">
            <div className="text-2xl font-bold print:text-xl">{formatDurationSeconds(totalExecutionSeconds, t)}</div>
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid print:rounded print:border-gray-300 print:shadow-none">
          <CardHeader className="pb-2 print:p-3 print:pb-1">
            <CardTitle className="text-sm font-medium text-gray-600 print:text-xs print:text-gray-700">{t('averageCaseTime')}</CardTitle>
          </CardHeader>
          <CardContent className="print:p-3 print:pt-0">
            <div className="text-2xl font-bold print:text-xl">{executedResultsCount > 0 ? formatDurationSeconds(averageExecutionSeconds, t) : t('notAvailableShort')}</div>
          </CardContent>
        </Card>
      </div>

      {/* Test Run Details */}
      <Card className="print:break-inside-avoid print:rounded print:border-gray-300 print:shadow-none">
        <CardHeader className="print:p-3 print:pb-2">
          <CardTitle className="text-base">{t('testRunInformation')}</CardTitle>
        </CardHeader>
        <CardContent className="print:p-3 print:pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-600 text-xs">{t('statusLabel')}</p>
              <Badge className="mt-1 print:border print:border-gray-400 print:bg-white print:text-black">{testRun?.status ? getRunStatusLabel(testRun.status) : t('notAvailableShort')}</Badge>
            </div>
            <div>
              <p className="text-gray-600 text-xs">{t('created')}</p>
              <p className="font-medium">{testRun?.created_at ? new Date(testRun.created_at).toLocaleString() : t('notAvailableShort')}</p>
            </div>
            <div>
              <p className="text-gray-600 text-xs">{t('started')}</p>
              <p className="font-medium">{testRun?.started_at ? new Date(testRun.started_at).toLocaleString() : t('notAvailableShort')}</p>
            </div>
            <div>
              <p className="text-gray-600 text-xs">{t('completedLabel')}</p>
              <p className="font-medium">{testRun?.completed_at ? new Date(testRun.completed_at).toLocaleString() : t('inProgress')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Breakdown */}
      <Card className="print:break-inside-avoid print:rounded print:border-gray-300 print:shadow-none">
        <CardHeader className="print:p-3 print:pb-2">
          <CardTitle className="text-base">{t('statusBreakdown')}</CardTitle>
        </CardHeader>
        <CardContent className="print:p-3 print:pt-0">
          <div className="space-y-3 print:space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 print:hidden" />
                <span className="text-sm">{t('passed')}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-48 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-600 h-2 rounded-full" 
                    style={{ width: `${totalTests > 0 ? (passedTests / totalTests) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{passedTests}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-600 print:hidden" />
                <span className="text-sm">{t('failed')}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-48 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-red-600 h-2 rounded-full" 
                    style={{ width: `${totalTests > 0 ? (failedTests / totalTests) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{failedTests}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 print:hidden" />
                <span className="text-sm">{t('blocked')}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-48 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-yellow-600 h-2 rounded-full" 
                    style={{ width: `${totalTests > 0 ? (blockedTests / totalTests) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{blockedTests}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-600 print:hidden" />
                <span className="text-sm">{t('skipped')}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-48 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-gray-600 h-2 rounded-full" 
                    style={{ width: `${totalTests > 0 ? (skippedTests / totalTests) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{skippedTests}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-400 print:hidden" />
                <span className="text-sm">{t('notTested')}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-48 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-gray-400 h-2 rounded-full" 
                    style={{ width: `${totalTests > 0 ? (notTestedTests / totalTests) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{notTestedTests}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Results Table */}
      <Card className="print:rounded-none print:border-0 print:shadow-none">
        <CardHeader className="print:p-0 print:pb-2">
          <CardTitle className="text-base">{t('testResultsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="print:p-0">
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full text-sm print:text-[10px] print:leading-tight">
              <thead className="bg-gray-50 text-xs print:bg-gray-100 print:text-[10px]">
                <tr>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('testCaseLabel')}</th>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('statusLabel')}</th>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('priority')}</th>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('customFields')}</th>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('executedBy')}</th>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('executionStartedLabel')}</th>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('executedAt')}</th>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('duration')}</th>
                  <th className="px-4 py-2 text-left print:px-2 print:py-1">{t('comments')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {testResults.map((result) => (
                  <tr key={result.id} className="hover:bg-gray-50 print:break-inside-avoid print:hover:bg-white">
                    <td className="px-4 py-2 print:px-2 print:py-1 print:align-top">
                      <div>
                        <p className="font-medium">{result.test_case?.title || t('unknownTestCase')}</p>
                        <p className="text-xs text-gray-500">TC-{result.test_case_id}</p>
                      </div>
                    </td>
                    <td className="px-4 py-2 print:px-2 print:py-1 print:align-top">
                      <Badge 
                        variant={getStatusBadgeVariant(result.status)}
                        className="text-xs print:border print:border-gray-400 print:bg-white print:text-black"
                      >
                        {getStatusLabel(result.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 print:px-2 print:py-1 print:align-top">
                      <Badge variant="outline" className="text-xs print:border-gray-400">
                        {result.test_case?.priority || t('notAvailableShort')}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-xs print:px-2 print:py-1 print:align-top">
                      {getResultCustomFields(result).length > 0 ? (
                        <div className="space-y-1">
                          {getResultCustomFields(result).map((field) => (
                            <div key={`${result.id}-${field.id}`} className="rounded bg-gray-50 px-2 py-1">
                              <span className="font-medium text-gray-700">{field.name}: </span>
                              <span className="text-gray-600">{field.value}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">{t('noCustomFieldValues')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs print:px-2 print:py-1 print:align-top">{getUserName(result.executed_by)}</td>
                    <td className="px-4 py-2 text-xs print:px-2 print:py-1 print:align-top">
                      {result.execution_started_at ? new Date(result.execution_started_at).toLocaleString() : t('notAvailableShort')}
                    </td>
                    <td className="px-4 py-2 text-xs print:px-2 print:py-1 print:align-top">
                      {result.executed_at ? new Date(result.executed_at).toLocaleString() : t('notAvailableShort')}
                    </td>
                    <td className="px-4 py-2 text-xs print:px-2 print:py-1 print:align-top">{formatDurationSeconds(result.execution_time, t)}</td>
                    <td className="px-4 py-2 text-xs print:px-2 print:py-1 print:align-top">{result.comments || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
