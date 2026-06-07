import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Play, Plus, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { testCasesAPI, testResultsAPI, testRunsAPI } from '@/lib/api';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';

type CandidateRun = {
  id: number;
  name: string;
  status: string;
  hasCase: boolean;
};

export function TestCaseExecute() {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  // The URL carries the per-project sequence; resolve it to the global test-case id.
  const { id: resolvedTcId, loading: tcIdLoading } = useResolvedEntityId(projectId, 'test-cases', id);
  const navigate = useNavigate();
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [testCase, setTestCase] = useState<any>(null);
  const [resolvedProjectId, setResolvedProjectId] = useState<number | null>(null);
  const [candidateRuns, setCandidateRuns] = useState<CandidateRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [newRunName, setNewRunName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadContext = async () => {
      setLoading(true);
      setError(null);

      if (tcIdLoading) return;  // wait for the seq -> id resolution
      const testCaseId = resolvedTcId;
      const routeProjectId = projectId ? Number(projectId) : null;

      if (!testCaseId || Number.isNaN(testCaseId)) {
        setError(t('invalidTestCaseId'));
        setLoading(false);
        return;
      }

      try {
        const caseData = await testCasesAPI.getById(testCaseId);
        const finalProjectId = routeProjectId && !Number.isNaN(routeProjectId)
          ? routeProjectId
          : Number(caseData.project_id);

        if (!finalProjectId || Number.isNaN(finalProjectId)) {
          throw new Error('missing_project_id');
        }

        const [runs, caseResults] = await Promise.all([
          testRunsAPI.getAll(finalProjectId, 0, 100),
          testResultsAPI.getAll(undefined, testCaseId, 0, 500).catch(() => []),
        ]);
        const runIdsContainingCase = new Set(
          caseResults.map((result: any) => Number(result.test_run_id))
        );
        const runChecks = runs.map((run: any) => ({
          id: run.id,
          name: run.name,
          status: run.status,
          hasCase: runIdsContainingCase.has(Number(run.id)),
        } as CandidateRun));

        const prioritizedRuns = runChecks.sort((a, b) => Number(b.hasCase) - Number(a.hasCase));
        const defaultRun = prioritizedRuns.find((run) => run.hasCase) ?? prioritizedRuns[0];

        if (!isMounted) return;
        setTestCase(caseData);
        setResolvedProjectId(finalProjectId);
        setCandidateRuns(prioritizedRuns);
        setSelectedRunId(defaultRun ? String(defaultRun.id) : '');
        setNewRunName(t('quickExecutionRunName', { title: caseData.title }));
      } catch (loadError) {
        console.error('Failed to load execute context:', loadError);
        if (!isMounted) return;
        setError(t('failedToPrepareExecutionFlow'));
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadContext();

    return () => {
      isMounted = false;
    };
  }, [id, projectId, language, resolvedTcId, tcIdLoading]);

  const selectedRun = useMemo(
    () => candidateRuns.find((run) => String(run.id) === selectedRunId) ?? null,
    [candidateRuns, selectedRunId]
  );

  const goBackToCase = () => {
    if (!id) return;
    if (resolvedProjectId) {
      navigate(`/projects/${resolvedProjectId}/test-cases/${id}`);
      return;
    }
    navigate(`/test-cases/${id}`);
  };

  const ensureCaseInRunAndNavigate = async (runId: number) => {
    if (!id || !resolvedProjectId) return;

    const testCaseId = resolvedTcId;
    const existingResults = await testResultsAPI.getAll(runId, testCaseId, 0, 1);

    if (existingResults.length === 0) {
      await testResultsAPI.create({
        test_run_id: runId,
        test_case_id: testCaseId,
        status: 'pending',
        actual_result: '',
        comments: '',
      });
    }

    navigate(`/projects/${resolvedProjectId}/test-runs/${runId}/test-cases/${testCaseId}`);
  };

  const handleStartInSelectedRun = async () => {
    if (!selectedRunId) {
      toast({
        title: t('warning'),
        description: t('selectTestRunToContinue'),
        variant: 'destructive',
      });
      return;
    }

    setStarting(true);
    try {
      await ensureCaseInRunAndNavigate(Number(selectedRunId));
    } catch (startError) {
      console.error('Failed to start execution in selected run:', startError);
      toast({
        title: t('error'),
        description: t('failedToStartExecutionInTestRun'),
        variant: 'destructive',
      });
    } finally {
      setStarting(false);
    }
  };

  const handleCreateRunAndStart = async () => {
    if (!resolvedProjectId || !id || !testCase) return;

    const trimmedRunName = newRunName.trim();
    if (!trimmedRunName) {
      toast({
        title: t('validationError'),
        description: t('testRunNameRequiredForExecution'),
        variant: 'destructive',
      });
      return;
    }

    setCreating(true);
    try {
      const newRun = await testRunsAPI.create({
        name: trimmedRunName,
        description: t('manualExecutionRunDescription', { title: testCase.title }),
        project_id: resolvedProjectId,
        status: 'in_progress',
        priority: testCase.priority || 'medium',
      });

      await ensureCaseInRunAndNavigate(newRun.id);
    } catch (createError) {
      console.error('Failed to create run and start execution:', createError);
      toast({
        title: t('error'),
        description: t('failedToCreateRunForExecution'),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !testCase) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>{t('unableToStartExecution')}</CardTitle>
            <CardDescription>{error || t('failedToPrepareExecutionFlow')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={goBackToCase}>{t('backToTestCase')}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={`flex items-center justify-between gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
        <div className={`flex items-center gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
          <Button variant="ghost" onClick={goBackToCase}>
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
            {t('backToTestCase')}
          </Button>
          <div className={isRTL ? 'text-right' : ''}>
            <h1 className="text-2xl font-bold">{t('startTestExecution')}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('executionLauncherSubtitle', { id: testCase.id, title: testCase.title })}
            </p>
          </div>
        </div>
        <Badge variant="secondary">{t('testCase')}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('useExistingTestRun')}</CardTitle>
          <CardDescription>{t('useExistingTestRunDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {candidateRuns.length === 0 ? (
            <div className={`rounded-md border p-3 text-sm text-amber-700 bg-amber-50 ${isRTL ? 'text-right' : ''}`}>
              <AlertTriangle className={`inline h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('noExistingTestRunsForProject')}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="run-select">{t('testRun')}</Label>
                <Select value={selectedRunId} onValueChange={setSelectedRunId}>
                  <SelectTrigger id="run-select">
                    <SelectValue placeholder={t('selectTestRunToContinue')} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidateRuns.map((run) => (
                      <SelectItem key={run.id} value={String(run.id)}>
                        {run.name} ({run.status}){run.hasCase ? ` • ${t('alreadyContainsThisTestCase')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleStartInSelectedRun} disabled={starting || !selectedRunId}>
                <Play className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {starting ? t('startingExecution') : t('startInSelectedRun')}
              </Button>

              {selectedRun?.hasCase && (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {t('existingResultWillBeUpdated')}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('createNewTestRunAndStart')}</CardTitle>
          <CardDescription>{t('createNewTestRunAndStartDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-run-name">{t('runName')}</Label>
            <Input
              id="new-run-name"
              value={newRunName}
              onChange={(e) => setNewRunName(e.target.value)}
              placeholder={t('enterRunName')}
            />
          </div>

          <Button onClick={handleCreateRunAndStart} disabled={creating}>
            <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {creating ? t('creatingAndStarting') : t('createRunAndStart')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
