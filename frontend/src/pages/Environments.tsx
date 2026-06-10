import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { usePermissions } from '@/hooks/usePermissions';
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
import { environmentsAPI } from '@/lib/api';

const environmentTypeTranslationKeys: Record<string, string> = {
  development: 'environmentTypeDevelopment',
  staging: 'environmentTypeStaging',
  production: 'environmentTypeProduction',
  custom: 'environmentTypeCustom',
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const envNameInputRef = useRef<HTMLInputElement>(null);
  const [environments, setEnvironments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [envName, setEnvName] = useState('');
  const [envDescription, setEnvDescription] = useState('');
  const [envType, setEnvType] = useState('development');
  const [envUrl, setEnvUrl] = useState('');
  const [envDbUrl, setEnvDbUrl] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [environmentToDelete, setEnvironmentToDelete] = useState<{id: number, name: string} | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingEnvironment, setEditingEnvironment] = useState<any>(null);
  const [originalFormData, setOriginalFormData] = useState<any>(null);

  useEffect(() => {
    loadEnvironments();
  }, [currentProjectId]);

  // Auto-focus on name input when dialog opens
  useEffect(() => {
    if (isDialogOpen && envNameInputRef.current) {
      setTimeout(() => envNameInputRef.current?.focus(), 100);
    }
  }, [isDialogOpen]);

  // Track unsaved changes
  useEffect(() => {
    if (isEditing && originalFormData) {
      // Compare with original data when editing
      setHasUnsavedChanges(
        envName !== originalFormData.name ||
        envDescription !== originalFormData.description ||
        envType !== originalFormData.environment_type ||
        envUrl !== originalFormData.url ||
        envDbUrl !== originalFormData.database_url
      );
    } else {
      // For new environment, check if any field has content
      setHasUnsavedChanges(
        envName.trim() !== '' ||
        envDescription.trim() !== '' ||
        envUrl.trim() !== '' ||
        envDbUrl.trim() !== ''
      );
    }
  }, [envName, envDescription, envType, envUrl, envDbUrl, isEditing, originalFormData]);

  const loadEnvironments = async () => {
    if (!currentProjectId) {
      setEnvironments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await environmentsAPI.getAll(currentProjectId);
      setEnvironments(data);
    } catch (error) {
      console.error('Failed to load environments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEnvironment = async () => {
    if (!currentProjectId) {
      console.error('Cannot save environment without a selected project');
      return;
    }

    try {
      setIsCreating(true);
      const environmentData = {
        name: envName,
        description: envDescription,
        environment_type: envType,
        project_id: currentProjectId,
        config_data: {
          url: envUrl,
          database_url: envDbUrl,
          credentials: { username: '', password: '' }
        },
        build_info: {
          version: '1.0.0',
          commit_hash: '',
          build_date: new Date().toISOString()
        },
        is_active: true
      };

      if (isEditing && editingEnvironment) {
        // Update existing environment
        const updatedEnvironment = await environmentsAPI.update(editingEnvironment.id, environmentData);
        setEnvironments(environments.map(env => env.id === editingEnvironment.id ? updatedEnvironment : env));
      } else {
        // Create new environment
        const createdEnvironment = await environmentsAPI.create(environmentData);
        setEnvironments([...environments, createdEnvironment]);
      }

      setEnvName('');
      setEnvDescription('');
      setEnvType('development');
      setEnvUrl('');
      setEnvDbUrl('');
      setHasUnsavedChanges(false);
      setIsDialogOpen(false);
      setIsEditing(false);
      setEditingEnvironment(null);
    } catch (error) {
      console.error('Failed to save environment:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      setIsDialogOpen(open);
      if (!open) {
        setEnvName('');
        setEnvDescription('');
        setEnvType('development');
        setEnvUrl('');
        setEnvDbUrl('');
        setHasUnsavedChanges(false);
        setIsEditing(false);
        setEditingEnvironment(null);
        setOriginalFormData(null);
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      setEnvName('');
      setEnvDescription('');
      setEnvType('development');
      setEnvUrl('');
      setEnvDbUrl('');
      setHasUnsavedChanges(false);
      setIsEditing(false);
      setEditingEnvironment(null);
      setOriginalFormData(null);
      setIsDialogOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateEnvironment();
    }
  };

  const handleDeleteEnvironment = async (envId: number, envName: string) => {
    // Set the environment to delete and open confirmation dialog
    setEnvironmentToDelete({ id: envId, name: envName });
    setDeleteDialogOpen(true);
  };

  const confirmDeleteEnvironment = async () => {
    if (!environmentToDelete) return;
    
    try {
      await environmentsAPI.delete(environmentToDelete.id);
      setEnvironments(environments.filter(env => env.id !== environmentToDelete.id));
      setDeleteDialogOpen(false);
      setEnvironmentToDelete(null);
    } catch (error) {
      console.error('Failed to delete environment:', error);
      setDeleteDialogOpen(false);
      setEnvironmentToDelete(null);
    }
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
    // Pre-fill the form with cloned environment data
    setEnvName(t('environmentCloneName', { name: environment.name }));
    setEnvDescription(environment.description || '');
    setEnvType(environment.environment_type || 'development');
    setEnvUrl(environment.config_data?.url || '');
    setEnvDbUrl(environment.config_data?.database_url || '');
    setIsDialogOpen(true);
  };

  const handleEditEnvironment = (environment: any) => {
    // Pre-fill the form with environment data for editing
    setEnvName(environment.name);
    setEnvDescription(environment.description || '');
    setEnvType(environment.environment_type || 'development');
    setEnvUrl(environment.config_data?.url || '');
    setEnvDbUrl(environment.config_data?.database_url || '');
    setIsEditing(true);
    setEditingEnvironment(environment);
    // Save original data for comparison
    setOriginalFormData({
      name: environment.name,
      description: environment.description || '',
      environment_type: environment.environment_type || 'development',
      url: environment.config_data?.url || '',
      database_url: environment.config_data?.database_url || ''
    });
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
                    ref={envNameInputRef}
                    id="envName"
                    value={envName}
                    onChange={(e) => setEnvName(e.target.value)}
                    className={envName.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
                    placeholder={t('enterEnvironmentName')}
                    maxLength={100}
                  />
                  <div className="flex justify-between gap-3 text-xs text-gray-500">
                    <span>{t('enterEnvironmentName')}</span>
                    <span dir="ltr">{envName.length}/100</span>
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
                    value={envDescription}
                    onChange={(e) => setEnvDescription(e.target.value)}
                    placeholder={t('describeEnvironment')}
                    rows={2}
                    maxLength={500}
                  />
                  <div className="flex justify-between gap-3 text-xs text-gray-500">
                    <span>{t('describeEnvironment')}</span>
                    <span dir="ltr">{envDescription.length}/500</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="envType" className="text-right rtl:text-left">
                  {t('type')}
                </Label>
                <Select value={envType} onValueChange={setEnvType}>
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
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="envUrl" className="text-right rtl:text-left">
                  {t('apiUrlLabel')}
                </Label>
                <Input
                  id="envUrl"
                  value={envUrl}
                  onChange={(e) => setEnvUrl(e.target.value)}
                  className="col-span-3"
                  placeholder="https://api.example.com"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="envDbUrl" className="text-right rtl:text-left">
                  {t('databaseUrl')}
                </Label>
                <Input
                  id="envDbUrl"
                  value={envDbUrl}
                  onChange={(e) => setEnvDbUrl(e.target.value)}
                  className="col-span-3"
                  placeholder="postgresql://localhost:5432/testdb"
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
                onClick={handleCreateEnvironment}
                disabled={!envName.trim() || isCreating}
                className="transition-all duration-200"
              >
                {isCreating ? t('creating') : (isEditing ? t('updateEnvironment') : t('createEnvironment'))}
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
