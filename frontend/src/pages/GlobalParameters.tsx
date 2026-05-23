import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Search, Globe, Lock, Unlock } from 'lucide-react';

// Mock data for demonstration
const mockGlobalParameters = [
  {
    id: '1',
    name: 'API_BASE_URL',
    value: 'https://api.example.com',
    description: 'Base URL for all API calls',
    parameter_type: 'string',
    project_id: null, // Global parameter
    is_encrypted: false,
    created_at: '2024-01-15T10:00:00Z',
    is_active: true
  },
  {
    id: '2',
    name: 'DATABASE_TIMEOUT',
    value: '30',
    description: 'Database connection timeout in seconds',
    parameter_type: 'number',
    project_id: null, // Global parameter
    is_encrypted: false,
    created_at: '2024-01-16T09:00:00Z',
    is_active: true
  },
  {
    id: '3',
    name: 'API_KEY',
    value: 'encrypted_value_here',
    description: 'API key for external service',
    parameter_type: 'string',
    project_id: '1', // Project-specific
    is_encrypted: true,
    created_at: '2024-01-17T11:00:00Z',
    is_active: true
  },
  {
    id: '4',
    name: 'MAX_RETRIES',
    value: '3',
    description: 'Maximum number of retry attempts',
    parameter_type: 'number',
    project_id: '2', // Project-specific
    is_encrypted: false,
    created_at: '2024-01-18T14:00:00Z',
    is_active: true
  }
];

const mockProjects = [
  { id: '1', name: 'Web Application' },
  { id: '2', name: 'Mobile App' },
  { id: '3', name: 'API Services' }
];

