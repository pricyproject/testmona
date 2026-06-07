import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/authStore';
import {
  datasetsAPI,
  defectsAPI,
  executionSettingsAPI,
  getApiErrorMessage,
  testCasesAPI,
  testResultsAPI,
  testRunsAPI,
  usersAPI,
  type GlobalParameter,
  type TestDataset,
} from '@/lib/api';
import { loadProjectParameters, paramsToMap, resolveParameters } from '@/utils/parameters';
import { canWriteResults } from '@/utils/roles';
import {
  type TestStep,
  type ExecutionPhase,
  type DefectLinkType,
  type NewDefectDraft,
  type IterationStatusMap,
} from '@/components/TestCases/execution/types';
import type { ExecutionStatus } from '@/components/TestCases/execution/statusConfig';

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

const COMPLETED_STATUSES = new Set(['pass', 'passed', 'fail', 'failed', 'block', 'blocked', 'skip', 'skipped']);
const isCompletedResultStatus = (status?: string | null) =>
  COMPLETED_STATUSES.has(String(status || '').toLowerCase().replace('-', '_'));

interface FormSnapshot {
  status: string;
  notes: string;
  logs: string;
  defectLink: string;
  customLink: string;
  blockerReason: string;
  assignee: string;
}
// Serialized fingerprint of the editable result fields, used to detect unsaved
// changes. Timer state is intentionally excluded — it persists on its own.
const snapshotOf = (s: FormSnapshot): string => JSON.stringify(s);

const BACKEND_STEP_TO_STATUS: Record<string, ExecutionStatus> = {
  passed: 'passed', pass: 'passed',
  failed: 'failed', fail: 'failed',
  blocked: 'blocked', block: 'blocked',
  skipped: 'pending', skip: 'pending', pending: 'pending',
};
// Stable, order-independent fingerprint of per-step outcomes for dirty detection.
const serializeStepMap = (steps: TestStep[], map: Record<number, ExecutionStatus>): string =>
  JSON.stringify(steps.map((s) => map[s.step_number] || 'pending'));

const STATUS_TO_BACKEND: Record<string, string> = { passed: 'pass', failed: 'fail', blocked: 'block', skipped: 'skip' };
const BACKEND_TO_STATUS: Record<string, ExecutionStatus> = {
  passed: 'passed', pass: 'passed',
  failed: 'failed', fail: 'failed',
  blocked: 'blocked', block: 'blocked',
  skipped: 'skipped', skip: 'skipped',
  // "not executed yet" — stored canonically as not_started, shown as the
  // unselected "Not Started" state in the execution UI.
  pending: 'pending', not_started: 'pending',
};

/**
 * All state, effects and handlers for the test-case execution page. Kept apart
 * from presentation so the page and its sub-components stay declarative.
 */
