import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useEnvironments,
  useCreateEnvironment,
  useUpdateEnvironment,
  useDeleteEnvironment,
} from '@/hooks/queries/environments';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Server, Settings, Trash2, Copy, PlayCircle } from 'lucide-react';

const environmentTypeTranslationKeys: Record<string, string> = {
  development: 'environmentTypeDevelopment',
  staging: 'environmentTypeStaging',
  production: 'environmentTypeProduction',
  custom: 'environmentTypeCustom',
};

interface EnvironmentFormValues {
  name: string;
  description: string;
  environment_type: string;
  url: string;
  database_url: string;
}

const defaultEnvironmentValues: EnvironmentFormValues = {
  name: '',
  description: '',
  environment_type: 'development',
  url: '',
  database_url: '',
};

export function Environments() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId?: string }>();
  const { t, isRTL } = useTranslation();
  const { canWrite } = usePermissions();
  const routeProjectId = Number(projectId);
  const currentProjectId =
    projectId && Number.isInteger(routeProjectId) && routeProjectId > 0 ? routeProjectId : null;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [environmentToDelete, setEnvironmentToDelete] = useState<{id: number, name: string} | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingEnvironment, setEditingEnvironment] = useState<any>(null);

  const { data: environments = [], isLoading: loading } = useEnvironments(currentProjectId);
  const createEnvironment = useCreateEnvironment(currentProjectId);
  const updateEnvironment = useUpdateEnvironment(currentProjectId);
  const deleteEnvironment = useDeleteEnvironment(currentProjectId);
  const isSaving = createEnvironment.isPending || updateEnvironment.isPending;

  const { register, handleSubmit, control, reset, setValue, setFocus, watch, formState } =
    useForm<EnvironmentFormValues>({ defaultValues: defaultEnvironmentValues });
  // formState.isDirty replaces the hand-rolled "hasUnsavedChanges" tracking:
  // it is true once the user diverges from the form's baseline (empty for a new
  // environment, the loaded values for an edit).
  const { isDirty } = formState;
  const envName = watch('name');
  const envDescription = watch('description');

  // Auto-focus the name input when the dialog opens.
  useEffect(() => {
    if (isDialogOpen) {
      const timer = setTimeout(() => setFocus('name'), 100);
      return () => clearTimeout(timer);
    }
  }, [isDialogOpen, setFocus]);

  const resetFormState = () => {
    reset(defaultEnvironmentValues);
    setIsEditing(false);
    setEditingEnvironment(null);
  };

  const onSubmit = (values: EnvironmentFormValues) => {
    if (!currentProjectId) {
      console.error('Cannot save environment without a selected project');
      return;
    }

    const environmentData = {
      name: values.name,
      description: values.description,
      environment_type: values.environment_type,
      project_id: currentProjectId,
      config_data: {
        url: values.url,
        database_url: values.database_url,
        credentials: { username: '', password: '' }
      },
      build_info: {
        version: '1.0.0',
        commit_hash: '',
        build_date: new Date().toISOString()
      },
      is_active: true
    };

    const onSuccess = () => {
      resetFormState();
      setIsDialogOpen(false);
    };
    const onError = (error: unknown) => console.error('Failed to save environment:', error);

    if (isEditing && editingEnvironment) {
      updateEnvironment.mutate({ id: editingEnvironment.id, environment: environmentData }, { onSuccess, onError });
    } else {
      createEnvironment.mutate(environmentData, { onSuccess, onError });
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && isDirty) {
      setShowUnsavedDialog(true);
    } else {
      setIsDialogOpen(open);
      if (!open) {
        resetFormState();
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      resetFormState();
      setIsDialogOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(onSubmit)();
    }
  };

  const handleDeleteEnvironment = async (envId: number, envName: string) => {
    // Set the environment to delete and open confirmation dialog
    setEnvironmentToDelete({ id: envId, name: envName });
    setDeleteDialogOpen(true);
  };

  const confirmDeleteEnvironment = () => {
    if (!environmentToDelete) return;
    deleteEnvironment.mutate(environmentToDelete.id, {
      onError: (error) => console.error('Failed to delete environment:', error),
      onSettled: () => {
        setDeleteDialogOpen(false);
        setEnvironmentToDelete(null);
      },
    });
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setEnvironmentToDelete(null);
  };

  const handleRunTests = (envId: number) => {
    if (!currentProjectId) {
      console.error('Cannot run tests without a selected project');
      return;
    }

    navigate(`/projects/${currentProjectId}/test-runs?environment=${envId}`);
  };

  const handleCloneEnvironment = (environment: any) => {
    // Pre-fill the form with cloned environment data. Start from a clean
    // baseline and set each field as dirty so closing without saving still
    // warns about the unsaved clone.
    reset(defaultEnvironmentValues);
    setIsEditing(false);
    setEditingEnvironment(null);
    const dirty = { shouldDirty: true };
    setValue('name', t('environmentCloneName', { name: environment.name }), dirty);
    setValue('description', environment.description || '', dirty);
    setValue('environment_type', environment.environment_type || 'development', dirty);
    setValue('url', environment.config_data?.url || '', dirty);
    setValue('database_url', environment.config_data?.database_url || '', dirty);
    setIsDialogOpen(true);
  };

  const handleEditEnvironment = (environment: any) => {
    // Load the environment into the form as the new pristine baseline, so
    // isDirty only becomes true once the user actually changes a field.
    reset({
      name: environment.name,
      description: environment.description || '',
      environment_type: environment.environment_type || 'development',
      url: environment.config_data?.url || '',
      database_url: environment.config_data?.database_url || '',
    });
    setIsEditing(true);
    setEditingEnvironment(environment);
    setIsDialogOpen(true);
  };

  const getEnvironmentBadge = (type: string) => {
    const variants: Record<string, string> = {
      development: 'bg-blue-100 text-blue-800',
      staging: 'bg-yellow-100 text-yellow-800',
      production: 'bg-red-100 text-red-800',
      custom: 'bg-purple-100 text-purple-800'
    };
    return variants[type] || 'bg-gray-100 text-gray-800';
  };

  const getEnvironmentTypeLabel = (type: string) => t(environmentTypeTranslationKeys[type] || 'environmentTypeCustom');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('executionEnvironments')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('executionEnvironmentsDescription')}</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
          {canWrite && (
            <DialogTrigger asChild>
              <Button disabled={!currentProjectId}>
                <Plus className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                {t('addEnvironment')}
              </Button>
            </DialogTrigger>
          )}
          <DialogContent isRTL={isRTL} className="sm:max-w-[600px]" onKeyDown={handleKeyDown}>
            <DialogHeader>
              <DialogTitle>{isEditing ? t('editEnvironment') : t('createNewEnvironment')}</DialogTitle>
              <DialogDescription>
                {isEditing ? t('updateEnvironmentConfiguration') : t('addEnvironmentDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="envName" className="text-right rtl:text-left">
                  {t('name')}
                </Label>
                <div className="col-span-3 space-y-1">
                  <Input
                    id="envName"
                    className={(envName ?? '').trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
                    placeholder={t('enterEnvironmentName')}
                    maxLength={100}
                    {...register('name', { required: true })}
                  />
                  <div className="flex justify-between gap-3 text-xs text-gray-500">
                    <span>{t('enterEnvironmentName')}</span>
                    <span dir="ltr">{(envName ?? '').length}/100</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 items-start gap-4">
                <Label htmlFor="envDescription" className="text-right pt-2 rtl:text-left">
                  {t('description')}
                </Label>
                <div className="col-span-3 space-y-1">
                  <Textarea
                    id="envDescription"
                    placeholder={t('describeEnvironment')}
                    rows={2}
                    maxLength={500}
                    {...register('description')}
                  />
                  <div className="flex justify-between gap-3 text-xs text-gray-500">
                    <span>{t('describeEnvironment')}</span>
                    <span dir="ltr">{(envDescription ?? '').length}/500</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="envType" className="text-right rtl:text-left">
                  {t('type')}
                </Label>
                <Controller
                  name="environment_type"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="col-span-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="development">{t('development')}</SelectItem>
                        <SelectItem value="staging">{t('staging')}</SelectItem>
                        <SelectItem value="production">{t('production')}</SelectItem>
                        <SelectItem value="custom">{t('custom')}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="envUrl" className="text-right rtl:text-left">
                  {t('apiUrlLabel')}
                </Label>
                <Input
                  id="envUrl"
                  className="col-span-3"
                  placeholder="https://api.example.com"
                  {...register('url')}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="envDbUrl" className="text-right rtl:text-left">
                  {t('databaseUrl')}
                </Label>
                <Input
                  id="envDbUrl"
                  className="col-span-3"
                  placeholder="postgresql://localhost:5432/testdb"
                  {...register('database_url')}
                />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <div className="text-xs text-gray-500 mb-2 sm:mb-0 sm:mr-auto rtl:sm:mr-0 rtl:sm:ml-auto">
                {t('ctrlEnterToSubmit')}
              </div>
              <Button
                variant="outline"
                onClick={() => handleDialogClose(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                onClick={handleSubmit(onSubmit)}
                disabled={!(envName ?? '').trim() || isSaving}
                className="transition-all duration-200"
              >
                {isSaving ? t('creating') : (isEditing ? t('updateEnvironment') : t('createEnvironment'))}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Environments List */}
      {loading ? (
        <div className="rounded-md border border-dashed border-gray-200 p-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('loadingEnvironments')}
        </div>
      ) : environments.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 p-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {currentProjectId ? t('noEnvironmentsYet') : t('selectProjectForEnvironments')}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {environments.map((environment: any) => (
          <Card key={environment.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 rtl:flex-row-reverse">
                  <Server className="h-5 w-5 text-blue-600" />
                  <CardTitle className="text-lg">{environment.name}</CardTitle>
                </div>
                <Badge className={getEnvironmentBadge(environment.environment_type)}>
                  {getEnvironmentTypeLabel(environment.environment_type)}
                </Badge>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {environment.description || t('noDescriptionProvided')}
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm">
                    <span className="font-medium">{t('apiUrlLabel')}:</span>
                    <div dir="ltr" className="text-left text-gray-600 dark:text-gray-300 font-mono text-xs bg-gray-50 dark:bg-gray-900 p-1 rounded">
                      {environment.config_data?.url || t('notAvailableShort')}
                    </div>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">{t('database')}:</span>
                    <div dir="ltr" className="text-left text-gray-600 dark:text-gray-300 font-mono text-xs bg-gray-50 dark:bg-gray-900 p-1 rounded truncate">
                      {environment.config_data?.database_url || t('notAvailableShort')}
                    </div>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">{t('version')}:</span>
                    <div className="text-gray-600 dark:text-gray-300">{environment.build_info?.version || t('notAvailableShort')}</div>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleRunTests(environment.id)}
                    className="flex-1 min-w-[80px]"
                  >
                    <PlayCircle className="h-4 w-4 mr-1 rtl:mr-0 rtl:ml-1" />
                    <span className="whitespace-nowrap">{t('runTests')}</span>
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleCloneEnvironment(environment)}
                    className="min-w-[70px]"
                  >
                    <Copy className="h-4 w-4 mr-1 rtl:mr-0 rtl:ml-1" />
                    <span className="whitespace-nowrap">{t('clone')}</span>
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleEditEnvironment(environment)}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleDeleteEnvironment(environment.id, environment.name)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent isRTL={isRTL}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('areYouSure')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteEnvironmentConfirm', { name: environmentToDelete?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDelete}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteEnvironment}
              className="bg-red-600 hover:bg-red-700"
            >
              {t('deleteEnvironment')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved Changes Dialog */}
      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent isRTL={isRTL}>
          <DialogHeader>
            <DialogTitle>{t('unsavedChangesTitle')}</DialogTitle>
            <DialogDescription>
              {t('unsavedChangesModalMessage')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleUnsavedConfirm(false)}
            >
              {t('keepEditingModal')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleUnsavedConfirm(true)}
            >
              {t('discardChangesModal')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