export function GlobalParameters() {
  const { t, isRTL } = useTranslation();
  const [parameters, setParameters] = useState(mockGlobalParameters);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedParameter, setSelectedParameter] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [showEncrypted, setShowEncrypted] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const paramNameInputRef = useRef<HTMLInputElement>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    value: '',
    description: '',
    parameter_type: 'string',
    project_id: null as string | null,
    is_encrypted: false
  });

  // Auto-focus on name input when dialog opens
  useEffect(() => {
    if (isCreateDialogOpen && paramNameInputRef.current) {
      setTimeout(() => paramNameInputRef.current?.focus(), 100);
    }
  }, [isCreateDialogOpen]);

  // Track unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(
      formData.name.trim() !== '' || 
      formData.value.trim() !== '' ||
      formData.description.trim() !== ''
    );
  }, [formData.name, formData.value, formData.description]);

  const handleCreateParameter = () => {
    setIsCreating(true);
    const newParameter = {
      id: Date.now().toString(),
      ...formData,
      created_at: new Date().toISOString(),
      is_active: true
    };
    setParameters([...parameters, newParameter]);
    resetForm();
    setHasUnsavedChanges(false);
    setIsCreateDialogOpen(false);
    setIsCreating(false);
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      setIsCreateDialogOpen(open);
      if (!open) {
        resetForm();
        setHasUnsavedChanges(false);
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      resetForm();
      setHasUnsavedChanges(false);
      setIsCreateDialogOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateParameter();
    }
  };

  const handleEditParameter = () => {
    const updatedParameters = parameters.map(param =>
      param.id === selectedParameter.id ? { ...param, ...formData } : param
    );
    setParameters(updatedParameters);
    resetForm();
    setIsEditDialogOpen(false);
    setSelectedParameter(null);
  };

  const handleDeleteParameter = (paramId: string) => {
    const updatedParameters = parameters.map(param =>
      param.id === paramId ? { ...param, is_active: false } : param
    );
    setParameters(updatedParameters);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      value: '',
      description: '',
      parameter_type: 'string',
      project_id: null,
      is_encrypted: false
    });
  };

  const openEditDialog = (param: any) => {
    setSelectedParameter(param);
    setFormData({
      name: param.name,
      value: param.is_encrypted && !showEncrypted ? '••••••••' : param.value,
      description: param.description,
      parameter_type: param.parameter_type,
      project_id: param.project_id,
      is_encrypted: param.is_encrypted
    });
    setIsEditDialogOpen(true);
  };

  const filteredParameters = parameters.filter(param => {
    const matchesSearch = param.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         param.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesProject = selectedProject === 'all' || 
                           (selectedProject === 'global' && param.project_id === null) ||
                           param.project_id === selectedProject;
    return matchesSearch && matchesProject && param.is_active;
  });

  const getProjectName = (projectId: string | null) => {
    if (projectId === null) return 'Global';
    const project = mockProjects.find(p => p.id === projectId);
    return project?.name || 'Unknown';
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      string: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      number: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      boolean: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      json: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  const displayValue = (param: any) => {
    if (param.is_encrypted && !showEncrypted) {
      return '••••••••';
    }
    return param.value;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Global Parameters</h1>
          <p className="text-gray-600 dark:text-gray-400">Manage reusable parameters for test configurations</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {t('createParameter')}
            </Button>
          </DialogTrigger>
          <DialogContent isRTL={isRTL} className="sm:max-w-[500px]" onKeyDown={handleKeyDown}>
            <DialogHeader>
              <DialogTitle>{t('createNewParameter')}</DialogTitle>
              <DialogDescription>
                {t('createParameterDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  {t('name')} *
                </Label>
                <div className="col-span-3 space-y-1">
                  <Input
                    ref={paramNameInputRef}
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className={formData.name.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
                    placeholder={t('enterParameterName')}
                    maxLength={100}
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{t('enterParameterName')}</span>
                    <span>{formData.name.length}/100</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="type" className="text-right">
                  {t('type')} *
                </Label>
                <Select value={formData.parameter_type} onValueChange={(value) => setFormData({...formData, parameter_type: value})}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder={t('selectType')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">{t('string')}</SelectItem>
                    <SelectItem value="number">{t('number')}</SelectItem>
                    <SelectItem value="boolean">{t('boolean')}</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="project" className="text-right">
                  {t('scope')}
                </Label>
                <Select value={formData.project_id === null ? 'global' : formData.project_id} onValueChange={(value) => setFormData({...formData, project_id: value === 'global' ? null : value})}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder={t('selectScope')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">{t('global')}</SelectItem>
                    {mockProjects.map(project => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-start gap-4">
                <Label htmlFor="value" className="text-right pt-2">
                  {t('value')} *
                </Label>
                <div className="col-span-3 space-y-1">
                  <Textarea
                    id="value"
                    value={formData.value}
                    onChange={(e) => setFormData({...formData, value: e.target.value})}
                    placeholder={t('enterParameterValue')}
                    rows={2}
                    maxLength={1000}
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{t('enterParameterValue')}</span>
                    <span>{formData.value.length}/1000</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 items-start gap-4">
                <Label htmlFor="description" className="text-right pt-2">
                  {t('description')}
                </Label>
                <div className="col-span-3 space-y-1">
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder={t('enterParameterDescription')}
                    rows={2}
                    maxLength={500}
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{t('enterParameterDescription')}</span>
                    <span>{formData.description.length}/500</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="encrypted" className="text-right">
                  {t('encrypted')}
                </Label>
                <Select value={formData.is_encrypted.toString()} onValueChange={(value) => setFormData({...formData, is_encrypted: value === 'true'})}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">{t('no')}</SelectItem>
                    <SelectItem value="true">{t('yes')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <div className="text-xs text-gray-500 mb-2 sm:mb-0 sm:mr-auto">
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
                onClick={handleCreateParameter}
                disabled={!formData.name.trim() || !formData.value.trim() || isCreating}
                className="transition-all duration-200"
              >
                {isCreating ? t('creating') : t('createParameter')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
          <Input
            placeholder={t('searchParameters')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by scope" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scopes</SelectItem>
            <SelectItem value="global">Global Only</SelectItem>
            {mockProjects.map(project => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowEncrypted(!showEncrypted)}
        >
          {showEncrypted ? <Unlock className="h-4 w-4 mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
          {showEncrypted ? 'Hide' : 'Show'} Encrypted
        </Button>
      </div>

      {/* Parameters List */}
      <div className="grid gap-4">
        {filteredParameters.map((param) => (
          <Card key={param.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg truncate" title={param.name}>
                      {param.name}
                    </CardTitle>
                    {param.project_id === null && (
                      <Globe className="h-4 w-4 text-blue-600" />
                    )}
                    {param.is_encrypted && (
                      <Lock className="h-4 w-4 text-orange-600" />
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{param.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline">{getProjectName(param.project_id)}</Badge>
                    <Badge className={getTypeColor(param.parameter_type)}>
                      {param.parameter_type}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(param)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteParameter(param.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <h4 className="font-medium text-sm text-gray-700 dark:text-gray-300">Value:</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 p-2 rounded font-mono">
                    {displayValue(param)}
                  </p>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Created: {new Date(param.created_at).toLocaleString()}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        setIsEditDialogOpen(open);
        if (!open) {
          resetForm();
          setSelectedParameter(null);
        }
      }}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('editParameter')}</DialogTitle>
            <DialogDescription>
              {t('updateParameterDetails')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-name" className="text-right">
                {t('name')} *
              </Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                className="col-span-3"
                placeholder={t('enterParameterName')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-type" className="text-right">
                {t('type')} *
              </Label>
              <Select value={formData.parameter_type} onValueChange={(value) => setFormData({...formData, parameter_type: value})}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('selectType')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">{t('string')}</SelectItem>
                  <SelectItem value="number">{t('number')}</SelectItem>
                  <SelectItem value="boolean">{t('boolean')}</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-project" className="text-right">
                {t('scope')}
              </Label>
              <Select value={formData.project_id === null ? 'global' : formData.project_id} onValueChange={(value) => setFormData({...formData, project_id: value === 'global' ? null : value})}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('selectScope')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">{t('global')}</SelectItem>
                  {mockProjects.map(project => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="edit-value" className="text-right pt-2">
                {t('value')} *
              </Label>
              <Textarea
                id="edit-value"
                value={formData.value}
                onChange={(e) => setFormData({...formData, value: e.target.value})}
                className="col-span-3"
                placeholder={t('enterParameterValue')}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="edit-description" className="text-right pt-2">
                {t('description')}
              </Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                className="col-span-3"
                placeholder={t('enterParameterDescription')}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-encrypted" className="text-right">
                {t('encrypted')}
              </Label>
              <Select value={formData.is_encrypted.toString()} onValueChange={(value) => setFormData({...formData, is_encrypted: value === 'true'})}>
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">{t('no')}</SelectItem>
                  <SelectItem value="true">{t('yes')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              onClick={handleEditParameter}
              disabled={!formData.name.trim() || !formData.value.trim()}
            >
              {t('updateParameter')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
