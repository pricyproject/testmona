import { useCallback, useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { defectsAPI, getApiErrorMessage, testCasesAPI } from '@/lib/api';
import { defectManagementAPI, IssueTrackerIntegration } from '@/lib/defectManagementAPI';
import { SearchableTestCaseSelect } from '@/components/Defects/SearchableTestCaseSelect';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppName } from '@/hooks/useAppName';
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
import { Plus, Bug, Search, ChevronLeft, ChevronRight, Edit, Trash2, AlertTriangle, ExternalLink, Settings, RefreshCw, Loader2, CheckCircle2, AlertCircle, FileText, Link2, SlidersHorizontal } from 'lucide-react';

export function Defects() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();
  const { appName } = useAppName(false);
  
  const [defects, setDefects] = useState<any[]>([]);
  const [testCases, setTestCases] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  
  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingDefect, setEditingDefect] = useState<any>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const defectTitleInputRef = useRef<HTMLInputElement>(null);
  const [isIntegrationDialogOpen, setIsIntegrationDialogOpen] = useState(false);
  const [isIntegrationFormOpen, setIsIntegrationFormOpen] = useState(false);
  
  // Integration states
  const [integrations, setIntegrations] = useState<IssueTrackerIntegration[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<IssueTrackerIntegration | null>(null);
  const [integrationToDelete, setIntegrationToDelete] = useState<IssueTrackerIntegration | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Integration form state
  const [integrationForm, setIntegrationForm] = useState({
    name: '',
    tracker_type: 'jira',
    api_url: '',
    api_token: '',
    username: '',
    project_key: '',
    sync_direction: 'bidirectional',
    is_active: true
  });
  
  // Sync dialog state
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [syncingDefectId, setSyncingDefectId] = useState<number | null>(null);
  const [selectedSyncIntegrationId, setSelectedSyncIntegrationId] = useState<number | null>(null);
  
  // Dynamic placeholders based on tracker type
  const getPlaceholders = () => {
    const placeholders: Record<string, any> = {
      jira: {
        name: 'My Jira Integration',
        apiUrl: 'https://your-domain.atlassian.net',
        projectKey: 'TEST',
        projectKeyLabel: 'Project Key',
        projectKeyDesc: 'The project key from your Jira instance (e.g., TEST, PROJ)'
      },
      github: {
        name: 'My GitHub Integration',
        apiUrl: 'https://api.github.com',
        projectKey: 'owner/repo',
        projectKeyLabel: 'Repository',
        projectKeyDesc: 'GitHub repository in format: owner/repo'
      },
      gitlab: {
        name: 'My GitLab Integration',
        apiUrl: 'https://gitlab.com/api/v4',
        projectKey: 'namespace/project',
        projectKeyLabel: 'Project Path',
        projectKeyDesc: 'GitLab project path (e.g., namespace/project)'
      },
      'azure-devops': {
        name: 'My Azure DevOps Integration',
        apiUrl: 'https://dev.azure.com/your-org',
        projectKey: 'Project Name',
        projectKeyLabel: 'Project Name',
        projectKeyDesc: 'Azure DevOps project name'
      },
      linear: {
        name: 'My Linear Integration',
        apiUrl: 'https://api.linear.app',
        projectKey: 'Team Key',
        projectKeyLabel: 'Team Key',
        projectKeyDesc: 'Linear team key (e.g., ENG, PROD)'
      },
      asana: {
        name: 'My Asana Integration',
        apiUrl: 'https://app.asana.com/api/1.0',
        projectKey: 'Project GID',
        projectKeyLabel: 'Project GID',
        projectKeyDesc: 'Asana project GID (numeric ID)'
      }
    };
    return placeholders[integrationForm.tracker_type] || placeholders.jira;
  };
  
  // Validation state
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const nameInputRef = useRef<HTMLInputElement>(null);
  const apiUrlInputRef = useRef<HTMLInputElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const projectKeyInputRef = useRef<HTMLInputElement>(null);
  
  // Form states
  const [defectId, setDefectId] = useState('');
  const [defectTitle, setDefectTitle] = useState('');
  const [defectDescription, setDefectDescription] = useState('');
  const [defectStatus, setDefectStatus] = useState('open');
  const [defectSeverity, setDefectSeverity] = useState('medium');
  const [defectPriority, setDefectPriority] = useState('medium');
  const [defectSteps, setDefectSteps] = useState('');
  const [defectEnvironment, setDefectEnvironment] = useState('');
  const [defectTags, setDefectTags] = useState('');
  const [defectJiraLink, setDefectJiraLink] = useState('');
  const [defectTestCaseId, setDefectTestCaseId] = useState('none');
  const [defectTouchedFields, setDefectTouchedFields] = useState<Record<string, boolean>>({});
  const hasUnsavedChanges = defectTitle.trim() !== '' || defectDescription.trim() !== '' || defectSteps.trim() !== '';
  const externalIssueValue = defectJiraLink.trim();
  const isExternalIssueUrlInvalid = externalIssueValue !== '' && !/^https?:\/\/\S+$/i.test(externalIssueValue);
  const selectedDefectTestCase = testCases.find((testCase) => String(testCase.id) === defectTestCaseId) || null;
  const isDuplicateDefectId = defectId.trim() !== '' && defects.some((defect) =>
    String(defect.defect_id || '').toLowerCase() === defectId.trim().toLowerCase()
  );

  const getNextDefectId = () => {
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

  const resetDefectForm = () => {
    setDefectId('');
    setDefectTitle('');
    setDefectDescription('');
    setDefectStatus('open');
    setDefectSeverity('medium');
    setDefectPriority('medium');
    setDefectSteps('');
    setDefectEnvironment('');
    setDefectTags('');
    setDefectJiraLink('');
    setDefectTestCaseId('none');
    setDefectTouchedFields({});
  };

  const fetchIntegrations = useCallback(async () => {
    if (!projectId) return;

    setIsLoadingIntegrations(true);
    try {
      const data = await defectManagementAPI.getIssueTrackerIntegrations(parseInt(projectId));
      setIntegrations(data);
    } catch (error) {
      console.error('Failed to fetch integrations:', error);
      toast({
        title: t('error'),
        description: t('failedToLoadIntegrations'),
        variant: 'destructive',
      });
    } finally {
      setIsLoadingIntegrations(false);
    }
  }, [projectId, t, toast]);

  const loadDefects = async () => {
    if (!projectId) return;

    try {
      setIsLoading(true);
      const defectsData = await defectsAPI.getAll(parseInt(projectId));
      setDefects(defectsData);
    } catch (error) {
      console.error('Failed to load defects:', error);
      toast({
        title: t('error'),
        description: t('failedToLoadDefects'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Load defects and test cases
  useEffect(() => {
    const loadData = async () => {
      if (!projectId) return;

      try {
        setIsLoading(true);
        
        // Load defects
        const defectsData = await defectsAPI.getAll(parseInt(projectId));
        setDefects(defectsData);
        
        // Load test cases for dropdown
        const testCasesData = await testCasesAPI.getAll(parseInt(projectId));
        setTestCases(testCasesData);
        
        // Load integrations
        fetchIntegrations();
        
      } catch (error) {
        console.error('Failed to load data:', error);
        toast({
          title: t('error'),
          description: t('failedToLoadData'),
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [projectId, fetchIntegrations, t, toast]);

  // Auto-focus on title input when dialog opens
  useEffect(() => {
    if (isCreateDialogOpen && defectTitleInputRef.current) {
      setTimeout(() => defectTitleInputRef.current?.focus(), 100);
    }
  }, [isCreateDialogOpen]);

  const handleDialogClose = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      setIsCreateDialogOpen(open);
      if (!open) {
        resetDefectForm();
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      resetDefectForm();
      setIsCreateDialogOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateDefect();
    }
  };

  // Filter defects based on search query
  const filteredDefects = defects.filter(defect =>
    String(defect.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(defect.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(defect.defect_id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(defect.tags || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredDefects.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedDefects = filteredDefects.slice(startIndex, startIndex + itemsPerPage);

  const handleCreateDefect = async () => {
    const trimmedDefectId = defectId.trim() || getNextDefectId();
    const trimmedTitle = defectTitle.trim();
    const selectedTestCaseId = defectTestCaseId && defectTestCaseId !== 'none' ? Number(defectTestCaseId) : null;

    if (!trimmedDefectId || !trimmedTitle || !projectId) {
      toast({
        title: t('error'),
        description: t('defectIdAndTitleRequired'),
        variant: "destructive",
      });
      return;
    }

    if (defects.some((defect) => String(defect.defect_id || '').toLowerCase() === trimmedDefectId.toLowerCase())) {
      toast({
        title: t('validationError'),
        description: t('defectIdAlreadyExists'),
        variant: "destructive",
      });
      return;
    }

    if (isExternalIssueUrlInvalid) {
      toast({
        title: t('validationError'),
        description: t('externalIssueUrlInvalid'),
        variant: "destructive",
      });
      return;
    }

    if (selectedTestCaseId !== null && !Number.isFinite(selectedTestCaseId)) {
      toast({
        title: t('validationError'),
        description: t('invalidTestCaseId'),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreating(true);
      const defectData = {
        defect_id: trimmedDefectId,
        title: trimmedTitle,
        description: defectDescription.trim(),
        severity: defectSeverity,
        priority: defectPriority,
        steps_to_reproduce: defectSteps.trim(),
        environment: defectEnvironment.trim(),
        tags: defectTags.trim(),
        external_issue_url: externalIssueValue || null,
        test_case_id: selectedTestCaseId,
        project_id: parseInt(projectId),
      };

      const createdDefect = await defectsAPI.create(defectData);
      setDefects(prevDefects => [createdDefect, ...prevDefects]);
      
      // Reset form
      resetDefectForm();
      setIsCreateDialogOpen(false);

      toast({
        title: t('success'),
        description: t('defectCreatedSuccessfully'),
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

  const handleEditDefect = (defect: any) => {
    setEditingDefect(defect);
    setDefectId(defect.defect_id || '');
    setDefectTitle(defect.title || '');
    setDefectDescription(defect.description || '');
    setDefectStatus(defect.status || 'open');
    setDefectSeverity(defect.severity || 'medium');
    setDefectPriority(defect.priority || 'medium');
    setDefectSteps(defect.steps_to_reproduce || '');
    setDefectEnvironment(defect.environment || '');
    setDefectTags(defect.tags || '');
    setDefectJiraLink(defect.external_issue_url || defect.jira_link || '');
    setDefectTestCaseId(defect.test_case_id?.toString() || 'none');
    setIsEditDialogOpen(true);
  };

  const handleUpdateDefect = async () => {
    if (!editingDefect || !projectId) return;

    const trimmedDefectId = defectId.trim();
    const trimmedTitle = defectTitle.trim();
    const selectedTestCaseId = defectTestCaseId && defectTestCaseId !== 'none' ? Number(defectTestCaseId) : null;

    if (!trimmedDefectId || !trimmedTitle) {
      toast({
        title: t('error'),
        description: t('defectIdAndTitleRequired'),
        variant: "destructive",
      });
      return;
    }

    if (selectedTestCaseId !== null && !Number.isFinite(selectedTestCaseId)) {
      toast({
        title: t('validationError'),
        description: t('invalidTestCaseId'),
        variant: "destructive",
      });
      return;
    }

    try {
      const defectData = {
        defect_id: trimmedDefectId,
        title: trimmedTitle,
        description: defectDescription.trim(),
        status: defectStatus,
        severity: defectSeverity,
        priority: defectPriority,
        steps_to_reproduce: defectSteps.trim(),
        environment: defectEnvironment.trim(),
        tags: defectTags.trim(),
        external_issue_url: defectJiraLink.trim() || null,
        test_case_id: selectedTestCaseId,
      };

      const updatedDefect = await defectsAPI.update(editingDefect.id, defectData);
      setDefects(defects.map(d => d.id === editingDefect.id ? updatedDefect : d));
      
      setIsEditDialogOpen(false);
      setEditingDefect(null);

      toast({
        title: t('success'),
        description: t('defectUpdatedSuccessfully'),
      });
    } catch (error) {
      console.error('Failed to update defect:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToUpdateDefect')),
        variant: "destructive",
      });
    }
  };

  const handleDeleteDefect = async (defectId: number) => {
    if (!confirm(t('confirmDeleteDefect'))) return;

    try {
      await defectsAPI.delete(defectId);
      setDefects(defects.filter(d => d.id !== defectId));

      toast({
        title: t('success'),
        description: t('defectDeletedSuccessfully'),
      });
    } catch (error) {
      console.error('Failed to delete defect:', error);
      toast({
        title: t('error'),
        description: getApiErrorMessage(error, t('failedToDeleteDefect')),
        variant: "destructive",
      });
    }
  };

  const handleLinkToTestCase = (defect: any) => {
    if (defect.test_case_id && defect.test_run_id) {
      // Navigate to the specific test execution for this test case
      navigate(`/projects/${projectId}/test-runs/${defect.test_run_id}/test-cases/${defect.test_case_id}`);
    } else if (defect.test_case_id) {
      // If only test case ID, navigate to test case details
      navigate(`/projects/${projectId}/test-cases/${defect.test_case_id}`);
    } else {
      // If no specific test case, navigate to test cases page
      navigate(`/projects/${projectId}/test-cases`);
    }
  };

  const handleLinkToJira = (defect: any) => {
    const externalLink = defect.external_issue_url || defect.jira_link;
    if (externalLink) {
      window.open(externalLink, '_blank', 'noopener,noreferrer');
    } else {
      // Navigate to Jira integration settings
      navigate(`/projects/${projectId}/custom-fields?tab=jira`);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      open: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      fixed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      reopened: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      closed: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      rejected: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
    };
    return variants[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[severity] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      urgent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[priority] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getSyncStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      not_synced: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      syncing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      synced: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getSyncStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      not_synced: t('notSynced'),
      syncing: t('syncing'),
      synced: t('synced'),
      error: t('syncFailed')
    };
    return labels[status] || t('notSynced');
  };

  const getTriageLabel = (value: string) => {
    const labels: Record<string, string> = {
      low: t('low'),
      medium: t('medium'),
      high: t('high'),
      critical: t('critical'),
      urgent: t('urgent'),
    };
    return labels[value] || value;
  };

  const handleOpenSyncDialog = (defectId: number) => {
    if (integrations.length === 0) {
      toast({
        title: t('noIntegrationsAvailable'),
        description: 'Please add an integration first before syncing defects',
        variant: 'destructive',
      });
      return;
    }
    setSyncingDefectId(defectId);
    setSelectedSyncIntegrationId(null);
    setIsSyncDialogOpen(true);
  };

  const handleSyncWithExternal = async () => {
    if (!projectId || !syncingDefectId || !selectedSyncIntegrationId) return;

    setIsSyncing(true);
    try {
      const result = await defectManagementAPI.syncDefectWithExternal(
        parseInt(projectId),
        syncingDefectId,
        {
          integration_id: selectedSyncIntegrationId,
          sync_type: 'bidirectional',
          action: 'create'
        }
      );

      if (result.success) {
        toast({
          title: t('syncSuccessful'),
          description: t('syncSuccessfulDesc', { issueId: result.issue_id }),
        });
        setIsSyncDialogOpen(false);
        // Refresh defects to update sync status
        loadDefects();
      } else {
        toast({
          title: t('syncFailed'),
          description: result.message || t('syncFailedDesc'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to sync defect:', error);
      toast({
        title: t('error'),
        description: t('syncFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleViewInExternal = (externalUrl: string) => {
    window.open(externalUrl, '_blank');
  };

  const handleAddIntegration = () => {
    setEditingIntegration(null);
    setIntegrationForm({
      name: '',
      tracker_type: 'jira',
      api_url: '',
      api_token: '',
      username: '',
      project_key: '',
      sync_direction: 'bidirectional',
      is_active: true
    });
    setValidationErrors({});
    setTouchedFields({});
    setIsIntegrationFormOpen(true);
  };

  const handleEditIntegration = (integration: IssueTrackerIntegration) => {
    setEditingIntegration(integration);
    setIntegrationForm({
      name: integration.name,
      tracker_type: integration.tracker_type,
      api_url: integration.api_url,
      api_token: '',
      username: integration.username || '',
      project_key: integration.project_key || '',
      sync_direction: integration.sync_direction,
      is_active: integration.is_active
    });
    setValidationErrors({});
    setTouchedFields({});
    setIsIntegrationFormOpen(true);
  };

  const handleSaveIntegration = async () => {
    if (!projectId) return;
    
    // Mark all fields as touched
    setTouchedFields({
      name: true,
      api_url: true,
      api_token: true,
      project_key: true,
    });

    // Validate form
    const errors: Record<string, string> = {};
    
    // Name validation
    if (!integrationForm.name.trim()) {
      errors.name = t('integrationNameRequired');
    } else if (integrationForm.name.length < 3) {
      errors.name = t('integrationNameMinLength');
    } else if (integrationForm.name.length > 100) {
      errors.name = t('integrationNameMaxLength');
    }

    // API URL validation
    if (!integrationForm.api_url.trim()) {
      errors.api_url = t('apiUrlRequired');
    } else {
      try {
        const url = new URL(integrationForm.api_url);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.api_url = t('apiUrlProtocol');
        }
      } catch {
        errors.api_url = t('apiUrlValidUrl');
      }
    }

    // API Token validation (required for new integrations, optional for edits)
    if (!editingIntegration && !integrationForm.api_token.trim()) {
      errors.api_token = t('apiTokenRequired');
    } else if (integrationForm.api_token && integrationForm.api_token.length < 8) {
      errors.api_token = t('apiTokenMinLength');
    }

    // Project Key validation (required for Jira, GitHub, GitLab)
    if (['jira', 'github', 'gitlab'].includes(integrationForm.tracker_type)) {
      if (!integrationForm.project_key.trim()) {
        errors.project_key = t('projectKeyRequired');
      } else if (integrationForm.project_key.length < 2) {
        errors.project_key = t('projectKeyMinLength');
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      
      // Focus on the first field with an error
      if (errors.name) {
        nameInputRef.current?.focus();
      } else if (errors.api_url) {
        apiUrlInputRef.current?.focus();
      } else if (errors.api_token) {
        tokenInputRef.current?.focus();
      } else if (errors.project_key) {
        projectKeyInputRef.current?.focus();
      }

      toast({
        title: t('validationError'),
        description: t('pleaseFixErrorsBeforeSaving'),
        variant: 'destructive',
      });
      return;
    }

    try {
      if (editingIntegration) {
        await defectManagementAPI.updateIssueTrackerIntegration(
          parseInt(projectId),
          editingIntegration.id,
          integrationForm
        );
        toast({
          title: t('success'),
          description: t('integrationUpdatedSuccessfully'),
        });
      } else {
        await defectManagementAPI.createIssueTrackerIntegration(
          parseInt(projectId),
          integrationForm
        );
        toast({
          title: t('success'),
          description: t('integrationCreatedSuccessfully'),
        });
      }
      setIsIntegrationFormOpen(false);
      setValidationErrors({});
      setTouchedFields({});
      fetchIntegrations();
    } catch (error) {
      console.error('Failed to save integration:', error);
      toast({
        title: t('error'),
        description: t('failedToSaveIntegration'),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteIntegration = (integration: IssueTrackerIntegration) => {
    setIntegrationToDelete(integration);
  };

  const confirmDeleteIntegration = async () => {
    if (!projectId) return;
    if (!integrationToDelete) return;

    try {
      await defectManagementAPI.deleteIssueTrackerIntegration(parseInt(projectId), integrationToDelete.id);
      toast({
        title: t('success'),
        description: t('integrationDeletedSuccessfully'),
      });
      setIntegrationToDelete(null);
      fetchIntegrations();
    } catch (error) {
      console.error('Failed to delete integration:', error);
      toast({
        title: t('error'),
        description: t('failedToDeleteIntegration'),
        variant: 'destructive',
      });
    } finally {
      setIntegrationToDelete(null);
    }
  };

  const handleTestConnection = async (integrationId: number) => {
    if (!projectId) return;
    
    setIsTestingConnection(true);
    try {
      const result = await defectManagementAPI.testIssueTrackerConnection(parseInt(projectId), integrationId);
      if (result.success) {
        toast({
          title: t('success'),
          description: t('connectionTestPassed'),
        });
      } else {
        toast({
          title: t('connectionTestFailed'),
          description: result.message || t('connectionTestFailed'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      toast({
        title: t('error'),
        description: t('connectionTestFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('defects')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('defectsDescription')}</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isIntegrationDialogOpen} onOpenChange={setIsIntegrationDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Settings className="h-4 w-4 mr-2" />
                {t('integrations')}
              </Button>
            </DialogTrigger>
            <DialogContent isRTL={isRTL} className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>{t('integrations')}</DialogTitle>
                <DialogDescription>
                  {t('integrationsDesc')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {isLoadingIntegrations ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : integrations.length === 0 ? (
                  <div className="text-center py-8">
                    <Settings className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
                    <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('noIntegrationsAvailable')}</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {t('noIntegrationsDefectsDesc')}
                    </p>
                  </div>
                ) : (
                  integrations.map((integration) => (
                    <Card key={integration.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-semibold">{integration.name}</h4>
                              {!integration.is_active && (
                                <Badge variant="outline" className="text-xs">Inactive</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                              <Badge variant="outline" className="capitalize">
                                {integration.tracker_type}
                              </Badge>
                              {integration.project_key && (
                                <Badge variant="outline">{integration.project_key}</Badge>
                              )}
                              <Badge className={getSyncStatusBadge(integration.sync_status)}>
                                {integration.sync_status}
                              </Badge>
                            </div>
                            {integration.last_sync && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Last sync: {new Date(integration.last_sync).toLocaleString()}
                              </p>
                            )}
                            {integration.sync_error && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                <AlertCircle className="h-3 w-3 inline mr-1" />
                                {integration.sync_error}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleTestConnection(integration.id)}
                              disabled={isTestingConnection}
                            >
                              {isTestingConnection ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleEditIntegration(integration)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleDeleteIntegration(integration)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
                <Button 
                  className="w-full" 
                  variant="outline"
                  onClick={handleAddIntegration}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('addIntegration')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={isCreateDialogOpen} onOpenChange={handleDialogClose}>
            <DialogTrigger asChild>
              <Button onClick={() => setDefectId(getNextDefectId())}>
                <Plus className="h-4 w-4 mr-2" />
                {t('reportDefect')}
              </Button>
            </DialogTrigger>
          <DialogContent isRTL={isRTL} className="max-h-[90vh] overflow-y-auto sm:max-w-[980px] p-0" onKeyDown={handleKeyDown}>
            <DialogHeader className="border-b px-6 py-5 dark:border-gray-800">
              <div className={`flex items-start justify-between gap-4 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                <div className="space-y-1">
                  <DialogTitle className="flex items-center gap-2 text-2xl">
                    <Bug className="h-5 w-5 text-red-600" />
                    {t('reportNewDefect')}
                  </DialogTitle>
                  <DialogDescription>
                    {t('reportNewDefectDesc')}
                  </DialogDescription>
                </div>
                <Badge variant="outline" className="mt-1 shrink-0 font-mono">
                  {defectId || getNextDefectId()}
                </Badge>
              </div>
            </DialogHeader>

            <div className="grid gap-0 lg:grid-cols-[1fr_280px]">
              <div className="space-y-6 px-6 py-5">
                <section className="space-y-4">
                  <div className={`flex items-center gap-2 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                    <FileText className="h-4 w-4 text-blue-600" />
                    <h3 className="text-sm font-semibold uppercase text-gray-600 dark:text-gray-300">{t('defectModalCoreDetails')}</h3>
                  </div>
                  <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                    <div className="space-y-2">
                      <Label htmlFor="defectId" className="flex items-center gap-2">
                        {t('defectId')}
                        <Badge variant="outline" className="text-[10px]">{t('required')}</Badge>
                      </Label>
                      <Input
                        id="defectId"
                        value={defectId}
                        onChange={(e) => setDefectId(e.target.value)}
                        onBlur={() => setDefectTouchedFields({...defectTouchedFields, defectId: true})}
                        className={defectTouchedFields.defectId && (defectId.trim() === '' || isDuplicateDefectId) ? 'border-red-300 focus:border-red-500' : ''}
                        placeholder={t('defectIdPlaceholder')}
                        maxLength={50}
                      />
                      <div className="flex justify-between gap-2 text-xs text-gray-500">
                        <span className={(isDuplicateDefectId || (defectTouchedFields.defectId && !defectId.trim())) ? 'text-red-600' : ''}>
                          {defectTouchedFields.defectId && !defectId.trim()
                            ? t('required')
                            : isDuplicateDefectId ? t('defectIdAlreadyExists') : t('generatedIdHint')}
                        </span>
                        <span>{defectId.length}/50</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="defectTitle" className="flex items-center gap-2">
                        {t('title')}
                        <Badge variant="outline" className="text-[10px]">{t('required')}</Badge>
                      </Label>
                      <Input
                        ref={defectTitleInputRef}
                        id="defectTitle"
                        value={defectTitle}
                        onChange={(e) => setDefectTitle(e.target.value)}
                        onBlur={() => setDefectTouchedFields({...defectTouchedFields, defectTitle: true})}
                        className={defectTouchedFields.defectTitle && defectTitle.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
                        placeholder={t('defectTitlePlaceholder')}
                        maxLength={200}
                      />
                      <div className="flex justify-between gap-2 text-xs text-gray-500">
                        <span>{defectTouchedFields.defectTitle && !defectTitle.trim() ? t('defectTitleRequired') : t('defectModalTitleHint')}</span>
                        <span>{defectTitle.length}/200</span>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className={`flex items-center gap-2 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                    <SlidersHorizontal className="h-4 w-4 text-amber-600" />
                    <h3 className="text-sm font-semibold uppercase text-gray-600 dark:text-gray-300">{t('defectModalTriage')}</h3>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="defectStatus">{t('status')}</Label>
                      <div id="defectStatus" className="flex h-10 items-center rounded-md border bg-gray-50 px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                        {t('open')}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="defectSeverity">{t('defectSeverity')}</Label>
                      <Select value={defectSeverity} onValueChange={setDefectSeverity}>
                        <SelectTrigger id="defectSeverity">
                          <SelectValue placeholder={t('selectSeverity')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">{t('low')}</SelectItem>
                          <SelectItem value="medium">{t('medium')}</SelectItem>
                          <SelectItem value="high">{t('high')}</SelectItem>
                          <SelectItem value="critical">{t('critical')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="defectPriority">{t('defectPriority')}</Label>
                      <Select value={defectPriority} onValueChange={setDefectPriority}>
                        <SelectTrigger id="defectPriority">
                          <SelectValue placeholder={t('selectPriority')} />
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
                </section>

                <section className="space-y-4">
                  <div className={`flex items-center gap-2 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <h3 className="text-sm font-semibold uppercase text-gray-600 dark:text-gray-300">{t('defectModalEvidence')}</h3>
                  </div>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="defectDescription">{t('description')}</Label>
                      <Textarea
                        id="defectDescription"
                        value={defectDescription}
                        onChange={(e) => setDefectDescription(e.target.value)}
                        placeholder={t('defectDescriptionPlaceholder')}
                        rows={4}
                        maxLength={1000}
                        className="resize-none"
                      />
                      <div className="flex justify-end text-xs text-gray-500">{defectDescription.length}/1000</div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="defectSteps">{t('stepsToReproduce')}</Label>
                        <Textarea
                          id="defectSteps"
                          value={defectSteps}
                          onChange={(e) => setDefectSteps(e.target.value)}
                          placeholder={t('stepsToReproducePlaceholder')}
                          rows={5}
                          maxLength={2000}
                          className="resize-none"
                        />
                        <div className="flex justify-end text-xs text-gray-500">{defectSteps.length}/2000</div>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="defectEnvironment">{t('environment')}</Label>
                          <Input
                            id="defectEnvironment"
                            value={defectEnvironment}
                            onChange={(e) => setDefectEnvironment(e.target.value)}
                            placeholder={t('environmentPlaceholder')}
                            maxLength={255}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="defectTags">{t('tags')}</Label>
                          <Input
                            id="defectTags"
                            value={defectTags}
                            onChange={(e) => setDefectTags(e.target.value)}
                            placeholder={t('tagsPlaceholder')}
                            maxLength={500}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className={`flex items-center gap-2 ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                    <Link2 className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-sm font-semibold uppercase text-gray-600 dark:text-gray-300">{t('defectModalLinks')}</h3>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="defectTestCase">{t('testCase')}</Label>
                      <SearchableTestCaseSelect
                        id="defectTestCase"
                        value={defectTestCaseId}
                        onChange={setDefectTestCaseId}
                        testCases={testCases}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="defectJiraLink">{t('externalIssue')}</Label>
                      <Input
                        id="defectJiraLink"
                        value={defectJiraLink}
                        onChange={(e) => setDefectJiraLink(e.target.value)}
                        onBlur={() => setDefectTouchedFields({...defectTouchedFields, defectJiraLink: true})}
                        className={isExternalIssueUrlInvalid ? 'border-red-300 focus:border-red-500' : ''}
                        placeholder={t('jiraLinkPlaceholder')}
                        maxLength={500}
                      />
                      {isExternalIssueUrlInvalid && (
                        <div className="text-xs text-red-600">{t('externalIssueUrlInvalid')}</div>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <aside className="border-t bg-gray-50 px-6 py-5 dark:border-gray-800 dark:bg-gray-900/40 lg:border-l lg:border-t-0">
                <div className="sticky top-0 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold uppercase text-gray-600 dark:text-gray-300">{t('defectModalSummary')}</h3>
                    <p className="mt-2 break-words text-lg font-semibold text-gray-950 dark:text-gray-100">
                      {defectTitle.trim() || t('defectModalUntitled')}
                    </p>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-500">{t('defectId')}</span>
                      <span className="font-mono">{defectId || getNextDefectId()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-500">{t('status')}</span>
                      <Badge className={getStatusBadge('open')}>{t('open')}</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-500">{t('defectSeverity')}</span>
                      <Badge className={getSeverityBadge(defectSeverity)}>{getTriageLabel(defectSeverity)}</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-500">{t('defectPriority')}</span>
                      <Badge className={getPriorityBadge(defectPriority)}>{getTriageLabel(defectPriority)}</Badge>
                    </div>
                    <div className="space-y-1">
                      <span className="text-gray-500">{t('testCase')}</span>
                      <div className="rounded-md border bg-white p-2 text-sm dark:border-gray-700 dark:bg-gray-950">
                        {selectedDefectTestCase?.title || t('noTestCaseLinked')}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-950">
                    <div className="mb-2 font-medium">{defectTitle.trim() && defectId.trim() && !isDuplicateDefectId && !isExternalIssueUrlInvalid ? t('defectModalReady') : t('defectModalNeedsAttention')}</div>
                    <div className="text-gray-500">
                      {defectTitle.trim() && defectId.trim() && !isDuplicateDefectId && !isExternalIssueUrlInvalid
                        ? t('defectModalReadyDesc')
                        : t('defectModalNeedsAttentionDesc')}
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <DialogFooter className="border-t px-6 py-4 dark:border-gray-800">
              <Button variant="outline" onClick={() => handleDialogClose(false)}>
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                onClick={handleCreateDefect}
                disabled={!defectId.trim() || !defectTitle.trim() || isDuplicateDefectId || isExternalIssueUrlInvalid || isCreating}
                className="min-w-36 transition-all duration-200"
              >
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
      </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
          <Input
            placeholder={t('searchDefects')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Defects List */}
      <div className="space-y-4">
        {paginatedDefects.length > 0 ? (
          paginatedDefects.map((defect) => (
            <Card key={defect.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-gray-500 dark:text-gray-400">{defect.defect_id}</span>
                      <Badge className={getStatusBadge(defect.status)}>
                        {defect.status.replace('_', ' ')}
                      </Badge>
                      <Badge className={getSeverityBadge(defect.severity)}>
                        {defect.severity}
                      </Badge>
                      <Badge className={getPriorityBadge(defect.priority)}>
                        {defect.priority}
                      </Badge>
                      <Badge className={getSyncStatusBadge(defect.sync_status || defect.external_sync_status)}>
                        {getSyncStatusLabel(defect.sync_status || defect.external_sync_status)}
                      </Badge>
                    </div>
                    <CardTitle className="text-lg mb-1 flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                      {defect.title}
                    </CardTitle>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{defect.description}</p>
                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                      <p><strong>{t('environment')}:</strong> {defect.environment || t('notSpecified')}</p>
                      {defect.tags && <p><strong>{t('tags')}:</strong> {defect.tags}</p>}
                      {(defect.external_issue_url || defect.jira_link) && (
                        <p className="flex items-center gap-1">
                          <strong>{t('externalIssue')}:</strong>
                          <Button 
                            variant="link" 
                            size="sm"
                            onClick={() => handleLinkToJira(defect)}
                            className="p-0 h-auto text-blue-600 hover:underline flex items-center gap-1"
                          >
                            {defect.external_issue_url || defect.jira_link}
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </p>
                      )}
                      {defect.test_case_id && (
                        <p>
                          <strong>{t('testCase')}:</strong> 
                          <Button 
                            variant="link" 
                            size="sm"
                            onClick={() => handleLinkToTestCase(defect)}
                            className="p-0 h-auto text-blue-600 hover:underline"
                          >
                            {t('viewTestExecution')}
                          </Button>
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {new Date(defect.created_at).toLocaleDateString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {defect.steps_to_reproduce && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">{t('stepsToReproduce')}:</h4>
                    <div className="bg-gray-50 p-3 rounded-md">
                      <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{defect.steps_to_reproduce}</pre>
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  {(defect.sync_status || defect.external_sync_status) === 'synced' && defect.external_issue_url && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleViewInExternal(defect.external_issue_url)}
                      className="flex items-center gap-1"
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      View in Tracker
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleOpenSyncDialog(defect.id)}
                    disabled={integrations.length === 0}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Sync
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleEditDefect(defect)}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  {(defect.external_issue_url || defect.jira_link) && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleLinkToJira(defect)}
                      className="flex items-center gap-1"
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      Jira
                    </Button>
                  )}
                  {defect.test_case_id && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleLinkToTestCase(defect)}
                    >
                      Test Execution
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleDeleteDefect(defect.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Bug className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
                <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {searchQuery ? t('noDefectsFound') : t('noDefectsReported')}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {searchQuery
                    ? t('noDefectsFoundDesc')
                    : t('noDefectsReportedDesc')
                  }
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-lg shadow mt-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {t('showingDefects', { start: startIndex + 1, end: Math.min(startIndex + itemsPerPage, filteredDefects.length), total: filteredDefects.length })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('previous')}
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
            >
              {t('next')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Integration Form Dialog */}
      <Dialog open={isIntegrationFormOpen} onOpenChange={setIsIntegrationFormOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingIntegration ? t('editIntegration') : t('addIntegrationTitle')}
            </DialogTitle>
            <DialogDescription>
              {editingIntegration 
                ? t('updateIntegrationConfiguration')
                : t('configureNewIntegration')
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="integration-name">{t('integrationNameLabel')} *</Label>
                <Input
                  id="integration-name"
                  ref={nameInputRef}
                  placeholder={getPlaceholders().name}
                  value={integrationForm.name}
                  onChange={(e) => setIntegrationForm({...integrationForm, name: e.target.value})}
                  onBlur={() => setTouchedFields({...touchedFields, name: true})}
                  className={touchedFields.name && validationErrors.name ? 'border-red-500' : ''}
                />
                {touchedFields.name && validationErrors.name && (
                  <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.name}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="tracker-type">{t('trackerType')} *</Label>
                <Select
                  value={integrationForm.tracker_type}
                  onValueChange={(value) => {
                    setIntegrationForm({...integrationForm, tracker_type: value});
                    // Clear project key error when changing tracker type
                    if (value !== integrationForm.tracker_type) {
                      setValidationErrors({...validationErrors, project_key: ''});
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jira">Jira</SelectItem>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="gitlab">GitLab</SelectItem>
                    <SelectItem value="azure-devops">Azure DevOps</SelectItem>
                    <SelectItem value="linear">Linear</SelectItem>
                    <SelectItem value="asana">Asana</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-url">{t('apiUrlLabel')} *</Label>
              <Input
                id="api-url"
                ref={apiUrlInputRef}
                placeholder={getPlaceholders().apiUrl}
                value={integrationForm.api_url}
                onChange={(e) => setIntegrationForm({...integrationForm, api_url: e.target.value})}
                onBlur={() => setTouchedFields({...touchedFields, api_url: true})}
                className={touchedFields.api_url && validationErrors.api_url ? 'border-red-500' : ''}
              />
              {touchedFields.api_url && validationErrors.api_url && (
                <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.api_url}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('usernameEmail')}</Label>
                <Input
                  id="username"
                  placeholder={t('usernameEmailPlaceholder')}
                  value={integrationForm.username}
                  onChange={(e) => setIntegrationForm({...integrationForm, username: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-token">{t('apiTokenLabel')} {(!editingIntegration) ? '*' : ''}</Label>
                <Input
                  id="api-token"
                  ref={tokenInputRef}
                  type="password"
                  placeholder={editingIntegration ? t('leaveBlankToKeepExistingToken') : t('enterApiToken')}
                  value={integrationForm.api_token}
                  onChange={(e) => setIntegrationForm({...integrationForm, api_token: e.target.value})}
                  onBlur={() => setTouchedFields({...touchedFields, api_token: true})}
                  className={touchedFields.api_token && validationErrors.api_token ? 'border-red-500' : ''}
                />
                {touchedFields.api_token && validationErrors.api_token && (
                  <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.api_token}</p>
                )}
                <p className="text-xs text-gray-500">
                  {t('tokenEncryptedSecurely')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-key">{getPlaceholders().projectKeyLabel} *</Label>
              <Input
                id="project-key"
                ref={projectKeyInputRef}
                placeholder={getPlaceholders().projectKey}
                value={integrationForm.project_key}
                onChange={(e) => setIntegrationForm({...integrationForm, project_key: e.target.value})}
                onBlur={() => setTouchedFields({...touchedFields, project_key: true})}
                className={touchedFields.project_key && validationErrors.project_key ? 'border-red-500' : ''}
              />
              {touchedFields.project_key && validationErrors.project_key && (
                <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.project_key}</p>
              )}
              <p className="text-xs text-gray-500">
                {getPlaceholders().projectKeyDesc}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sync-direction">{t('syncDirection')}</Label>
              <Select
                value={integrationForm.sync_direction}
                onValueChange={(value) => setIntegrationForm({...integrationForm, sync_direction: value})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="import">{t('importOnly', { appName })}</SelectItem>
                  <SelectItem value="export">{t('exportOnly', { appName })}</SelectItem>
                  <SelectItem value="bidirectional">{t('bidirectional')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is-active"
                checked={integrationForm.is_active}
                onChange={(e) => setIntegrationForm({...integrationForm, is_active: e.target.checked})}
                className="h-4 w-4"
              />
              <Label htmlFor="is-active">{t('enableThisIntegration')}</Label>
            </div>

            {editingIntegration && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <AlertCircle className="h-4 w-4 inline mr-2" />
                  {t('leaveApiTokenBlank')}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsIntegrationFormOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSaveIntegration}>
              {editingIntegration ? t('updateIntegration') : t('createIntegration')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Dialog */}
      <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('syncDefectWithExternal')}</DialogTitle>
            <DialogDescription>
              {t('syncDefectWithExternalDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sync-integration">{t('selectIntegration')} *</Label>
              <Select
                value={selectedSyncIntegrationId?.toString()}
                onValueChange={(value) => setSelectedSyncIntegrationId(parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('selectAnIntegration')} />
                </SelectTrigger>
                <SelectContent>
                  {integrations.map((integration) => (
                    <SelectItem key={integration.id} value={integration.id.toString()}>
                      <div className="flex items-center gap-2">
                        <span className="capitalize">{integration.tracker_type}</span>
                        <span className="text-gray-500">- {integration.name}</span>
                        {!integration.is_active && <Badge variant="outline" className="text-xs ml-2">{t('inactive')}</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {integrations.length === 0 && (
              <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                <p>{t('noIntegrationsAvailable')}</p>
              </div>
            )}

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <AlertCircle className="h-4 w-4 inline mr-2" />
                {t('defectWillBeSynced')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSyncDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSyncWithExternal} disabled={!selectedSyncIntegrationId || isSyncing}>
              {isSyncing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('syncingDefect')}
                </div>
              ) : (
                t('syncDefect')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Defect Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('editDefectTitle', { id: editingDefect?.defect_id || '' })}</DialogTitle>
            <DialogDescription>
              {t('editDefectDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectId" className="text-right">
                {t('defectId')}
              </Label>
              <Input
                id="editDefectId"
                value={defectId}
                onChange={(e) => setDefectId(e.target.value)}
                className="col-span-3"
                placeholder={t('defectIdPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectTitle" className="text-right">
                {t('title')}
              </Label>
              <Input
                id="editDefectTitle"
                value={defectTitle}
                onChange={(e) => setDefectTitle(e.target.value)}
                className="col-span-3"
                placeholder={t('defectTitlePlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="editDefectDescription" className="text-right pt-2">
                {t('description')}
              </Label>
              <Textarea
                id="editDefectDescription"
                value={defectDescription}
                onChange={(e) => setDefectDescription(e.target.value)}
                className="col-span-3"
                placeholder={t('defectDescriptionPlaceholder')}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectStatus" className="text-right">
                {t('status')}
              </Label>
              <Select value={defectStatus} onValueChange={setDefectStatus}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('defectSelectStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{t('open')}</SelectItem>
                  <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
                  <SelectItem value="fixed">{t('fixed')}</SelectItem>
                  <SelectItem value="closed">{t('closed')}</SelectItem>
                  <SelectItem value="rejected">{t('rejected')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectSeverity" className="text-right">
                {t('defectSeverity')}
              </Label>
              <Select value={defectSeverity} onValueChange={setDefectSeverity}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('selectSeverity')} />
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
              <Label htmlFor="editDefectPriority" className="text-right">
                {t('defectPriority')}
              </Label>
              <Select value={defectPriority} onValueChange={setDefectPriority}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('selectPriority')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('low')}</SelectItem>
                  <SelectItem value="medium">{t('medium')}</SelectItem>
                  <SelectItem value="high">{t('high')}</SelectItem>
                  <SelectItem value="urgent">{t('urgent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="editDefectSteps" className="text-right pt-2">
                {t('stepsToReproduce')}
              </Label>
              <Textarea
                id="editDefectSteps"
                value={defectSteps}
                onChange={(e) => setDefectSteps(e.target.value)}
                className="col-span-3"
                placeholder={t('stepsToReproducePlaceholder')}
                rows={4}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectEnvironment" className="text-right">
                {t('environmentLabel')}
              </Label>
              <Input
                id="editDefectEnvironment"
                value={defectEnvironment}
                onChange={(e) => setDefectEnvironment(e.target.value)}
                className="col-span-3"
                placeholder={t('environmentPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectJiraLink" className="text-right">
                {t('jiraLink')}
              </Label>
              <Input
                id="editDefectJiraLink"
                value={defectJiraLink}
                onChange={(e) => setDefectJiraLink(e.target.value)}
                className="col-span-3"
                placeholder={t('jiraLinkPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectTags" className="text-right">
                {t('tags')}
              </Label>
              <Input
                id="editDefectTags"
                value={defectTags}
                onChange={(e) => setDefectTags(e.target.value)}
                className="col-span-3"
                placeholder={t('tagsPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="editDefectTestCase" className="text-right">
                {t('testCase')}
              </Label>
              <SearchableTestCaseSelect
                id="editDefectTestCase"
                value={defectTestCaseId}
                onChange={setDefectTestCaseId}
                testCases={testCases}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              onClick={handleUpdateDefect}
              disabled={!defectId.trim() || !defectTitle.trim()}
            >
              {t('updateDefect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!integrationToDelete} onOpenChange={(open) => !open && setIntegrationToDelete(null)}>
        <AlertDialogContent isRTL={isRTL}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDeleteIntegration')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmDeleteIntegrationDesc', { name: integrationToDelete?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteIntegration} className="bg-red-600 hover:bg-red-700">
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
