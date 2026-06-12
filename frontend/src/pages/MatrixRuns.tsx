import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Grid3X3, Loader2, Plus, Trash2 } from 'lucide-react';
import { matrixRunsAPI, testCasesAPI, testSuitesAPI, environmentsAPI, getApiErrorMessage } from '@/lib/api';
import { MatrixRun, TestCase } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { usePermissions } from '@/hooks/usePermissions';

const statusBadgeClass = (status: string) => {
  if (status === 'completed') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (status === 'in_progress') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
};

const environmentTypeTranslationKeys: Record<string, string> = {
  development: 'environmentTypeDevelopment',
  staging: 'environmentTypeStaging',
  production: 'environmentTypeProduction',
  custom: 'environmentTypeCustom',
};

interface TestSuiteOption {
  id: number;
  name: string;
}

interface EnvironmentOption {
  id: number;
  name: string;
  environment_type: string;
}

export function MatrixRuns() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId?: string }>();
  const { t, isRTL } = useTranslation();
  const { canWrite } = usePermissions();
  const currentProjectId = projectId ? parseInt(projectId) : null;

  const [matrixRuns, setMatrixRuns] = useState<MatrixRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [testSuites, setTestSuites] = useState<TestSuiteOption[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentOption[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState('');
  const [suiteCases, setSuiteCases] = useState<TestCase[]>([]);
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [selectedCaseIds, setSelectedCaseIds] = useState<number[]>([]);
  const [selectedEnvIds, setSelectedEnvIds] = useState<number[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MatrixRun | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadMatrixRuns = useCallback(async () => {
    if (!currentProjectId) return;
    try {
      setIsLoading(true);
      setError(null);
      setMatrixRuns(await matrixRunsAPI.getAll(currentProjectId));
    } catch (err) {
      console.error('Failed to load matrix runs:', err);
      setError(t('failedToLoadMatrixRuns'));
    } finally {
      setIsLoading(false);
    }
  }, [currentProjectId, t]);

  useEffect(() => {
    void loadMatrixRuns();
  }, [loadMatrixRuns]);

  useEffect(() => {
    if (!isCreateOpen || !currentProjectId) return;
    Promise.all([
      testSuitesAPI.getAll(currentProjectId).catch(() => []),
      environmentsAPI.getAll(currentProjectId).catch(() => []),
    ]).then(([suites, envs]) => {
      setTestSuites(suites);
      setEnvironments(envs);
    });
  }, [isCreateOpen, currentProjectId]);

  // Selecting a suite loads its cases, all pre-selected ("same suite across N envs").
  useEffect(() => {
    if (!selectedSuiteId || !currentProjectId) {
      setSuiteCases([]);
      setSelectedCaseIds([]);
      return;
    }
    let cancelled = false;
    setIsLoadingCases(true);
    testCasesAPI.getAll(currentProjectId, parseInt(selectedSuiteId), undefined, 'id', 'asc', 0, 500)
      .then((cases: TestCase[]) => {
        if (cancelled) return;
        setSuiteCases(cases);
        setSelectedCaseIds(cases.map((testCase) => testCase.id));
      })
      .catch(() => {
        if (!cancelled) setSuiteCases([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCases(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSuiteId, currentProjectId]);

  const allCasesSelected = suiteCases.length > 0 && selectedCaseIds.length === suiteCases.length;

  const toggleCase = (caseId: number) => {
    setSelectedCaseIds((prev) =>
      prev.includes(caseId) ? prev.filter((id) => id !== caseId) : [...prev, caseId]
    );
  };

  const toggleEnv = (envId: number) => {
    setSelectedEnvIds((prev) =>
      prev.includes(envId) ? prev.filter((id) => id !== envId) : [...prev, envId]
    );
  };

  const resetCreateForm = () => {
    setName('');
    setDescription('');
    setSelectedSuiteId('');
    setSuiteCases([]);
    setSelectedCaseIds([]);
    setSelectedEnvIds([]);
  };

  const canSubmit = name.trim() !== '' && selectedCaseIds.length > 0 && selectedEnvIds.length > 0;

  const getEnvironmentTypeLabel = (type: string) => t(environmentTypeTranslationKeys[type] || 'environmentTypeCustom');

  const handleCreate = async () => {
    if (!currentProjectId || !canSubmit) return;
    try {
      setIsCreating(true);
      setError(null);
      const created = await matrixRunsAPI.create({
        project_id: currentProjectId,
        name: name.trim(),
        description: description.trim() || undefined,
        environment_ids: selectedEnvIds,
        test_case_ids: selectedCaseIds,
      });
      setIsCreateOpen(false);
      resetCreateForm();
      navigate(`/projects/${currentProjectId}/matrix-runs/${created.project_seq ?? created.id}`);
    } catch (err) {
      console.error('Failed to create matrix run:', err);
      setError(getApiErrorMessage(err, t('failedToCreateMatrixRun')));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await matrixRunsAPI.delete(deleteTarget.id);
      setMatrixRuns((prev) => prev.filter((run) => run.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      console.error('Failed to delete matrix run:', err);
      setError(getApiErrorMessage(err, t('failedToDeleteMatrixRun')));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('matrixRunsTitle')}</h1>
          <p className="text-gray-600">{t('matrixRunsDescription')}</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) resetCreateForm(); }}>
          {canWrite && (
            <DialogTrigger asChild>
              <Button type="button">
                <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('createMatrixRun')}
              </Button>
            </DialogTrigger>
          )}
          <DialogContent isRTL={isRTL} className="max-h-[92vh] overflow-y-auto sm:max-w-[760px]">
            <DialogHeader>
              <div className="flex items-start gap-3 text-start">
                <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-600/20">
                  <Grid3X3 className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle className="text-2xl font-bold">{t('createMatrixRun')}</DialogTitle>
                  <DialogDescription>{t('createMatrixRunDescription')}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="matrixName" className="text-sm font-semibold">{t('matrixRunName')} *</Label>
                <Input
                  id="matrixName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('enterMatrixRunName')}
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="matrixDescription" className="text-sm font-semibold">{t('runDescriptionLabel')}</Label>
                <Textarea
                  id="matrixDescription"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">{t('selectTestSuite')} *</Label>
                <Select value={selectedSuiteId} onValueChange={setSelectedSuiteId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('selectTestSuite')} />
                  </SelectTrigger>
                  <SelectContent>
                    {testSuites.map((suite) => (
                      <SelectItem key={suite.id} value={suite.id.toString()}>{suite.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedSuiteId && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">
                      {t('matrixSelectedCases', { count: selectedCaseIds.length })}
                    </Label>
                    {suiteCases.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSelectedCaseIds(allCasesSelected ? [] : suiteCases.map((testCase) => testCase.id))
                        }
                      >
                        {allCasesSelected ? t('deselectAll') : t('selectAll')}
                      </Button>
                    )}
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    {isLoadingCases ? (
                      <div className="flex items-center justify-center py-6 text-slate-400">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    ) : suiteCases.length === 0 ? (
                      <p className="py-4 text-center text-sm text-slate-500">{t('noTestCasesInSuite')}</p>
                    ) : (
                      suiteCases.map((testCase) => (
                        <label key={testCase.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <Checkbox
                            checked={selectedCaseIds.includes(testCase.id)}
                            onCheckedChange={() => toggleCase(testCase.id)}
                          />
                          <span className="truncate text-sm">{testCase.title}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  {t('matrixSelectedEnvironments', { count: selectedEnvIds.length })} *
                </Label>
                {environments.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
                    {t('noEnvironmentsDefined')}
                  </p>
                ) : (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {environments.map((env) => (
                      <label key={env.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
                        <Checkbox
                          checked={selectedEnvIds.includes(env.id)}
                          onCheckedChange={() => toggleEnv(env.id)}
                        />
                        <span className="truncate text-sm font-medium">{env.name}</span>
                        <Badge variant="secondary" className="ms-auto shrink-0 text-xs">
                          {getEnvironmentTypeLabel(env.environment_type)}
                        </Badge>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</Button>
              <Button type="button" onClick={handleCreate} disabled={!canSubmit || isCreating}>
                {isCreating && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('createMatrixRun')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : matrixRuns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Grid3X3 className="h-12 w-12 text-slate-300 dark:text-slate-700" />
            <p className="text-lg font-semibold">{t('noMatrixRuns')}</p>
            <p className="max-w-md text-sm text-slate-500">{t('noMatrixRunsHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {matrixRuns.map((matrixRun) => (
            <Card
              key={matrixRun.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/projects/${currentProjectId}/matrix-runs/${matrixRun.project_seq ?? matrixRun.id}`)}
            >
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Grid3X3 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="truncate font-semibold">{matrixRun.name}</span>
                    <Badge className={`shrink-0 ${statusBadgeClass(matrixRun.status)}`}>
                      {t(`matrixStatus_${matrixRun.status}`)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{t('matrixCasesBadge', { count: matrixRun.case_count })}</span>
                    <span aria-hidden>·</span>
                    <span>{t('matrixProgressBadge', { percent: matrixRun.progress_percent })}</span>
                    {matrixRun.environments.map((col) => (
                      <Badge key={col.test_run_id} variant="secondary" className="text-xs">
                        {col.environment_name} {col.progress_percent}%
                      </Badge>
                    ))}
                  </div>
                </div>
                {canWrite && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('deleteMatrixRun')}
                    title={t('deleteMatrixRun')}
                    className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(matrixRun);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent isRTL={isRTL}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteMatrixRun')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteMatrixRunConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {isDeleting && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
