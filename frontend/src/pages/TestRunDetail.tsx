import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertCircle,
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
  Columns3,
  Loader2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TestRunPieChart, TestRunBarChart, TestRunTrendChart } from '@/components/ui/chart';
import { useTranslation } from '@/hooks/useTranslation';
import { sectionsAPI, testCasesAPI, testRunsAPI, testResultsAPI, usersAPI } from '@/lib/api';
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
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();
  const [testRun, setTestRun] = useState<any>(null);
  const [testResults, setTestResults] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [resultSearchQuery, setResultSearchQuery] = useState('');
  const [chartFilter, setChartFilter] = useState<string>('all'); // New state for chart filtering
  const [isAddTestCasesOpen, setIsAddTestCasesOpen] = useState(false);
  const [selectedTestCasesForRemoval, setSelectedTestCasesForRemoval] = useState<number[]>([]);
  const [availableTestCases, setAvailableTestCases] = useState<any[]>([]);
  const [selectedTestCasesToAdd, setSelectedTestCasesToAdd] = useState<number[]>([]);
  const [searchTestCases, setSearchTestCases] = useState('');
  const [sections, setSections] = useState<any[]>([]);
  const [isResettingTime, setIsResettingTime] = useState(false);
  const [isAssigningRun, setIsAssigningRun] = useState(false);

  // Column sorting
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Column visibility (optional columns only; checkbox/testCase/status/actions are always visible)
  type OptionalCol = 'section' | 'priority' | 'executedBy' | 'executedAt' | 'duration' | 'comments';
  const [hiddenCols, setHiddenCols] = useState<Set<OptionalCol>>(new Set());
  const isVisible = (col: OptionalCol) => !hiddenCols.has(col);
  const toggleCol = (col: OptionalCol) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  };

  // Prepare chart data
  const prepareChartData = () => {
    if (!testResults.length) {
      return { pieData: [], sectionData: [], trendData: [] };
    }

    const normalizeResultStatus = (status: string) => {
      const normalizedStatus = status.toLowerCase();
      const statusMap: Record<string, 'pass' | 'fail' | 'block' | 'skip' | 'not_tested'> = {
        pass: 'pass',
        passed: 'pass',
        fail: 'fail',
        failed: 'fail',
        block: 'block',
        blocked: 'block',
        skip: 'skip',
        skipped: 'skip',
        not_tested: 'not_tested',
        pending: 'not_tested',
      };

      return statusMap[normalizedStatus] || 'not_tested';
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
      { key: 'not_tested', name: t('notTested'), value: statusCounts.not_tested || 0, color: '#94a3b8' },
    ].filter(item => item.value > 0);

    // Bar chart data by section
    const sectionData = testResults.reduce((acc: any[], result) => {
      // Get section name from the test_case object
      let sectionName = t('noSection');
      
      // First try to get section from the nested section object (preferred)
      if (result.test_case?.section?.name) {
        sectionName = result.test_case.section.name;
      } else if (result.test_case?.section_id) {
        // Fallback: try to find section name from sections array
        const section = sections.find(s => s.id === result.test_case.section_id);
        if (section) {
          sectionName = section.name;
        } else {
          // Last resort: use section ID
          sectionName = `Section ${result.test_case.section_id}`;
        }
      }
      
      const normalizedStatus = normalizeResultStatus(result.status);
      const existingSection = acc.find(item => item.name === sectionName);
      
      if (existingSection) {
        existingSection[normalizedStatus] = (existingSection[normalizedStatus] || 0) + 1;
        existingSection.total++;
      } else {
        acc.push({
          name: sectionName,
          pass: normalizedStatus === 'pass' ? 1 : 0,
          fail: normalizedStatus === 'fail' ? 1 : 0,
          block: normalizedStatus === 'block' ? 1 : 0,
          skip: normalizedStatus === 'skip' ? 1 : 0,
          not_tested: normalizedStatus === 'not_tested' ? 1 : 0,
          total: 1,
        });
      }
      return acc;
    }, []);

    // Calculate pass rate by section
    sectionData.forEach(section => {
      section.passRate = section.total > 0 ? Math.round((section.pass / section.total) * 100) : 0;
    });

    const sortedResults = [...testResults].sort((a, b) => {
      const firstDate = new Date(a.executed_at || a.updated_at || a.created_at || testRun?.created_at || 0).getTime();
      const secondDate = new Date(b.executed_at || b.updated_at || b.created_at || testRun?.created_at || 0).getTime();
      return firstDate - secondDate;
    });

    let cumulativeTotal = 0;
    let cumulativePassed = 0;
    const trendData = sortedResults.map((result, index) => {
      cumulativeTotal += 1;
      if (normalizeResultStatus(result.status) === 'pass') {
        cumulativePassed += 1;
      }

      const resultDate = result.executed_at || result.updated_at || result.created_at || testRun?.created_at;

      return {
        date: resultDate ? new Date(resultDate).toLocaleDateString() : `${t('result')} ${index + 1}`,
        passRate: cumulativeTotal > 0 ? Math.round((cumulativePassed / cumulativeTotal) * 100) : 0,
        totalTests: cumulativeTotal,
      };
    });

    return { pieData, sectionData, trendData };
  };  
  const normalizeRunStatus = (status?: string | null) => (status || '').toLowerCase().replace(/[-\s]/g, '_');

  const isResultComplete = (status?: string | null) => {
    const normalizedStatus = normalizeRunStatus(status);
    return Boolean(normalizedStatus) && normalizedStatus !== 'not_tested' && normalizedStatus !== 'pending';
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

    if (isResultComplete(targetStatus) && payload.execution_time === undefined) {
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

    await testRunsAPI.update(parseInt(id), statusPayload);
    return testRunsAPI.getById(parseInt(id));
  };

  // Function to check and update test run status
  const checkAndUpdateStatus = async () => {
    if (!id || !projectId) return;
    
    try {
      const testRunData = await testRunsAPI.getById(parseInt(id));
      const currentProjectId = parseInt(projectId);
      if (Number.isNaN(currentProjectId) || Number(testRunData.project_id) !== currentProjectId) {
        setTestRun(null);
        setTestResults([]);
        setError(t('testRunNotFoundInProject'));
        return;
      }

      const testResultsData = await testResultsAPI.getAll(parseInt(id));
      const updatedTestRun = await syncTestRunStatus(testRunData, testResultsData);
      setTestRun(updatedTestRun);
      setTestResults(testResultsData);
    } catch (error) {
      console.error('Failed to check/update status:', error);
    }
  };
  
  useEffect(() => {
    const loadData = async () => {
      if (!id || !projectId) {
        setError('Missing test run ID or project ID');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        // Load test run data
        const testRunData = await testRunsAPI.getById(parseInt(id));
        const currentProjectId = parseInt(projectId);
        if (Number.isNaN(currentProjectId) || Number(testRunData.project_id) !== currentProjectId) {
          setTestRun(null);
          setTestResults([]);
          setUsers([]);
          setError(t('testRunNotFoundInProject'));
          return;
        }
        
        // Load test results for this test run
        const testResultsData = await testResultsAPI.getAll(parseInt(id));
        
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
  }, [id, projectId]);

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
      case 'not_tested':
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
      not_tested: 'border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400',
    };
    return variants[normalizedStatus] || 'border border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300';
  };

  const formatStatusLabel = (status: string) => {
    const normalizedStatus = status.toLowerCase();
    const labels: Record<string, string> = {
      not_tested: 'Not Tested',
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

  const filteredResults = testResults.filter(result => {
    const resultStatus = normalizeRunStatus(result.status) || 'not_tested';
    const selectedStatus = normalizeRunStatus(filter);
    const matchesStatus = filter === 'all' || resultStatus === selectedStatus;
    const normalizedQuery = resultSearchQuery.trim().toLowerCase();

    if (!normalizedQuery) return matchesStatus;

    const searchableFields = [
      result.test_case?.title,
      result.test_case_id ? `tc-${result.test_case_id}` : '',
      result.test_case?.section?.name,
      result.test_case?.priority,
      result.comments,
      getResultExecutorName(result),
      formatStatusLabel(result.status),
    ];

    return matchesStatus && searchableFields.some((field) =>
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
          default:
            return 0;
        }
      })
    : filteredResults;

  const statusCounts = testResults.reduce((acc: any, result) => {
    const normalizedStatus = normalizeRunStatus(result.status) || 'not_tested';
    acc[normalizedStatus] = (acc[normalizedStatus] || 0) + 1;
    return acc;
  }, {});
  
  const totalTests = testResults.length;
  const passedTests = (statusCounts.pass || 0) + (statusCounts.passed || 0);
  const failedTests = (statusCounts.fail || 0) + (statusCounts.failed || 0);
  const blockedTests = (statusCounts.block || 0) + (statusCounts.blocked || 0);
  const skippedTests = (statusCounts.skip || 0) + (statusCounts.skipped || 0);
  const notTestedTests = (statusCounts.not_tested || 0) + (statusCounts.pending || 0);
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
          status: 'not_tested',
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
        'not tested': 'not_tested',
      };
      
      const normalizedStatus = filterData.value.toLowerCase();
      const mappedStatus = statusMap[normalizedStatus] || normalizedStatus;
      setFilter(mappedStatus);
    } else if (filterData.type === 'section') {
      // Filter by section - this would require a different filter approach
      console.log('Filter by section:', filterData.value);
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

  // Handle View Reports and Export Results
  const handleViewReports = () => {
    // Navigate to dedicated report page
    navigate(`/projects/${projectId}/test-runs/${id}/report`);
  };

  const handleExportResults = () => {
    if (!testRun) return;

    // Create CSV content
    const headers = ['Test Case ID', 'Test Case Title', 'Section', 'Priority', 'Status', 'Executed By', 'Executed At', 'Duration (s)', 'Comments'];
    const csvContent = [
      headers.join(','),
      ...testResults.map(result => [
        result.testCaseId,
        `"${result.testCaseTitle}"`,
        result.section || '',
        result.priority || 'medium',
        result.status,
        result.executedBy || '',
        result.executed_at || '',
        result.execution_time ?? '',
        `"${result.comments || ''}"`
      ].join(','))
    ].join('\n');

    // Create and download CSV
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-run-${testRun.id}-results.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('Results exported successfully!');
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
    if (!id) return;
    
    if (!confirm('Are you sure you want to reset all timing data for this test run? This will clear execution times for all test results.')) {
      return;
    }

    try {
      setIsResettingTime(true);
      await testRunsAPI.resetTime(parseInt(id));
      
      // Reload test run and results to get updated data
      const [updatedTestRun, updatedTestResults] = await Promise.all([
        testRunsAPI.getById(parseInt(id)),
        testResultsAPI.getAll(parseInt(id))
      ]);
      
      const syncedTestRun = await syncTestRunStatus(updatedTestRun, updatedTestResults);
      setTestRun(syncedTestRun);
      setTestResults(updatedTestResults);
      
      alert('Test run time has been reset successfully');
    } catch (error) {
      console.error('Failed to reset test run time:', error);
      alert('Failed to reset test run time');
    } finally {
      setIsResettingTime(false);
    }
  };

  const getUserDisplayName = (userId?: number | null) => {
    if (!userId) return t('unassigned');
    const assignee = users.find((user) => Number(user.id) === Number(userId));
    return assignee?.full_name || assignee?.username || assignee?.email || t('unknown');
  };

  const handleAssignRun = async (value: string) => {
    if (!id) return;

    try {
      setIsAssigningRun(true);
      const nextAssigneeId = value === 'unassigned' ? null : parseInt(value, 10);
      const updatedRun = await testRunsAPI.assign(parseInt(id, 10), Number.isInteger(nextAssigneeId) ? nextAssigneeId : null);
      setTestRun((prev: any) => ({ ...prev, ...updatedRun }));
    } catch (error) {
      console.error('Failed to assign test run:', error);
      setError(t('failedToAssignTestRun'));
    } finally {
      setIsAssigningRun(false);
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
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-cyan-50 to-slate-100 p-5 text-slate-950 shadow-xl shadow-slate-200/70 dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 dark:text-white dark:shadow-black/30 sm:p-6">
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
                <Badge className="border border-cyan-200 bg-cyan-100/80 px-3 py-1 text-cyan-800 shadow-sm backdrop-blur dark:border-cyan-200/30 dark:bg-cyan-300/15 dark:text-cyan-50">
                  {t('runId')}: {testRun.id}
                </Badge>
                <Badge className={`${getStatusBadge(testRun.status)} px-3 py-1 shadow-sm backdrop-blur`}>
                  {formattedRunStatus}
                </Badge>
                <Badge className="border border-emerald-200 bg-emerald-100/80 px-3 py-1 text-emerald-800 shadow-sm backdrop-blur dark:border-emerald-200/30 dark:bg-emerald-300/15 dark:text-emerald-50">
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

              <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 shadow-sm ring-1 ring-slate-200/80 backdrop-blur dark:bg-white/10 dark:ring-white/10">
                  <Calendar className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  {t('createdLabel')}: {formattedCreatedDate}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 shadow-sm ring-1 ring-slate-200/80 backdrop-blur dark:bg-white/10 dark:ring-white/10">
                  <RefreshCw className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  {t('lastUpdated')}: {formattedUpdatedDate}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 shadow-sm ring-1 ring-slate-200/80 backdrop-blur dark:bg-white/10 dark:ring-white/10">
                  <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  {t('totalTestsWithCount', { count: totalTests })}
                </span>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 shadow-sm ring-1 ring-slate-200/80 backdrop-blur dark:bg-white/10 dark:ring-white/10">
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
                  {isAssigningRun && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-600 dark:text-cyan-200" />}
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
            {selectedTestCasesForRemoval.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemoveTestCases}
                className="h-11 rounded-xl sm:col-span-3"
              >
                <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('removeSelectedCount', { count: selectedTestCasesForRemoval.length })}
              </Button>
            )}
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
                <span>{notTestedTests} not tested</span>
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
        />
        <TestRunTrendChart data={trendData} title={t('passRateTrend')} />
      </div>

      {/* Test Results */}
      <Card className="overflow-hidden border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white dark:border-slate-800 dark:from-slate-950 dark:to-slate-900">
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
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('testResultsTableDescription')}
              </p>
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
                    <SelectItem value="not_tested">{t('notTestedCount', { count: notTestedTests })}</SelectItem>
                  </SelectContent>
                </Select>
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
        </CardHeader>
        <CardContent className="p-0">
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
                        checked={filteredResults.length > 0 && selectedTestCasesForRemoval.length === filteredResults.length}
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
                        <TableHead
                          className={`cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-800 ${className || ''}`}
                          onClick={() => handleSort(col)}
                        >
                          <div className="flex items-center gap-1">{children}<SortIcon col={col} /></div>
                        </TableHead>
                      );
                      return (
                        <>
                          <SortHead col="testCase" className="min-w-[260px]">{t('testCase')}</SortHead>
                          {isVisible('section') && <SortHead col="section" className="min-w-[130px]">{t('section')}</SortHead>}
                          {isVisible('priority') && <SortHead col="priority">{t('priority')}</SortHead>}
                          <SortHead col="status" className="min-w-[150px]">{t('status')}</SortHead>
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
                  {sortedFilteredResults.map((result) => {
                    const isEditing = editingResult === result.id;
                    const testCaseTitle = result.test_case?.title || t('unknownTestCase');
                    const sectionName = result.test_case?.section?.name || t('noSection');
                    const executedBy = getResultExecutorName(result);

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
                                <SelectItem value="not_tested">{t('notTested')}</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="flex items-center gap-2">
                              {getStatusIcon(result.status)}
                              <Badge className={getStatusBadge(result.status)}>
                                {formatStatusLabel(result.status)}
                              </Badge>
                            </div>
                          )}
                        </TableCell>
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
                                {result.executed_at ? new Date(result.executed_at).toLocaleDateString() : t('notExecuted')}
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
                            <div className="flex max-w-[200px] items-start gap-2 text-sm text-slate-600 dark:text-slate-300" title={result.comments || ''}>
                              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                              <span className="line-clamp-2">{result.comments || '-'}</span>
                            </div>
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
                              className="h-4 w-4 flex-shrink-0 ml-6"
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
    </div>
  );
}
