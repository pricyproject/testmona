import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { defectsAPI, executionSettingsAPI, getApiErrorMessage, testCasesAPI, testResultsAPI, testRunsAPI, usersAPI } from '@/lib/api';
import { SearchableDefectSelect } from '@/components/Defects/SearchableDefectSelect';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/authStore';
import { formatDurationSeconds } from '@/utils/timeFormat';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Edit,
  Save,
  Plus,
  FileText,
  Bug,
  User,
  ChevronLeft,
  ChevronRight,
  Link,
  Link2,
  Unlink,
  RefreshCw,
  ShieldAlert,
  PlayCircle,
  Pause,
} from 'lucide-react';

const DEFECT_LINK_TYPES = ['found', 'blocked_by', 'related'] as const;
type DefectLinkType = typeof DEFECT_LINK_TYPES[number];

const isValidHttpUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return true; // empty is allowed
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

export function TestCaseExecution() {
  const navigate = useNavigate();
  const { projectId, testRunId, testCaseId } = useParams();
  const { isRTL, t } = useTranslation();
  const { toast } = useToast();
  const { user: currentUser } = useAuthStore();
  const [executionStatus, setExecutionStatus] = useState('pending');
  const [executionNotes, setExecutionNotes] = useState('');
  const [executionLogs, setExecutionLogs] = useState('');
  const [assignee, setAssignee] = useState('');
  const [defectLink, setDefectLink] = useState('');
  const [customLink, setCustomLink] = useState('');
  const [defects, setDefects] = useState<any[]>([]);
  const [isDefectDialogOpen, setIsDefectDialogOpen] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  // Structured defect links for this execution result
  const [testResultId, setTestResultId] = useState<number | null>(null);
  const [resultDefectLinks, setResultDefectLinks] = useState<any[]>([]);
  const [availableDefects, setAvailableDefects] = useState<any[]>([]);
  const [selectedDefectId, setSelectedDefectId] = useState('');
  const [linkType, setLinkType] = useState<DefectLinkType>('found');
  const [isLinkingDefect, setIsLinkingDefect] = useState(false);
  const [requireDefectOnFailure, setRequireDefectOnFailure] = useState(false);
  const [retestNeeded, setRetestNeeded] = useState(false);
  const defectTitleInputRef = useRef<HTMLInputElement>(null);
  const [manualTimeAdjustment, setManualTimeAdjustment] = useState(0);
  const [executionStartedAtRef, setExecutionStartedAtRef] = useState<string | null>(null);
  const [executionStartedAt, setExecutionStartedAt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<string | null>(null);
  const [totalPausedTime, setTotalPausedTime] = useState(0);
  const [manualTimeEntry, setManualTimeEntry] = useState('');
  const [showManualTimeDialog, setShowManualTimeDialog] = useState(false);
  const [executionState, setExecutionState] = useState<'idle' | 'running' | 'paused' | 'completed'>('idle');
  const [isRecentlyPaused, setIsRecentlyPaused] = useState(false);
  const [defectTouchedFields, setDefectTouchedFields] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [allTestCases, setAllTestCases] = useState<any[]>([]);
  const [testCase, setTestCase] = useState<any>(null);
  const [testSteps, setTestSteps] = useState<Array<{
    step_number: number;
    action: string;
    expected_result: string;
    step_type: string;
  }>>([]);
  const [testRun, setTestRun] = useState<any>(null);
  const [executionHistory, setExecutionHistory] = useState<any[]>([]);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const [newDefect, setNewDefect] = useState({
    title: '',
    description: '',
    severity: 'medium',
    priority: 'high'
  });
  const hasUnsavedChanges = newDefect.title.trim() !== '' || newDefect.description.trim() !== '';

  const createExecutionDefectId = () => {
    const numericProjectId = Number(projectId);
    const prefix = `P${Number.isFinite(numericProjectId) ? numericProjectId : 'X'}-DEF-`;
    const highest = defects.reduce((max, defect) => {
      const rawId = String(defect?.defect_id || '');
      if (!rawId.startsWith(prefix)) return max;
      const suffix = Number(rawId.slice(prefix.length));
      return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
    }, 0);
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  };

  const completedResultStatuses = new Set(['pass', 'passed', 'fail', 'failed', 'block', 'blocked', 'skip', 'skipped']);

  const isCompletedResultStatus = (status?: string | null) => (
    completedResultStatuses.has(String(status || '').toLowerCase().replace('-', '_'))
  );

  const setExecutionStart = (startedAt: string) => {
    setExecutionStartedAtRef(startedAt);
    setExecutionStartedAt(startedAt);
    // Don't calculate elapsed time here - let the timer handle it
    // The elapsed time will be set from backend data when the component loads
  };

  const ensureExecutionTimerStarted = async (result?: any) => {
    const existingStart = result?.execution_started_at;
    const shouldPersistStart = result?.id && !existingStart && !isCompletedResultStatus(result?.status);
    const startedAt = existingStart || new Date().toISOString();

    setExecutionStart(startedAt);
    
    // Restore time values from database
    if (result) {
      // execution_time already includes manual_time_adjustment from backend calculation
      const totalTime = result.execution_time || 0;
      const manualAdjustment = result.manual_time_adjustment || 0;
      setElapsedSeconds(totalTime);
      setManualTimeAdjustment(manualAdjustment);
      
      // Restore pause state based on backend execution_state
      const backendExecutionState = result.execution_state;
      if (backendExecutionState === 'paused') {
        setPausedAt(result.paused_at);
        setIsPaused(true);
        setExecutionState('paused');
      } else if (backendExecutionState === 'idle' || backendExecutionState === 'running') {
        setIsPaused(false);
        setPausedAt(null);
      }
    }

    if (shouldPersistStart) {
      try {
        await testResultsAPI.update(Number(result.id), { execution_started_at: startedAt });
      } catch (startError) {
        console.error('Failed to persist execution start time:', startError);
      }
    }
  };

  useEffect(() => {
    if (!executionStartedAt || isPaused || executionState === 'idle' || executionState === 'completed' || executionState === 'paused') return;

    let secondsSinceLastSync = 0;
    const intervalId = window.setInterval(() => {
      // Debug: Log timer state to identify issues
      if (isPaused) {
        return;
      }
      
      // Simply increment the existing elapsed time by 1 second
      // This avoids timestamp calculation issues and trusts the backend's execution_time
      setElapsedSeconds(prev => Math.max(0, prev + 1));
      
      // Sync with backend every 30 seconds to ensure consistency
      // Only sync if not recently paused/resumed (to avoid overriding immediate state changes)
      secondsSinceLastSync++;
      if (secondsSinceLastSync >= 30 && testRunId && testCaseId && !isRecentlyPaused) {
        secondsSinceLastSync = 0;
        testResultsAPI.getAll(parseInt(testRunId), parseInt(testCaseId))
          .then(results => {
            if (results.length > 0) {
              const result = results[0];
              // Only sync if backend state matches current execution state
              if (result.execution_state === executionState) {
                setElapsedSeconds(result.execution_time || 0);
                setManualTimeAdjustment(result.manual_time_adjustment || 0);
                setTotalPausedTime(result.total_paused_time || 0);
              }
            }
          })
          .catch(error => console.error('Failed to sync timer:', error));
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [executionStartedAt, isPaused, executionState, testRunId, testCaseId]);

  
  // When execution state changes to completed, load the final execution time from backend
  useEffect(() => {
    if (executionState === 'completed' && testRunId && testCaseId) {
      const loadFinalExecutionTime = async () => {
        try {
          const existingResults = await testResultsAPI.getAll(
            parseInt(testRunId), 
            parseInt(testCaseId)
          );
          if (existingResults.length > 0) {
            const result = existingResults[0];
            // Use the backend's calculated execution_time which includes manual adjustments
            const totalTime = result.execution_time || 0;
            const manualAdjustment = result.manual_time_adjustment || 0;
            setElapsedSeconds(totalTime);
            setManualTimeAdjustment(manualAdjustment);
          }
        } catch (error) {
          console.error('Failed to load final execution time:', error);
        }
      };
      loadFinalExecutionTime();
    }
  }, [executionState, testRunId, testCaseId]);

  // Load test case and test run data
  useEffect(() => {
    const loadTestData = async () => {
      if (!projectId || !testRunId || !testCaseId) {
        setLoadError(t('failedToLoadTestCaseOrTestRun'));
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setLoadError(null);

        const currentProjectId = parseInt(projectId);
        const currentTestRunId = parseInt(testRunId);
        const currentTestCaseId = parseInt(testCaseId);

        if ([currentProjectId, currentTestRunId, currentTestCaseId].some(Number.isNaN)) {
          setLoadError(t('failedToLoadTestCaseOrTestRun'));
          return;
        }

        const [caseData, runData, runCaseResults] = await Promise.all([
          testCasesAPI.getById(currentTestCaseId),
          testRunsAPI.getById(currentTestRunId),
          testResultsAPI.getAll(currentTestRunId, currentTestCaseId),
        ]);

        const runProjectId = Number(runData.project_id);
        const testCaseProjectId = caseData.project_id == null ? null : Number(caseData.project_id);
        const isTestCaseInRun = runCaseResults.some((result: any) =>
          Number(result.test_run_id) === currentTestRunId && Number(result.test_case_id) === currentTestCaseId
        );

        if (
          runProjectId !== currentProjectId ||
          !isTestCaseInRun ||
          (testCaseProjectId !== null && testCaseProjectId !== currentProjectId)
        ) {
          setTestCase(null);
          setTestRun(null);
          setTestSteps([]);
          setExecutionHistory([]);
          setLoadError(t('testCaseOrRunNotFoundInProject'));
          return;
        }

        setTestCase(caseData);
        setTestRun(runData);
        
        // If multistep, fetch the steps
        if (caseData.is_multistep) {
          try {
            const steps = await testCasesAPI.getSteps(currentTestCaseId);
            setTestSteps(steps);
          } catch (stepsError) {
            console.error('Failed to fetch test steps:', stepsError);
            setTestSteps([]);
          }
        } else {
          setTestSteps([]);
        }
        
        // Load execution history - handle auth errors gracefully
        try {
          const history = await testCasesAPI.getExecutionHistory(currentTestCaseId, 50);
          setExecutionHistory(history);
          setHistoryLoadError(false);
        } catch (historyError: any) {
          console.error('Failed to load execution history:', historyError);
          setHistoryLoadError(true);
          setExecutionHistory([]);
        }
      } catch (error) {
        console.error('Failed to load test data:', error);
        setLoadError(t('failedToLoadTestCaseOrTestRun'));
        toast({
          title: t('error'),
          description: t('failedToLoadTestCaseOrTestRun'),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    
    loadTestData();
  }, [projectId, testCaseId, testRunId]);

  // Auto-focus on defect title input when dialog opens
  useEffect(() => {
    if (isDefectDialogOpen && defectTitleInputRef.current) {
      setTimeout(() => defectTitleInputRef.current?.focus(), 100);
    }
  }, [isDefectDialogOpen]);

  // Load users and test cases from test run
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // Load all users for assignee options
        const allUsers = await usersAPI.getAll();
        setUsers(allUsers);
        
        // Set current user as default assignee if not already set
        if (currentUser && !assignee) {
          setAssignee(currentUser.id.toString());
        }
        
        // Load test cases from test run
        if (testRunId) {
          const results = await testResultsAPI.getAll(parseInt(testRunId));
          const testCasesInRun = results.map((r: any) => ({
            id: r.test_case_id,
            title: r.test_case?.title || `Test Case ${r.test_case_id}`
          }));
          setAllTestCases(testCasesInRun);
        }
      } catch (error) {
        console.error('Failed to load initial data:', error);
        // Fallback to current user only if API fails
        if (currentUser) {
          setUsers([currentUser]);
          if (!assignee) {
            setAssignee(currentUser.id.toString());
          }
        }
      }
    };
    
    loadInitialData();
  }, [testRunId, currentUser, assignee]);

  // Load existing execution status when component mounts or test case changes
  useEffect(() => {
    const loadExistingExecution = async () => {
      if (!testRunId || !testCaseId) return;
      
      setIsLoading(true);
      try {
        const existingResults = await testResultsAPI.getAll(
          parseInt(testRunId), 
          parseInt(testCaseId)
        );
        
        if (existingResults.length > 0) {
          const result = existingResults[0];
          
          // Map status values
          const statusMap: { [key: string]: string } = {
            'passed': 'passed',
            'pass': 'passed', 
            'failed': 'failed',
            'fail': 'failed',
            'blocked': 'blocked',
            'block': 'blocked',
            'skipped': 'skipped',
            'skip': 'skipped',
            'pending': 'pending'
          };
          
          const mappedStatus = statusMap[result.status] || 'pending';
          setExecutionStatus(mappedStatus);
          setExecutionNotes(result.actual_result || result.comments || '');
          setTestResultId(result.id ?? null);
          setDefectLink(result.defect_link || '');
          setCustomLink(result.custom_link || '');
          setRetestNeeded(Boolean(result.retest_needed));
          setAssignee(
            result.executed_by?.toString()
            || testRun?.assigned_to?.toString()
            || currentUser?.id?.toString()
            || ''
          );
          await ensureExecutionTimerStarted(result);
          
          // Set execution state based on backend execution_state first, then fallback to status logic
          const backendExecutionState = result.execution_state;
          if (backendExecutionState) {
            setExecutionState(backendExecutionState);
            setIsPaused(backendExecutionState === 'paused');
          } else if (isCompletedResultStatus(result.status)) {
            setExecutionState('completed');
            setIsPaused(true);
          } else {
            // No stored execution state — don't auto-start; user must click Start
            setExecutionState('idle');
            setIsPaused(false);
          }
          
          // Restore elapsed time from database
          // execution_time already includes manual_time_adjustment from backend calculation
          const totalTime = result.execution_time || 0;
          const manualAdjustment = result.manual_time_adjustment || 0;
          setElapsedSeconds(totalTime);
          setManualTimeAdjustment(manualAdjustment);
          
          // Restore pause state if applicable
          if (result.paused_at) {
            setPausedAt(result.paused_at);
            setIsPaused(true);
            setExecutionState('paused');
          }
        } else {
          setExecutionStatus('pending');
          setExecutionNotes('');
          setAssignee(testRun?.assigned_to?.toString() || currentUser?.id?.toString() || '');
          setExecutionState('idle');
          setIsPaused(false);
          setTestResultId(null);
          setRetestNeeded(false);
        }
      } finally {
        setIsLoading(false);
      }
    };
    
    loadExistingExecution();
  }, [testRunId, testCaseId, testRun?.assigned_to, currentUser?.id]);

  // Load existing defects for this test case
  useEffect(() => {
    const loadExistingDefects = async () => {
      if (!projectId || !testCaseId) return;
      
      try {
        const allDefects = await defectsAPI.getAll(parseInt(projectId));
        setAvailableDefects(Array.isArray(allDefects) ? allDefects : []);

        // Filter defects for this test case
        const currentTestCaseId = Number(testCaseId);
        const currentTestRunId = Number(testRunId);
        const testCaseDefects = allDefects.filter(defect => {
          const linkedTestCaseId = Number(defect.test_case_id);
          const linkedTestRunId = defect.test_run_id == null ? null : Number(defect.test_run_id);
          return linkedTestCaseId === currentTestCaseId && (linkedTestRunId === null || linkedTestRunId === currentTestRunId);
        });

        setDefects(testCaseDefects);
      } catch (error) {
        console.error('❌ Failed to load existing defects:', error);
        setDefects([]);
        setAvailableDefects([]);
      }
    };

    loadExistingDefects();
  }, [projectId, testCaseId, testRunId]);

  // Load structured defect links for this execution result
  const loadResultDefectLinks = async (resultId: number | null) => {
    if (!resultId) {
      setResultDefectLinks([]);
      return;
    }
    try {
      const links = await testResultsAPI.getDefectLinks(resultId);
      setResultDefectLinks(Array.isArray(links) ? links : []);
    } catch (error) {
      console.error('Failed to load defect links:', error);
      setResultDefectLinks([]);
    }
  };

  useEffect(() => {
    loadResultDefectLinks(testResultId);
  }, [testResultId]);

  // Load project execution settings (defect-on-failure policy)
  useEffect(() => {
    const loadExecutionSettings = async () => {
      if (!projectId) return;
      try {
        const settings = await executionSettingsAPI.get(parseInt(projectId));
        setRequireDefectOnFailure(Boolean(settings?.require_defect_on_failure));
      } catch (error) {
        console.error('Failed to load execution settings:', error);
        setRequireDefectOnFailure(false);
      }
    };
    loadExecutionSettings();
  }, [projectId]);

  // Default the link type to match the execution status
  useEffect(() => {
    if (executionStatus === 'blocked') {
      setLinkType('blocked_by');
    } else if (executionStatus === 'failed') {
      setLinkType('found');
    }
  }, [executionStatus]);

  // Mock saved executions (persisted data)
  const [savedExecutions, setSavedExecutions] = useState<any[]>(() => {
    const saved = localStorage.getItem('testExecutions');
    return saved ? JSON.parse(saved) : [];
  });

  // Get current test case index for navigation
  const currentIndex = allTestCases.findIndex(tc => tc.id.toString() === testCaseId?.toString());
  const hasNext = currentIndex >= 0 && currentIndex < allTestCases.length - 1;
  const hasPrevious = currentIndex > 0;

  const statusOptions = [
    { value: 'pending', label: 'Pending', icon: Clock, color: 'text-gray-600' },
    { value: 'passed', label: 'Passed', icon: CheckCircle, color: 'text-green-600' },
    { value: 'failed', label: 'Failed', icon: XCircle, color: 'text-red-600' },
    { value: 'blocked', label: 'Blocked', icon: AlertTriangle, color: 'text-orange-600' }
  ];

  const getStatusIcon = (status: string) => {
    const statusOption = statusOptions.find(opt => opt.value === status);
    return statusOption ? <statusOption.icon className="h-5 w-5" /> : <Clock className="h-5 w-5" />;
  };

  const getStatusColor = (status: string) => {
    const statusOption = statusOptions.find(opt => opt.value === status);
    return statusOption ? statusOption.color : 'text-gray-600';
  };

  const getExecutionStatusBadgeClass = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: 'border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300',
      passed: 'border border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      failed: 'border border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
      blocked: 'border border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    };
    return statusMap[status] || statusMap.pending;
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

  const getPriorityBadgeVariant = (priority: string) => {
    const priorityMap: Record<string, { variant: string; className: string }> = {
      'critical': { variant: 'destructive', className: 'bg-red-600 text-white' },
      'high': { variant: 'destructive', className: 'bg-orange-500 text-white' },
      'medium': { variant: 'default', className: 'bg-yellow-500 text-white' },
      'low': { variant: 'secondary', className: 'bg-blue-500 text-white' }
    };
    return priorityMap[priority?.toLowerCase()] || priorityMap['medium'];
  };

  const historyByRun = useMemo(() => {
    const grouped = new Map<number, any[]>();
    for (const entry of executionHistory) {
      if (!entry?.test_run_id) continue;
      const runId = Number(entry.test_run_id);
      if (!grouped.has(runId)) grouped.set(runId, []);
      grouped.get(runId)?.push(entry);
    }

    return Array.from(grouped.entries())
      .map(([runId, entries]) => {
        const latest = entries[0];
        return {
          runId,
          runName: latest?.test_run_name || `Run #${runId}`,
          runStatus: latest?.test_run_status || 'unknown',
          runPriority: latest?.test_run_priority || 'medium',
          projectName: latest?.project_name || t('unknown'),
          totalExecutions: entries.length,
          lastExecutedAt: latest?.executed_at || latest?.created_at || null,
          latestStatus: latest?.status || 'pending',
          latestExecutor: latest?.executed_by_full_name || latest?.executed_by || latest?.executed_by_email || t('unknown'),
          executionTime: latest?.execution_time,
        };
      })
      .sort((a, b) => {
        const aTime = a.lastExecutedAt ? new Date(a.lastExecutedAt).getTime() : 0;
        const bTime = b.lastExecutedAt ? new Date(b.lastExecutedAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [executionHistory, t]);

  const historySummary = useMemo(() => {
    const executorNames = new Set(
      executionHistory
        .map((entry) => entry.executed_by_full_name || entry.executed_by || entry.executed_by_email)
        .filter(Boolean)
    );

    return {
      totalRuns: historyByRun.length,
      totalExecutions: executionHistory.length,
      uniqueExecutors: executorNames.size,
      latestResult: executionHistory[0]?.status || null,
    };
  }, [executionHistory, historyByRun.length]);

  const openRunExecution = (runId: number) => {
    if (!projectId || !testCaseId) return;
    navigate(`/projects/${projectId}/test-runs/${runId}/test-cases/${testCaseId}`);
  };

  const handleSaveExecution = async () => {
    try {

      // Validate required fields
      if (!testRunId || !testCaseId) {
        console.error('❌ Missing testRunId or testCaseId');
        alert('Error: Missing test run ID or test case ID');
        return;
      }

      if (executionStatus === 'pending') {
        console.error('❌ Cannot save with pending status');
        alert('Please set a status before saving (Passed, Failed, Blocked, etc.)');
        return;
      }

      const isFailedOrBlocked = executionStatus === 'failed' || executionStatus === 'blocked';

      // Validate failure-context URLs before saving
      if (!isValidHttpUrl(defectLink) || !isValidHttpUrl(customLink)) {
        toast({
          title: t('invalidUrl'),
          description: t('invalidUrlDescription'),
          variant: 'destructive',
        });
        return;
      }

      // Enforce the project's defect-on-failure policy
      if (isFailedOrBlocked && requireDefectOnFailure) {
        const hasDefectEvidence = resultDefectLinks.length > 0 || defectLink.trim() !== '';
        if (!hasDefectEvidence) {
          toast({
            title: t('defectRequired'),
            description: t('defectRequiredDescription'),
            variant: 'destructive',
          });
          return;
        }
      }

      // Map frontend status to backend status
      const statusMap: Record<string, string> = {
        'passed': 'pass',
        'failed': 'fail',
        'blocked': 'block',
        'pending': 'skip'
      };

      const startedAt = executionStartedAtRef || new Date().toISOString();
      const startedAtTime = new Date(startedAt).getTime();
      // Use current elapsed seconds from state, not recalculate
      const executionTimeSeconds = Math.max(0, elapsedSeconds);

      const executionData = {
        test_case_id: parseInt(testCaseId || '0'),
        test_run_id: parseInt(testRunId || '0'),
        status: statusMap[executionStatus] || 'skip',
        actual_result: executionNotes,
        comments: executionNotes,
        execution_started_at: startedAt,
        execution_time: executionTimeSeconds,
        executed_by: parseInt(assignee) || null,
        logs: executionLogs,
        // Persist failure-context links to the backend (no longer localStorage-only)
        defect_link: isFailedOrBlocked ? defectLink.trim() : '',
        custom_link: isFailedOrBlocked ? customLink.trim() : '',
      };

      const authToken = localStorage.getItem('token');
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      };

      // First, let's test if the backend is reachable
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const testResponse = await fetch(`${API_BASE_URL}/test-results`, {
          method: 'GET',
          headers: requestHeaders,
          mode: 'cors',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        if (!testResponse.ok) {
          throw new Error(`Backend returned ${testResponse.status}`);
        }
      } catch (connectionError) {
        console.error('❌ Backend connection failed:', connectionError);
        // Don't return here, continue with the main logic
      }

      // Check if a test result already exists for this test case and test run
      
      let savedResult: any = null;
      
      // Try direct fetch first to see if axios is the issue
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const directResponse = await fetch(`${API_BASE_URL}/test-results?test_run_id=${parseInt(testRunId || '0')}&test_case_id=${parseInt(testCaseId || '0')}`, {
          method: 'GET',
          headers: requestHeaders,
          mode: 'cors',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        if (!directResponse.ok) {
          const errorText = await directResponse.text();
          throw new Error(`Fetch existing result failed: ${directResponse.status} - ${errorText}`);
        }
        const directData = await directResponse.json();
        const existingResults = directData;
        
        if (existingResults.length > 0) {
          // Update existing result using direct fetch
          const existingResult = existingResults[0];
          
          const updateController = new AbortController();
          const updateTimeoutId = setTimeout(() => updateController.abort(), 10000);
          
          const updateResponse = await fetch(`${API_BASE_URL}/test-results/${existingResult.id}`, {
            method: 'PUT',
            headers: requestHeaders,
            mode: 'cors',
            signal: updateController.signal,
            body: JSON.stringify(executionData)
          });
          
          clearTimeout(updateTimeoutId);
          
          if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.error('❌ Error response body:', errorText);
            throw new Error(`Update failed: ${updateResponse.status} - ${errorText}`);
          }
          
          savedResult = await updateResponse.json();
        } else {
          // Create new result using direct fetch
          
          const requestBody = JSON.stringify(executionData);
          
          const createController = new AbortController();
          const createTimeoutId = setTimeout(() => createController.abort(), 10000);
          
          const createResponse = await fetch(`${API_BASE_URL}/test-results`, {
            method: 'POST',
            headers: requestHeaders,
            mode: 'cors',
            signal: createController.signal,
            body: requestBody
          });
          
          clearTimeout(createTimeoutId);
          
          if (!createResponse.ok) {
            const errorText = await createResponse.text();
            console.error('❌ Error response body:', errorText);
            throw new Error(`Create failed: ${createResponse.status} - ${errorText}`);
          }
          
          savedResult = await createResponse.json();
        }
        
        // Also test with axios API for comparison
        const axiosResults = await testResultsAPI.getAll(
          parseInt(testRunId || '0'), 
          parseInt(testCaseId || '0')
        );
        
      } catch (fetchError) {
        console.error('❌ Direct fetch failed:', fetchError);
        throw fetchError;
      }

      // Get the savedResult from the fetch operations above
      // Note: savedResult is now available from the try block above

      // Track the saved result id and refresh its structured defect links.
      // Re-executing clears any pending retest flag (mirrors backend behavior).
      if (savedResult?.id) {
        setTestResultId(savedResult.id);
        setRetestNeeded(Boolean(savedResult.retest_needed));
        await loadResultDefectLinks(savedResult.id);
      }

      // Also save additional data to localStorage for now (defects, logs, etc.)
      const additionalData = {
        test_case_id: testCaseId,
        test_run_id: testRunId,
        notes: executionNotes,
        logs: executionLogs,
        assignee: assignee,
        defect_link: defectLink,
        custom_link: customLink,
        defects: defects,
        saved_at: new Date().toISOString(),
        backend_result_id: savedResult.id
      };

      const saved = localStorage.getItem('testExecutions');
      const executions = saved ? JSON.parse(saved) : [];
      const updatedExecutions = executions.filter(
        (exec: any) => exec.test_case_id !== testCaseId || exec.test_run_id !== testRunId
      );
      updatedExecutions.push(additionalData);
      localStorage.setItem('testExecutions', JSON.stringify(updatedExecutions));
      setExecutionStart(savedResult.execution_started_at || startedAt);
      setElapsedSeconds(savedResult.execution_time ?? executionTimeSeconds);

      try {
        const refreshedHistory = await testCasesAPI.getExecutionHistory(parseInt(testCaseId || '0'), 50);
        setExecutionHistory(refreshedHistory);
        setHistoryLoadError(false);
      } catch (historyError) {
        console.error('Failed to refresh execution history:', historyError);
      }

      toast({
        title: t('executionSaved'),
        description: t('executionSavedDescription'),
        variant: 'success',
      });
    } catch (error) {
      console.error('💥 === SAVE FAILED ===');
      console.error('Error details:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('Network Error')) {
          alert('Network error: Cannot connect to backend server. Please ensure the backend is running on ' + API_BASE_URL);
        } else if (error.message.includes('404')) {
          alert('API endpoint not found. Please check if the backend API is properly configured.');
        } else if (error.message.includes('CORS')) {
          alert('CORS error: Please check backend CORS configuration.');
        } else {
          alert(`Error saving execution: ${error.message}`);
        }
      } else {
        alert('Unknown error occurred while saving execution. Please check the console for details.');
      }
    }
  };

  // Derive defect fields from the current execution context (for prefilling)
  const buildDefectContext = () => {
    const stepsText = testSteps.length > 0
      ? testSteps.map(step => `${step.step_number}. ${step.action}`).join('\n')
      : (testCase?.steps || testCase?.test_steps || testCase?.preconditions || '');
    const expectedText = testSteps.length > 0
      ? testSteps
          .filter(step => step.expected_result)
          .map(step => `${step.step_number}. ${step.expected_result}`)
          .join('\n')
      : (testCase?.expected_result || testCase?.expected_results || '');
    const environment = testRun?.environment?.name
      || testRun?.environment_name
      || testRun?.environment
      || '';
    const context: Record<string, string> = {};
    if (stepsText) context.steps_to_reproduce = String(stepsText);
    if (expectedText) context.expected_result = String(expectedText);
    if (executionNotes.trim()) context.actual_result = executionNotes.trim();
    if (environment) context.environment = String(environment);
    return context;
  };

  // Open the report-defect dialog with values prefilled from execution context
  const openDefectDialog = () => {
    const tcPriority = String(testCase?.priority || '').toLowerCase();
    const severity = ['low', 'medium', 'high', 'critical'].includes(tcPriority) ? tcPriority : 'medium';
    const statusLabel = executionStatus === 'blocked' ? t('blocked') : t('failed');
    setNewDefect({
      title: testCase?.title ? `[${statusLabel}] ${testCase.title}` : '',
      description: executionNotes.trim(),
      severity,
      priority: 'high',
    });
    setIsDefectDialogOpen(true);
  };

  const handleLinkExistingDefect = async () => {
    if (!selectedDefectId) return;
    if (!testResultId) {
      toast({
        title: t('error'),
        description: t('saveExecutionBeforeLinkingDefect'),
        variant: 'destructive',
      });
      return;
    }
    try {
      setIsLinkingDefect(true);
      await testResultsAPI.linkDefect(testResultId, {
        defect_id: parseInt(selectedDefectId),
        link_type: linkType,
      });
      setSelectedDefectId('');
      await loadResultDefectLinks(testResultId);
      toast({ title: t('success'), description: t('defectLinkedSuccessfully') });
    } catch (error) {
      console.error('Failed to link defect:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToLinkDefect')),
        variant: 'destructive',
      });
    } finally {
      setIsLinkingDefect(false);
    }
  };

  const linkTypeLabel = (type: string) => {
    if (type === 'blocked_by') return t('linkTypeBlockedBy');
    if (type === 'related') return t('linkTypeRelated');
    return t('linkTypeFound');
  };

  const handleUnlinkDefect = async (linkId: number) => {
    if (!testResultId) return;
    try {
      await testResultsAPI.unlinkDefect(testResultId, linkId);
      await loadResultDefectLinks(testResultId);
      toast({ title: t('success'), description: t('defectUnlinkedSuccessfully') });
    } catch (error) {
      console.error('Failed to unlink defect:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToUnlinkDefect')),
        variant: 'destructive',
      });
    }
  };

  const handleCreateDefect = async () => {
    const currentProjectId = Number(projectId);
    const currentTestRunId = Number(testRunId);
    const currentTestCaseId = Number(testCaseId);
    const trimmedTitle = newDefect.title.trim();

    if ([currentProjectId, currentTestRunId, currentTestCaseId].some(value => !Number.isFinite(value) || value <= 0)) {
      toast({
        title: t('error'),
        description: t('failedToCreateDefect'),
        variant: "destructive",
      });
      return;
    }

    if (!trimmedTitle) {
      toast({
        title: t('validationError'),
        description: t('defectTitleRequired'),
        variant: "destructive",
      });
      return;
    }

    // Check for duplicate title
    const isDuplicate = defects.some(d => 
      String(d.title || '').toLowerCase().trim() === trimmedTitle.toLowerCase()
    );
    
    if (isDuplicate) {
      toast({
        title: t('duplicateDefect'),
        description: t('defectWithThisTitleAlreadyExists'),
        variant: "destructive",
      });
      return;
    }
    
    try {
      setIsCreating(true);
      // Build defect payload, prefilled with execution context
      const defectData: any = {
        defect_id: createExecutionDefectId(),
        title: trimmedTitle,
        description: newDefect.description.trim(),
        severity: newDefect.severity,
        priority: newDefect.priority,
        test_case_id: currentTestCaseId,
        test_run_id: currentTestRunId,
        project_id: currentProjectId,
        reported_by: currentUser?.id,
        ...buildDefectContext(),
      };

      let createdDefect: any = null;
      if (testResultId) {
        // Create the defect and link it to this execution result atomically
        const link = await testResultsAPI.linkDefect(testResultId, {
          new_defect: defectData,
          link_type: linkType,
        });
        createdDefect = link?.defect || null;
        await loadResultDefectLinks(testResultId);
      } else {
        createdDefect = await defectsAPI.create(defectData);
      }

      // Keep loose defect lists in sync for ID generation / duplicate checks
      if (createdDefect) {
        setDefects(prevDefects => [createdDefect, ...prevDefects]);
        setAvailableDefects(prevDefects => [createdDefect, ...prevDefects]);
      }
      setNewDefect({ title: '', description: '', severity: 'medium', priority: 'high' });
      setIsDefectDialogOpen(false);

      toast({
        title: t('success'),
        description: t('defectReportedSuccessfully'),
      });
    } catch (error) {
      console.error('Failed to create defect:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToCreateDefect')),
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      setIsDefectDialogOpen(open);
      if (!open) {
        setNewDefect({ title: '', description: '', severity: 'medium', priority: 'high' });
        setDefectTouchedFields({});
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      setNewDefect({ title: '', description: '', severity: 'medium', priority: 'high' });
      setDefectTouchedFields({});
      setIsDefectDialogOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateDefect();
    }
  };

  const handleEditTestCase = () => {
    navigate(`/projects/${projectId}/test-cases/${testCaseId}/edit`);
  };


  // Navigation functions
  const handleNextTestCase = () => {
    if (hasNext && currentIndex >= 0) {
      const nextCase = allTestCases[currentIndex + 1];
      if (nextCase) {
        navigate(`/projects/${projectId}/test-runs/${testRunId}/test-cases/${nextCase.id}`);
      }
    }
  };

  const handlePreviousTestCase = () => {
    if (hasPrevious && currentIndex >= 0) {
      const prevCase = allTestCases[currentIndex - 1];
      if (prevCase) {
        navigate(`/projects/${projectId}/test-runs/${testRunId}/test-cases/${prevCase.id}`);
      }
    }
  };

  const handleSaveAndNext = () => {
    handleSaveExecution();
    setTimeout(() => {
      if (hasNext) {
        handleNextTestCase();
      }
    }, 500); // Small delay to show success message
  };

  const handleSaveAndPrevious = () => {
    handleSaveExecution();
    setTimeout(() => {
      if (hasPrevious) {
        handlePreviousTestCase();
      }
    }, 500); // Small delay to show success message
  };

  // Pause/Resume functionality
  const handleStartTimer = () => {
    const now = new Date().toISOString();
    setExecutionStartedAt(now);
    setExecutionStartedAtRef(now);
    setExecutionState('running');
    setIsPaused(false);
  };

  const handlePauseExecution = async () => {
    if (!testRunId || !testCaseId) return;
    
    try {
      const existingResults = await testResultsAPI.getAll(
        parseInt(testRunId), 
        parseInt(testCaseId)
      );
      
      if (existingResults.length === 0) {
        console.error('No test result found to pause/resume');
        return;
      }
      
      const result = existingResults[0];
      const isCurrentlyPaused = executionState === 'paused';

      if (isCurrentlyPaused) {
        // Resume
        const resumeResponse = await fetch(`${API_BASE_URL}/test-results/${result.id}/resume`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });

        if (resumeResponse.ok) {
          setIsRecentlyPaused(true);
          setTimeout(() => setIsRecentlyPaused(false), 5000);

          setIsPaused(false);
          setPausedAt(null);
          setExecutionState('running');

          const refreshedResults = await testResultsAPI.getAll(
            parseInt(testRunId || '0'),
            parseInt(testCaseId || '0')
          );
          if (refreshedResults.length > 0) {
            const r = refreshedResults[0];
            setElapsedSeconds(r.execution_time || 0);
            setManualTimeAdjustment(r.manual_time_adjustment || 0);
            setTotalPausedTime(r.total_paused_time || 0);
          }

          toast({ title: 'Execution Resumed', description: 'Test execution has been resumed', variant: 'success' });
        }
      } else {
        // Pause
        const pauseResponse = await fetch(`${API_BASE_URL}/test-results/${result.id}/pause`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });

        if (pauseResponse.ok) {
          setIsRecentlyPaused(true);
          setTimeout(() => setIsRecentlyPaused(false), 5000);

          const refreshedResults = await testResultsAPI.getAll(
            parseInt(testRunId || '0'),
            parseInt(testCaseId || '0')
          );
          if (refreshedResults.length > 0) {
            const r = refreshedResults[0];
            setPausedAt(r.paused_at || new Date().toISOString());
            setElapsedSeconds(r.execution_time || 0);
            setManualTimeAdjustment(r.manual_time_adjustment || 0);
            setTotalPausedTime(r.total_paused_time || 0);
          }

          // Set both in lockstep so they are always consistent
          setExecutionState('paused');
          setIsPaused(true);

          toast({ title: 'Execution Paused', description: 'Test execution has been paused', variant: 'success' });
        }
      }
    } catch (error) {
      console.error('Failed to pause/resume execution:', error);
      toast({
        title: 'Error',
        description: 'Failed to pause/resume execution',
        variant: 'destructive',
      });
    }
  };

  const handleManualTimeEntry = async () => {
    const hours = parseFloat(manualTimeEntry) || 0;
    if (hours <= 0 || hours > 24) {
      toast({
        title: 'Invalid Input',
        description: 'Please enter a valid number of hours between 0 and 24',
        variant: 'destructive',
      });
      return;
    }
    
    if (!testRunId || !testCaseId) return;
    
    try {
      const existingResults = await testResultsAPI.getAll(
        parseInt(testRunId), 
        parseInt(testCaseId)
      );
      
      if (existingResults.length === 0) {
        console.error('No test result found to add time to');
        return;
      }
      
      const result = existingResults[0];
      
      const response = await fetch(`${API_BASE_URL}/test-results/${result.id}/add-time`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ hours })
      });
      
      if (response.ok) {
        const data = await response.json();
        setManualTimeEntry('');
        setShowManualTimeDialog(false);
        toast({
          title: 'Time Added',
          description: `Added ${hours.toFixed(1)} hours to execution time`,
          variant: 'success',
        });
        
        // Refresh execution data to get updated time
        const refreshedResults = await testResultsAPI.getAll(
          parseInt(testRunId || '0'), 
          parseInt(testCaseId || '0')
        );
        if (refreshedResults.length > 0) {
          const result = refreshedResults[0];
          // execution_time already includes manual_time_adjustment from backend calculation
          const totalTime = result.execution_time || 0;
          const manualAdjustment = result.manual_time_adjustment || 0;
          setElapsedSeconds(totalTime);
          setManualTimeAdjustment(manualAdjustment);
          
          // Also update other timing fields
          if (result.execution_state) {
            setExecutionState(result.execution_state);
            setIsPaused(result.execution_state === 'paused');
          }
        }
      } else {
        throw new Error('Failed to add time');
      }
    } catch (error) {
      console.error('Failed to add manual time:', error);
      toast({
        title: 'Error',
        description: 'Failed to add manual time',
        variant: 'destructive',
      });
    }
  };

  const [showResetTimerDialog, setShowResetTimerDialog] = useState(false);
  const handleResetTimer = () => {
    setShowResetTimerDialog(true);
  };

  const handleConfirmResetTimer = async () => {
    if (!testRunId || !testCaseId) {
      toast({
        title: 'Error',
        description: 'Test run ID or test case ID not found',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Get current test result to reset
      const currentResults = await testResultsAPI.getAll(
        parseInt(testRunId || '0'), 
        parseInt(testCaseId || '0')
      );
      
      if (currentResults.length === 0) {
        toast({
          title: 'Error',
          description: 'No test result found for this test case',
          variant: 'destructive',
        });
        return;
      }

      // Reset time for individual test result
      await testResultsAPI.resetTime(currentResults[0].id);
      
      // Reset local state — go back to idle so user must explicitly restart
      setElapsedSeconds(0);
      setTotalPausedTime(0);
      setPausedAt(null);
      setManualTimeAdjustment(0);
      setExecutionStartedAt(null);
      setExecutionStartedAtRef(null);
      setExecutionState('idle');
      setIsPaused(false);
      setShowResetTimerDialog(false);
      
      toast({
        title: 'Timer Reset',
        description: 'Timer has been reset for this test case',
        variant: 'success',
      });
      
      // Timer is now idle — don't re-apply any start time from backend
    } catch (error) {
      console.error('Failed to reset test result time:', error);
      toast({
        title: 'Error',
        description: 'Failed to reset test case timer',
        variant: 'destructive',
      });
    }
  };

  const selectedStatus = statusOptions.find(opt => opt.value === executionStatus);
  const executionStatusBadgeClass = getExecutionStatusBadgeClass(executionStatus);
  const testRunName = testRun?.name || t('loading');
  const testCaseTitle = testCase?.title || t('loading');
  const progressLabel = allTestCases.length > 0 && currentIndex >= 0
    ? t('testCaseProgress', { current: currentIndex + 1, total: allTestCases.length })
    : t('loadingTestCases');

  if (loadError) {
    return (
      <div className="space-y-4 py-12 text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
        <h2 className="text-2xl font-bold">{loadError}</h2>
        <Button variant="outline" onClick={() => navigate(`/projects/${projectId}/test-runs`)}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
          {t('backToTestRuns')}
        </Button>
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
              onClick={() => navigate(`/projects/${projectId}/test-runs/${testRunId}`)}
              className="w-fit bg-slate-900/5 text-slate-700 hover:bg-slate-900/10 hover:text-slate-950 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white"
            >
              <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
              {t('backToTestRun')}
            </Button>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="border border-cyan-200 bg-cyan-100/80 px-3 py-1 text-cyan-800 shadow-xs backdrop-blur-sm dark:border-cyan-200/30 dark:bg-cyan-300/15 dark:text-cyan-50">
                  {t('testCaseExecution')}
                </Badge>
                <Badge className={`${executionStatusBadgeClass} px-3 py-1 shadow-xs backdrop-blur-sm`}>
                  {selectedStatus?.label || executionStatus}
                </Badge>
                <Badge className="border border-emerald-200 bg-emerald-100/80 px-3 py-1 text-emerald-800 shadow-xs backdrop-blur-sm dark:border-emerald-200/30 dark:bg-emerald-300/15 dark:text-emerald-50">
                  {progressLabel}
                </Badge>
              </div>

              <div className="max-w-4xl space-y-2">
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${projectId}/test-cases/${testCaseId}`)}
                  className="group inline-flex max-w-full items-center gap-2 text-left text-3xl font-black leading-tight tracking-tight text-slate-950 hover:text-cyan-700 dark:text-white dark:hover:text-cyan-200 sm:text-4xl"
                  title={testCaseTitle}
                >
                  <span className="truncate">{testCaseTitle}</span>
                  <Link className="h-4 w-4 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-6 text-slate-600 dark:text-slate-200 sm:text-base">
                  <span className="font-semibold text-slate-700 dark:text-slate-100">{t('testRunLabel')}:</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${projectId}/test-runs/${testRunId}`)}
                    className="inline-flex max-w-full items-center gap-1.5 font-medium text-cyan-700 hover:text-cyan-900 hover:underline dark:text-cyan-200 dark:hover:text-cyan-100"
                    title={testRunName}
                  >
                    <span className="truncate">{testRunName}</span>
                    <Link className="h-3.5 w-3.5 shrink-0" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 shadow-xs ring-1 ring-slate-200/80 backdrop-blur-sm dark:bg-white/10 dark:ring-white/10">
                  <FileText className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  {t('testCaseLabel')}: TC-{testCaseId}
                </span>
                <div className="hidden gap-1 sm:flex" aria-hidden="true">
                  {allTestCases.map((_, index) => (
                    <div
                      key={index}
                      className={`h-2 w-2 rounded-full transition-colors duration-200 ${
                        index === currentIndex
                          ? 'bg-cyan-600 ring-2 ring-cyan-200 dark:bg-cyan-300 dark:ring-cyan-800'
                          : index < currentIndex
                          ? 'bg-emerald-500 dark:bg-emerald-500'
                          : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:min-w-[520px] xl:grid-cols-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousTestCase}
              disabled={!hasPrevious}
              className="h-11 justify-center rounded-xl border-slate-200 bg-white/80 text-slate-700 hover:bg-white hover:text-slate-950 disabled:bg-slate-100/70 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white dark:disabled:bg-white/5"
            >
              <ChevronLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
              {t('previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextTestCase}
              disabled={!hasNext}
              className="h-11 justify-center rounded-xl border-slate-200 bg-white/80 text-slate-700 hover:bg-white hover:text-slate-950 disabled:bg-slate-100/70 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white dark:disabled:bg-white/5"
            >
              {t('next')}
              <ChevronRight className={`h-4 w-4 ${isRTL ? 'mr-2 rotate-180' : 'ml-2'}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleEditTestCase}
              className="h-11 justify-center rounded-xl border-slate-200 bg-white/80 text-slate-700 hover:bg-white hover:text-slate-950 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white"
            >
              <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('edit')}
            </Button>
            <Button
              onClick={handleSaveExecution}
              disabled={executionStatus === 'pending'}
              className="h-11 justify-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
              size="sm"
            >
              <Save className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('save')}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Test Case Details */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Test Case Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {testCase ? (
                <>
                  <div>
                    <h3 className="font-semibold text-sm">{testCase.title}</h3>
                    <p className="text-gray-600 text-xs mt-1">{testCase.description || 'No description provided'}</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-medium text-gray-700">Priority</Label>
                      <div className="mt-1">
                        <Badge className={`text-xs ${getPriorityBadgeVariant(testCase.priority).className}`}>
                          {testCase.priority?.toUpperCase() || 'MEDIUM'}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-gray-700">Status</Label>
                      <div className="mt-1">
                        <Badge variant="outline" className="text-xs">
                          {testCase.status || 'Active'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {testCase.preconditions && (
                    <div>
                      <Label className="text-xs font-medium text-gray-700">Preconditions</Label>
                      <p className="text-xs text-gray-600 bg-gray-50 p-2 rounded mt-1">
                        {testCase.preconditions}
                      </p>
                    </div>
                  )}

                  {testCase.is_multistep ? (
                    testSteps.length > 0 ? (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Label className="text-xs font-medium text-gray-700">Test Steps</Label>
                          <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 text-xs">
                            Multistep
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          {testSteps.map((step) => (
                            <div key={step.step_number} className="border border-gray-200 dark:border-gray-700 rounded p-2 bg-gray-50 dark:bg-gray-900/50">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="flex items-center justify-center w-5 h-5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold rounded-full">
                                  {step.step_number}
                                </span>
                                <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400 px-1 py-0.5 text-xs">
                                  {step.step_type}
                                </Badge>
                              </div>
                              <div className="space-y-1">
                                <div>
                                  <span className="text-xs font-medium text-gray-600">Action:</span>
                                  <p className="text-xs text-gray-600 mt-0.5">{step.action}</p>
                                </div>
                                <div>
                                  <span className="text-xs font-medium text-gray-600">Expected:</span>
                                  <p className="text-xs text-gray-600 mt-0.5">{step.expected_result}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Label className="text-xs font-medium text-gray-700">Test Steps</Label>
                        <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded mt-1">
                          No multistep data available
                        </p>
                      </div>
                    )
                  ) : testCase.steps && (
                    <div>
                      <Label className="text-xs font-medium text-gray-700">Test Steps</Label>
                      <pre className="text-xs text-gray-600 bg-gray-50 p-2 rounded whitespace-pre-wrap mt-1">
                        {testCase.steps}
                      </pre>
                    </div>
                  )}

                  {!testCase.is_multistep && testCase.expected_result && (
                    <div>
                      <Label className="text-xs font-medium text-gray-700">Expected Result</Label>
                      <p className="text-xs text-gray-600 bg-green-50 p-2 rounded mt-1">
                        {testCase.expected_result}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500">Loading test case details...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Execution Form */}
          <Card className="overflow-hidden border-slate-200/80 shadow-xs dark:border-slate-800">
            <CardHeader className="border-b border-slate-100 bg-linear-to-r from-slate-50 via-cyan-50/60 to-white pb-4 dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50">
                    <Save className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                    {t('executionDetails')}
                  </CardTitle>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {t('executionDetailsDescription')}
                  </p>
                </div>
                <Badge className={`w-fit ${executionStatusBadgeClass} px-3 py-1 shadow-xs`}>
                  {selectedStatus?.label || executionStatus}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-4 sm:p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white/80 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-950/60">
                  <Label htmlFor="status" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('executionStatusLabel')}
                  </Label>
                  <Select value={executionStatus} onValueChange={setExecutionStatus}>
                    <SelectTrigger className="mt-2 h-10 text-sm">
                      <SelectValue placeholder={t('selectStatus')} />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex items-center gap-2">
                            <option.icon className={`h-3.5 w-3.5 ${option.color}`} />
                            <span className="text-sm">{option.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/80 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-950/60">
                  <Label htmlFor="assignee" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('assigneeLabel')}
                  </Label>
                  <Select value={assignee} onValueChange={setAssignee}>
                    <SelectTrigger className="mt-2 h-10 text-sm">
                      <SelectValue placeholder={t('selectAssignee')} />
                    </SelectTrigger>
                    <SelectContent>
                      {currentUser && (
                        <SelectItem key="me" value={currentUser.id.toString()}>
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5" />
                            <span className="text-sm font-medium">
                              Me ({currentUser.username || currentUser.email || 'Unknown User'})
                            </span>
                          </div>
                        </SelectItem>
                      )}
                      {users.filter(u => u.id !== currentUser?.id).map((user) => (
                        <SelectItem key={user.id} value={user.id.toString()}>
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5" />
                            <span className="text-sm">
                              {user.full_name || user.username || user.email || `User ${user.id}`}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-xl border border-cyan-200 bg-cyan-50/80 p-3 shadow-xs dark:border-cyan-900/60 dark:bg-cyan-950/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                  {t('elapsedTimeLabel')}
                </p>
                <p className="mt-2 text-lg font-bold text-cyan-950 dark:text-cyan-50">
                  {formatDurationSeconds(elapsedSeconds, t)}
                </p>
                <p className="mt-1 text-xs text-cyan-700/80 dark:text-cyan-200/80">
                  {t('executionStartedLabel')}: {executionStartedAt ? new Date(executionStartedAt).toLocaleString() : t('nA')}
                </p>

                {/* Timer Controls */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {executionState === 'idle' ? (
                    <Button
                      size="sm"
                      onClick={handleStartTimer}
                      className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                    >
                      <PlayCircle className="h-3 w-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePauseExecution}
                      disabled={executionState === 'completed'}
                      className="h-8 text-xs"
                    >
                      {executionState === 'paused' ? (
                        <><PlayCircle className="h-3 w-3 mr-1" /> Resume</>
                      ) : (
                        <><Pause className="h-3 w-3 mr-1" /> Pause</>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowManualTimeDialog(true)}
                    disabled={executionState === 'idle'}
                    className="h-8 text-xs"
                  >
                    <Clock className="h-3 w-3 mr-1" />
                    Add Time
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetTimer}
                    disabled={executionState === 'idle'}
                    className="h-8 text-xs"
                  >
                    <ArrowLeft className="h-3 w-3 mr-1 rotate-180" />
                    Reset
                  </Button>
                </div>

                {/* Status Indicator */}
                <div className="mt-2 flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${
                    executionState === 'running' ? 'animate-pulse bg-green-500' :
                    executionState === 'paused'  ? 'bg-yellow-500' :
                    executionState === 'completed' ? 'bg-blue-500' :
                    'bg-gray-300'
                  }`} />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {executionState === 'running'   ? 'Running' :
                     executionState === 'paused'    ? 'Paused' :
                     executionState === 'completed' ? 'Completed' :
                     'Not started'}
                  </span>
                </div>
              </div>

              {/* Retest banner: a linked defect changed status */}
              {retestNeeded && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-semibold">{t('retestNeededTitle')}</div>
                    <div className="text-xs">{t('retestNeededDescription')}</div>
                  </div>
                </div>
              )}

              {/* Show link fields only when failed or blocked */}
              {(executionStatus === 'failed' || executionStatus === 'blocked') && (
                <div className="rounded-xl border border-red-200 bg-linear-to-br from-red-50 to-orange-50 p-4 shadow-xs dark:border-red-900/60 dark:from-red-950/30 dark:to-orange-950/20">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-200">
                    <AlertTriangle className="h-4 w-4" />
                    {t('failureContext')}
                  </div>
                  {requireDefectOnFailure && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-red-700 dark:bg-slate-950/40 dark:text-red-200">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      {t('defectRequiredHint')}
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label htmlFor="defectLink" className="text-xs font-semibold text-red-700 dark:text-red-200">
                        {t('defectLinkLabel')}
                      </Label>
                      <Input
                        id="defectLink"
                        name="defect-url"
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        data-lpignore="true"
                        data-1p-ignore="true"
                        value={defectLink}
                        onChange={(e) => setDefectLink(e.target.value)}
                        placeholder={t('defectLinkPlaceholder')}
                        className="mt-1 h-9 border-red-200 bg-white/90 text-sm dark:border-red-900/70 dark:bg-slate-950/60"
                      />
                    </div>
                    <div>
                      <Label htmlFor="customLink" className="text-xs font-semibold text-red-700 dark:text-red-200">
                        {t('customLinkLabel')}
                      </Label>
                      <Input
                        id="customLink"
                        name="custom-url"
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        data-lpignore="true"
                        data-1p-ignore="true"
                        value={customLink}
                        onChange={(e) => setCustomLink(e.target.value)}
                        placeholder={t('customLinkPlaceholder')}
                        className="mt-1 h-9 border-red-200 bg-white/90 text-sm dark:border-red-900/70 dark:bg-slate-950/60"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="notes" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('executionNotesLabel')}
                  </Label>
                  <Textarea
                    id="notes"
                    value={executionNotes}
                    onChange={(e) => setExecutionNotes(e.target.value)}
                    placeholder={t('executionNotesPlaceholder')}
                    rows={5}
                    className="h-36 min-h-36 resize-none text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="logs" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('executionLogsLabel')}
                  </Label>
                  <Textarea
                    id="logs"
                    value={executionLogs}
                    onChange={(e) => setExecutionLogs(e.target.value)}
                    placeholder={t('executionLogsPlaceholder')}
                    rows={5}
                    className="h-36 min-h-36 resize-none font-mono text-xs"
                  />
                </div>
              </div>

              {/* Prominent Save Button */}
              <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                <Button
                  onClick={handleSaveExecution}
                  disabled={executionStatus === 'pending'}
                  className="h-11 w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                >
                  <Save className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('saveExecution')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Linked Defects Section */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bug className="h-4 w-4" />
                  {t('linkedDefects')} ({resultDefectLinks.length})
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openDefectDialog}
                  className="h-8 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t('reportDefect')}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Link an existing defect to this execution result */}
              <div className="space-y-2 rounded-lg border border-dashed p-3 dark:border-slate-700">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('linkExistingDefect')}
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <SearchableDefectSelect
                    id="defectLinkSelect"
                    value={selectedDefectId}
                    onChange={setSelectedDefectId}
                    defects={availableDefects}
                    className="flex-1"
                  />
                  <Select value={linkType} onValueChange={(value) => setLinkType(value as DefectLinkType)}>
                    <SelectTrigger className="h-9 sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="found">{t('linkTypeFound')}</SelectItem>
                      <SelectItem value="blocked_by">{t('linkTypeBlockedBy')}</SelectItem>
                      <SelectItem value="related">{t('linkTypeRelated')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleLinkExistingDefect}
                    disabled={!selectedDefectId || isLinkingDefect}
                    className="h-9"
                  >
                    <Link2 className="h-3.5 w-3.5 mr-1" />
                    {isLinkingDefect ? t('linking') : t('link')}
                  </Button>
                </div>
              </div>

              {/* List of defects linked to this execution result */}
              {resultDefectLinks.length === 0 ? (
                <p className="text-gray-500 text-center py-3 text-xs">{t('noDefectsLinked')}</p>
              ) : (
                <div className="space-y-2">
                  {resultDefectLinks.map((link) => {
                    const defect = link.defect || {};
                    return (
                      <div key={link.id} className="border rounded-lg p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="font-mono text-xs">{defect.defect_id || `#${link.defect_id}`}</span>
                              {defect.severity && (
                                <Badge variant="outline" className="text-xs capitalize">{defect.severity}</Badge>
                              )}
                              {defect.status && (
                                <Badge variant="outline" className="text-xs capitalize">{defect.status}</Badge>
                              )}
                              <Badge variant="secondary" className="text-xs">{linkTypeLabel(link.link_type)}</Badge>
                            </div>
                            <h4 className="font-medium text-sm truncate">{defect.title}</h4>
                            {defect.external_issue_url && (
                              <a
                                href={defect.external_issue_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                              >
                                <Link className="h-3 w-3" />
                                {t('openInTracker')}
                              </a>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUnlinkDefect(link.id)}
                            className="h-7 w-7 p-0 shrink-0"
                            title={t('unlinkDefect')}
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Status Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current Status</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full ${getStatusColor(executionStatus)} bg-opacity-10 mb-3`}>
                {getStatusIcon(executionStatus)}
              </div>
              <h3 className="text-sm font-semibold capitalize">{executionStatus}</h3>
              {selectedStatus && (
                <p className="text-xs text-gray-600 mt-1">{selectedStatus.label}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button 
                variant="outline" 
                className="w-full justify-start h-8 text-xs"
                onClick={() => setExecutionStatus('passed')}
              >
                <CheckCircle className="h-3 w-3 mr-2 text-green-600" />
                Mark as Passed
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start h-8 text-xs"
                onClick={() => setExecutionStatus('failed')}
              >
                <XCircle className="h-3 w-3 mr-2 text-red-600" />
                Mark as Failed
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start h-8 text-xs"
                onClick={openDefectDialog}
              >
                <Bug className="h-3 w-3 mr-2 text-orange-600" />
                Report Defect
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start h-8 text-xs"
                onClick={() => setExecutionStatus('blocked')}
              >
                <AlertTriangle className="h-3 w-3 mr-2 text-orange-600" />
                Mark as Blocked
              </Button>
            </CardContent>
          </Card>

          {/* Execution History */}
          <Card className="overflow-hidden border-slate-200 dark:border-slate-800">
            <CardHeader className="border-b bg-slate-50/80 pb-3 dark:bg-slate-900/60">
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <span>{t('executionHistory')}</span>
                {historyByRun.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {t('totalRuns')}: {historySummary.totalRuns}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {historyLoadError && (
                <p className="text-xs text-red-600">{t('failedToLoadExecutionHistory')}</p>
              )}
              {historyByRun.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">
                  {t('noExecutionHistory')}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">{t('totalExecutions')}</p>
                      <p className="text-lg font-semibold">{historySummary.totalExecutions}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">{t('uniqueExecutors')}</p>
                      <p className="text-lg font-semibold">{historySummary.uniqueExecutors}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('usedInTestRuns')}</p>
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                      {historyByRun.map((run) => (
                        <button
                          key={run.runId}
                          type="button"
                          onClick={() => openRunExecution(run.runId)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/60 dark:border-slate-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium truncate">{run.runName}</p>
                            <Badge variant="outline" className="text-[10px]">
                              {formatStatusLabel(run.latestStatus)}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1">
                            {t('lastExecutedByAt', {
                              executor: run.latestExecutor,
                              date: run.lastExecutedAt ? new Date(run.lastExecutedAt).toLocaleString() : t('nA'),
                            })}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-500">
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

                  <div className="space-y-2 max-h-96 overflow-y-auto border-t pt-3 pr-1">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('resultDetails')}</p>
                    {executionHistory.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium truncate">{item.test_run_name || `${t('testRun')} #${item.test_run_id}`}</p>
                          <Badge variant="outline" className="text-[10px]">{formatStatusLabel(item.status)}</Badge>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-600 space-y-1">
                          <p>
                            {t('executorLabel')}: {item.executed_by_full_name || item.executed_by || t('unknown')}
                            {item.executed_by_email ? ` (${item.executed_by_email})` : ''}
                          </p>
                          <p>{t('executionDateLabel')}: {item.executed_at ? new Date(item.executed_at).toLocaleString() : t('nA')}</p>
                          <p>{t('runStatusLabel')}: {item.test_run_status || t('unknown')}</p>
                          {item.execution_started_at && <p>{t('executionStartedLabel')}: {new Date(item.execution_started_at).toLocaleString()}</p>}
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
        </div>
      </div>

      {/* Defect Dialog */}
      <Dialog open={isDefectDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[500px]" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('reportNewDefect')}</DialogTitle>
            <DialogDescription>
              {t('reportExecutionDefectDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="defectTitle" className="text-right">
                {t('title')}
              </Label>
              <div className="col-span-3 space-y-1">
                <Input
                  ref={defectTitleInputRef}
                  id="defectTitle"
                  value={newDefect.title}
                  onChange={(e) => setNewDefect({...newDefect, title: e.target.value})}
                  onBlur={() => setDefectTouchedFields({...defectTouchedFields, title: true})}
                  className={defectTouchedFields.title && newDefect.title.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
                  placeholder={t('defectTitlePlaceholder')}
                  maxLength={200}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{t('defectTitlePlaceholder')}</span>
                  <span>{newDefect.title.length}/200</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="defectDescription" className="text-right pt-2">
                {t('description')}
              </Label>
              <div className="col-span-3 space-y-1">
                <Textarea
                  id="defectDescription"
                  value={newDefect.description}
                  onChange={(e) => setNewDefect({...newDefect, description: e.target.value})}
                  placeholder={t('defectDescriptionPlaceholder')}
                  rows={3}
                  maxLength={1000}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{t('defectDescriptionPlaceholder')}</span>
                  <span>{newDefect.description.length}/1000</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="severity" className="text-right">
                {t('defectSeverity')}
              </Label>
              <Select value={newDefect.severity} onValueChange={(value) => setNewDefect({...newDefect, severity: value})}>
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('low')}</SelectItem>
                  <SelectItem value="medium">{t('medium')}</SelectItem>
                  <SelectItem value="high">{t('high')}</SelectItem>
                  <SelectItem value="critical">{t('critical')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="priority" className="text-right">
                {t('defectPriority')}
              </Label>
              <Select value={newDefect.priority} onValueChange={(value) => setNewDefect({...newDefect, priority: value})}>
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('low')}</SelectItem>
                  <SelectItem value="medium">{t('medium')}</SelectItem>
                  <SelectItem value="high">{t('high')}</SelectItem>
                  <SelectItem value="urgent">{t('urgent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="text-xs text-gray-500 mb-2 sm:mb-0 sm:mr-auto">
              {t('ctrlEnterToSubmit')}
            </div>
            <Button variant="outline" onClick={() => handleDialogClose(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreateDefect} disabled={!newDefect.title.trim() || isCreating} className="transition-all duration-200">
              {isCreating ? t('creating') : t('reportDefect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Confirmation Dialog */}
      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('unsavedChangesTitle')}</DialogTitle>
            <DialogDescription>
              {t('unsavedChangesModalMessage')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleUnsavedConfirm(false)}>
              {t('keepEditingModal')}
            </Button>
            <Button onClick={() => handleUnsavedConfirm(true)}>
              {t('discardChangesModal')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Time Entry Dialog */}
      <Dialog open={showManualTimeDialog} onOpenChange={setShowManualTimeDialog}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('addManualTime')}</DialogTitle>
            <DialogDescription>
              {t('addManualTimeDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="manualTime" className="text-right">
                {t('hours')}
              </Label>
              <div className="col-span-3 space-y-1">
                <Input
                  id="manualTime"
                  type="number"
                  step="0.1"
                  min="0"
                  max="24"
                  value={manualTimeEntry}
                  onChange={(e) => setManualTimeEntry(e.target.value)}
                  placeholder={t('enterHoursPlaceholder')}
                  className="h-9"
                />
                <div className="text-xs text-gray-500">
                  {t('manualTimeHelper')}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualTimeDialog(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleManualTimeEntry} disabled={!manualTimeEntry || parseFloat(manualTimeEntry) <= 0}>
              {t('addTime')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Timer Confirmation Dialog */}
      <Dialog open={showResetTimerDialog} onOpenChange={setShowResetTimerDialog}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('resetTimer')}</DialogTitle>
            <DialogDescription>
              {t('resetTimerConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetTimerDialog(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleConfirmResetTimer} className="bg-red-600 hover:bg-red-700">
              {t('resetTimer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
