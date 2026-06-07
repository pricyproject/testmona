import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Bug,
  Clock,
  User,
  Calendar,
  BarChart3,
  Download,
  RefreshCw,
  PlayCircle,
  Plus,
  Trash2,
  Search,
  MessageSquare,
  Edit,
  Save,
  X,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Loader2,
  Link2,
  Unlink,
  Zap,
  Filter,
  Upload,
  FileUp,
  Server,
} from 'lucide-react';
import { SearchableDefectSelect } from '@/components/Defects/SearchableDefectSelect';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TestRunPieChart, TestRunBarChart, TestRunTrendChart } from '@/components/ui/chart';
import { useTranslation } from '@/hooks/useTranslation';
import { defectsAPI, environmentsAPI, getApiErrorMessage, sectionsAPI, testCasesAPI, testRunsAPI, testResultsAPI, usersAPI } from '@/lib/api';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CustomFieldsPanel } from '@/components/CustomFieldsPanel';
import { useToast } from '@/hooks/use-toast';
import { TestResult } from '@/types/index';
import { formatDurationSeconds } from '@/utils/timeFormat';

interface TestRun {
  id: string;
  name: string;
  description?: string;
  status: 'in-progress' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  blockedTests: number;
  skippedTests: number;
  inProgressTests: number;
  testResults: TestResult[];
  environment?: string;
  testSuite?: string;
  executedBy?: string;
}

