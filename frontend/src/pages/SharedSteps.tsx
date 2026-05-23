import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { sharedStepsAPI } from '@/lib/api';
import { SharedStep, SharedStepCreate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Edit, Trash2, Search, Copy, TrendingUp, AlertCircle, Loader2 } from 'lucide-react';

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 500;
const STEP_TEXT_MAX_LENGTH = 1000;

interface SharedStepFormData {
  name: string;
  description: string;
  action: string;
  expected_result: string;
}

const emptyFormData: SharedStepFormData = {
  name: '',
  description: '',
  action: '',
  expected_result: '',
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  const responseDetail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof responseDetail === 'string') {
    return responseDetail;
  }
  if (Array.isArray(responseDetail)) {
    return responseDetail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) return String(item.msg);
        return '';
      })
      .filter(Boolean)
      .join(', ');
  }

  const message = (error as { message?: string })?.message;
  return message || fallback;
};

const normalizeSharedStepPayload = (formData: SharedStepFormData, projectId: number): SharedStepCreate => ({
  name: formData.name.trim(),
  description: formData.description.trim() || null,
  action: formData.action.trim(),
  expected_result: formData.expected_result.trim(),
  project_id: projectId,
});

const formatDateTime = (value?: string, fallback = '') => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
};

export function SharedSteps() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL } = useTranslation();
  const [sharedSteps, setSharedSteps] = useState<SharedStep[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedStep, setSelectedStep] = useState<SharedStep | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deletingStepId, setDeletingStepId] = useState<number | null>(null);
  const [duplicatingStepId, setDuplicatingStepId] = useState<number | null>(null);
  const [pendingCloseDialog, setPendingCloseDialog] = useState<'create' | 'edit' | null>(null);
  const [touchedFields, setTouchedFields] = useState<Record<keyof SharedStepFormData, boolean>>({
    name: false,
    description: false,
    action: false,
    expected_result: false,
  });
  const [formData, setFormData] = useState<SharedStepFormData>(emptyFormData);
  const [initialFormData, setInitialFormData] = useState<SharedStepFormData>(emptyFormData);
  const stepNameInputRef = useRef<HTMLInputElement>(null);

  const numericProjectId = projectId ? Number(projectId) : undefined;
  const isProjectIdValid = numericProjectId !== undefined && Number.isInteger(numericProjectId) && numericProjectId > 0;
  const canSubmit = Boolean(
    formData.name.trim() &&
    formData.action.trim() &&
    formData.expected_result.trim() &&
    numericProjectId &&
    isProjectIdValid
  );

  const resetForm = () => {
    setInitialFormData(emptyFormData);
    setFormData(emptyFormData);
    setTouchedFields({
      name: false,
      description: false,
      action: false,
      expected_result: false,
    });
  };

  const isFormDirty = useCallback((data: SharedStepFormData = formData) => (
    data.name !== initialFormData.name ||
    data.description !== initialFormData.description ||
    data.action !== initialFormData.action ||
    data.expected_result !== initialFormData.expected_result
  ), [formData, initialFormData]);

  const hasUnsavedChanges = useMemo(() => isFormDirty(), [isFormDirty]);

  const loadSharedSteps = useCallback(async (signal?: AbortSignal) => {
    if (!isProjectIdValid) {
      setError(t('invalidProjectId'));
      setSharedSteps([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await sharedStepsAPI.getAll(numericProjectId, 0, 100, signal);
      setSharedSteps(data);
    } catch (loadError) {
      if (signal?.aborted) return;
      console.error('Failed to load shared steps:', loadError);
      setSharedSteps([]);
      setError(getErrorMessage(loadError, t('failedToLoadSharedSteps')));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [isProjectIdValid, numericProjectId, t]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      loadSharedSteps(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [loadSharedSteps]);

  useEffect(() => {
    if (isCreateDialogOpen && stepNameInputRef.current) {
      const focusTimer = window.setTimeout(() => stepNameInputRef.current?.focus(), 100);
      return () => window.clearTimeout(focusTimer);
    }
  }, [isCreateDialogOpen]);

  const updateFormField = (field: keyof SharedStepFormData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const handleCreateSharedStep = async () => {
    if (!canSubmit || !numericProjectId) {
      setTouchedFields({
        name: true,
        description: true,
        action: true,
        expected_result: true,
      });
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      await sharedStepsAPI.create(normalizeSharedStepPayload(formData, numericProjectId));
      resetForm();
      setIsCreateDialogOpen(false);
      await loadSharedSteps();
    } catch (createError) {
      console.error('Failed to create shared step:', createError);
      setError(getErrorMessage(createError, t('failedToCreateSharedStep')));
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditSharedStep = async () => {
    if (!selectedStep || !canSubmit || !numericProjectId) {
      setTouchedFields({
        name: true,
        description: true,
        action: true,
        expected_result: true,
      });
      return;
    }

    try {
      setIsUpdating(true);
      setError(null);
      const payload = normalizeSharedStepPayload(formData, numericProjectId);
      await sharedStepsAPI.update(selectedStep.id, {
        name: payload.name,
        description: payload.description,
        action: payload.action,
        expected_result: payload.expected_result,
      });
      resetForm();
      setIsEditDialogOpen(false);
      setSelectedStep(null);
      await loadSharedSteps();
    } catch (updateError) {
      console.error('Failed to update shared step:', updateError);
      setError(getErrorMessage(updateError, t('failedToUpdateSharedStep')));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteSharedStep = async (stepId: number) => {
    if (!window.confirm(t('confirmDeleteReusableSharedStep'))) return;

    try {
      setDeletingStepId(stepId);
      setError(null);
      await sharedStepsAPI.delete(stepId);
      await loadSharedSteps();
    } catch (deleteError) {
      console.error('Failed to delete shared step:', deleteError);
      setError(getErrorMessage(deleteError, t('failedToDeleteSharedStep')));
    } finally {
      setDeletingStepId(null);
    }
  };

  const handleDuplicateStep = async (step: SharedStep) => {
    try {
      setDuplicatingStepId(step.id);
      setError(null);
      const copySuffix = t('sharedStepCopySuffix');
      const fallbackCopyName = t('sharedStepCopyName', { name: step.name });
      const copyName = step.name.length + copySuffix.length <= NAME_MAX_LENGTH
        ? `${step.name}${copySuffix}`
        : fallbackCopyName.slice(0, NAME_MAX_LENGTH);
      await sharedStepsAPI.create({
        name: copyName,
        description: step.description || null,
        action: step.action,
        expected_result: step.expected_result,
        project_id: step.project_id,
      });
      await loadSharedSteps();
    } catch (duplicateError) {
      console.error('Failed to duplicate shared step:', duplicateError);
      setError(getErrorMessage(duplicateError, t('failedToDuplicateSharedStep')));
    } finally {
      setDuplicatingStepId(null);
    }
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    if (open) {
      setInitialFormData(emptyFormData);
      setIsCreateDialogOpen(true);
      return;
    }

    if (!open && hasUnsavedChanges) {
      setPendingCloseDialog('create');
      setShowUnsavedDialog(true);
      return;
    }

    setIsCreateDialogOpen(open);
    if (!open) {
      resetForm();
    }
  };

  const handleEditDialogOpenChange = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setPendingCloseDialog('edit');
      setShowUnsavedDialog(true);
      return;
    }

    setIsEditDialogOpen(open);
    if (!open) {
      resetForm();
      setSelectedStep(null);
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      resetForm();
      if (pendingCloseDialog === 'create') {
        setIsCreateDialogOpen(false);
      }
      if (pendingCloseDialog === 'edit') {
        setIsEditDialogOpen(false);
        setSelectedStep(null);
      }
    }
    setPendingCloseDialog(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      handleCreateSharedStep();
    }
  };

  const openEditDialog = (step: SharedStep) => {
    const nextFormData = {
      name: step.name,
      description: step.description || '',
      action: step.action,
      expected_result: step.expected_result,
    };
    setSelectedStep(step);
    setInitialFormData(nextFormData);
    setFormData(nextFormData);
    setTouchedFields({
      name: false,
      description: false,
      action: false,
      expected_result: false,
    });
    setIsEditDialogOpen(true);
  };

  const filteredSteps = sharedSteps.filter((step) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return step.is_active;

    return (
      step.is_active &&
      (step.name.toLowerCase().includes(query) ||
        (step.description || '').toLowerCase().includes(query) ||
        step.action.toLowerCase().includes(query) ||
        step.expected_result.toLowerCase().includes(query))
    );
  });

  const renderFormFields = (mode: 'create' | 'edit') => (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
        <Label htmlFor={`${mode}-name`} className="sm:text-right">
          {t('sharedStepNameRequired')}
        </Label>
        <div className="space-y-1 sm:col-span-3">
          <Input
            ref={mode === 'create' ? stepNameInputRef : undefined}
            id={`${mode}-name`}
            value={formData.name}
            onChange={(event) => updateFormField('name', event.target.value)}
            onBlur={() => setTouchedFields((current) => ({ ...current, name: true }))}
            className={touchedFields.name && formData.name.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
            placeholder={t('sharedStepNamePlaceholder')}
            maxLength={NAME_MAX_LENGTH}
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{t('sharedStepNamePlaceholder')}</span>
            <span>{t('characterCount', { count: formData.name.length, max: NAME_MAX_LENGTH })}</span>
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4 sm:items-start sm:gap-4">
        <Label htmlFor={`${mode}-description`} className="pt-2 sm:text-right">
          {t('description')}
        </Label>
        <div className="space-y-1 sm:col-span-3">
          <Textarea
            id={`${mode}-description`}
            value={formData.description}
            onChange={(event) => updateFormField('description', event.target.value)}
            placeholder={t('sharedStepDescriptionPlaceholder')}
            rows={2}
            maxLength={DESCRIPTION_MAX_LENGTH}
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{t('sharedStepDescriptionPlaceholder')}</span>
            <span>{t('characterCount', { count: formData.description.length, max: DESCRIPTION_MAX_LENGTH })}</span>
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4 sm:items-start sm:gap-4">
        <Label htmlFor={`${mode}-action`} className="pt-2 sm:text-right">
          {t('sharedStepActionRequired')}
        </Label>
        <div className="space-y-1 sm:col-span-3">
          <Textarea
            id={`${mode}-action`}
            value={formData.action}
            onChange={(event) => updateFormField('action', event.target.value)}
            onBlur={() => setTouchedFields((current) => ({ ...current, action: true }))}
            className={touchedFields.action && formData.action.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
            placeholder={t('sharedStepActionPlaceholder')}
            rows={3}
            maxLength={STEP_TEXT_MAX_LENGTH}
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{t('sharedStepActionPlaceholder')}</span>
            <span>{t('characterCount', { count: formData.action.length, max: STEP_TEXT_MAX_LENGTH })}</span>
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4 sm:items-start sm:gap-4">
        <Label htmlFor={`${mode}-expected-result`} className="pt-2 sm:text-right">
          {t('sharedStepExpectedResultRequired')}
        </Label>
        <div className="space-y-1 sm:col-span-3">
          <Textarea
            id={`${mode}-expected-result`}
            value={formData.expected_result}
            onChange={(event) => updateFormField('expected_result', event.target.value)}
            onBlur={() => setTouchedFields((current) => ({ ...current, expected_result: true }))}
            className={
              touchedFields.expected_result && formData.expected_result.trim() === ''
                ? 'border-red-300 focus:border-red-500'
                : ''
            }
            placeholder={t('sharedStepExpectedResultPlaceholder')}
            rows={3}
            maxLength={STEP_TEXT_MAX_LENGTH}
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{t('sharedStepExpectedResultPlaceholder')}</span>
            <span>{t('characterCount', { count: formData.expected_result.length, max: STEP_TEXT_MAX_LENGTH })}</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('sharedSteps')}</h1>
          <p className="text-gray-600">{t('sharedStepsSubtitle')}</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={handleCreateDialogOpenChange}>
          <DialogTrigger asChild>
            <Button disabled={!isProjectIdValid || !numericProjectId}>
              <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('createSharedStep')}
            </Button>
          </DialogTrigger>
          <DialogContent isRTL={isRTL} className="sm:max-w-[600px]" onKeyDown={handleKeyDown}>
            <DialogHeader>
              <DialogTitle>{t('createNewSharedStep')}</DialogTitle>
              <DialogDescription>{t('createNewSharedStepDescription')}</DialogDescription>
            </DialogHeader>
            {renderFormFields('create')}
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <div className={`mb-2 text-xs text-gray-500 sm:mb-0 ${isRTL ? 'sm:ml-auto' : 'sm:mr-auto'}`}>
                {t('ctrlEnterToSubmit')}
              </div>
              <Button variant="outline" onClick={() => handleCreateDialogOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={handleCreateSharedStep} disabled={!canSubmit || isCreating}>
                {isCreating && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {isCreating ? t('creating') : t('createSharedStep')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('unsavedChanges')}</DialogTitle>
            <DialogDescription>{t('unsavedChangesModalMessage')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleUnsavedConfirm(false)}>
              {t('keepEditingModal')}
            </Button>
            <Button onClick={() => handleUnsavedConfirm(true)}>{t('discardChanges')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 ${isRTL ? 'right-3' : 'left-3'}`}
          />
          <Input
            placeholder={t('searchSharedSteps')}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className={isRTL ? 'pr-10' : 'pl-10'}
          />
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-600">
          <Loader2 className={`h-6 w-6 animate-spin text-blue-600 ${isRTL ? 'ml-2' : 'mr-2'}`} />
          <span>{t('loadingSharedSteps')}</span>
        </div>
      )}

      {!loading && (
        <div className="grid gap-4">
          {filteredSteps.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <h3 className="mb-2 text-lg font-semibold text-gray-900">
                  {searchTerm ? t('noSharedStepsFound') : t('noSharedStepsYet')}
                </h3>
                <p className="mb-4 text-center text-gray-600">
                  {searchTerm
                    ? t('tryAdjustingSearchTerms')
                    : numericProjectId
                      ? t('createFirstSharedStep')
                      : t('selectProjectForSharedSteps')}
                </p>
                {!searchTerm && numericProjectId && (
                  <Button onClick={() => setIsCreateDialogOpen(true)}>
                    <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('createSharedStep')}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            filteredSteps.map((step) => (
              <Card key={step.id} className="transition-shadow hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-lg" title={step.name}>
                        {step.name}
                      </CardTitle>
                      <p className="mt-1 text-sm text-gray-600">{step.description || t('noDescription')}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex items-center text-sm text-gray-500">
                          <TrendingUp className={`h-3 w-3 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                          {t('usedTimes', { count: step.usage_count || 0 })}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDuplicateStep(step)}
                        disabled={duplicatingStepId === step.id || deletingStepId === step.id}
                        aria-label={t('duplicateSharedStep')}
                        title={t('duplicateSharedStep')}
                      >
                        {duplicatingStepId === step.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(step)}
                        disabled={duplicatingStepId === step.id || deletingStepId === step.id}
                        aria-label={t('editSharedStep')}
                        title={t('editSharedStep')}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteSharedStep(step.id)}
                        disabled={deletingStepId === step.id || duplicatingStepId === step.id}
                        aria-label={t('deleteSharedStep')}
                        title={t('deleteSharedStep')}
                      >
                        {deletingStepId === step.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700">{t('action')}:</h4>
                      <p className="rounded bg-gray-50 p-2 text-sm text-gray-600">{step.action}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700">{t('expectedResult')}:</h4>
                      <p className="rounded bg-green-50 p-2 text-sm text-gray-600">{step.expected_result}</p>
                    </div>
                    <div className="text-xs text-gray-500">
                      {t('createdDate', { date: formatDateTime(step.created_at, t('unknownTime')) })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      <Dialog open={isEditDialogOpen} onOpenChange={handleEditDialogOpenChange}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t('editSharedStep')}</DialogTitle>
            <DialogDescription>{t('editSharedStepDescription')}</DialogDescription>
          </DialogHeader>
          {renderFormFields('edit')}
          <DialogFooter>
            <Button variant="outline" onClick={() => handleEditDialogOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleEditSharedStep} disabled={!canSubmit || isUpdating}>
              {isUpdating && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {isUpdating ? t('updating') : t('updateSharedStep')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
