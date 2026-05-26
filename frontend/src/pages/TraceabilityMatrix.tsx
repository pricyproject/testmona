import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Loader2,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { analyticsAPI } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TestStatus = 'passed' | 'failed' | 'blocked' | 'skipped' | 'not_tested';

interface OpenDefect {
  id: number;
  defect_id: string;
  title: string;
  severity: string;
  status: string;
}

interface MatrixTestCase {
  id: number;
  title: string;
  status: TestStatus;
  test_run_id: number | null;
  coverage_type?: string;
  last_executed: string | null;
  open_defects_count: number;
  open_defects: OpenDefect[];
}

interface MatrixRequirement {
  requirement_id: number;
  requirement_key: string | null;
  requirement_title: string;
  requirement_status: string | null;
  requirement_priority: string | null;
  total_test_cases: number;
  open_defects_count: number;
  test_cases: MatrixTestCase[];
}

interface MatrixData {
  project_id: number;
  total_requirements: number;
  covered_requirements: number;
  uncovered_requirements: number;
  coverage_percentage: number;
  matched_requirements: number;
  skip: number;
  limit: number;
  requirements: MatrixRequirement[];
}

const PAGE_SIZE = 25;

type CoverageFilter = 'all' | 'covered' | 'uncovered';
type PriorityFilter = 'all' | 'low' | 'medium' | 'high' | 'critical';
type StatusFilter = 'all' | TestStatus;

const normalizeStatus = (status: string | undefined | null): TestStatus => {
  const lookup: Record<string, TestStatus> = {
    pass: 'passed',
    passed: 'passed',
    fail: 'failed',
    failed: 'failed',
    block: 'blocked',
    blocked: 'blocked',
    skip: 'skipped',
    skipped: 'skipped',
    not_tested: 'not_tested',
  };
  return lookup[(status || '').toLowerCase()] || 'not_tested';
};

const statusBadgeClass = (status: TestStatus): string => {
  switch (status) {
    case 'passed':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    case 'blocked':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300';
    case 'skipped':
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }
};

const statusIcon = (status: TestStatus) => {
  switch (status) {
    case 'passed':
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5" />;
    case 'blocked':
      return <ShieldAlert className="h-3.5 w-3.5" />;
    case 'skipped':
      return <AlertTriangle className="h-3.5 w-3.5" />;
    default:
      return <CircleDashed className="h-3.5 w-3.5" />;
  }
};

const formatDate = (iso: string | null, language: string): string | null => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(language);
  } catch {
    return null;
  }
};