export function TestRunDetail() {
  const { id, projectId } = useParams<{ id: string; projectId: string }>();
  // The URL carries the per-project sequence; resolve it to the global test-run id.
  const { id: runGlobalId, loading: runIdLoading } = useResolvedEntityId(projectId, 'test-runs', id);
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [testRun, setTestRun] = useState<any>(null);
  const [testResults, setTestResults] = useState<any[]>([]);
  const [defectCoverage, setDefectCoverage] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<string>(() => searchParams.get('status') || 'all');
  const [resultSearchQuery, setResultSearchQuery] = useState(() => searchParams.get('q') || '');
  const [isAddTestCasesOpen, setIsAddTestCasesOpen] = useState(false);
  const [selectedTestCasesForRemoval, setSelectedTestCasesForRemoval] = useState<number[]>([]);
  const [availableTestCases, setAvailableTestCases] = useState<any[]>([]);
  const [selectedTestCasesToAdd, setSelectedTestCasesToAdd] = useState<number[]>([]);
  const [searchTestCases, setSearchTestCases] = useState('');
  const [sections, setSections] = useState<any[]>([]);
  const [isResettingTime, setIsResettingTime] = useState(false);
  const [isAssigningRun, setIsAssigningRun] = useState(false);
  const [environments, setEnvironments] = useState<any[]>([]);
  const [isSettingEnvironment, setIsSettingEnvironment] = useState(false);

  // Column sorting
  const [sortColumn, setSortColumn] = useState<string | null>(() => searchParams.get('sort') || null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (searchParams.get('dir') === 'desc' ? 'desc' : 'asc'));

  // Column visibility (optional columns only; checkbox/testCase/status/actions are always visible)
  type OptionalCol = 'section' | 'priority' | 'defects' | 'executedBy' | 'executedAt' | 'duration' | 'comments';
  const [hiddenCols, setHiddenCols] = useState<Set<OptionalCol>>(new Set());
  const isVisible = (col: OptionalCol) => !hiddenCols.has(col);
  const toggleCol = (col: OptionalCol) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  };

  // Faceted + quick filters
  const [sectionFilter, setSectionFilter] = useState<string>(() => searchParams.get('section') || 'all');
  const [priorityFilter, setPriorityFilter] = useState<string>(() => searchParams.get('priority') || 'all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>(() => searchParams.get('assignee') || 'all');
  // attention: all | untested | failed_no_defect | retest
  const [attentionFilter, setAttentionFilter] = useState<string>(() => searchParams.get('attention') || 'all');

  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState<number>(() => Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1));

  // Inline defect linking from the table
  const [defectsCatalog, setDefectsCatalog] = useState<any[]>([]);
  const [linkDialogResultId, setLinkDialogResultId] = useState<number | null>(null);
  const [linkDefectId, setLinkDefectId] = useState('');
  const [linkType, setLinkType] = useState('found');
  const [isLinkingDefect, setIsLinkingDefect] = useState(false);

  // Cross-run flakiness, keyed by test case id
  const [flakiness, setFlakiness] = useState<Record<string, { runs: number; fails: number; flaky: boolean }>>({});

  // Inline / bulk save progress
  const [savingResultId, setSavingResultId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Bumped whenever results are mutated, to refresh backend-computed rollups
  const [derivedRefreshKey, setDerivedRefreshKey] = useState(0);
  const bumpDerived = () => setDerivedRefreshKey((k) => k + 1);
  // Server-side search term for the inline defect picker
  const [defectSearch, setDefectSearch] = useState('');

  // CI result import
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFormat, setImportFormat] = useState<'auto' | 'junit' | 'ctrf'>('auto');
  const [importAutoCreate, setImportAutoCreate] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<any>(null);

  // Prepare chart data
  const prepareChartData = () => {
    if (!testResults.length) {
      return { pieData: [], sectionData: [], trendData: [] };
    }

    const normalizeResultStatus = (status: string) => {
      const normalizedStatus = status.toLowerCase();
      const statusMap: Record<string, 'pass' | 'fail' | 'block' | 'skip' | 'not_started'> = {
        pass: 'pass',
        passed: 'pass',
        fail: 'fail',
        failed: 'fail',
        block: 'block',
        blocked: 'block',
        skip: 'skip',
        skipped: 'skip',
        not_started: 'not_started',
        pending: 'not_started',
      };

      return statusMap[normalizedStatus] || 'not_started';
    };

    // Calculate status counts - normalize status values
    const statusCounts = testResults.reduce((acc: any, result) => {
      const normalizedStatus = normalizeResultStatus(result.status);
      acc[normalizedStatus] = (acc[normalizedStatus] || 0) + 1;
      return acc;
    }, {});

    // Pie chart data
    const pieData = [
      { key: 'pass', name: t('passed'), value: statusCounts.pass || 0, color: '#10b981' },
      { key: 'fail', name: t('failed'), value: statusCounts.fail || 0, color: '#ef4444' },
      { key: 'block', name: t('blocked'), value: statusCounts.block || 0, color: '#f59e0b' },
      { key: 'skip', name: t('skipped'), value: statusCounts.skip || 0, color: '#64748b' },
      { key: 'not_started', name: t('notStarted'), value: statusCounts.not_started || 0, color: '#94a3b8' },
    ].filter(item => item.value > 0);

    // Bar chart data by section. Group on the same identity the results table
    // filters by (section name, or a "no section" sentinel) so that clicking a
    // bar narrows the table to exactly the rows that bar represents. `filterValue`
    // is what the table's sectionFilter compares against; `name` is the label.
    const sectionMap = new Map<string, any>();
    testResults.forEach((result) => {
      const rawName = result.test_case?.section?.name?.trim();
      const filterValue = rawName || NO_SECTION;
      const normalizedStatus = normalizeResultStatus(result.status);

      let entry = sectionMap.get(filterValue);
      if (!entry) {
        entry = {
          name: rawName || t('noSection'),
          filterValue,
          pass: 0,
          fail: 0,
          block: 0,
          skip: 0,
          not_started: 0,
          total: 0,
        };
        sectionMap.set(filterValue, entry);
      }
      entry[normalizedStatus] = (entry[normalizedStatus] || 0) + 1;
      entry.total++;
    });
    const sectionData = Array.from(sectionMap.values());

    // Pass rate per section, expressed over executed results only (pending tests
    // aren't failures, so they must not drag the rate toward 0).
    sectionData.forEach(section => {
      const executed = section.total - section.not_started;
      section.passRate = executed > 0 ? Math.round((section.pass / executed) * 100) : 0;
    });

    // The trend shows how the pass rate evolved as tests were *executed*, with
    // one point per execution day. Tests that haven't run yet have no point on
    // the timeline. Aggregating by day (rather than per result) is what keeps the
    // chart stable: a calendar date appears exactly once, so it never shows two
    // conflicting values, and editing a result only moves it between day buckets
    // instead of reshuffling a positional index across the whole series.
    const executedResults = testResults.filter((result) => isResultComplete(result.status));
    const resultTimestamp = (result: any) => {
      const time = new Date(
        result.executed_at || result.updated_at || result.created_at || testRun?.created_at || 0,
      ).getTime();
      return Number.isNaN(time) ? 0 : time;
    };

    // Bucket executed results by calendar day using a stable, locale-independent key.
    const dayBuckets = new Map<string, { time: number; label: string; passed: number; total: number }>();
    executedResults.forEach((result) => {
      const day = new Date(resultTimestamp(result));
      const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      let bucket = dayBuckets.get(dayKey);
      if (!bucket) {
        bucket = { time: day.getTime(), label: day.toLocaleDateString(), passed: 0, total: 0 };
        dayBuckets.set(dayKey, bucket);
      }
      bucket.total += 1;
      if (normalizeResultStatus(result.status) === 'pass') {
        bucket.passed += 1;
      }
    });

    const sortedDays = Array.from(dayBuckets.values()).sort((a, b) => a.time - b.time);
    let cumulativeTotal = 0;
    let cumulativePassed = 0;
    const trendData = sortedDays.map((bucket, index) => {
      cumulativeTotal += bucket.total;
      cumulativePassed += bucket.passed;
      return {
        // `order` is the unique X position (day sequence); `date` is the label.
        order: index + 1,
        date: bucket.label,
        passRate: cumulativeTotal > 0 ? Math.round((cumulativePassed / cumulativeTotal) * 100) : 0,
        totalTests: cumulativeTotal,
      };
    });

    return { pieData, sectionData, trendData };
  };  
  // Load defect-linking coverage rollup for traceability reporting
  useEffect(() => {
    if (!runGlobalId) return;
    let cancelled = false;
    testRunsAPI.getDefectCoverage(runGlobalId)
      .then((data) => { if (!cancelled) setDefectCoverage(data); })
      .catch((err) => { console.error('Failed to load defect coverage:', err); });
    return () => { cancelled = true; };
  }, [runGlobalId, testResults.length, derivedRefreshKey]);

  // Load cross-run flakiness for the test cases in this run
  useEffect(() => {
    if (!runGlobalId) return;
    let cancelled = false;
    testRunsAPI.getFlakiness(runGlobalId)
      .then((data) => { if (!cancelled) setFlakiness(data || {}); })
      .catch((err) => { console.error('Failed to load flakiness:', err); });
    return () => { cancelled = true; };
  }, [runGlobalId, testResults.length, derivedRefreshKey]);

  // Load the project's defect catalog for inline defect linking.
  // Empty search → 100 most recent; otherwise server-side filtered (debounced).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const query = defectSearch.trim();
    const handle = window.setTimeout(() => {
      defectsAPI.getAll(parseInt(projectId), 0, 100, query ? { search: query } : {})
        .then((data) => { if (!cancelled) setDefectsCatalog(Array.isArray(data) ? data : []); })
        .catch((err) => { console.error('Failed to load defects catalog:', err); });
    }, query ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [projectId, defectSearch]);

  // Keep filter/search/sort/page state in the URL (shareable + survives reload)
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const sync = (key: string, value: string, fallback: string) => {
      if (value && value !== fallback) next.set(key, value);
      else next.delete(key);
    };
    sync('status', filter, 'all');
    sync('q', resultSearchQuery.trim(), '');
    sync('section', sectionFilter, 'all');
    sync('priority', priorityFilter, 'all');
    sync('assignee', assigneeFilter, 'all');
    sync('attention', attentionFilter, 'all');
    sync('sort', sortColumn || '', '');
    sync('dir', sortColumn ? sortDir : '', '');
    sync('page', page > 1 ? String(page) : '', '');
    setSearchParams(next, { replace: true });

  }, [filter, resultSearchQuery, sectionFilter, priorityFilter, assigneeFilter, attentionFilter, sortColumn, sortDir, page]);

  // Reset to the first page whenever the filter set changes (but not on mount,
  // so a page number provided in the URL survives the initial render). Also
  // prune the selection to rows still visible, so bulk actions never hit
  // filtered-out (invisible) results.
  const filtersInitialized = useRef(false);
  useEffect(() => {
    if (!filtersInitialized.current) {
      filtersInitialized.current = true;
      return;
    }
    setPage(1);
    const visibleIds = new Set(filteredResults.map((r) => r.id));
    setSelectedTestCasesForRemoval((prev) => prev.filter((rid) => visibleIds.has(rid)));

  }, [filter, resultSearchQuery, sectionFilter, priorityFilter, assigneeFilter, attentionFilter]);

  const normalizeRunStatus = (status?: string | null) => (status || '').toLowerCase().replace(/[-\s]/g, '_');

  const isResultComplete = (status?: string | null) => {
    const normalizedStatus = normalizeRunStatus(status);
    return Boolean(normalizedStatus) && normalizedStatus !== 'not_started' && normalizedStatus !== 'pending';
  };

  const getResultExecutorName = (result: any) => {
    const executor = result.executor;
    if (executor?.full_name || executor?.username || executor?.email) {
      return executor.full_name || executor.username || executor.email;
    }

    if (isResultComplete(result.status) && testRun?.assignee) {
      return testRun.assignee.full_name || testRun.assignee.username || testRun.assignee.email;
    }

    return t('notExecuted');
  };

  const getTimedResultPayload = (result: any, pendingValues: Record<string, any>) => {
    const payload = { ...pendingValues };
    const targetStatus = payload.status ?? result.status;

    // Only stamp a duration when the result is first completed and has none yet.
    // Editing another field (comment, executor) on an already-timed result must
    // never overwrite its recorded execution_time.
    if (
      isResultComplete(targetStatus)
      && payload.execution_time === undefined
      && result.execution_time == null
    ) {
      const startedAt = payload.execution_started_at || result.execution_started_at || new Date().toISOString();
      const startedAtTime = new Date(startedAt).getTime();
      payload.execution_started_at = startedAt;
      payload.execution_time = Number.isNaN(startedAtTime)
        ? 0
        : Math.max(0, Math.round((Date.now() - startedAtTime) / 1000));
    }

    return payload;
  };

  const getDerivedRunStatusPayload = (runData: any, resultsData: any[]) => {
    const currentStatus = normalizeRunStatus(runData.status);
    const hasResults = resultsData.length > 0;
    const allCompleted = hasResults && resultsData.every((result: any) => isResultComplete(result.status));
    const targetStatus = !hasResults ? 'pending' : allCompleted ? 'completed' : 'running';

    const completedAtIsConsistent = targetStatus === 'completed' ? Boolean(runData.completed_at) : !runData.completed_at;
    const startedAtIsConsistent = targetStatus === 'pending' || Boolean(runData.started_at);
    if (currentStatus === targetStatus && completedAtIsConsistent && startedAtIsConsistent) {
      return null;
    }

    return {
      status: targetStatus,
      started_at: targetStatus === 'pending' ? null : (runData.started_at || new Date().toISOString()),
      completed_at: targetStatus === 'completed' ? (runData.completed_at || new Date().toISOString()) : null,
    };
  };

  const syncTestRunStatus = async (runData: any, resultsData: any[]) => {
    const statusPayload = getDerivedRunStatusPayload(runData, resultsData);
    if (!statusPayload || !id) {
      return runData;
    }

    await testRunsAPI.update(runGlobalId, statusPayload);
    return testRunsAPI.getById(runGlobalId);
  };

  // Function to check and update test run status
  const checkAndUpdateStatus = async () => {
    if (runIdLoading || !id || !projectId || !runGlobalId) return;
    
    try {
      const testRunData = await testRunsAPI.getById(runGlobalId);
      const currentProjectId = parseInt(projectId);
      if (Number.isNaN(currentProjectId) || Number(testRunData.project_id) !== currentProjectId) {
        setTestRun(null);
        setTestResults([]);
        setError(t('testRunNotFoundInProject'));
        return;
      }

      const testResultsData = await testResultsAPI.getAll(runGlobalId);
      const updatedTestRun = await syncTestRunStatus(testRunData, testResultsData);
      setTestRun(updatedTestRun);
      setTestResults(testResultsData);
    } catch (error) {
      console.error('Failed to check/update status:', error);
    }
  };
  
  useEffect(() => {
    const loadData = async () => {
      if (runIdLoading) return;  // wait for the seq -> id resolution
      if (!id || !projectId || !runGlobalId) {
        setError('Missing test run ID or project ID');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        // Load test run data
        const testRunData = await testRunsAPI.getById(runGlobalId);
        const currentProjectId = parseInt(projectId);
        if (Number.isNaN(currentProjectId) || Number(testRunData.project_id) !== currentProjectId) {
          setTestRun(null);
          setTestResults([]);
          setUsers([]);
          setError(t('testRunNotFoundInProject'));
          return;
        }
        
        // Load test results for this test run
        const testResultsData = await testResultsAPI.getAll(runGlobalId);
        
        // Load users for dropdown
        const usersData = await usersAPI.getAll();
        
        const syncedTestRun = await syncTestRunStatus(testRunData, testResultsData);
        setTestRun(syncedTestRun);
        setTestResults(testResultsData);
        setUsers(usersData);
      } catch (err) {
        console.error('Failed to load test run data:', err);
        setError('Failed to load test run data');
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Set up interval to check status every 5 seconds
    const interval = setInterval(checkAndUpdateStatus, 5000);
    return () => clearInterval(interval);
  }, [id, projectId, runGlobalId, runIdLoading]);

  // Load sections for chart data
  useEffect(() => {
    const loadSections = async () => {
      if (projectId) {
        try {
          const sectionsData = await sectionsAPI.getProjectSectionHierarchy(parseInt(projectId));
          const allSections: any[] = [];
          
          // Flatten sections from hierarchy
          const flattenSections = (hierarchy: any[]) => {
            hierarchy.forEach((item: any) => {
              if (item.sections) {
                item.sections.forEach((section: any) => {
                  allSections.push({
                    id: section.id,
                    name: section.name,
                    test_suite_id: item.test_suite?.id
                  });
                  if (section.subsections) {
                    const flattenSubsections = (subsections: any[], parentName: string) => {
                      subsections.forEach((sub: any) => {
                        allSections.push({
                          id: sub.id,
                          name: `${parentName} > ${sub.name}`,
                          test_suite_id: item.test_suite?.id
                        });
                        if (sub.subsections) {
                          flattenSubsections(sub.subsections, `${parentName} > ${sub.name}`);
                        }
                      });
                    };
                    flattenSubsections(section.subsections, section.name);
                  }
                });
              }
            });
          };
          
          flattenSections(sectionsData.hierarchy || []);
          setSections(allSections);
        } catch (err) {
          console.error('Failed to load sections:', err);
        }
      }
    };

    loadSections();
  }, [projectId]);

  // Load the project's execution environments so a run can be pointed at one
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    environmentsAPI.getAll(parseInt(projectId))
      .then((data) => { if (!cancelled) setEnvironments(Array.isArray(data) ? data : []); })
      .catch((err) => { console.error('Failed to load environments:', err); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Load available test cases when dialog opens
  useEffect(() => {
    const loadAvailableTestCases = async () => {
      if (isAddTestCasesOpen && projectId) {
        try {
          const allTestCases = await testCasesAPI.getAll();
          
          // Filter out test cases that are already in this test run
          const existingTestCaseIds = testResults.map(r => r.test_case_id);
          const available = allTestCases.filter(tc => !existingTestCaseIds.includes(tc.id));
          
          setAvailableTestCases(available);
        } catch (err) {
          console.error('Failed to load available test cases:', err);
        }
      }
    };

    loadAvailableTestCases();
  }, [isAddTestCasesOpen, projectId, testResults]);

  const normalizeStatusKey = (status?: string) => (status || '').toLowerCase().replace(/[-\s]/g, '_');

  const getStatusIcon = (status: string) => {
    const normalizedStatus = normalizeStatusKey(status);
    switch (normalizedStatus) {
      case 'pass':
      case 'passed':
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'fail':
      case 'failed':
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'block':
      case 'blocked':
        return <AlertCircle className="h-4 w-4 text-orange-600" />;
      case 'running':
      case 'in_progress':
        return <PlayCircle className="h-4 w-4 text-blue-600" />;
      case 'skip':
      case 'skipped':
        return <Clock className="h-4 w-4 text-gray-600" />;
      case 'pending':
      case 'not_started':
        return <Clock className="h-4 w-4 text-gray-400" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const normalizedStatus = normalizeStatusKey(status);
    const variants: Record<string, string> = {
      pass: 'border border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300',
      passed: 'border border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300',
      completed: 'border border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      fail: 'border border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
      failed: 'border border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
      cancelled: 'border border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
      block: 'border border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
      blocked: 'border border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
      running: 'border border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      in_progress: 'border border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      skip: 'border border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300',
      skipped: 'border border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300',
      pending: 'border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400',
      not_started: 'border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400',
    };
    return variants[normalizedStatus] || 'border border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300';
  };

  const formatStatusLabel = (status: string) => {
    const normalizedStatus = status.toLowerCase();
    const labels: Record<string, string> = {
      not_started: 'Not Started',
      pass: 'Pass',
      passed: 'Passed',
      fail: 'Fail',
      failed: 'Failed',
      block: 'Block',
      blocked: 'Blocked',
      skip: 'Skip',
      skipped: 'Skipped',
      pending: 'Pending',
      in_progress: 'In Progress',
      running: 'Running',
      completed: 'Completed',
      cancelled: 'Cancelled',
    };
    return labels[normalizedStatus] || status.replace(/[-_]/g, ' ');
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
      medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    };
    return variants[priority] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  const PRIORITY_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
  };

  // --- Row-level defect / flakiness helpers --------------------------------
  const NO_SECTION = '__no_section__';
  const getResultDefectLinks = (result: any): any[] =>
    Array.isArray(result?.defect_links) ? result.defect_links : [];
  const isFailedOrBlocked = (result: any) =>
    ['fail', 'block'].includes(normalizeRunStatus(result?.status));
  const isUnlinkedFailure = (result: any) =>
    isFailedOrBlocked(result)
    && getResultDefectLinks(result).length === 0
    && !String(result?.defect_link || '').trim();
  const getFlakiness = (result: any) =>
    result?.test_case_id != null ? flakiness[String(result.test_case_id)] : undefined;

  // Facet option lists derived from the loaded results
  const sectionOptions = useMemo(() => {
    const names = new Set<string>();
    testResults.forEach((r) => names.add(r.test_case?.section?.name || NO_SECTION));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [testResults]);
  const assigneeOptions = useMemo(() => {
    const ids = new Set<string>();
    let hasUnassigned = false;
    testResults.forEach((r) => {
      if (r.executed_by) ids.add(String(r.executed_by));
      else hasUnassigned = true;
    });
    return { ids: Array.from(ids), hasUnassigned };
  }, [testResults]);

  const filteredResults = testResults.filter(result => {
    const resultStatus = normalizeRunStatus(result.status) || 'not_started';
    if (filter !== 'all' && resultStatus !== normalizeRunStatus(filter)) return false;

    // Faceted filters
    if (sectionFilter !== 'all' && (result.test_case?.section?.name || NO_SECTION) !== sectionFilter) return false;
    if (priorityFilter !== 'all' && (result.test_case?.priority || 'medium') !== priorityFilter) return false;
    if (assigneeFilter !== 'all') {
      const execId = result.executed_by ? String(result.executed_by) : 'unassigned';
      if (execId !== assigneeFilter) return false;
    }

    // Quick "needs attention" filters
    if (attentionFilter === 'untested' && isResultComplete(result.status)) return false;
    if (attentionFilter === 'failed_no_defect' && !isUnlinkedFailure(result)) return false;
    if (attentionFilter === 'retest' && !result.retest_needed) return false;

    // Free-text search
    const normalizedQuery = resultSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return true;

    const searchableFields = [
      result.test_case?.title,
      result.test_case_id ? `tc-${result.test_case_id}` : '',
      result.test_case?.section?.name,
      result.test_case?.priority,
      result.comments,
      getResultExecutorName(result),
      formatStatusLabel(result.status),
      ...getResultDefectLinks(result).map((link: any) => link?.defect?.defect_id),
    ];

    return searchableFields.some((field) =>
      String(field || '').toLowerCase().includes(normalizedQuery)
    );
  });

  const sortedFilteredResults = sortColumn
    ? [...filteredResults].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        switch (sortColumn) {
          case 'testCase':
            return dir * (a.test_case?.title || '').localeCompare(b.test_case?.title || '');
          case 'section':
            return dir * (a.test_case?.section?.name || '').localeCompare(b.test_case?.section?.name || '');
          case 'priority': {
            const pa = PRIORITY_ORDER[a.test_case?.priority || 'medium'] ?? 1;
            const pb = PRIORITY_ORDER[b.test_case?.priority || 'medium'] ?? 1;
            return dir * (pa - pb);
          }
          case 'status':
            return dir * (a.status || '').localeCompare(b.status || '');
          case 'executedBy':
            return dir * getResultExecutorName(a).localeCompare(getResultExecutorName(b));
          case 'executedAt':
            return dir * (new Date(a.executed_at || 0).getTime() - new Date(b.executed_at || 0).getTime());
          case 'duration':
            return dir * ((Number(a.execution_time) || 0) - (Number(b.execution_time) || 0));
          case 'defects':
            return dir * (getResultDefectLinks(a).length - getResultDefectLinks(b).length);
          default:
            return 0;
        }
      })
    : filteredResults;

  // Pagination over the filtered + sorted results
  const totalPages = Math.max(1, Math.ceil(sortedFilteredResults.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pagedResults = sortedFilteredResults.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const statusCounts = testResults.reduce((acc: any, result) => {
    const normalizedStatus = normalizeRunStatus(result.status) || 'not_started';
    acc[normalizedStatus] = (acc[normalizedStatus] || 0) + 1;
    return acc;
  }, {});
  
  const totalTests = testResults.length;
  const passedTests = (statusCounts.pass || 0) + (statusCounts.passed || 0);
  const failedTests = (statusCounts.fail || 0) + (statusCounts.failed || 0);
  const blockedTests = (statusCounts.block || 0) + (statusCounts.blocked || 0);
  const skippedTests = (statusCounts.skip || 0) + (statusCounts.skipped || 0);
  const notStartedTests = (statusCounts.not_started || 0) + (statusCounts.pending || 0);
  const unlinkedFailureCount = testResults.filter(isUnlinkedFailure).length;
  const retestCount = testResults.filter((r) => r.retest_needed).length;
  const flakyCount = testResults.filter((r) => getFlakiness(r)?.flaky).length;
  const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
  const totalExecutionSeconds = testResults.reduce((total, result) => total + (Number(result.execution_time) || 0), 0);
  const executedResultsCount = testResults.filter((result) => isResultComplete(result.status) && result.execution_time != null).length;
  const averageExecutionSeconds = executedResultsCount > 0 ? Math.round(totalExecutionSeconds / executedResultsCount) : 0;
  const { pieData, sectionData, trendData } = prepareChartData();
  const runDescription = testRun?.description?.trim() || t('noDescriptionProvided');
  const formattedCreatedDate = testRun?.created_at
    ? new Date(testRun.created_at).toLocaleDateString()
    : t('notAvailableShort');
  const formattedUpdatedDate = testRun?.updated_at
    ? new Date(testRun.updated_at).toLocaleDateString()
    : t('notAvailableShort');
  const formattedRunStatus = testRun?.status
    ? formatStatusLabel(testRun.status)
    : t('notAvailableShort');

  // Handle adding/removing test cases
  const handleAddTestCases = async () => {
    if (selectedTestCasesToAdd.length === 0) {
      setIsAddTestCasesOpen(false);
      return;
    }

    try {
      const testResultsPromises = selectedTestCasesToAdd.map(testCaseId =>
        testResultsAPI.create({
          test_run_id: parseInt(id!),
          test_case_id: testCaseId,
          status: 'not_started',
          actual_result: undefined,
          comments: undefined,
          execution_time: undefined,
          executed_by: undefined,
        })
      );
      
      await Promise.all(testResultsPromises);
      
      // Reload test results
      const updatedTestResults = await testResultsAPI.getAll(parseInt(id!));
      const updatedTestRun = testRun ? await syncTestRunStatus(testRun, updatedTestResults) : null;
      setTestResults(updatedTestResults);
      if (updatedTestRun) {
        setTestRun(updatedTestRun);
      }
      
      setIsAddTestCasesOpen(false);
      setSelectedTestCasesToAdd([]);
    } catch (err) {
      console.error('Failed to add test cases:', err);
      setError('Failed to add test cases');
    }
  };

  const handleRemoveTestCases = async () => {
    if (selectedTestCasesForRemoval.length === 0) return;
    
    try {
      const deletePromises = selectedTestCasesForRemoval.map(resultId =>
        testResultsAPI.delete(resultId)
      );
      
      await Promise.all(deletePromises);
      
      // Reload test results
      const updatedTestResults = await testResultsAPI.getAll(parseInt(id!));
      const updatedTestRun = testRun ? await syncTestRunStatus(testRun, updatedTestResults) : null;
      setTestResults(updatedTestResults);
      if (updatedTestRun) {
        setTestRun(updatedTestRun);
      }
      
      setSelectedTestCasesForRemoval([]);
    } catch (err) {
      console.error('Failed to remove test cases:', err);
      setError('Failed to remove test cases');
    }
  };

  const handleSelectTestCaseForRemoval = (resultId: number) => {
    setSelectedTestCasesForRemoval(prev => 
      prev.includes(resultId) 
        ? prev.filter(id => id !== resultId)
        : [...prev, resultId]
    );
  };

  // Handle chart clicks for filtering
  const handleChartClick = (filterData: any) => {
    if (filterData.type === 'status') {
      // Map chart labels to backend status values
      const statusMap: Record<string, string> = {
        'passed': 'pass',
        'failed': 'fail',
        'blocked': 'block',
        'skipped': 'skip',
        'not tested': 'not_started',
      };
      
      const normalizedStatus = filterData.value.toLowerCase();
      const mappedStatus = statusMap[normalizedStatus] || normalizedStatus;
      setFilter(mappedStatus);
    } else if (filterData.type === 'section' && filterData.value) {
      // Toggle the table's section facet so a second click clears it
      setSectionFilter((prev) => (prev === filterData.value ? 'all' : filterData.value));
    }
  };

  // Handle inline editing
  const [editingResult, setEditingResult] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ [key: string]: any }>({});

  const handleEdit = (resultId: string, field: string, value: any) => {
    setEditingResult(resultId);
    setEditValues(prev => ({ ...prev, [resultId]: { ...prev[resultId], [field]: value } }));
  };

  const handleSave = async (resultId: string) => {
    const result = testResults.find((item) => String(item.id) === String(resultId));
    const pendingValues = editValues[resultId];

    if (!result || !pendingValues) {
      setEditingResult(null);
      return;
    }

    try {
      const payload = {
        ...getTimedResultPayload(result, pendingValues),
        executed_by: pendingValues.executed_by ? parseInt(pendingValues.executed_by, 10) : result.executed_by,
      };
      const updatedResult = await testResultsAPI.update(Number(resultId), payload);
      const updatedTestResults = testResults.map((item) =>
        String(item.id) === String(resultId) ? { ...item, ...updatedResult } : item
      );

      const updatedTestRun = testRun ? await syncTestRunStatus(testRun, updatedTestResults) : null;
      setTestResults(updatedTestResults);
      if (updatedTestRun) {
        setTestRun({ ...updatedTestRun, testResults: updatedTestResults });
      } else if (testRun?.testResults) {
        setTestRun({ ...testRun, testResults: updatedTestResults });
      }
      bumpDerived();
      setEditValues((prev) => {
        const nextValues = { ...prev };
        delete nextValues[resultId];
        return nextValues;
      });
    } catch (err) {
      console.error('Failed to update test result:', err);
      setError('Failed to update test result');
    } finally {
      setEditingResult(null);
    }
  };

  // Apply a batch of updated results to local state and re-derive run status
  const commitResults = async (updatedTestResults: any[]) => {
    const updatedTestRun = testRun ? await syncTestRunStatus(testRun, updatedTestResults) : null;
    setTestResults(updatedTestResults);
    if (updatedTestRun) {
      setTestRun({ ...updatedTestRun, testResults: updatedTestResults });
    } else if (testRun?.testResults) {
      setTestRun({ ...testRun, testResults: updatedTestResults });
    }
    // Backend-computed rollups (coverage, flakiness) depend on this change
    bumpDerived();
  };

  const selectedResults = () => testResults.filter((r) => selectedTestCasesForRemoval.includes(r.id));

  // One-click status change straight from the table
  const quickUpdateStatus = async (result: any, status: string) => {
    if (normalizeRunStatus(result.status) === normalizeRunStatus(status)) return;
    setSavingResultId(result.id);
    try {
      const updated = await testResultsAPI.update(Number(result.id), getTimedResultPayload(result, { status }));
      await commitResults(testResults.map((item) => (item.id === result.id ? { ...item, ...updated } : item)));
    } catch (err) {
      console.error('Failed to update status:', err);
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToUpdateResult')), variant: 'destructive' });
    } finally {
      setSavingResultId(null);
    }
  };

  // Bulk operations on the selected rows. Each row is updated independently so a
  // single failure doesn't discard the rows that succeeded.
  const runBulk = async (buildPayload: (result: any) => any) => {
    const targets = selectedResults();
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      const outcomes = await Promise.allSettled(
        targets.map((r) => testResultsAPI.update(Number(r.id), buildPayload(r))),
      );
      const succeeded = outcomes
        .filter((o): o is PromiseFulfilledResult<any> => o.status === 'fulfilled')
        .map((o) => o.value);
      const failed = outcomes.length - succeeded.length;

      if (succeeded.length > 0) {
        const byId = new Map(succeeded.map((u: any) => [u.id, u]));
        await commitResults(testResults.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r)));
      }
      // Keep only the rows that failed selected, so the user can retry them
      const failedIds = new Set(
        targets.filter((_, i) => outcomes[i].status === 'rejected').map((r) => r.id),
      );
      setSelectedTestCasesForRemoval((prev) => prev.filter((rid) => failedIds.has(rid)));

      if (failed === 0) {
        toast({ title: t('success'), description: t('bulkUpdateApplied', { count: succeeded.length }) });
      } else {
        toast({
          title: t('error'),
          description: t('bulkUpdatePartial', { ok: succeeded.length, failed }),
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Bulk update failed:', err);
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToUpdateResult')), variant: 'destructive' });
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkUpdateStatus = (status: string) => runBulk((r) => getTimedResultPayload(r, { status }));
  const bulkAssign = (userId: string) =>
    runBulk(() => ({ executed_by: userId ? parseInt(userId, 10) : null }));
  const bulkMarkRetest = () => runBulk(() => ({ retest_needed: true }));

  // Inline defect linking
  const openLinkDialog = (resultId: number) => {
    setLinkDialogResultId(resultId);
    setLinkDefectId('');
    setLinkType('found');
    setDefectSearch('');
  };

  // The result the Link Defect dialog is acting on, used to show which test case
  // the defect is being attached to.
  const linkTargetResult = linkDialogResultId !== null
    ? testResults.find((result) => result.id === linkDialogResultId) || null
    : null;

  const refreshResultLinks = async (resultId: number) => {
    const links = await testResultsAPI.getDefectLinks(resultId);
    setTestResults((prev) => prev.map((r) => (r.id === resultId ? { ...r, defect_links: links } : r)));
    // Linking/unlinking changes the run's defect-coverage rollup
    bumpDerived();
  };

  const handleLinkDefectSave = async () => {
    if (!linkDialogResultId || !linkDefectId) return;
    setIsLinkingDefect(true);
    try {
      await testResultsAPI.linkDefect(linkDialogResultId, {
        defect_id: parseInt(linkDefectId, 10),
        link_type: linkType,
      });
      await refreshResultLinks(linkDialogResultId);
      toast({ title: t('success'), description: t('defectLinkedSuccessfully') });
      setLinkDialogResultId(null);
    } catch (err) {
      console.error('Failed to link defect:', err);
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToLinkDefect')), variant: 'destructive' });
    } finally {
      setIsLinkingDefect(false);
    }
  };

  const handleUnlinkDefect = async (result: any, linkId: number) => {
    try {
      await testResultsAPI.unlinkDefect(result.id, linkId);
      await refreshResultLinks(result.id);
      toast({ title: t('success'), description: t('defectUnlinkedSuccessfully') });
    } catch (err) {
      console.error('Failed to unlink defect:', err);
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToUnlinkDefect')), variant: 'destructive' });
    }
  };

  // Jump straight into the next not-yet-executed test case
  const runNextUntested = () => {
    const next = sortedFilteredResults.find((r) => !isResultComplete(r.status))
      || testResults.find((r) => !isResultComplete(r.status));
    if (next?.test_case_id) {
      navigate(`/projects/${projectId}/test-runs/${id}/test-cases/${next.test_case_id}`);
    }
  };

  // Compact relative timestamp ("3m ago", "2h ago", …)
  const relativeTime = (dateStr?: string | null) => {
    if (!dateStr) return null;
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return null;
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return t('justNow');
    if (mins < 60) return t('minutesAgoShort', { count: mins });
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return t('hoursAgoShort', { count: hrs });
    const days = Math.round(hrs / 24);
    if (days < 30) return t('daysAgoShort', { count: days });
    return new Date(dateStr).toLocaleDateString();
  };

  // Handle View Reports and Export Results
  const handleViewReports = () => {
    // Navigate to dedicated report page
    navigate(`/projects/${projectId}/test-runs/${id}/report`);
  };

  // RFC 4180 escape: wrap in quotes, double inner quotes. Also defuse CSV
  // formula injection by prefixing a single quote when a value starts with a
  // character spreadsheets treat as a formula opener.
  const csvCell = (value: unknown): string => {
    if (value === null || value === undefined) return '""';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  };

  const handleExportResults = () => {
    if (!testRun) return;

    const statusLabel = (status?: string): string => {
      const key = normalizeStatusKey(status);
      const labels: Record<string, string> = {
        pass: t('passed'),
        passed: t('passed'),
        fail: t('failed'),
        failed: t('failed'),
        block: t('blocked'),
        blocked: t('blocked'),
        skip: t('skipped'),
        skipped: t('skipped'),
        not_started: t('notStarted'),
        pending: t('notStarted'),
      };
      return labels[key] || status || '';
    };

    const headers = [
      t('testCaseId'),
      t('testCaseTitle'),
      t('section'),
      t('priority'),
      t('status'),
      t('executedBy'),
      t('executedAt'),
      t('duration'),
      t('comments'),
    ];

    const rows = testResults.map((result) => [
      result.test_case_id != null ? `TC-${result.test_case_id}` : '',
      result.test_case?.title || '',
      result.test_case?.section?.name || '',
      result.test_case?.priority || '',
      statusLabel(result.status),
      getResultExecutorName(result),
      result.executed_at || '',
      result.execution_time != null && result.execution_time !== ''
        ? formatDurationSeconds(result.execution_time, t)
        : '',
      result.comments || '',
    ]);

    // RFC 4180: CRLF line breaks, every field quoted. Prepend a UTF-8 BOM so
    // Excel on Windows renders non-ASCII (Persian/Arabic) test case titles
    // correctly instead of as mojibake.
    const csvBody = [headers, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    const csvContent = '﻿' + csvBody + '\r\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-run-${testRun.id}-results.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: t('exportCompleted'),
      description: t('resultsExportedSuccessfully', { count: String(rows.length) }),
    });
  };

  const handleCancel = (resultId: string) => {
    setEditingResult(null);
    setEditValues(prev => {
      const newValues = { ...prev };
      delete newValues[resultId];
      return newValues;
    });
  };

  const handleResetTime = async () => {
    if (!runGlobalId) return;
    
    if (!confirm('Are you sure you want to reset all timing data for this test run? This will clear execution times for all test results.')) {
      return;
    }

    try {
      setIsResettingTime(true);
      await testRunsAPI.resetTime(runGlobalId);
      
      // Reload test run and results to get updated data
      const [updatedTestRun, updatedTestResults] = await Promise.all([
        testRunsAPI.getById(runGlobalId),
        testResultsAPI.getAll(runGlobalId)
      ]);
      
      const syncedTestRun = await syncTestRunStatus(updatedTestRun, updatedTestResults);
      setTestRun(syncedTestRun);
      setTestResults(updatedTestResults);

      toast({
        title: t('success'),
        description: t('testRunTimeResetSuccess'),
      });
    } catch (error) {
      console.error('Failed to reset test run time:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToResetTestRunTime')),
        variant: 'destructive',
      });
    } finally {
      setIsResettingTime(false);
    }
  };

  const resetImportDialog = () => {
    setImportFile(null);
    setImportFormat('auto');
    setImportAutoCreate(false);
    setImportSummary(null);
  };

  const handleImportResults = async () => {
    if (!runGlobalId || !importFile) return;
    try {
      setIsImporting(true);
      setImportSummary(null);
      const summary = await testRunsAPI.importResults(runGlobalId, importFile, {
        format: importFormat === 'auto' ? undefined : importFormat,
        autoCreate: importAutoCreate,
      });
      setImportSummary(summary);

      // Reload run + results so the table reflects the new statuses.
      const [updatedRun, updatedResults] = await Promise.all([
        testRunsAPI.getById(runGlobalId),
        testResultsAPI.getAll(runGlobalId),
      ]);
      const syncedRun = await syncTestRunStatus(updatedRun, updatedResults);
      setTestRun(syncedRun);
      setTestResults(updatedResults);
      bumpDerived();

      toast({
        title: t('importCompleted'),
        description: t('importResultsSummary', {
          matched: String(summary.matched ?? 0),
          unmatched: String(summary.unmatched ?? 0),
        }),
      });
    } catch (error) {
      console.error('Failed to import results:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToImportResults')),
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const getUserDisplayName = (userId?: number | null) => {
    if (!userId) return t('unassigned');
    const assignee = users.find((user) => Number(user.id) === Number(userId));
    return assignee?.full_name || assignee?.username || assignee?.email || t('unknown');
  };

  const handleAssignRun = async (value: string) => {
    if (!runGlobalId) return;

    const nextAssigneeId = value === 'unassigned' ? null : parseInt(value, 10);
    const normalizedId = Number.isInteger(nextAssigneeId) ? nextAssigneeId : null;
    const prevAssignedTo = testRun?.assigned_to ?? null;
    if (normalizedId === prevAssignedTo) return;

    // Optimistically reflect the choice so the field doesn't flicker back to the
    // old value while the request is in flight.
    setTestRun((prev: any) => (prev ? { ...prev, assigned_to: normalizedId } : prev));

    try {
      setIsAssigningRun(true);
      const updatedRun = await testRunsAPI.assign(parseInt(id, 10), normalizedId);
      setTestRun((prev: any) => ({ ...prev, ...updatedRun }));
    } catch (error) {
      console.error('Failed to assign test run:', error);
      setError(t('failedToAssignTestRun'));
      // Revert the optimistic change if the server rejected it.
      setTestRun((prev: any) => (prev ? { ...prev, assigned_to: prevAssignedTo } : prev));
    } finally {
      setIsAssigningRun(false);
    }
  };

  const handleSetEnvironment = async (value: string) => {
    if (!runGlobalId) return;

    const nextEnvironmentId = value === 'none' ? null : parseInt(value, 10);
    const normalizedId = Number.isInteger(nextEnvironmentId) ? nextEnvironmentId : null;
    const prevEnvironmentId = testRun?.environment_id ?? null;
    if (normalizedId === prevEnvironmentId) return;

    // Optimistically reflect the choice so the field doesn't flicker back to the
    // old value while the request is in flight.
    setTestRun((prev: any) => (prev ? { ...prev, environment_id: normalizedId } : prev));

    try {
      setIsSettingEnvironment(true);
      const updatedRun = await testRunsAPI.update(parseInt(id, 10), { environment_id: normalizedId });
      setTestRun((prev: any) => ({ ...prev, ...updatedRun }));
    } catch (error) {
      console.error('Failed to set test run environment:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToSetEnvironment')),
        variant: 'destructive',
      });
      // Revert the optimistic change if the server rejected it.
      setTestRun((prev: any) => (prev ? { ...prev, environment_id: prevEnvironmentId } : prev));
    } finally {
      setIsSettingEnvironment(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${projectId}/test-runs`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Test Runs
          </Button>
        </div>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !testRun) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${projectId}/test-runs`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Test Runs
          </Button>
        </div>
        <div className="text-center py-12">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            {error || t('testRunNotFound')}
          </h2>
          <p className="text-gray-600">
            {error || t('testRunNotFoundDescription')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-linear-to-br from-white via-cyan-50 to-slate-100 p-5 text-slate-950 shadow-xl shadow-slate-200/70 dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 dark:text-white dark:shadow-black/30 sm:p-6">
        <div className="pointer-events-none absolute -top-24 h-56 w-56 rounded-full bg-cyan-300/40 blur-3xl dark:bg-cyan-400/20 ltr:right-10 rtl:left-10" />
        <div className="pointer-events-none absolute -bottom-24 h-56 w-56 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-300/10 ltr:left-10 rtl:right-10" />

        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/test-runs`)}
              className="w-fit bg-slate-900/5 text-slate-700 hover:bg-slate-900/10 hover:text-slate-950 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white"
            >
              <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
              {t('backToTestRuns')}
            </Button>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="border border-cyan-200 bg-cyan-100/80 px-3 py-1 text-cyan-800 shadow-xs backdrop-blur-sm dark:border-cyan-200/30 dark:bg-cyan-300/15 dark:text-cyan-50">
                  {t('runId')}: {testRun.id}
                </Badge>
                <Badge className={`${getStatusBadge(testRun.status)} px-3 py-1 shadow-xs backdrop-blur-sm`}>
                  {formattedRunStatus}
                </Badge>
                <Badge className="border border-emerald-200 bg-emerald-100/80 px-3 py-1 text-emerald-800 shadow-xs backdrop-blur-sm dark:border-emerald-200/30 dark:bg-emerald-300/15 dark:text-emerald-50">
                  {t('passRateWithValue', { value: passRate })}
                </Badge>
              </div>

              <div className="max-w-4xl space-y-2">
                <h1 className="text-3xl font-black leading-tight tracking-tight text-slate-950 dark:text-white sm:text-4xl" title={testRun.name}>
                  {testRun.name}
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-200 sm:text-base" title={runDescription}>
                  {runDescription}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 h-9 shadow-xs ring-1 ring-slate-200/80 backdrop-blur-sm dark:bg-white/10 dark:ring-white/10">
                  <Calendar className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  {t('createdLabel')}: {formattedCreatedDate}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 h-9 shadow-xs ring-1 ring-slate-200/80 backdrop-blur-sm dark:bg-white/10 dark:ring-white/10">
                  <RefreshCw className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  {t('lastUpdated')}: {formattedUpdatedDate}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 h-9 shadow-xs ring-1 ring-slate-200/80 backdrop-blur-sm dark:bg-white/10 dark:ring-white/10">
                  <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  {t('totalTestsWithCount', { count: totalTests })}
                </span>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 h-9 shadow-xs ring-1 ring-slate-200/80 backdrop-blur-sm dark:bg-white/10 dark:ring-white/10">
                  <User className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  <span className="shrink-0">{t('assignedToLabel')}:</span>
                  <Select
                    value={testRun.assigned_to ? String(testRun.assigned_to) : 'unassigned'}
                    onValueChange={handleAssignRun}
                    disabled={isAssigningRun}
                  >
                    <SelectTrigger className="h-7 w-[170px] border-0 bg-transparent px-1 py-0 text-xs font-semibold shadow-none focus:ring-0 sm:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">{t('unassigned')}</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={String(user.id)}>
                          {user.full_name || user.username || user.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Fixed slot keeps the pill width stable so the row doesn't
                      reflow when the spinner toggles during assignment. */}
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {isAssigningRun && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-600 dark:text-cyan-200" />}
                  </span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 h-9 shadow-xs ring-1 ring-slate-200/80 backdrop-blur-sm dark:bg-white/10 dark:ring-white/10">
                  <Server className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  <span className="shrink-0">{t('environmentLabel')}:</span>
                  <Select
                    value={testRun.environment_id ? String(testRun.environment_id) : 'none'}
                    onValueChange={handleSetEnvironment}
                    disabled={isSettingEnvironment}
                  >
                    <SelectTrigger className="h-7 w-[170px] border-0 bg-transparent px-1 py-0 text-xs font-semibold shadow-none focus:ring-0 sm:text-sm">
                      <SelectValue placeholder={t('selectTestEnvironment')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('noEnvironment')}</SelectItem>
                      {environments.length === 0 ? (
                        <SelectItem value="__no_envs__" disabled>{t('noEnvironmentsAvailable')}</SelectItem>
                      ) : (
                        environments.map((environment) => (
                          <SelectItem key={environment.id} value={String(environment.id)}>
                            {environment.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {/* Fixed slot keeps the pill width stable so the row doesn't
                      reflow when the spinner toggles while saving. */}
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {isSettingEnvironment && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-600 dark:text-cyan-200" />}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid w-full gap-2 sm:grid-cols-3 xl:w-auto xl:min-w-[520px]">
            <Button
              size="sm"
              onClick={() => setIsAddTestCasesOpen(true)}
              className="h-11 justify-center rounded-xl bg-slate-950 text-white hover:bg-slate-800 dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200"
            >
              <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('addTestCases')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportResults}
              className="h-11 justify-center rounded-xl border-slate-200 bg-white/80 text-slate-700 hover:bg-white hover:text-slate-950 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white"
            >
              <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('exportResults')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetImportDialog();
                setIsImportOpen(true);
              }}
              className="h-11 justify-center rounded-xl border-slate-200 bg-white/80 text-slate-700 hover:bg-white hover:text-slate-950 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white"
            >
              <Upload className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('importCIResults')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleViewReports}
              className="h-11 justify-center rounded-xl border-slate-200 bg-white/80 text-slate-700 hover:bg-white hover:text-slate-950 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white"
            >
              <BarChart3 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('viewReport')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetTime}
              disabled={isResettingTime}
              className="h-11 justify-center rounded-xl border-orange-200 bg-white/80 text-orange-700 hover:bg-orange-50 hover:text-orange-950 dark:border-orange-800/30 dark:bg-orange-950/10 dark:text-orange-400 dark:hover:bg-orange-950/20 dark:hover:text-orange-300"
            >
              <RotateCcw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {isResettingTime ? 'Resetting...' : 'Reset Time'}
            </Button>
            {testRun.status === 'completed' && (
              <Button size="sm" className="h-11 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300 sm:col-span-3">
                <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('rerunTest')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Test Run Information */}
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap gap-6 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>
              Created: {testRun.created_at ? new Date(testRun.created_at).toLocaleDateString() : 'N/A'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>
              {testRun.completed_at 
                ? `Completed: ${new Date(testRun.completed_at).toLocaleDateString()}`
                : 'Not completed'
              }
            </span>
          </div>
          {testRun.updated_at && testRun.updated_at !== testRun.created_at && (
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              <span>
                Last updated: {new Date(testRun.updated_at).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Status and Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            {getStatusIcon(testRun.status)}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formattedRunStatus}</div>
            <p className="text-xs text-gray-500">
              {testRun.status === 'completed' 
                ? `Completed at ${testRun.completed_at ? new Date(testRun.completed_at).toLocaleString() : 'N/A'}`
                : `Started at ${testRun.created_at ? new Date(testRun.created_at).toLocaleString() : 'N/A'}`
              }
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{passRate}%</div>
            <p className="text-xs text-gray-500">
              {passedTests} of {totalTests} passed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tests</CardTitle>
            <BarChart3 className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTests}</div>
            <div className="text-xs text-gray-500 space-y-1 mt-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>{passedTests} passed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                <span>{failedTests} failed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                <span>{blockedTests} blocked</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                <span>{skippedTests} skipped</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                <span>{notStartedTests} not tested</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('duration')}</CardTitle>
            <Clock className="h-4 w-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalExecutionSeconds > 0
                ? formatDurationSeconds(totalExecutionSeconds, t)
                : testRun?.estimated_duration ? t('minutesShort', { count: testRun.estimated_duration }) : t('inProgress')
              }
            </div>
            <p className="text-xs text-gray-500">
              {t('averageCaseTime')}: {executedResultsCount > 0 ? formatDurationSeconds(averageExecutionSeconds, t) : t('notAvailableShort')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Defect Coverage / Traceability Rollup */}
      {defectCoverage && defectCoverage.failed_or_blocked > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Bug className="h-4 w-4 text-orange-600" />
              {t('defectCoverage')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-2xl font-bold">
                  {defectCoverage.linked}/{defectCoverage.failed_or_blocked}
                </div>
                <p className="text-xs text-gray-500">{t('defectCoverageLinked')}</p>
              </div>
              <div>
                <div className={`text-2xl font-bold ${defectCoverage.unlinked > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                  {defectCoverage.unlinked}
                </div>
                <p className="text-xs text-gray-500">{t('defectCoverageUnlinked')}</p>
              </div>
              <div>
                <div className="text-2xl font-bold">{defectCoverage.open_defects}</div>
                <p className="text-xs text-gray-500">{t('defectCoverageOpenDefects')}</p>
              </div>
              <div>
                <div className={`text-2xl font-bold ${defectCoverage.retest_needed > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                  {defectCoverage.retest_needed}
                </div>
                <p className="text-xs text-gray-500">{t('defectCoverageRetestNeeded')}</p>
              </div>
            </div>
            {defectCoverage.unlinked > 0 && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t('defectCoverageUnlinkedWarning', { count: defectCoverage.unlinked })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TestRunPieChart 
          data={pieData} 
          title={t('testResultsDistribution')} 
          onChartClick={handleChartClick}
        />
        <TestRunBarChart
          data={sectionData}
          title={t('resultsBySection')}
          onChartClick={handleChartClick}
          activeSection={sectionFilter}
        />
        <TestRunTrendChart data={trendData} title={t('passRateTrend')} />
      </div>

      {/* Test Results */}
      <Card className="overflow-hidden border-slate-200/80 shadow-xs dark:border-slate-800">
        <CardHeader className="border-b border-slate-100 bg-linear-to-r from-slate-50 to-white dark:border-slate-800 dark:from-slate-950 dark:to-slate-900">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-xl font-bold text-slate-950 dark:text-slate-50">{t('testResultsTitle')}</CardTitle>
                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                  {t('filteredResultsCount', { shown: filteredResults.length, total: totalTests })}
                </Badge>
                {selectedTestCasesForRemoval.length > 0 && (
                  <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
                    {t('selectedResultsCount', { count: selectedTestCasesForRemoval.length })}
                  </Badge>
                )}
              </div>
              {/* Dynamic, actionable summary — each segment is a one-click filter */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {notStartedTests === 0 && unlinkedFailureCount === 0 && retestCount === 0 ? (
                  <span className="text-slate-500 dark:text-slate-400">{t('testResultsTableDescription')}</span>
                ) : (
                  <>
                    <span className="text-slate-500 dark:text-slate-400">{t('needsAttention')}:</span>
                    {notStartedTests > 0 && (
                      <button
                        type="button"
                        onClick={() => setAttentionFilter(attentionFilter === 'untested' ? 'all' : 'untested')}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${attentionFilter === 'untested' ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}
                      >
                        {t('summaryUntested', { count: notStartedTests })}
                      </button>
                    )}
                    {unlinkedFailureCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setAttentionFilter(attentionFilter === 'failed_no_defect' ? 'all' : 'failed_no_defect')}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${attentionFilter === 'failed_no_defect' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300'}`}
                      >
                        {t('summaryFailedNoDefect', { count: unlinkedFailureCount })}
                      </button>
                    )}
                    {retestCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setAttentionFilter(attentionFilter === 'retest' ? 'all' : 'retest')}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${attentionFilter === 'retest' ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/50 dark:text-amber-300'}`}
                      >
                        {t('summaryRetest', { count: retestCount })}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-auto xl:min-w-[560px]">
              <div className="relative">
                <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
                <Input
                  value={resultSearchQuery}
                  onChange={(event) => setResultSearchQuery(event.target.value)}
                  placeholder={t('searchTestResultsPlaceholder')}
                  className={isRTL ? 'pr-9' : 'pl-9'}
                />
              </div>
              <div className="flex gap-2">
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allTestsCount', { count: totalTests })}</SelectItem>
                    <SelectItem value="pass">{t('passedCount', { count: passedTests })}</SelectItem>
                    <SelectItem value="fail">{t('failedCount', { count: failedTests })}</SelectItem>
                    <SelectItem value="block">{t('blockedCount', { count: blockedTests })}</SelectItem>
                    <SelectItem value="skip">{t('skippedCount', { count: skippedTests })}</SelectItem>
                    <SelectItem value="not_started">{t('notStartedCount', { count: notStartedTests })}</SelectItem>
                  </SelectContent>
                </Select>
                {notStartedTests > 0 && (
                  <Button variant="outline" size="sm" className="shrink-0 gap-1.5 px-3" onClick={runNextUntested}>
                    <PlayCircle className="h-4 w-4 text-emerald-600" />
                    <span className="hidden sm:inline">{t('runNextUntested')}</span>
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="shrink-0 gap-1.5 px-3">
                      <Columns3 className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('columns')}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {([
                      { key: 'section', label: t('section') },
                      { key: 'priority', label: t('priority') },
                      { key: 'defects', label: t('defects') },
                      { key: 'executedBy', label: t('executedBy') },
                      { key: 'executedAt', label: t('executedAt') },
                      { key: 'duration', label: t('duration') },
                      { key: 'comments', label: t('comments') },
                    ] as { key: OptionalCol; label: string }[]).map(({ key, label }) => (
                      <DropdownMenuCheckboxItem
                        key={key}
                        checked={isVisible(key)}
                        onCheckedChange={() => toggleCol(key)}
                      >
                        {label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {/* Faceted filters */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Filter className="h-4 w-4 text-slate-400" />
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
              <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allSections')}</SelectItem>
                {sectionOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name === NO_SECTION ? t('noSection') : name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allPriorities')}</SelectItem>
                <SelectItem value="critical">{t('critical')}</SelectItem>
                <SelectItem value="high">{t('high')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="low">{t('low')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allAssignees')}</SelectItem>
                {assigneeOptions.hasUnassigned && <SelectItem value="unassigned">{t('unassigned')}</SelectItem>}
                {assigneeOptions.ids.map((uid) => {
                  const u = users.find((x) => String(x.id) === uid);
                  return <SelectItem key={uid} value={uid}>{u ? (u.full_name || u.username) : `#${uid}`}</SelectItem>;
                })}
              </SelectContent>
            </Select>
            {(sectionFilter !== 'all' || priorityFilter !== 'all' || assigneeFilter !== 'all' || attentionFilter !== 'all' || filter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-slate-500"
                onClick={() => {
                  setFilter('all'); setSectionFilter('all'); setPriorityFilter('all');
                  setAssigneeFilter('all'); setAttentionFilter('all');
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                {t('clearFilters')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Bulk-action bar */}
          {selectedTestCasesForRemoval.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-blue-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-blue-950/20">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('selectedResultsCount', { count: selectedTestCasesForRemoval.length })}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={bulkBusy}>
                    <CheckCircle className="h-3.5 w-3.5" />
                    {t('bulkSetStatus')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {([
                    ['pass', t('passed')], ['fail', t('failed')], ['block', t('blocked')],
                    ['skip', t('skipped')], ['not_started', t('notStarted')],
                  ] as [string, string][]).map(([val, label]) => (
                    <DropdownMenuItem key={val} onClick={() => bulkUpdateStatus(val)}>{label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={bulkBusy}>
                    <User className="h-3.5 w-3.5" />
                    {t('bulkAssign')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-64 overflow-y-auto">
                  <DropdownMenuItem onClick={() => bulkAssign('')}>{t('unassigned')}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {users.map((u) => (
                    <DropdownMenuItem key={u.id} onClick={() => bulkAssign(String(u.id))}>
                      {u.full_name || u.username}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={bulkBusy} onClick={bulkMarkRetest}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t('bulkMarkRetest')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400"
                disabled={bulkBusy}
                onClick={handleRemoveTestCases}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('removeFromRun')}
              </Button>
              {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 px-2 text-xs text-slate-500 ${isRTL ? 'mr-auto' : 'ml-auto'}`}
                onClick={() => setSelectedTestCasesForRemoval([])}
              >
                {t('clearSelection')}
              </Button>
            </div>
          )}
          {filteredResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Search className="mb-3 h-10 w-10 text-slate-300" />
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('noMatchingTestResults')}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('tryDifferentResultSearch')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                  <TableRow className="border-slate-200 dark:border-slate-800">
                    <TableHead className="w-12">
                      <Checkbox
                        checked={
                          filteredResults.length > 0 && selectedTestCasesForRemoval.length === filteredResults.length
                            ? true
                            : selectedTestCasesForRemoval.length > 0
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedTestCasesForRemoval(filteredResults.map(r => r.id));
                          } else {
                            setSelectedTestCasesForRemoval([]);
                          }
                        }}
                        aria-label="Select all visible test results"
                      />
                    </TableHead>
                    {/* Sortable helper rendered inline */}
                    {(() => {
                      const SortIcon = ({ col }: { col: string }) => {
                        if (sortColumn !== col) return <ChevronsUpDown className="h-3 w-3 text-slate-300 shrink-0" />;
                        return sortDir === 'asc'
                          ? <ChevronUp className="h-3 w-3 shrink-0" />
                          : <ChevronDown className="h-3 w-3 shrink-0" />;
                      };
                      const SortHead = ({ col, className, children }: { col: string; className?: string; children: React.ReactNode }) => (
                        <TableHead className={`select-none ${className || ''}`}>
                          <button
                            type="button"
                            onClick={() => handleSort(col)}
                            aria-label={t('sortBy', { column: String(children) })}
                            className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {children}<SortIcon col={col} />
                          </button>
                        </TableHead>
                      );
                      return (
                        <>
                          <SortHead col="testCase" className="min-w-[260px]">{t('testCase')}</SortHead>
                          {isVisible('section') && <SortHead col="section" className="min-w-[130px]">{t('section')}</SortHead>}
                          {isVisible('priority') && <SortHead col="priority">{t('priority')}</SortHead>}
                          <SortHead col="status" className="min-w-[150px]">{t('status')}</SortHead>
                          {isVisible('defects') && <SortHead col="defects" className="min-w-[170px]">{t('defects')}</SortHead>}
                          {isVisible('executedBy') && <SortHead col="executedBy" className="min-w-[160px]">{t('executedBy')}</SortHead>}
                          {isVisible('executedAt') && <SortHead col="executedAt" className="min-w-[150px]">{t('executedAt')}</SortHead>}
                          {isVisible('duration') && <SortHead col="duration">{t('duration')}</SortHead>}
                          {isVisible('comments') && <TableHead className="min-w-[180px]">{t('comments')}</TableHead>}
                          <TableHead className="min-w-[160px] text-right">{t('actions')}</TableHead>
                        </>
                      );
                    })()}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedResults.map((result) => {
                    const isEditing = editingResult === result.id;
                    const testCaseTitle = result.test_case?.title || t('unknownTestCase');
                    const sectionName = result.test_case?.section?.name || t('noSection');
                    const executedBy = getResultExecutorName(result);
                    const defectLinks = getResultDefectLinks(result);
                    const flaky = getFlakiness(result);
                    const isSaving = savingResultId === result.id;

                    return (
                      <TableRow key={result.id} className="group border-slate-100 transition-colors hover:bg-blue-50/40 dark:border-slate-800 dark:hover:bg-blue-950/20">
                        <TableCell className="align-top pt-5">
                          <Checkbox
                            checked={selectedTestCasesForRemoval.includes(result.id)}
                            onCheckedChange={() => handleSelectTestCaseForRemoval(result.id)}
                            aria-label={`Select ${testCaseTitle}`}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <Button
                              variant="link"
                              className="h-auto max-w-[260px] justify-start p-0 text-left font-semibold text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                              onClick={() => {
                                if (result.test_case_id) {
                                  navigate(`/projects/${projectId}/test-runs/${id}/test-cases/${result.test_case_id}`);
                                }
                              }}
                              title={testCaseTitle}
                            >
                              <span className="truncate">{testCaseTitle}</span>
                            </Button>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                {result.test_case_id ? `TC-${result.test_case_id}` : 'N/A'}
                              </span>
                              {result.test_case?.test_type && <span>{result.test_case.test_type}</span>}
                              {result.retest_needed && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                  <RefreshCw className="h-3 w-3" />
                                  {t('retest')}
                                </span>
                              )}
                              {flaky?.flaky && (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-700 dark:bg-purple-950/50 dark:text-purple-300"
                                  title={t('flakyTooltip', { fails: flaky.fails, runs: flaky.runs })}
                                >
                                  <Zap className="h-3 w-3" />
                                  {t('flaky')}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        {isVisible('section') && (
                          <TableCell className="align-top">
                            <span className="inline-flex max-w-[150px] items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300" title={sectionName}>
                              <span className="truncate">{sectionName}</span>
                            </span>
                          </TableCell>
                        )}
                        {isVisible('priority') && (
                          <TableCell className="align-top">
                            <Badge className={getPriorityBadge(result.test_case?.priority || 'medium')}>
                              {result.test_case?.priority || 'medium'}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell className="align-top">
                          {isEditing ? (
                            <Select
                              value={editValues[result.id]?.status || result.status}
                              onValueChange={(value) => handleEdit(result.id, 'status', value)}
                            >
                              <SelectTrigger className="w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pass">{t('passed')}</SelectItem>
                                <SelectItem value="fail">{t('failed')}</SelectItem>
                                <SelectItem value="block">{t('blocked')}</SelectItem>
                                <SelectItem value="skip">{t('skipped')}</SelectItem>
                                <SelectItem value="not_started">{t('notStarted')}</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  title={t('clickToChangeStatus')}
                                  className="-mx-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-800"
                                >
                                  {isSaving
                                    ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                    : getStatusIcon(result.status)}
                                  <Badge className={getStatusBadge(result.status)}>
                                    {formatStatusLabel(result.status)}
                                  </Badge>
                                  <ChevronDown className="h-3 w-3 text-slate-400" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuLabel>{t('setStatus')}</DropdownMenuLabel>
                                {([
                                  ['pass', t('passed')], ['fail', t('failed')], ['block', t('blocked')],
                                  ['skip', t('skipped')], ['not_started', t('notStarted')],
                                ] as [string, string][]).map(([val, label]) => (
                                  <DropdownMenuItem key={val} onClick={() => quickUpdateStatus(result, val)}>
                                    {getStatusIcon(val)}
                                    <span className="ml-2">{label}</span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                        {isVisible('defects') && (
                          <TableCell className="align-top">
                            <div className="flex flex-wrap items-center gap-1">
                              {defectLinks.map((link: any) => (
                                <span
                                  key={link.id}
                                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                  title={link.defect?.title || ''}
                                >
                                  <Bug className="h-3 w-3" />
                                  <Link
                                    to={`/projects/${projectId}/defects/${link.defect?.id || link.defect_id}`}
                                    className="font-mono text-blue-600 hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-400 dark:text-blue-300"
                                  >
                                    {link.defect?.defect_id || `#${link.defect_id}`}
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => handleUnlinkDefect(result, link.id)}
                                    title={t('unlinkDefect')}
                                    aria-label={`${t('unlinkDefect')} ${link.defect?.defect_id || ''}`}
                                    className="rounded text-slate-400 hover:text-red-500 focus-visible:text-red-500 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-red-400"
                                  >
                                    <Unlink className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                              {isUnlinkedFailure(result) && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                                  <AlertTriangle className="h-3 w-3" />
                                  {t('noDefect')}
                                </span>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 px-1.5 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                                onClick={() => openLinkDialog(result.id)}
                              >
                                <Link2 className="h-3 w-3" />
                                {t('link')}
                              </Button>
                            </div>
                          </TableCell>
                        )}
                        {isVisible('executedBy') && (
                          <TableCell className="align-top">
                            {isEditing ? (
                              <Select
                                value={editValues[result.id]?.executed_by || result.executed_by?.toString() || ''}
                                onValueChange={(value) => handleEdit(result.id, 'executed_by', value)}
                              >
                                <SelectTrigger className="w-40">
                                  <SelectValue placeholder={t('selectUser')} />
                                </SelectTrigger>
                                <SelectContent>
                                  {users.map((user) => (
                                    <SelectItem key={user.id} value={user.id.toString()}>
                                      {user.full_name || user.username}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                <User className="h-4 w-4 shrink-0 text-slate-400" />
                                <span className="max-w-[130px] truncate" title={executedBy}>{executedBy}</span>
                              </div>
                            )}
                          </TableCell>
                        )}
                        {isVisible('executedAt') && (
                          <TableCell className="align-top">
                            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                              <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
                              <span className="max-w-[130px] truncate" title={result.executed_at ? new Date(result.executed_at).toLocaleString() : t('notExecuted')}>
                                {result.executed_at ? relativeTime(result.executed_at) : t('notExecuted')}
                              </span>
                            </div>
                          </TableCell>
                        )}
                        {isVisible('duration') && (
                          <TableCell className="align-top">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                              {formatDurationSeconds(result.execution_time, t)}
                            </span>
                          </TableCell>
                        )}
                        {isVisible('comments') && (
                          <TableCell className="align-top">
                            {isEditing ? (
                              <Textarea
                                value={editValues[result.id]?.comments ?? result.comments ?? ''}
                                onChange={(e) => handleEdit(result.id, 'comments', e.target.value)}
                                placeholder={t('comments')}
                                rows={2}
                                className="min-h-[40px] w-[200px] resize-y text-sm"
                              />
                            ) : (
                              <div className="flex max-w-[200px] items-start gap-2 text-sm text-slate-600 dark:text-slate-300" title={result.comments || ''}>
                                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                                <span className="line-clamp-2">{result.comments || '-'}</span>
                              </div>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="align-top text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (result.test_case_id) {
                                  navigate(`/projects/${projectId}/test-runs/${id}/test-cases/${result.test_case_id}`);
                                }
                              }}
                            >
                              <PlayCircle className="h-4 w-4 mr-1" />
                              {t('execute')}
                            </Button>
                            {isEditing ? (
                              <>
                                <Button size="sm" onClick={() => handleSave(result.id)}>
                                  <Save className="h-4 w-4 mr-1" />
                                  {t('save')}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => handleCancel(result.id)}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => setEditingResult(result.id)}>
                                <Edit className="h-4 w-4 mr-1" />
                                {t('edit')}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {filteredResults.length > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('paginationRange', {
                  start: (currentPage - 1) * PAGE_SIZE + 1,
                  end: Math.min(currentPage * PAGE_SIZE, sortedFilteredResults.length),
                  total: sortedFilteredResults.length,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
                  {t('previous')}
                </Button>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t('pageOf', { current: currentPage, total: totalPages })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('next')}
                  <ChevronRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Test Cases Dialog */}
      {isAddTestCasesOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-4xl max-h-[80vh] flex flex-col">
            <h2 className="text-xl font-semibold mb-4">Add Test Cases to Test Run</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Select test cases to add to this test run ({selectedTestCasesToAdd.length} selected):
            </p>
            
            {/* Search */}
            <div className="mb-4">
              <Input
                placeholder="Search test cases..."
                value={searchTestCases}
                onChange={(e) => setSearchTestCases(e.target.value)}
                className="w-full"
              />
            </div>
            
            {/* Test Cases List - Grouped by Section */}
            <div className="flex-1 overflow-y-auto border rounded p-3 space-y-3">
              {availableTestCases.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No available test cases to add. All test cases may already be in this test run.
                </p>
              ) : (() => {
                // Filter test cases based on search
                const filteredTestCases = availableTestCases.filter(tc => 
                  tc.title.toLowerCase().includes(searchTestCases.toLowerCase()) ||
                  (tc.description && tc.description.toLowerCase().includes(searchTestCases.toLowerCase()))
                );

                // Group test cases by section
                const groupedTestCases: { [key: string]: any[] } = {};
                const noSectionKey = '__no_section__';
                
                filteredTestCases.forEach(tc => {
                  const section = sections.find(s => s.id === tc.section_id);
                  const key = section ? `${section.id}` : noSectionKey;
                  if (!groupedTestCases[key]) {
                    groupedTestCases[key] = [];
                  }
                  groupedTestCases[key].push(tc);
                });

                // Sort sections by name
                const sortedSectionKeys = Object.keys(groupedTestCases).sort((a, b) => {
                  if (a === noSectionKey) return 1;
                  if (b === noSectionKey) return -1;
                  const sectionA = sections.find(s => s.id === parseInt(a));
                  const sectionB = sections.find(s => s.id === parseInt(b));
                  return (sectionA?.name || '').localeCompare(sectionB?.name || '');
                });

                return sortedSectionKeys.map(sectionKey => {
                  const testCasesInSection = groupedTestCases[sectionKey];
                  const section = sectionKey === noSectionKey ? null : sections.find(s => s.id === parseInt(sectionKey));
                  const sectionName = section ? section.name : 'No Section';
                  const allSelected = testCasesInSection.every(tc => selectedTestCasesToAdd.includes(tc.id));
                  const someSelected = testCasesInSection.some(tc => selectedTestCasesToAdd.includes(tc.id));

                  return (
                    <div key={sectionKey} className="border rounded-lg overflow-hidden">
                      {/* Section Header */}
                      <div 
                        className="bg-gray-50 dark:bg-gray-700 px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        onClick={() => {
                          // Toggle all test cases in this section
                          if (allSelected) {
                            setSelectedTestCasesToAdd(prev => 
                              prev.filter(id => !testCasesInSection.map(tc => tc.id).includes(id))
                            );
                          } else {
                            setSelectedTestCasesToAdd(prev => {
                              const newIds = testCasesInSection.map(tc => tc.id).filter(id => !prev.includes(id));
                              return [...prev, ...newIds];
                            });
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected && !allSelected;
                            }}
                            onChange={() => {}}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4"
                          />
                          <span className="font-medium text-sm">
                            📁 {sectionName}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({testCasesInSection.length} test case{testCasesInSection.length !== 1 ? 's' : ''})
                          </span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {someSelected ? `${testCasesInSection.filter(tc => selectedTestCasesToAdd.includes(tc.id)).length} selected` : 'Click to select all'}
                        </span>
                      </div>

                      {/* Test Cases in Section */}
                      <div className="divide-y">
                        {testCasesInSection.map((testCase) => (
                          <div
                            key={testCase.id}
                            className="flex items-center space-x-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTestCasesToAdd(prev =>
                                prev.includes(testCase.id)
                                  ? prev.filter(id => id !== testCase.id)
                                  : [...prev, testCase.id]
                              );
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTestCasesToAdd.includes(testCase.id)}
                              onChange={() => {}}
                              className="h-4 w-4 shrink-0 ml-6"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{testCase.title}</div>
                              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <span>TC{testCase.id}</span>
                              </div>
                            </div>
                            <Badge className={getPriorityBadge(testCase.priority || 'medium') + ' text-xs'}>
                              {testCase.priority || 'medium'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            
            <div className="flex justify-between items-center mt-4 pt-4 border-t">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {selectedTestCasesToAdd.length} test case(s) selected
              </div>
              <div className="flex space-x-2">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setIsAddTestCasesOpen(false);
                    setSelectedTestCasesToAdd([]);
                    setSearchTestCases('');
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleAddTestCases}
                  disabled={selectedTestCasesToAdd.length === 0}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add {selectedTestCasesToAdd.length} Test Case(s)
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Link Defect Dialog */}
      <Dialog open={linkDialogResultId !== null} onOpenChange={(open) => !open && setLinkDialogResultId(null)}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[480px]">
          <DialogHeader className="min-w-0">
            <DialogTitle className="truncate">{t('linkDefectToResult')}</DialogTitle>
            <DialogDescription>{t('linkDefectToResultDesc')}</DialogDescription>
          </DialogHeader>
          {/* min-w-0 lets this column shrink inside the grid-based DialogContent so
              a long defect/test-case title truncates instead of widening the modal. */}
          <div className="min-w-0 space-y-4 py-2">
            {linkTargetResult && (
              <div className="min-w-0 rounded-md border bg-muted/40 px-3 py-2 dark:border-gray-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('testCaseLabel')}
                </p>
                <p className="truncate text-sm font-medium" title={linkTargetResult.test_case?.title || `TC-${linkTargetResult.test_case_id}`}>
                  {linkTargetResult.test_case?.title || `TC-${linkTargetResult.test_case_id}`}
                </p>
              </div>
            )}
            <div className="min-w-0 space-y-1.5">
              <label htmlFor="runLinkDefectSelect" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('defect')}
              </label>
              <SearchableDefectSelect
                id="runLinkDefectSelect"
                value={linkDefectId}
                onChange={setLinkDefectId}
                defects={defectsCatalog}
                onSearchChange={setDefectSearch}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('linkType')}
              </label>
              <Select value={linkType} onValueChange={setLinkType}>
                <SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="found">{t('linkTypeFound')}</SelectItem>
                  <SelectItem value="blocked_by">{t('linkTypeBlockedBy')}</SelectItem>
                  <SelectItem value="related">{t('linkTypeRelated')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogResultId(null)}>{t('cancel')}</Button>
            <Button onClick={handleLinkDefectSave} disabled={!linkDefectId || isLinkingDefect}>
              <Link2 className="mr-1.5 h-4 w-4" />
              {isLinkingDefect ? t('linking') : t('link')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isImportOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsImportOpen(false);
            resetImportDialog();
          }
        }}
      >
        <DialogContent isRTL={isRTL} className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="h-5 w-5" />
              {t('importCIResults')}
            </DialogTitle>
            <DialogDescription>{t('importCIResultsDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="ci-import-file">
                {t('resultsFile')}
              </label>
              <input
                id="ci-import-file"
                type="file"
                accept=".xml,.json,.junit,application/xml,text/xml,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setImportFile(file);
                  setImportSummary(null);
                }}
                className="block w-full cursor-pointer rounded-md border border-input bg-background text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm hover:file:bg-muted/80"
              />
              <p className="text-xs text-muted-foreground">{t('importCIResultsHint')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="ci-import-format">
                  {t('format')}
                </label>
                <Select value={importFormat} onValueChange={(value) => setImportFormat(value as any)}>
                  <SelectTrigger id="ci-import-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('autoDetect')}</SelectItem>
                    <SelectItem value="junit">JUnit XML</SelectItem>
                    <SelectItem value="ctrf">CTRF JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('newCases')}</label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={importAutoCreate}
                    onCheckedChange={(value) => setImportAutoCreate(Boolean(value))}
                  />
                  <span>{t('importAutoCreateLabel')}</span>
                </label>
              </div>
            </div>

            {importSummary && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="mb-2 font-medium">
                  {t('importSummaryTitle')} — {String(importSummary.format).toUpperCase()}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
                  <div>{t('total')}: <strong>{importSummary.total}</strong></div>
                  <div>{t('matched')}: <strong className="text-emerald-600">{importSummary.matched}</strong></div>
                  <div>{t('updated')}: <strong>{importSummary.updated}</strong></div>
                  <div>{t('created')}: <strong>{importSummary.created}</strong></div>
                  <div>{t('unmatched')}: <strong className="text-amber-600">{importSummary.unmatched}</strong></div>
                </div>
                {Array.isArray(importSummary.results) && importSummary.results.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-auto rounded border bg-background p-2 font-mono text-[11px] leading-relaxed">
                    {importSummary.results.map((row: any, idx: number) => (
                      <div key={idx} className="flex justify-between gap-2 py-0.5">
                        <span className="truncate" title={row.name}>{row.name}</span>
                        <span
                          className={
                            row.action === 'updated' || row.action === 'created'
                              ? 'text-emerald-600'
                              : row.action === 'unmatched'
                                ? 'text-amber-600'
                                : 'text-muted-foreground'
                          }
                        >
                          {row.action}{row.test_case_id ? ` → TC-${row.test_case_id}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsImportOpen(false);
                resetImportDialog();
              }}
              disabled={isImporting}
            >
              {importSummary ? t('close') : t('cancel')}
            </Button>
            <Button onClick={handleImportResults} disabled={!importFile || isImporting} className="gap-2">
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isImporting ? t('importing') : t('importResults')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {testRun?.project_id && testRun?.id && (
        <div className="mt-6">
          <CustomFieldsPanel
            projectId={Number(testRun.project_id)}
            entityType="test_run"
            entityId={Number(testRun.id)}
          />
        </div>
      )}
    </div>
  );
}