export function useTestCaseExecution() {
  const navigate = useNavigate();
  const { projectId, testRunId, testCaseId } = useParams();
  // The URL carries per-project sequences; resolve both to global ids.
  const { id: runGlobalId, loading: runLoading } = useResolvedEntityId(projectId, 'test-runs', testRunId);
  const { id: tcGlobalId, loading: tcLoading } = useResolvedEntityId(projectId, 'test-cases', testCaseId);
  const { isRTL, t } = useTranslation();
  const { toast } = useToast();
  const { user: currentUser } = useAuthStore();

  // --- Core execution result fields ---
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('pending');
  const [executionNotes, setExecutionNotes] = useState('');
  const [executionLogs, setExecutionLogs] = useState('');
  const [assignee, setAssignee] = useState('');
  const [defectLink, setDefectLink] = useState('');
  const [customLink, setCustomLink] = useState('');
  // Structured triage reason for blocked executions (environment, test_data, …).
  const [blockerReason, setBlockerReason] = useState('');
  const [selectedFailureStepNumber, setSelectedFailureStepNumber] = useState('');
  const [failureStepActual, setFailureStepActual] = useState('');
  const [testResultId, setTestResultId] = useState<number | null>(null);
  const [retestNeeded, setRetestNeeded] = useState(false);
  const [requireDefectOnFailure, setRequireDefectOnFailure] = useState(false);

  // --- Defects ---
  const [defects, setDefects] = useState<any[]>([]);
  const [availableDefects, setAvailableDefects] = useState<any[]>([]);
  const [resultDefectLinks, setResultDefectLinks] = useState<any[]>([]);
  const [selectedDefectId, setSelectedDefectId] = useState('');
  const [linkType, setLinkType] = useState<DefectLinkType>('found');
  const [isLinkingDefect, setIsLinkingDefect] = useState(false);
  const [updatingDefectStatusId, setUpdatingDefectStatusId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isDefectDialogOpen, setIsDefectDialogOpen] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [defectTouchedFields, setDefectTouchedFields] = useState<Record<string, boolean>>({});
  const defectTitleInputRef = useRef<HTMLInputElement>(null);
  const [newDefect, setNewDefect] = useState<NewDefectDraft>({
    title: '', description: '', severity: 'medium', priority: 'high',
  });
  const hasUnsavedChanges = newDefect.title.trim() !== '' || newDefect.description.trim() !== '';

  // --- Timer ---
  const [manualTimeAdjustment, setManualTimeAdjustment] = useState(0);
  const [executionStartedAt, setExecutionStartedAt] = useState<string | null>(null);
  const executionStartedAtRef = useRef<string | null>(null);
  const setExecutionStart = useCallback((startedAt: string | null) => {
    executionStartedAtRef.current = startedAt;
    setExecutionStartedAt(startedAt);
  }, []);
  // Fingerprint of the last loaded/saved form state for unsaved-change detection.
  const savedSnapshotRef = useRef<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Wall-clock baseline so the timer stays accurate even when background tabs
  // throttle setInterval. Every external change goes through rebaseTimer.
  const timerBaselineRef = useRef<{ seconds: number; atMs: number }>({ seconds: 0, atMs: Date.now() });
  const rebaseTimer = useCallback((seconds: number) => {
    const safe = Math.max(0, Number.isFinite(seconds) ? Math.round(seconds) : 0);
    timerBaselineRef.current = { seconds: safe, atMs: Date.now() };
    setElapsedSeconds(safe);
  }, []);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<string | null>(null);
  const [totalPausedTime, setTotalPausedTime] = useState(0);
  const [executionState, setExecutionState] = useState<ExecutionPhase>('idle');
  // Live elapsed value read straight off the wall-clock baseline so callers
  // (save, pause, add-time) never use a value that's up to a second stale.
  const computeElapsed = useCallback(() => {
    if (executionState === 'running' && !isPaused && executionStartedAtRef.current) {
      const { seconds, atMs } = timerBaselineRef.current;
      return Math.max(0, Math.round(seconds + (Date.now() - atMs) / 1000));
    }
    return elapsedSeconds;
  }, [executionState, isPaused, elapsedSeconds]);
  const [manualTimeEntry, setManualTimeEntry] = useState('');
  const [showManualTimeDialog, setShowManualTimeDialog] = useState(false);
  const [showResetTimerDialog, setShowResetTimerDialog] = useState(false);

  // --- Page data ---
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false); // re-entry guard against double-submit
  const [loadError, setLoadError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [allTestCases, setAllTestCases] = useState<any[]>([]);
  const [testCase, setTestCase] = useState<any>(null);
  const [testSteps, setTestSteps] = useState<TestStep[]>([]);
  const [testStepsLoadError, setTestStepsLoadError] = useState(false);
  const [testRun, setTestRun] = useState<any>(null);
  const [executionHistory, setExecutionHistory] = useState<any[]>([]);
  const [historyLoadError, setHistoryLoadError] = useState(false);

  // --- Data-driven iterations ---
  const [dataset, setDataset] = useState<TestDataset | null>(null);
  const [activeIteration, setActiveIteration] = useState(0);
  const [iterationStatuses, setIterationStatuses] = useState<IterationStatusMap>({});
  const [globalParams, setGlobalParams] = useState<GlobalParameter[]>([]);

  // --- Per-step outcomes (multistep cases) ---
  const [stepStatuses, setStepStatuses] = useState<Record<number, ExecutionStatus>>({});
  const savedStepSnapshotRef = useRef<string | null>(null);
  const setStepStatus = (stepNumber: number, status: ExecutionStatus) =>
    setStepStatuses((prev) => {
      // Clicking the active outcome again clears it back to pending.
      if (prev[stepNumber] === status) {
        const next = { ...prev };
        delete next[stepNumber];
        return next;
      }
      return { ...prev, [stepNumber]: status };
    });

  const createExecutionDefectId = () => {
    const numericProjectId = Number(projectId);
    const prefix = `P${Number.isFinite(numericProjectId) ? numericProjectId : 'X'}-DEF-`;
    const projectDefects = availableDefects.length > 0 ? availableDefects : defects;
    const highest = projectDefects.reduce((max, defect) => {
      const rawId = String(defect?.defect_id || '');
      if (!rawId.startsWith(prefix)) return max;
      const suffix = Number(rawId.slice(prefix.length));
      return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
    }, 0);
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  };

  const restoreTimingFromResult = useCallback((result: any) => {
    // execution_time already includes manual_time_adjustment from the backend.
    const totalTime = result?.execution_time || 0;
    const manualAdjustment = result?.manual_time_adjustment || 0;
    const totalPaused = result?.total_paused_time || 0;
    const startedAt = result?.execution_started_at || null;

    setExecutionStart(startedAt || new Date().toISOString());

    // Backend doesn't recompute execution_time while "running" — project to now
    // so a freshly-loaded running timer doesn't snap forward on the next save.
    const isRunningOnServer = result?.execution_state === 'running';
    const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
    let baseline = totalTime;
    if (isRunningOnServer && Number.isFinite(startedAtMs)) {
      const projected = Math.max(0, (Date.now() - startedAtMs) / 1000 - totalPaused + manualAdjustment);
      baseline = Math.max(totalTime, projected);
    }
    rebaseTimer(baseline);
    setManualTimeAdjustment(manualAdjustment);
    setTotalPausedTime(totalPaused);
  }, [rebaseTimer, setExecutionStart]);

  // Tick the timer from wall-clock + baseline while running.
  useEffect(() => {
    if (!executionStartedAt || isPaused || executionState !== 'running') return;
    const tick = () => {
      const { seconds, atMs } = timerBaselineRef.current;
      setElapsedSeconds(Math.max(0, Math.round(seconds + (Date.now() - atMs) / 1000)));
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [executionStartedAt, isPaused, executionState]);

  // When completed, load the backend's final execution time (incl. adjustments).
  useEffect(() => {
    if (executionState !== 'completed' || !testRunId || !testCaseId || runLoading || tcLoading) return;
    (async () => {
      try {
        const results = await testResultsAPI.getAll(runGlobalId, tcGlobalId);
        if (results.length > 0) {
          rebaseTimer(results[0].execution_time || 0);
          setManualTimeAdjustment(results[0].manual_time_adjustment || 0);
        }
      } catch (error) {
        console.error('Failed to load final execution time:', error);
      }
    })();
  }, [executionState, testRunId, testCaseId, rebaseTimer, runGlobalId, tcGlobalId, runLoading, tcLoading]);

  // Load test case + run + steps + history. The `cancelled` guard prevents a
  // slow response for a previous case from overwriting the current one when the
  // tester pages quickly through prev/next.
  useEffect(() => {
    let cancelled = false;
    const loadTestData = async () => {
      if (runLoading || tcLoading) return;  // wait for the seq -> id resolution
      if (!projectId || !testRunId || !testCaseId) {
        setLoadError(t('failedToLoadTestCaseOrTestRun'));
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setLoadError(null);

        const currentProjectId = parseInt(projectId);
        const currentTestRunId = runGlobalId;
        const currentTestCaseId = tcGlobalId;
        if ([currentProjectId, currentTestRunId, currentTestCaseId].some(Number.isNaN)) {
          setLoadError(t('failedToLoadTestCaseOrTestRun'));
          return;
        }

        const [caseData, runData, runCaseResults] = await Promise.all([
          testCasesAPI.getById(currentTestCaseId),
          testRunsAPI.getById(currentTestRunId),
          testResultsAPI.getAll(currentTestRunId, currentTestCaseId),
        ]);
        if (cancelled) return;

        const runProjectId = Number(runData.project_id);
        const testCaseProjectId = caseData.project_id == null ? null : Number(caseData.project_id);
        const isTestCaseInRun = runCaseResults.some((r: any) =>
          Number(r.test_run_id) === currentTestRunId && Number(r.test_case_id) === currentTestCaseId);

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

        if (caseData.is_multistep) {
          try {
            const steps = await testCasesAPI.getSteps(currentTestCaseId);
            if (cancelled) return;
            setTestSteps(steps);
            setTestStepsLoadError(false);
          } catch (stepsError) {
            if (cancelled) return;
            console.error('Failed to fetch test steps:', stepsError);
            setTestSteps([]);
            setTestStepsLoadError(true);
          }
        } else {
          setTestSteps([]);
          setTestStepsLoadError(false);
        }

        try {
          if (!currentTestCaseId || Number.isNaN(currentTestCaseId)) {
            setExecutionHistory([]);
            setHistoryLoadError(false);
            return;
          }
          const history = await testCasesAPI.getExecutionHistory(currentTestCaseId, 50);
          if (cancelled) return;
          setExecutionHistory(history);
          setHistoryLoadError(false);
        } catch (historyError) {
          if (cancelled) return;
          console.error('Failed to load execution history:', historyError);
          setHistoryLoadError(true);
          setExecutionHistory([]);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load test data:', error);
        setLoadError(t('failedToLoadTestCaseOrTestRun'));
        toast({ title: t('error'), description: t('failedToLoadTestCaseOrTestRun'), variant: 'destructive' });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    loadTestData();
    return () => { cancelled = true; };
  }, [projectId, testCaseId, testRunId, runGlobalId, tcGlobalId, runLoading, tcLoading]);

  // Auto-focus the defect title when the dialog opens.
  useEffect(() => {
    if (isDefectDialogOpen) {
      const id = setTimeout(() => defectTitleInputRef.current?.focus(), 100);
      return () => clearTimeout(id);
    }
  }, [isDefectDialogOpen]);

  // Load users + the test cases in this run (for navigation). Uses a functional
  // default for assignee so it never clobbers a value set elsewhere and doesn't
  // need `assignee` in its deps (which would refetch on every keystroke).
  useEffect(() => {
    let cancelled = false;
    const loadInitialData = async () => {
      try {
        const allUsers = await usersAPI.getAll();
        if (cancelled) return;
        setUsers(allUsers);
        if (currentUser) setAssignee((prev) => prev || currentUser.id.toString());
        if (testRunId) {
          const results = await testResultsAPI.getAll(runGlobalId);
          if (cancelled) return;
          setAllTestCases(results.map((r: any) => ({
            id: r.test_case_id,
            title: r.test_case?.title || `Test Case ${r.test_case_id}`,
          })));
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load initial data:', error);
        if (currentUser) {
          setUsers([currentUser]);
          setAssignee((prev) => prev || currentUser.id.toString());
        }
      }
    };
    loadInitialData();
    return () => { cancelled = true; };
  }, [testRunId, currentUser]);

  // Load any existing execution result for this case in this run.
  useEffect(() => {
    let cancelled = false;
    const loadExistingExecution = async () => {
      if (!testRunId || !testCaseId) return;
      if (runLoading || tcLoading) return; // wait for the seq -> global id resolution
      setIsLoading(true);
      try {
        const results = await testResultsAPI.getAll(runGlobalId, tcGlobalId);
        if (cancelled) return;
        // Transient defect-context inputs aren't persisted on the result, so clear
        // them on every case load — otherwise a failing-step pick from the previous
        // case leaks into the next one after Save & Next.
        setSelectedFailureStepNumber('');
        setFailureStepActual('');
        if (results.length > 0) {
          const result = results[0];
          setExecutionStatus(BACKEND_TO_STATUS[result.status] || 'pending');
          setExecutionNotes(result.actual_result || result.comments || '');
          setExecutionLogs(result.logs || '');
          setTestResultId(result.id ?? null);
          setDefectLink(result.defect_link || '');
          setCustomLink(result.custom_link || '');
          setBlockerReason(result.blocker_reason || '');
          setRetestNeeded(Boolean(result.retest_needed));
          const loadedAssignee = result.executed_by?.toString()
            || testRun?.assigned_to?.toString()
            || currentUser?.id?.toString()
            || '';
          setAssignee(loadedAssignee);
          savedSnapshotRef.current = snapshotOf({
            status: BACKEND_TO_STATUS[result.status] || 'pending',
            notes: result.actual_result || result.comments || '',
            logs: result.logs || '',
            defectLink: result.defect_link || '',
            customLink: result.custom_link || '',
            blockerReason: result.blocker_reason || '',
            assignee: loadedAssignee,
          });
          restoreTimingFromResult(result);

          const backendState = result.execution_state as ExecutionPhase | undefined;
          if (backendState) {
            setExecutionState(backendState);
            setIsPaused(backendState === 'paused');
            if (backendState === 'paused') setPausedAt(result.paused_at);
          } else if (isCompletedResultStatus(result.status)) {
            setExecutionState('completed');
            setIsPaused(true);
          } else {
            setExecutionState('idle');
            setIsPaused(false);
          }
        } else {
          // No result yet for this case — reset everything so values from a
          // previously-viewed case don't leak in after prev/next navigation.
          setExecutionStatus('pending');
          setExecutionNotes('');
          setExecutionLogs('');
          setDefectLink('');
          setCustomLink('');
          setBlockerReason('');
          const defaultAssignee = testRun?.assigned_to?.toString() || currentUser?.id?.toString() || '';
          setAssignee(defaultAssignee);
          savedSnapshotRef.current = snapshotOf({
            status: 'pending', notes: '', logs: '', defectLink: '', customLink: '', blockerReason: '', assignee: defaultAssignee,
          });
          setExecutionState('idle');
          setIsPaused(false);
          setPausedAt(null);
          setTestResultId(null);
          setRetestNeeded(false);
          rebaseTimer(0);
          setManualTimeAdjustment(0);
          setTotalPausedTime(0);
          setExecutionStart(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    loadExistingExecution();
    return () => { cancelled = true; };
  }, [testRunId, testCaseId, runGlobalId, tcGlobalId, runLoading, tcLoading, testRun?.assigned_to, currentUser?.id, restoreTimingFromResult]);

  // Load per-step outcomes for the current result (multistep cases only).
  useEffect(() => {
    if (!testResultId || testSteps.length === 0) {
      setStepStatuses({});
      savedStepSnapshotRef.current = serializeStepMap(testSteps, {});
      return;
    }
    let cancelled = false;
    testResultsAPI.getStepResults(testResultId)
      .then((rows: any[]) => {
        if (cancelled) return;
        const next: Record<number, ExecutionStatus> = {};
        for (const r of rows || []) {
          if (typeof r?.step_number === 'number') next[r.step_number] = BACKEND_STEP_TO_STATUS[r.step_status] || 'pending';
        }
        setStepStatuses(next);
        savedStepSnapshotRef.current = serializeStepMap(testSteps, next);
      })
      .catch(() => {
        if (cancelled) return;
        setStepStatuses({});
        savedStepSnapshotRef.current = serializeStepMap(testSteps, {});
      });
    return () => { cancelled = true; };
  }, [testResultId, testSteps]);

  // Load defects for this project / test case.
  useEffect(() => {
    let cancelled = false;
    const loadExistingDefects = async () => {
      if (!projectId || !testCaseId) return;
      try {
        const allDefects = await defectsAPI.getAll(parseInt(projectId));
        if (cancelled) return;
        setAvailableDefects(Array.isArray(allDefects) ? allDefects : []);
        const currentTestCaseId = tcGlobalId;
        const currentTestRunId = runGlobalId;
        setDefects(allDefects.filter((defect: any) => {
          const linkedTestCaseId = Number(defect.test_case_id);
          const linkedTestRunId = defect.test_run_id == null ? null : Number(defect.test_run_id);
          return linkedTestCaseId === currentTestCaseId && (linkedTestRunId === null || linkedTestRunId === currentTestRunId);
        }));
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load existing defects:', error);
        setDefects([]);
        setAvailableDefects([]);
      }
    };
    loadExistingDefects();
    return () => { cancelled = true; };
  }, [projectId, testCaseId, testRunId, tcGlobalId, runGlobalId]);

  const loadResultDefectLinks = useCallback(async (resultId: number | null) => {
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
  }, []);

  useEffect(() => { loadResultDefectLinks(testResultId); }, [testResultId, loadResultDefectLinks]);

  // --- Case-level parameterization ---
  const datasetId = testCase?.dataset_id ?? null;
  useEffect(() => {
    if (!datasetId) {
      setDataset(null);
      setActiveIteration(0);
      return;
    }
    let cancelled = false;
    datasetsAPI.get(datasetId)
      .then((ds) => { if (!cancelled) { setDataset(ds); setActiveIteration(0); } })
      .catch(() => { if (!cancelled) setDataset(null); });
    return () => { cancelled = true; };
  }, [datasetId]);

  useEffect(() => {
    const numericProjectId = Number(projectId);
    if (!Number.isFinite(numericProjectId)) {
      setGlobalParams([]);
      return;
    }
    let cancelled = false;
    loadProjectParameters(numericProjectId)
      .then((rows) => { if (!cancelled) setGlobalParams(rows); })
      .catch(() => { if (!cancelled) setGlobalParams([]); });
    return () => { cancelled = true; };
  }, [projectId]);

  const globalMap = useMemo(() => paramsToMap(globalParams), [globalParams]);
  const hasIterations = !!dataset && Array.isArray(dataset.rows) && dataset.rows.length > 0;
  const activeRow = hasIterations ? (dataset!.rows[activeIteration] || {}) : null;
  const resolveGlobals = (text: string | null | undefined): string => resolveParameters(text, globalMap);
  const substitute = (text: string | null | undefined): string =>
    resolveParameters(text, activeRow ? { ...globalMap, ...activeRow } : globalMap);

  const derivedIterationStatus = useMemo<ExecutionStatus | null>(() => {
    if (!hasIterations) return null;
    const statuses = dataset!.rows.map((_, i) => iterationStatuses[i] || 'pending');
    if (statuses.includes('failed')) return 'failed';
    if (statuses.includes('blocked')) return 'blocked';
    if (statuses.some((s) => s === 'pending')) return 'pending';
    return 'passed';
  }, [hasIterations, dataset, iterationStatuses]);

  useEffect(() => {
    if (hasIterations && derivedIterationStatus) setExecutionStatus(derivedIterationStatus);
  }, [hasIterations, derivedIterationStatus]);

  // Restore prior per-iteration outcomes.
  useEffect(() => {
    if (!testResultId || !hasIterations) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await testResultsAPI.getById(testResultId);
        if (cancelled || !result?.iteration_results) return;
        const next: IterationStatusMap = {};
        for (const it of result.iteration_results) {
          if (typeof it?.row_index === 'number') next[it.row_index] = BACKEND_TO_STATUS[it.status] || 'pending';
        }
        setIterationStatuses(next);
      } catch {
        /* prior iteration outcomes are best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [testResultId, hasIterations]);

  // Project defect-on-failure policy.
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

  // Default the defect link type to match the execution status.
  useEffect(() => {
    if (executionStatus === 'blocked') {
      setLinkType('blocked_by');
    } else if (executionStatus === 'failed') {
      setLinkType('found');
    } else {
      setSelectedFailureStepNumber('');
      setFailureStepActual('');
    }
  }, [executionStatus]);

  // --- Navigation derived state ---
  const currentIndex = allTestCases.findIndex((tc) => tc.id.toString() === testCaseId?.toString());
  const hasNext = currentIndex >= 0 && currentIndex < allTestCases.length - 1;
  const hasPrevious = currentIndex > 0;

  const isFailedOrBlockedStatus = executionStatus === 'failed' || executionStatus === 'blocked';
  const selectedFailureStep = testSteps.find((step) => String(step.step_number) === selectedFailureStepNumber);

  // Whether the current user may record results (viewers are read-only).
  const canWrite = canWriteResults(currentUser);

  // --- Unsaved-change detection ---
  const formDirty = savedSnapshotRef.current !== null
    && snapshotOf({
      status: executionStatus, notes: executionNotes, logs: executionLogs,
      defectLink, customLink, blockerReason, assignee,
    }) !== savedSnapshotRef.current;
  const stepsDirty = testSteps.length > 0
    && savedStepSnapshotRef.current !== null
    && serializeStepMap(testSteps, stepStatuses) !== savedStepSnapshotRef.current;
  // A timer started before the first save lives only in memory.
  const timerUnsaved = !testResultId && (executionState === 'running' || elapsedSeconds > 0);
  const isDirty = !isLoading && (formDirty || stepsDirty);

  // Warn before a full page unload (refresh / tab close) if there are edits or a
  // running timer that haven't been recorded. In-app navigation is guarded
  // separately via the discard dialog below.
  useEffect(() => {
    if (!isDirty && !timerUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, timerUnsaved]);

  // In-app navigation guard. A React dialog can't return synchronously, so we
  // defer the pending navigation and run it once the user confirms.
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const pendingNavRef = useRef<(() => void) | null>(null);
  const guardedNavigate = useCallback((action: () => void) => {
    if (!isDirty && !timerUnsaved) { action(); return; }
    pendingNavRef.current = action;
    setShowDiscardDialog(true);
  }, [isDirty, timerUnsaved]);
  const confirmDiscardLeave = useCallback(() => {
    const action = pendingNavRef.current;
    pendingNavRef.current = null;
    setShowDiscardDialog(false);
    action?.();
  }, []);
  const cancelDiscard = useCallback(() => {
    pendingNavRef.current = null;
    setShowDiscardDialog(false);
  }, []);

  // --- History grouping ---
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
        .filter(Boolean),
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
    guardedNavigate(() => navigate(`/projects/${projectId}/test-runs/${runId}/test-cases/${testCaseId}`));
  };

  const refreshHistory = useCallback(async () => {
    if (!testCaseId || !tcGlobalId || Number.isNaN(tcGlobalId)) return;
    try {
      setExecutionHistory(await testCasesAPI.getExecutionHistory(tcGlobalId, 50));
      setHistoryLoadError(false);
    } catch (error) {
      console.error('Failed to refresh execution history:', error);
    }
  }, [testCaseId, tcGlobalId]);

  // --- Save execution ---
  const handleSaveExecution = useCallback(async (): Promise<boolean> => {
    if (!testRunId || !testCaseId) {
      toast({ title: t('error'), description: t('failedToLoadTestCaseOrTestRun'), variant: 'destructive' });
      return false;
    }
    if (executionStatus === 'pending') {
      toast({
        title: t('validationError'),
        description: hasIterations ? t('completeIterationsBeforeSaving') : t('selectStatusBeforeSaving'),
        variant: 'destructive',
      });
      return false;
    }

    const isFailedOrBlocked = executionStatus === 'failed' || executionStatus === 'blocked';
    if (!isValidHttpUrl(defectLink) || !isValidHttpUrl(customLink)) {
      toast({ title: t('invalidUrl'), description: t('invalidUrlDescription'), variant: 'destructive' });
      return false;
    }
    if (isFailedOrBlocked && requireDefectOnFailure) {
      const hasDefectEvidence = resultDefectLinks.length > 0 || defectLink.trim() !== '';
      if (!hasDefectEvidence) {
        toast({ title: t('defectRequired'), description: t('defectRequiredDescription'), variant: 'destructive' });
        return false;
      }
    }

    const startedAt = executionStartedAtRef.current || new Date().toISOString();
    const executionTimeSeconds = Math.max(0, computeElapsed());
    const iterationResultsPayload = hasIterations
      ? dataset!.rows.map((row, i) => ({
          row_index: i,
          values: row,
          status: STATUS_TO_BACKEND[iterationStatuses[i] || 'pending'] || 'skip',
        }))
      : null;

    // Recording a result completes the execution: stop the clock and persist the
    // full timing snapshot so reloads and analytics stay consistent.
    const executionData = {
      test_case_id: tcGlobalId,
      test_run_id: runGlobalId,
      status: STATUS_TO_BACKEND[executionStatus] || 'skip',
      actual_result: executionNotes,
      iteration_results: iterationResultsPayload,
      comments: executionNotes,
      execution_started_at: startedAt,
      execution_time: executionTimeSeconds,
      execution_state: 'completed',
      manual_time_adjustment: manualTimeAdjustment,
      total_paused_time: totalPausedTime,
      paused_at: null,
      executed_by: parseInt(assignee) || null,
      logs: executionLogs,
      defect_link: isFailedOrBlocked ? defectLink.trim() : '',
      custom_link: isFailedOrBlocked ? customLink.trim() : '',
      blocker_reason: executionStatus === 'blocked' ? (blockerReason || null) : null,
    };

    // Guard against double-submit (rapid clicks / Ctrl+S spam) creating
    // duplicate results.
    if (savingRef.current) return false;
    savingRef.current = true;
    setIsSaving(true);
    try {
      const existing = await testResultsAPI.getAll(runGlobalId, tcGlobalId);
      const savedResult = existing.length > 0
        ? await testResultsAPI.update(existing[0].id, executionData)
        : await testResultsAPI.create(executionData);

      if (savedResult?.id) {
        setTestResultId(savedResult.id);
        setRetestNeeded(Boolean(savedResult.retest_needed));
        await loadResultDefectLinks(savedResult.id);

        // Persist per-step outcomes for multistep cases.
        if (testSteps.length > 0) {
          const stepPayload = testSteps
            .filter((s) => ['passed', 'failed', 'blocked'].includes(stepStatuses[s.step_number]))
            .map((s) => ({
              step_number: s.step_number,
              step_name: (s.action || `Step ${s.step_number}`).slice(0, 500),
              step_status: stepStatuses[s.step_number],
              step_duration: 0,
            }));
          try {
            await testResultsAPI.saveStepResults(savedResult.id, stepPayload);
            savedStepSnapshotRef.current = serializeStepMap(testSteps, stepStatuses);
          } catch (stepError) {
            console.error('Failed to save step results:', stepError);
          }
        }
      }
      setExecutionStart(savedResult.execution_started_at || startedAt);
      rebaseTimer(savedResult.execution_time ?? executionTimeSeconds);
      setExecutionState('completed');
      setIsPaused(true);
      setPausedAt(null);
      savedSnapshotRef.current = snapshotOf({
        status: executionStatus, notes: executionNotes, logs: executionLogs,
        defectLink, customLink, blockerReason, assignee,
      });
      await refreshHistory();

      toast({ title: t('executionSaved'), description: t('executionSavedDescription'), variant: 'success' });
      return true;
    } catch (error) {
      console.error('Failed to save execution:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToSaveExecution')),
        variant: 'destructive',
      });
      return false;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [
    testRunId, testCaseId, executionStatus, defectLink, customLink, blockerReason, requireDefectOnFailure,
    resultDefectLinks.length, computeElapsed, manualTimeAdjustment, totalPausedTime,
    hasIterations, dataset, iterationStatuses, testSteps, stepStatuses,
    executionNotes, assignee, executionLogs, t, toast, loadResultDefectLinks, refreshHistory,
    rebaseTimer, setExecutionStart,
  ]);

  // --- Defect helpers ---
  const requireFailureStepSelection = () => {
    if (isFailedOrBlockedStatus && testStepsLoadError) {
      toast({ title: t('error'), description: t('testStepsLoadRequiredForDefect'), variant: 'destructive' });
      return false;
    }
    if (isFailedOrBlockedStatus && testSteps.length > 0 && !selectedFailureStep) {
      toast({ title: t('validationError'), description: t('selectFailingStepRequired'), variant: 'destructive' });
      return false;
    }
    return true;
  };

  const buildFailingStepPayload = () => {
    if (!isFailedOrBlockedStatus || !selectedFailureStep) return undefined;
    const actualResult = failureStepActual.trim() || executionNotes.trim();
    return {
      step_id: selectedFailureStep.id,
      step_number: selectedFailureStep.step_number,
      status: executionStatus,
      actual_result: actualResult || undefined,
      notes: executionNotes.trim() || undefined,
    };
  };

  const buildDefectContext = () => {
    const failingStepText = selectedFailureStep
      ? [
          `${t('failingStep')}: ${selectedFailureStep.step_number}`,
          `${t('action')}: ${selectedFailureStep.action}`,
          `${t('expectedResult')}: ${selectedFailureStep.expected_result}`,
          failureStepActual.trim() ? `${t('actualResultLabel')}: ${failureStepActual.trim()}` : '',
        ].filter(Boolean).join('\n')
      : '';
    const stepsText = testSteps.length > 0
      ? testSteps.map((step) => `${step.step_number}. ${step.action}`).join('\n')
      : (testCase?.steps || testCase?.test_steps || testCase?.preconditions || '');
    const expectedText = testSteps.length > 0
      ? testSteps.filter((step) => step.expected_result).map((step) => `${step.step_number}. ${step.expected_result}`).join('\n')
      : (testCase?.expected_result || testCase?.expected_results || '');
    const environment = testRun?.environment?.name || testRun?.environment_name || testRun?.environment || '';
    const context: Record<string, string> = {};
    if (stepsText || failingStepText) context.steps_to_reproduce = [failingStepText, stepsText].filter(Boolean).join('\n\n');
    if (expectedText) context.expected_result = String(expectedText);
    if (failureStepActual.trim() || executionNotes.trim()) context.actual_result = failureStepActual.trim() || executionNotes.trim();
    if (environment) context.environment = String(environment);
    return context;
  };

  const openDefectDialog = () => {
    if (!requireFailureStepSelection()) return;
    const tcPriority = String(testCase?.priority || '').toLowerCase();
    const severity = ['low', 'medium', 'high', 'critical'].includes(tcPriority) ? tcPriority : 'medium';
    const statusLabel = executionStatus === 'blocked' ? t('blocked') : t('failed');
    setNewDefect({
      title: testCase?.title ? `[${statusLabel}] ${testCase.title}` : '',
      description: selectedFailureStep
        ? `${t('failingStep')} ${selectedFailureStep.step_number}: ${selectedFailureStep.action}\n\n${failureStepActual.trim() || executionNotes.trim()}`
        : executionNotes.trim(),
      severity,
      priority: 'high',
    });
    setIsDefectDialogOpen(true);
  };

  const handleLinkExistingDefect = async () => {
    if (!selectedDefectId) return;
    if (!requireFailureStepSelection()) return;
    if (!testResultId) {
      toast({ title: t('error'), description: t('saveExecutionBeforeLinkingDefect'), variant: 'destructive' });
      return;
    }
    try {
      setIsLinkingDefect(true);
      await testResultsAPI.linkDefect(testResultId, {
        defect_id: parseInt(selectedDefectId),
        link_type: linkType,
        failing_step: buildFailingStepPayload(),
      });
      setSelectedDefectId('');
      await loadResultDefectLinks(testResultId);
      toast({ title: t('success'), description: t('defectLinkedSuccessfully') });
    } catch (error) {
      console.error('Failed to link defect:', error);
      toast({ title: t('error'), description: getApiErrorMessage(error, t('failedToLinkDefect')), variant: 'destructive' });
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
      toast({ title: t('error'), description: getApiErrorMessage(error, t('failedToUnlinkDefect')), variant: 'destructive' });
    }
  };

  const handleUpdateLinkedDefectStatus = async (defectId: number, status: string) => {
    try {
      setUpdatingDefectStatusId(defectId);
      await defectsAPI.update(defectId, { status });
      if (testResultId) await loadResultDefectLinks(testResultId);
      toast({ title: t('success'), description: t('defectStatusUpdated') });
    } catch (error) {
      console.error('Failed to update defect status:', error);
      toast({ title: t('error'), description: getApiErrorMessage(error, t('failedToUpdateDefect')), variant: 'destructive' });
    } finally {
      setUpdatingDefectStatusId(null);
    }
  };

  const handleCorrectLinkSnapshot = async (linkId: number) => {
    if (!testResultId) return;
    if (!requireFailureStepSelection()) return;
    try {
      await testResultsAPI.updateDefectLinkSnapshot(testResultId, linkId, {
        failing_step: buildFailingStepPayload(),
        clear_failing_step: isFailedOrBlockedStatus && !selectedFailureStep,
      });
      await loadResultDefectLinks(testResultId);
      toast({ title: t('success'), description: t('snapshotCorrectedSuccessfully') });
    } catch (error) {
      console.error('Failed to correct snapshot:', error);
      toast({ title: t('error'), description: getApiErrorMessage(error, t('failedToCorrectSnapshot')), variant: 'destructive' });
    }
  };

  const handleCreateDefect = async () => {
    const currentProjectId = Number(projectId);
    const currentTestRunId = Number(testRunId);
    const currentTestCaseId = Number(testCaseId);
    const trimmedTitle = newDefect.title.trim();

    if ([currentProjectId, currentTestRunId, currentTestCaseId].some((v) => !Number.isFinite(v) || v <= 0)) {
      toast({ title: t('error'), description: t('failedToCreateDefect'), variant: 'destructive' });
      return;
    }
    if (!testResultId) {
      toast({ title: t('error'), description: t('saveExecutionBeforeLinkingDefect'), variant: 'destructive' });
      return;
    }
    if (!requireFailureStepSelection()) return;
    if (!trimmedTitle) {
      toast({ title: t('validationError'), description: t('defectTitleRequired'), variant: 'destructive' });
      return;
    }
    if (defects.some((d) => String(d.title || '').toLowerCase().trim() === trimmedTitle.toLowerCase())) {
      toast({ title: t('duplicateDefect'), description: t('defectWithThisTitleAlreadyExists'), variant: 'destructive' });
      return;
    }

    try {
      setIsCreating(true);
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
      const link = await testResultsAPI.linkDefect(testResultId, {
        new_defect: defectData,
        link_type: linkType,
        failing_step: buildFailingStepPayload(),
      });
      const createdDefect: any = link?.defect || null;
      await loadResultDefectLinks(testResultId);
      if (createdDefect) {
        setDefects((prev) => [createdDefect, ...prev]);
        setAvailableDefects((prev) => [createdDefect, ...prev]);
      }
      setNewDefect({ title: '', description: '', severity: 'medium', priority: 'high' });
      setIsDefectDialogOpen(false);
      toast({ title: t('success'), description: t('defectReportedSuccessfully') });
    } catch (error) {
      console.error('Failed to create defect:', error);
      toast({ title: t('error'), description: getApiErrorMessage(error, t('failedToCreateDefect')), variant: 'destructive' });
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

  // --- Navigation handlers (guarded against discarding unsaved work) ---
  const handleEditTestCase = () => guardedNavigate(() => navigate(`/projects/${projectId}/test-cases/${testCaseId}/edit`));
  const openTestCase = () => guardedNavigate(() => navigate(`/projects/${projectId}/test-cases/${testCaseId}`));
  const backToTestRun = () => guardedNavigate(() => navigate(`/projects/${projectId}/test-runs/${testRunId}`));
  const backToTestRuns = () => guardedNavigate(() => navigate(`/projects/${projectId}/test-runs`));

  // Resolve the adjacent case ids once so both the guarded (manual nav) and
  // unguarded (post-save nav) paths share the same target.
  const nextCaseId = hasNext && currentIndex >= 0 ? allTestCases[currentIndex + 1]?.id : undefined;
  const prevCaseId = hasPrevious && currentIndex >= 0 ? allTestCases[currentIndex - 1]?.id : undefined;
  const navigateToCase = (caseId: number) =>
    navigate(`/projects/${projectId}/test-runs/${testRunId}/test-cases/${caseId}`);

  const handleNextTestCase = () => {
    if (nextCaseId != null) guardedNavigate(() => navigateToCase(nextCaseId));
  };
  const handlePreviousTestCase = () => {
    if (prevCaseId != null) guardedNavigate(() => navigateToCase(prevCaseId));
  };
  // Save & Next/Previous already persisted the result, so navigate directly —
  // routing through the guard would trip the (now stale) dirty check and pop the
  // discard dialog even though there's nothing left to discard.
  const handleSaveAndNext = async () => {
    if (await handleSaveExecution() && nextCaseId != null) navigateToCase(nextCaseId);
  };
  const handleSaveAndPrevious = async () => {
    if (await handleSaveExecution() && prevCaseId != null) navigateToCase(prevCaseId);
  };

  // --- Timer handlers ---
  // The timer is client-authoritative: elapsed is derived from a wall-clock
  // baseline and every control updates it instantly, then persists in the
  // background when a result row exists. This makes the timer usable before the
  // first save and keeps the display from ever "snapping" to a server value.
  // Best-effort background persistence of timing fields.
  const persistTiming = useCallback((patch: Record<string, unknown>) => {
    if (!testResultId) return;
    testResultsAPI.update(testResultId, patch).catch((error) => {
      console.error('Failed to persist timing:', error);
    });
  }, [testResultId]);

  const handleStartTimer = () => {
    const now = new Date().toISOString();
    setExecutionStart(now);
    rebaseTimer(elapsedSeconds); // continue from current value (usually 0)
    setIsPaused(false);
    setExecutionState('running');
    persistTiming({ execution_started_at: now, execution_state: 'running', execution_time: elapsedSeconds });
  };

  const handlePauseExecution = () => {
    const currentlyPaused = executionState === 'paused';
    const elapsed = computeElapsed();
    rebaseTimer(elapsed); // freeze (pause) or restart wall clock from here (resume)

    if (currentlyPaused) {
      setIsPaused(false);
      setPausedAt(null);
      setExecutionState('running');
      persistTiming({ execution_state: 'running', paused_at: null, execution_time: elapsed });
    } else {
      const now = new Date().toISOString();
      setIsPaused(true);
      setPausedAt(now);
      setExecutionState('paused');
      persistTiming({ execution_state: 'paused', paused_at: now, execution_time: elapsed });
    }
    toast({
      title: currentlyPaused ? t('executionResumed') : t('executionPaused'),
      description: currentlyPaused ? t('executionResumedDescription') : t('executionPausedDescription'),
      variant: 'success',
    });
  };

  const handleManualTimeEntry = () => {
    const hours = parseFloat(manualTimeEntry) || 0;
    if (hours <= 0 || hours > 24) {
      toast({ title: t('invalidInput'), description: t('manualTimeRange'), variant: 'destructive' });
      return;
    }
    const addSeconds = Math.round(hours * 3600);
    const newManual = manualTimeAdjustment + addSeconds;
    const newElapsed = computeElapsed() + addSeconds;
    setManualTimeAdjustment(newManual);
    rebaseTimer(newElapsed); // keeps counting if running, stays put if paused
    setManualTimeEntry('');
    setShowManualTimeDialog(false);
    persistTiming({ execution_time: newElapsed, manual_time_adjustment: newManual });
    toast({ title: t('timeAdded'), description: t('timeAddedDescription', { hours: hours.toFixed(1) }), variant: 'success' });
  };

  const handleResetTimer = () => setShowResetTimerDialog(true);

  const handleConfirmResetTimer = async () => {
    // Reset the visible timer immediately, then clear the server copy if present.
    rebaseTimer(0);
    setTotalPausedTime(0);
    setPausedAt(null);
    setManualTimeAdjustment(0);
    setExecutionStart(null);
    setExecutionState('idle');
    setIsPaused(false);
    setShowResetTimerDialog(false);
    if (testResultId) {
      try {
        await testResultsAPI.resetTime(testResultId);
      } catch (error) {
        console.error('Failed to reset test result time:', error);
        toast({ title: t('error'), description: t('failedToResetTimer'), variant: 'destructive' });
        return;
      }
    }
    toast({ title: t('timerReset'), description: t('timerResetDescription'), variant: 'success' });
  };

  const handleDefectDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateDefect();
    }
  };

  // Page-level keyboard shortcuts: P/F/B record an outcome, Ctrl/⌘+S saves,
  // Alt+Arrows page through cases. Disabled while typing or with a dialog open.
  const anyDialogOpen = isDefectDialogOpen || showManualTimeDialog || showResetTimerDialog || showUnsavedDialog;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A dialog owns its own keys (e.g. defect dialog's Ctrl+Enter); don't let
      // page shortcuts — including Ctrl/⌘+S — fire behind it.
      if (anyDialogOpen) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;

      // Save works even while typing in the notes/logs fields.
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSaveExecution();
        return;
      }
      if (isTyping || e.ctrlKey || e.metaKey) return;

      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); handleNextTestCase(); return; }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); handlePreviousTestCase(); return; }
      if (e.altKey) return;

      if (!hasIterations) {
        const k = e.key.toLowerCase();
        if (k === 'p' || k === 'f' || k === 'b' || k === 's') {
          e.preventDefault();
          setExecutionStatus(k === 'p' ? 'passed' : k === 'f' ? 'failed' : k === 'b' ? 'blocked' : 'skipped');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyDialogOpen, hasIterations, handleSaveExecution, handleNextTestCase, handlePreviousTestCase]);

  return {
    // routing / i18n
    projectId, testRunId, testCaseId, isRTL, t, currentUser,
    // status & form
    executionStatus, setExecutionStatus,
    executionNotes, setExecutionNotes,
    executionLogs, setExecutionLogs,
    assignee, setAssignee,
    defectLink, setDefectLink,
    customLink, setCustomLink,
    blockerReason, setBlockerReason,
    selectedFailureStepNumber, setSelectedFailureStepNumber,
    failureStepActual, setFailureStepActual,
    requireDefectOnFailure, retestNeeded,
    isFailedOrBlockedStatus, selectedFailureStep,
    canWrite,
    // page data
    isLoading, isSaving, isDirty, loadError, users, allTestCases, testCase, testSteps, testStepsLoadError,
    testRun, executionHistory, historyLoadError,
    // iterations
    dataset, hasIterations, activeRow, activeIteration, setActiveIteration,
    iterationStatuses, setIterationStatuses, globalParams,
    resolveGlobals, substitute,
    // per-step outcomes
    stepStatuses, setStepStatus,
    // navigation
    currentIndex, hasNext, hasPrevious,
    handleNextTestCase, handlePreviousTestCase, handleSaveAndNext, handleSaveAndPrevious,
    handleEditTestCase, openTestCase, backToTestRun, backToTestRuns, openRunExecution,
    // history
    historyByRun, historySummary,
    // timer
    elapsedSeconds, executionStartedAt, executionState, isPaused, manualTimeAdjustment,
    manualTimeEntry, setManualTimeEntry,
    showManualTimeDialog, setShowManualTimeDialog,
    showResetTimerDialog, setShowResetTimerDialog,
    handleStartTimer, handlePauseExecution, handleManualTimeEntry, handleResetTimer, handleConfirmResetTimer,
    // save
    handleSaveExecution,
    // defects
    defects, availableDefects, resultDefectLinks, selectedDefectId, setSelectedDefectId,
    linkType, setLinkType, isLinkingDefect, isCreating,
    isDefectDialogOpen, setIsDefectDialogOpen,
    showUnsavedDialog, setShowUnsavedDialog,
    // discard-changes navigation dialog
    showDiscardDialog, confirmDiscardLeave, cancelDiscard,
    defectTouchedFields, setDefectTouchedFields,
    defectTitleInputRef, newDefect, setNewDefect, hasUnsavedChanges,
    openDefectDialog, handleLinkExistingDefect, linkTypeLabel,
    handleUnlinkDefect, handleCorrectLinkSnapshot, handleCreateDefect,
    updatingDefectStatusId, handleUpdateLinkedDefectStatus,
    handleDialogClose, handleUnsavedConfirm, handleDefectDialogKeyDown,
  };
}

export type ExecutionController = ReturnType<typeof useTestCaseExecution>;