export function TraceabilityMatrix() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();

  const numericProjectId = projectId ? Number(projectId) : NaN;

  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [coverage, setCoverage] = useState<CoverageFilter>('all');
  const [testStatus, setTestStatus] = useState<StatusFilter>('all');

  const requestSeq = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(() => setAppliedSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    // Reset to the first page whenever filters change so we don't paginate past
    // the new result set.
    setPage(0);
  }, [appliedSearch, priority, coverage, testStatus]);

  useEffect(() => {
    if (!numericProjectId || Number.isNaN(numericProjectId)) {
      setError(t('failedToLoadTraceabilityMatrix'));
      setLoading(false);
      return;
    }

    const seq = ++requestSeq.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    analyticsAPI
      .getTraceabilityMatrix(numericProjectId, {
        priority: priority === 'all' ? undefined : priority,
        coverage_status: coverage === 'all' ? undefined : coverage,
        test_status: testStatus === 'all' ? undefined : testStatus,
        search: appliedSearch || undefined,
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
      .then((result: MatrixData) => {
        if (cancelled || seq !== requestSeq.current) return;
        setData(result);
      })
      .catch((err) => {
        if (cancelled || seq !== requestSeq.current) return;
        console.error('Failed to load traceability matrix:', err);
        setError(t('failedToLoadTraceabilityMatrix'));
        toast({
          title: t('error'),
          description: t('failedToLoadTraceabilityMatrix'),
          variant: 'destructive',
        });
      })
      .finally(() => {
        if (cancelled || seq !== requestSeq.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [numericProjectId, priority, coverage, testStatus, appliedSearch, page, t, toast]);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil((data.matched_requirements || 0) / PAGE_SIZE));
  }, [data]);

  const clearFilters = () => {
    setSearchInput('');
    setAppliedSearch('');
    setPriority('all');
    setCoverage('all');
    setTestStatus('all');
  };

  const hasActiveFilters =
    appliedSearch !== '' || priority !== 'all' || coverage !== 'all' || testStatus !== 'all';

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-2xl font-bold">{t('traceabilityMatrix')}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {t('traceabilityMatrixSubtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label={t('totalRequirements')} value={data?.total_requirements ?? 0} />
        <SummaryCard
          label={t('coveredRequirements')}
          value={data?.covered_requirements ?? 0}
          tone="positive"
        />
        <SummaryCard
          label={t('uncoveredRequirements')}
          value={data?.uncovered_requirements ?? 0}
          tone="warning"
        />
        <SummaryCard
          label={t('coveragePercent')}
          value={`${Math.round(data?.coverage_percentage ?? 0)}%`}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('filters')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="relative">
              <Search
                className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 ${
                  isRTL ? 'right-3' : 'left-3'
                }`}
              />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('search')}
                className={isRTL ? 'pr-9' : 'pl-9'}
              />
            </div>
            <Select value={priority} onValueChange={(v) => setPriority(v as PriorityFilter)}>
              <SelectTrigger>
                <SelectValue placeholder={t('priority')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allPriorities')}</SelectItem>
                <SelectItem value="low">{t('low')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="high">{t('high')}</SelectItem>
                <SelectItem value="critical">{t('critical')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={coverage} onValueChange={(v) => setCoverage(v as CoverageFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                <SelectItem value="covered">{t('coveredRequirements')}</SelectItem>
                <SelectItem value="uncovered">{t('uncoveredRequirements')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={testStatus} onValueChange={(v) => setTestStatus(v as StatusFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                <SelectItem value="passed">{t('passed')}</SelectItem>
                <SelectItem value="failed">{t('failed')}</SelectItem>
                <SelectItem value="blocked">{t('blocked')}</SelectItem>
                <SelectItem value="skipped">{t('skipped')}</SelectItem>
                <SelectItem value="not_tested">{t('notTested')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {hasActiveFilters && data && (
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>
                {t('reports_showingMatched', {
                  matched: data.matched_requirements,
                  total: data.total_requirements,
                })}
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {t('reports_clearFilters')}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
          <Loader2 className={`h-5 w-5 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
          {t('reports_loadingTraceability')}
        </div>
      )}

      {!loading && error && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && data.requirements.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {hasActiveFilters ? t('noRequirementsForMatrix') : t('reports_noReqsMsg')}
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && data.requirements.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className={`px-4 py-3 ${isRTL ? 'text-right' : 'text-left'}`}>
                    {t('colRequirement')}
                  </th>
                  <th className={`px-4 py-3 ${isRTL ? 'text-right' : 'text-left'}`}>
                    {t('reports_colTestCase')}
                  </th>
                  <th className="px-4 py-3 text-center">{t('reports_colStatus')}</th>
                  <th className={`px-4 py-3 ${isRTL ? 'text-left' : 'text-right'}`}>
                    {t('reports_colLastExecuted')}
                  </th>
                  <th className="px-4 py-3 text-center">{t('colOpenDefects')}</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {data.requirements.flatMap((req) => buildRows(req, numericProjectId, t, isRTL, language))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && !error && data && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('pageXOfY', { page: page + 1, pages: totalPages })}
          </span>
          <div className={`flex items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
              <span className={isRTL ? 'mr-1' : 'ml-1'}>{t('previous')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              <span className={isRTL ? 'ml-1' : 'mr-1'}>{t('next')}</span>
              <ChevronRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'positive' | 'warning';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-green-600 dark:text-green-400'
      : tone === 'warning'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-gray-900 dark:text-white';
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function buildRows(
  req: MatrixRequirement,
  projectId: number,
  t: ReturnType<typeof useTranslation>['t'],
  isRTL: boolean,
  language: string,
) {
  const reqCell = (
    <div className={`flex flex-col gap-1 ${isRTL ? 'text-right' : ''}`}>
      <div className={`flex items-center gap-2 ${isRTL ? 'flex-row-reverse' : ''}`}>
        <Link
          to={`/projects/${projectId}/requirements/${req.requirement_id}`}
          className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          {req.requirement_key || `REQ-${req.requirement_id}`}
        </Link>
        {req.requirement_priority && (
          <Badge variant="secondary" className="capitalize text-[10px]">
            {req.requirement_priority}
          </Badge>
        )}
      </div>
      <Link
        to={`/projects/${projectId}/requirements/${req.requirement_id}`}
        className="font-medium text-gray-900 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
      >
        {req.requirement_title}
      </Link>
    </div>
  );

  if (req.test_cases.length === 0) {
    return [
      <tr key={`req-${req.requirement_id}-empty`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
        <td className="px-4 py-3 align-top">{reqCell}</td>
        <td className="px-4 py-3 align-top text-gray-500 dark:text-gray-400 italic" colSpan={4}>
          {t('noTestCasesLinked')}
        </td>
      </tr>,
    ];
  }

  return req.test_cases.map((tc) => {
    const executionPath = tc.test_run_id
      ? `/projects/${projectId}/test-runs/${tc.test_run_id}/test-cases/${tc.id}`
      : `/projects/${projectId}/test-cases/${tc.id}/execute`;
    const status = normalizeStatus(tc.status);
    const lastRun = formatDate(tc.last_executed, language);

    return (
      <tr
        key={`req-${req.requirement_id}-tc-${tc.id}`}
        className="hover:bg-gray-50 dark:hover:bg-gray-800/40"
      >
        <td className="px-4 py-3 align-top">{reqCell}</td>
        <td className="px-4 py-3 align-top">
          <div className={`flex flex-col gap-1 ${isRTL ? 'text-right' : ''}`}>
            <Link
              to={`/projects/${projectId}/test-cases/${tc.id}`}
              className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              TC-{tc.id}
            </Link>
            <Link
              to={`/projects/${projectId}/test-cases/${tc.id}`}
              className="text-gray-800 hover:underline dark:text-gray-100"
            >
              {tc.title}
            </Link>
          </div>
        </td>
        <td className="px-4 py-3 align-top text-center">
          <Link
            to={executionPath}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${statusBadgeClass(
              status,
            )}`}
          >
            {statusIcon(status)}
            <span className="capitalize">{status.replace('_', ' ')}</span>
          </Link>
        </td>
        <td
          className={`px-4 py-3 align-top text-xs text-gray-600 dark:text-gray-400 ${
            isRTL ? 'text-left' : 'text-right'
          }`}
        >
          {lastRun || t('reports_never')}
        </td>
        <td className="px-4 py-3 align-top text-center">
          <DefectCell tc={tc} projectId={projectId} t={t} />
        </td>
      </tr>
    );
  });
}

function DefectCell({
  tc,
  projectId,
  t,
}: {
  tc: MatrixTestCase;
  projectId: number;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (tc.open_defects_count === 0) {
    return <span className="text-xs text-gray-400 dark:text-gray-500">{t('noOpenDefectsShort')}</span>;
  }

  const tooltip = [
    t('openDefectsTooltip', { count: tc.open_defects_count }),
    ...tc.open_defects.map((d) => `${d.defect_id || `#${d.id}`} — ${d.title} (${d.severity})`),
  ].join('\n');

  return (
    <Link
      to={`/projects/${projectId}/defects?test_case_id=${tc.id}`}
      title={tooltip}
      className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
    >
      <Bug className="h-3.5 w-3.5" />
      {tc.open_defects_count}
    </Link>
  );
}
