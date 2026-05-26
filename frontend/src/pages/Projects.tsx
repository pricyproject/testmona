import { useCallback, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, FolderOpen, Settings, Trash2, TestTube, FileText, PlayCircle, ChevronRight, AlertTriangle, Edit, WifiOff, RefreshCw, Archive, Copy, Clock, CheckCircle2, Download, Upload, FileDown, FileUp, Filter, Eye, X, BarChart3, Layers3, Sparkles, Search, ArrowUpDown, User as UserIcon, ChevronLeft, Users } from 'lucide-react';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { projectsAPI } from '@/lib/api';
import { validateProject, getCharacterCount, sanitizeInput } from '@/utils/validation';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useEnhancedApiCall } from '@/hooks/useEnhancedApiCall';
import { useAppName } from '@/hooks/useAppName';
import { getQueueSize } from '@/utils/requestQueue';
import { projectImportExportAPI } from '@/api/projectImportExport';
import { isAdminUser, normalizeRole, USER_ROLES } from '@/utils/roles';
import { useAuthStore } from '@/stores/authStore';
import { ProjectImportPreview } from '@/components/ProjectImportPreview';


export function Projects() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();
  const { appName } = useAppName(false);
  const { selectedProject, setSelectedProject, projects: storeProjects, setProjects: setStoreProjects } = useProjectStore();
  const { user } = useAuthStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [isArchivedLoading, setIsArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackendDown, setIsBackendDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [partialFailure, setPartialFailure] = useState<{ successCount: number; totalCount: number } | null>(null);

  // Enhanced error handling hooks
  const { isOnline, wasOffline, checkBackendConnectivity, isSlowConnection } = useNetworkStatus();
  const { enhancedApiCall, enhancedBulkApiCall, getQueueStatus, clearRequestQueue, processQueuedRequests, isProcessingQueue } = useEnhancedApiCall();
  const [queueSize, setQueueSize] = useState(0);

  // Bulk operations states
  const [selectedProjects, setSelectedProjects] = useState<Set<number>>(new Set());
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isBulkArchiveDialogOpen, setIsBulkArchiveDialogOpen] = useState(false);
  const [bulkConfirmationText, setBulkConfirmationText] = useState('');

  // Advanced features states
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [statusProject, setStatusProject] = useState<Project | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [isCloneDialogOpen, setIsCloneDialogOpen] = useState(false);

  // Search, filter, sort & pagination states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name-asc');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 12;
  const [cloneProject, setCloneProject] = useState<Project | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneDescription, setCloneDescription] = useState('');

  // Import/Export states
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [exportFormat, setExportFormat] = useState('json');
  const [includeData, setIncludeData] = useState(true);
  const [exportFields, setExportFields] = useState('');
  const [exportStatusFilter, setExportStatusFilter] = useState('all');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [mergeStrategy, setMergeStrategy] = useState('skip');
  const [partialImport, setPartialImport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);

  // Check if user has admin/manager role
  const userRole = normalizeRole(user?.role);
  const canImportExport = isAdminUser(user) || userRole === USER_ROLES.MANAGER;

  const fetchArchivedProjects = useCallback(async () => {
    setIsArchivedLoading(true);
    setArchivedError(null);

    const result = await enhancedApiCall(
      () => projectsAPI.getAll(0, 100, { status: 'archived' }),
      {
        maxRetries: 3,
        retryDelay: 1000,
        timeout: 30000,
        onRetry: (attempt, error) => {
          console.log(`Retrying archived projects fetch (attempt ${attempt}):`, error);
          setRetryCount(attempt);
        },
      }
    );

    if (result.data) {
      setArchivedProjects(result.data);
    } else {
      console.error('Failed to fetch archived projects:', result.error);
      setArchivedProjects([]);
      setArchivedError(result.error?.message || t('archivedProjectsFetchFailed'));
    }

    setIsArchivedLoading(false);
  }, [enhancedApiCall, t]);

  // Initialize projects on component mount with enhanced error handling
  useEffect(() => {
    const initializeProjects = async () => {
      setIsLoading(true);
      setError(null);
      setIsRetrying(false);
      setRetryCount(0);

      const result = await enhancedApiCall(
        () => projectsAPI.getAll(0, 100, { includeArchived: false }),
        {
          maxRetries: 3,
          retryDelay: 1000,
          timeout: 30000,
          onRetry: (attempt, error) => {
            console.log(`Retrying projects fetch (attempt ${attempt}):`, error);
            setIsRetrying(true);
            setRetryCount(attempt);
          },
        }
      );

      if (result.data) {
        setProjects(result.data);
        setStoreProjects(result.data);
        setIsBackendDown(false);
        setError(null);
      } else {
        console.error('Failed to fetch projects:', result.error);
        setIsBackendDown(true);
        setProjects([]);
        setStoreProjects([]);
        setError(result.error?.message || 'Unable to connect to the backend server. Please check your connection and try again.');
      }

      setIsRetrying(false);
      setIsLoading(false);
    };

    initializeProjects();
  }, [enhancedApiCall, setStoreProjects]);

  useEffect(() => {
    if (showArchivedProjects && !isBackendDown) {
      fetchArchivedProjects();
    }
  }, [fetchArchivedProjects, isBackendDown, showArchivedProjects]);

  // Monitor queue size
  useEffect(() => {
    const updateQueueSize = () => {
      setQueueSize(getQueueSize());
    };

    updateQueueSize();
    const interval = setInterval(updateQueueSize, 5000);

    return () => clearInterval(interval);
  }, []);

  // Process queued requests when connection is restored
  useEffect(() => {
    if (isOnline && wasOffline && queueSize > 0) {
      console.log('Connection restored, processing queued requests');
      processQueuedRequests();
    }
  }, [isOnline, wasOffline, queueSize, processQueuedRequests]);

  // Auto-focus on project name input when dialog opens
  useEffect(() => {
    if (isDialogOpen && projectNameInputRef.current) {
      setTimeout(() => projectNameInputRef.current?.focus(), 100);
    }
  }, [isDialogOpen]);

  // Track unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(projectName.trim() !== '' || projectDescription.trim() !== '');
  }, [projectName, projectDescription]);

  const handleCreateProject = async () => {
    if (!isOnline) {
      toast({
        title: t('offlineMode'),
        description: t('currentlyOfflineRequestQueued'),
        variant: "default",
      });
      return;
    }

    try {
      setIsCreating(true);
      setIsRetrying(true);
      const result = await enhancedApiCall(
        () => projectsAPI.create({
          name: projectName,
          description: projectDescription,
          status: 'active',
        }),
        {
          maxRetries: 3,
          retryDelay: 1000,
          onRetry: (attempt, error) => {
            console.log(`Retrying project creation (attempt ${attempt}):`, error);
            setRetryCount(attempt);
          },
        }
      );
      setIsRetrying(false);

      if (result.data) {
        const updatedProjects = [...projects, result.data];
        setProjects(updatedProjects);
        setStoreProjects(updatedProjects);

        toast({
          title: t('success'),
          description: t('projectCreatedSuccessfully', {name: projectName}),
        });

        setProjectName('');
        setProjectDescription('');
        setHasUnsavedChanges(false);
        setIsDialogOpen(false);
      } else {
        console.error('Error creating project:', result.error);
        const errorMessage = result.error?.response?.data?.detail || result.error?.message || t('failedToCreateProject');
        toast({
          title: t('error'),
          description: errorMessage,
          variant: "destructive",
        });
      }
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
        setProjectName('');
        setProjectDescription('');
        setHasUnsavedChanges(false);
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      setProjectName('');
      setProjectDescription('');
      setHasUnsavedChanges(false);
      setIsDialogOpen(false);
    }
  };

  const handleSubmitOnEnter = (
    e: React.KeyboardEvent,
    handler: () => void,
    canSubmit = true
  ) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !canSubmit) {
      return;
    }

    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    if (tagName === 'textarea' || tagName === 'button' || target.isContentEditable) {
      return;
    }

    e.preventDefault();
    handler();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    handleSubmitOnEnter(e, handleCreateProject, Boolean(projectName.trim()) && !isCreating);
  };

  const handleSelectAndNavigate = (project: Project, path: string) => {
    setSelectedProject(project);
    navigate(path);
  };

  const handleViewTestSuites = (project: Project) => {
    handleSelectAndNavigate(project, `/projects/${project.id}/test-suites`);
  };

  const handleViewTestCases = (project: Project) => {
    handleSelectAndNavigate(project, `/projects/${project.id}/test-cases`);
  };

  const handleViewTestRuns = (project: Project) => {
    handleSelectAndNavigate(project, `/projects/${project.id}/test-runs`);
  };

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project);
    // Navigate to project overview or test cases
    navigate(`/projects/${project.id}/test-cases`);
  };

  const handleOpenDeleteDialog = (project: Project) => {
    setProjectToDelete(project);
    setDeleteConfirmationName('');
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteProject = async () => {
    if (!isOnline) {
      toast({
        title: t('offlineMode'),
        description: t('cannotDeleteProjectOffline'),
        variant: "destructive",
      });
      return;
    }

    // Verify the project name matches
    if (deleteConfirmationName !== projectToDelete.name) {
      toast({
        title: t('error'),
        description: t('projectNameDoesntMatch'),
        variant: "destructive",
      });
      return;
    }

    setIsRetrying(true);
    const result = await enhancedApiCall(
      () => projectsAPI.delete(projectToDelete.id),
      {
        maxRetries: 3,
        retryDelay: 1000,
        onRetry: (attempt, error) => {
          console.log(`Retrying project deletion (attempt ${attempt}):`, error);
          setRetryCount(attempt);
        },
      }
    );
    setIsRetrying(false);

    if (result.data) {
      const updatedProjects = projects.filter(p => p.id !== projectToDelete.id);
      const updatedArchivedProjects = archivedProjects.filter(p => p.id !== projectToDelete.id);
      setProjects(updatedProjects);
      setArchivedProjects(updatedArchivedProjects);
      setStoreProjects(updatedProjects);

      toast({
        title: t('success'),
        description: t('projectDeletedSuccessfully', {name: projectToDelete.name}),
      });

      setIsDeleteDialogOpen(false);
      setProjectToDelete(null);
      setDeleteConfirmationName('');
    } else {
      console.error('Error deleting project:', result.error);
      const errorMessage = result.error?.response?.data?.detail || result.error?.message || t('failedToDeleteProject');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleOpenEditDialog = (project: Project) => {
    setEditingProject(project);
    setProjectName(project.name);
    setProjectDescription(project.description || '');
    setIsEditDialogOpen(true);
  };

  const handleUpdateProject = async () => {
    if (!isOnline) {
      toast({
        title: t('offlineMode'),
        description: t('cannotUpdateProjectOffline'),
        variant: "default",
      });
      return;
    }

    setIsRetrying(true);
    const result = await enhancedApiCall(
      () => projectsAPI.update(editingProject.id, {
        name: projectName,
        description: projectDescription,
      }),
      {
        maxRetries: 3,
        retryDelay: 1000,
        onRetry: (attempt, error) => {
          console.log(`Retrying project update (attempt ${attempt}):`, error);
          setRetryCount(attempt);
        },
      }
    );
    setIsRetrying(false);

    if (result.data) {
      const updatedProjects = projects.map(p =>
        p.id === editingProject.id ? { ...p, name: projectName, description: projectDescription, updated_at: new Date().toISOString() } : p
      );
      const updatedArchivedProjects = archivedProjects.map(p =>
        p.id === editingProject.id ? { ...p, name: projectName, description: projectDescription, updated_at: new Date().toISOString() } : p
      );
      setProjects(updatedProjects);
      setArchivedProjects(updatedArchivedProjects);
      setStoreProjects(updatedProjects);

      toast({
        title: t('success'),
        description: t('projectUpdatedSuccessfully'),
      });

      setIsEditDialogOpen(false);
      setEditingProject(null);
      setProjectName('');
      setProjectDescription('');
    } else {
      console.error('Error updating project:', result.error);
      const errorMessage = result.error?.response?.data?.detail || result.error?.message || t('failedToUpdateProject');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  // Bulk operations handlers
  const toggleProjectSelection = (projectId: number) => {
    const newSelection = new Set(selectedProjects);
    if (newSelection.has(projectId)) {
      newSelection.delete(projectId);
    } else {
      newSelection.add(projectId);
    }
    setSelectedProjects(newSelection);
  };

  const toggleAllProjects = () => {
    if (selectedProjects.size === projects.length) {
      setSelectedProjects(new Set());
    } else {
      setSelectedProjects(new Set(projects.map(p => p.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProjects.size === 0) return;

    if (!isOnline) {
      toast({
        title: "Offline Mode",
        description: "Cannot delete projects while offline. Please check your connection.",
        variant: "destructive",
      });
      return;
    }

    if (bulkConfirmationText !== `DELETE ${selectedProjects.size}`) {
      toast({
        title: "Error",
        description: "Confirmation text doesn't match. Please type exact confirmation text.",
        variant: "destructive",
      });
      return;
    }

    setIsRetrying(true);
    const deleteMethods = Array.from(selectedProjects).map(id => () => projectsAPI.delete(id));
    const bulkResult = await enhancedBulkApiCall(deleteMethods, {
      maxRetries: 3,
      retryDelay: 1000,
      onPartialSuccess: (successCount, totalCount) => {
        setPartialFailure({ successCount, totalCount });
      },
    });
    setIsRetrying(false);

    if (bulkResult.successCount > 0) {
      const successfullyDeletedIds = bulkResult.results
        .map((result, index) => result.data ? Array.from(selectedProjects)[index] : null)
        .filter(id => id !== null) as number[];

      const updatedProjects = projects.filter(p => !successfullyDeletedIds.includes(p.id));
      setProjects(updatedProjects);
      setStoreProjects(updatedProjects);

      if (bulkResult.failureCount > 0) {
        toast({
          title: "Partial Success",
          description: `${bulkResult.successCount} of ${bulkResult.results.length} project(s) deleted successfully. ${bulkResult.failureCount} failed.`,
          variant: "default",
        });
      } else {
        toast({
          title: "Success",
          description: `${bulkResult.successCount} project(s) deleted successfully.`,
        });
      }

      setSelectedProjects(new Set());
      setIsBulkDeleteDialogOpen(false);
      setBulkConfirmationText('');
      setPartialFailure(null);
    } else {
      console.error('Error bulk deleting projects:', bulkResult.results[0].error);
      const errorMessage = bulkResult.results[0].error?.response?.data?.detail || bulkResult.results[0].error?.message || "Failed to delete projects. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleBulkArchive = async () => {
    if (selectedProjects.size === 0) return;

    if (!isOnline) {
      toast({
        title: "Offline Mode",
        description: "Cannot archive projects while offline. The request has been queued.",
        variant: "default",
      });
      return;
    }

    setIsRetrying(true);
    const archiveMethods = Array.from(selectedProjects).map(id => () =>
      projectsAPI.update(id, { status: 'archived' })
    );
    const bulkResult = await enhancedBulkApiCall(archiveMethods, {
      maxRetries: 3,
      retryDelay: 1000,
      onPartialSuccess: (successCount, totalCount) => {
        setPartialFailure({ successCount, totalCount });
      },
    });
    setIsRetrying(false);

    if (bulkResult.successCount > 0) {
      const successfullyArchivedIds = bulkResult.results
        .map((result, index) => result.data ? Array.from(selectedProjects)[index] : null)
        .filter(id => id !== null) as number[];

      const archivedNow = projects
        .filter(p => successfullyArchivedIds.includes(p.id))
        .map(p => ({ ...p, status: 'archived' }));
      const updatedProjects = projects.filter(p => !successfullyArchivedIds.includes(p.id));
      setProjects(updatedProjects);
      if (showArchivedProjects) {
        setArchivedProjects(prev => [...archivedNow, ...prev.filter(p => !successfullyArchivedIds.includes(p.id))]);
      }
      setStoreProjects(updatedProjects);

      if (bulkResult.failureCount > 0) {
        toast({
          title: "Partial Success",
          description: `${bulkResult.successCount} of ${bulkResult.results.length} project(s) archived successfully. ${bulkResult.failureCount} failed.`,
          variant: "default",
        });
      } else {
        toast({
          title: "Success",
          description: `${bulkResult.successCount} project(s) archived successfully.`,
        });
      }

      setSelectedProjects(new Set());
      setIsBulkArchiveDialogOpen(false);
      setPartialFailure(null);
    } else {
      console.error('Error bulk archiving projects:', bulkResult.results[0].error);
      const errorMessage = bulkResult.results[0].error?.response?.data?.detail || bulkResult.results[0].error?.message || "Failed to archive projects. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  // Advanced features handlers
  const handleStatusChange = async () => {
    if (!statusProject) return;

    if (!isOnline) {
      toast({
        title: "Offline Mode",
        description: "Cannot update project status while offline. The request has been queued.",
        variant: "default",
      });
      return;
    }

    setIsRetrying(true);
    const result = await enhancedApiCall(
      () => projectsAPI.update(statusProject.id, { status: newStatus }),
      {
        maxRetries: 3,
        retryDelay: 1000,
        onRetry: (attempt, error) => {
          console.log(`Retrying status change (attempt ${attempt}):`, error);
          setRetryCount(attempt);
        },
      }
    );
    setIsRetrying(false);

    if (result.data) {
      const updatedProject = { ...statusProject, ...result.data, status: newStatus };
      const updatedProjects = newStatus === 'archived'
        ? projects.filter(p => p.id !== statusProject.id)
        : projects.some(p => p.id === statusProject.id)
          ? projects.map(p => p.id === statusProject.id ? updatedProject : p)
          : [updatedProject, ...projects];
      const updatedArchivedProjects = newStatus === 'archived'
        ? [updatedProject, ...archivedProjects.filter(p => p.id !== statusProject.id)]
        : archivedProjects.filter(p => p.id !== statusProject.id);

      setProjects(updatedProjects);
      setArchivedProjects(updatedArchivedProjects);
      setStoreProjects(updatedProjects);

      toast({
        title: "Success",
        description: `Project status changed to ${newStatus}.`,
      });

      setIsStatusDialogOpen(false);
      setStatusProject(null);
      setNewStatus('');
    } else {
      console.error('Error updating project status:', result.error);
      const errorMessage = result.error?.response?.data?.detail || result.error?.message || "Failed to update project status. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleCloneProject = async () => {
    if (!cloneProject || !cloneName.trim()) return;

    if (!isOnline) {
      toast({
        title: "Offline Mode",
        description: "Cannot clone project while offline. The request has been queued.",
        variant: "default",
      });
      return;
    }

    setIsRetrying(true);
    const result = await enhancedApiCall(
      () => projectsAPI.clone(cloneProject.id, {
        name: sanitizeInput(cloneName),
        description: sanitizeInput(cloneDescription),
      }),
      {
        maxRetries: 3,
        retryDelay: 1000,
        onRetry: (attempt, error) => {
          console.log(`Retrying project clone (attempt ${attempt}):`, error);
          setRetryCount(attempt);
        },
      }
    );
    setIsRetrying(false);

    if (result.data) {
      // Refresh from the server so the clone's test suite/case counts are accurate.
      const refreshResult = await enhancedApiCall(() => projectsAPI.getAll(0, 100, { includeArchived: false }));
      if (refreshResult.data) {
        setProjects(refreshResult.data);
        setStoreProjects(refreshResult.data);
      } else {
        const updatedProjects = [...projects, result.data];
        setProjects(updatedProjects);
        setStoreProjects(updatedProjects);
      }

      toast({
        title: "Success",
        description: `Project "${cloneName}" cloned successfully.`,
      });

      setIsCloneDialogOpen(false);
      setCloneProject(null);
      setCloneName('');
      setCloneDescription('');
    } else {
      console.error('Error cloning project:', result.error);
      const errorMessage = result.error?.response?.data?.detail || result.error?.message || "Failed to clone project. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  // Import/Export handlers
  const handleExportProjects = async () => {
    if (!canImportExport) {
      toast({
        title: "Access Denied",
        description: "Only admin and manager roles can export projects",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      const result = await projectImportExportAPI.exportProjects(
        undefined, // Export all projects
        exportFormat,
        includeData,
        exportFields || undefined,
        // 'all' is a UI-only sentinel; sending it to the backend is rejected.
        exportStatusFilter && exportStatusFilter !== 'all' ? exportStatusFilter : undefined
      );

      if (result) {
        projectImportExportAPI.downloadExport(
          result.filename,
          result.content,
          result.media_type
        );

        toast({
          title: "Success",
          description: `Projects exported successfully as ${exportFormat.toUpperCase()}`,
        });

        setIsExportDialogOpen(false);
      }
    } catch (error: any) {
      console.error('Error exporting projects:', error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to export projects. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;

    if (!file) {
      setImportFile(null);
      setValidationResult(null);
      return;
    }

    // Client-side file validation
    const validationErrors = [];

    // Validate file size (10MB limit)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      validationErrors.push(`File size exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    }

    // Validate file type
    if (!file.name.endsWith('.json') && !file.name.endsWith('.csv')) {
      validationErrors.push("Only JSON and CSV files are supported");
    }

    // Validate file name
    if (file.name.length > 255) {
      validationErrors.push("File name is too long (max 255 characters)");
    }

    // Validate file content (basic check)
    if (file.size === 0) {
      validationErrors.push("File is empty");
    }

    if (validationErrors.length > 0) {
      toast({
        title: "File Validation Failed",
        description: validationErrors.join("; "),
        variant: "destructive",
      });
      setImportFile(null);
      return;
    }

    setImportFile(file);
    setValidationResult(null);
  };

  const handleValidateImport = async () => {
    if (!importFile) {
      toast({
        title: "No File Selected",
        description: "Please select a file to import",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await projectImportExportAPI.validateProjectImport(importFile);
      setValidationResult(result);

      if (result.valid) {
        toast({
          title: "Validation Successful",
          description: `All ${result.valid_rows} rows are valid`,
        });
        setShowImportPreview(true);
      } else {
        toast({
          title: "Validation Completed",
          description: `${result.valid_rows} valid, ${result.invalid_rows} invalid rows. Review in preview.`,
          variant: result.invalid_rows > 0 ? "destructive" : "default",
        });
        setShowImportPreview(true);
      }
    } catch (error: any) {
      console.error('Error validating import file:', error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to validate file. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleImportProjects = async (strategy: string, partial: boolean, selectedRows: number[]) => {
    if (!canImportExport) {
      toast({
        title: "Access Denied",
        description: "Only admin and manager roles can import projects",
        variant: "destructive",
      });
      return;
    }

    if (!importFile) {
      toast({
        title: "No File Selected",
        description: "Please select a file to import",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    try {
      const result = await projectImportExportAPI.importProjects(importFile, strategy, partial, selectedRows);

      toast({
        title: "Import Completed",
        description: result.message,
      });

      // Refresh projects list
      const refreshResult = await enhancedApiCall(() => projectsAPI.getAll(0, 100, { includeArchived: false }));
      if (refreshResult.data) {
        setProjects(refreshResult.data);
        setStoreProjects(refreshResult.data);
      }
      if (showArchivedProjects) {
        fetchArchivedProjects();
      }

      setIsImportDialogOpen(false);
      setShowImportPreview(false);
      setImportFile(null);
      setValidationResult(null);
    } catch (error: any) {
      console.error('Error importing projects:', error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to import projects. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownloadTemplate = async (format: string) => {
    try {
      const result = await projectImportExportAPI.getProjectImportTemplate(format);

      projectImportExportAPI.downloadExport(
        result.filename,
        result.content,
        result.media_type
      );

      toast({
        title: "Template Downloaded",
        description: `Import template downloaded as ${format.toUpperCase()}`,
      });
    } catch (error: any) {
      console.error('Error downloading template:', error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to download template. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const projectSummary = projects.reduce(
    (summary, project) => ({
      active: summary.active + (project.status === 'active' ? 1 : 0),
      inactive: summary.inactive + (project.status === 'inactive' ? 1 : 0),
      suites: summary.suites + (project.test_suites_count ?? 0),
      cases: summary.cases + (project.test_cases_count ?? 0),
      runs: summary.runs + (project.test_runs_count ?? 0),
    }),
    { active: 0, inactive: 0, suites: 0, cases: 0, runs: 0 }
  );

  // Apply search, status filter and sort, then paginate (all client-side).
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredProjects = projects
    .filter((project) => {
      const matchesSearch =
        normalizedQuery === '' ||
        project.name.toLowerCase().includes(normalizedQuery) ||
        (project.description || '').toLowerCase().includes(normalizedQuery);
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'created-desc':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'created-asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'cases-desc':
          return (b.test_cases_count ?? 0) - (a.test_cases_count ?? 0);
        case 'name-asc':
        default:
          return a.name.localeCompare(b.name);
      }
    });

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedProjects = filteredProjects.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasActiveFilters = normalizedQuery !== '' || statusFilter !== 'all';
  const rangeStart = filteredProjects.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filteredProjects.length);

  // Reset to the first page whenever the filters change.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, sortBy]);

  const clearProjectFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
  };

  const getProjectStatusLabel = (status: string) => {
    const statusLabels: Record<string, string> = {
      active: t('projectStatusActive'),
      inactive: t('projectStatusInactive'),
      archived: t('projectStatusArchived'),
    };

    return statusLabels[status] || status.charAt(0).toUpperCase() + status.slice(1);
  };

  const getProjectStatusClasses = (status: string) => {
    const statusClasses: Record<string, string> = {
      active: 'border-primary/30 bg-primary/10 text-primary',
      inactive: 'border-secondary bg-secondary text-secondary-foreground',
      archived: 'border-muted bg-muted text-muted-foreground',
    };

    return statusClasses[status] || 'border-accent bg-accent text-accent-foreground';
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Network Status Alert */}
      {(!isOnline || isBackendDown) && (
        <Card className={`${!isOnline ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}>
          <CardContent className="pt-6">
            <div className="flex items-start space-x-4">
              <div className="shrink-0">
                {!isOnline ? (
                  <WifiOff className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                ) : (
                  <WifiOff className="h-6 w-6 text-red-600 dark:text-red-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`text-sm font-medium ${!isOnline ? 'text-yellow-800 dark:text-yellow-200' : 'text-red-800 dark:text-red-200'}`}>
                  {!isOnline ? t('youAreOffline') : t('backendUnavailable')}
                </h3>
                <p className={`mt-1 text-sm ${!isOnline ? 'text-yellow-700 dark:text-yellow-300' : 'text-red-700 dark:text-red-300'}`}>
                  {!isOnline
                    ? t('youAreOfflineDesc')
                    : (error || t('backendConnectionLostDesc'))}
                </p>
                {isRetrying && (
                  <div className="mt-2 flex items-center text-sm text-blue-600 dark:text-blue-400">
                    <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'} animate-spin`} />
                    {t('retrying')} ({t('attempt')} {retryCount}/3)
                  </div>
                )}
                <div className="mt-3 flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.location.reload()}
                    className={`${!isOnline ? 'text-yellow-700 border-yellow-300 hover:bg-yellow-100 dark:text-yellow-300 dark:border-yellow-700 dark:hover:bg-yellow-900/30' : 'text-red-700 border-red-300 hover:bg-red-100 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900/30'}`}
                  >
                    <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                    {t('retryConnection')}
                  </Button>
                  {!isOnline && queueSize > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={processQueuedRequests}
                      disabled={isProcessingQueue}
                      className="text-yellow-700 border-yellow-300 hover:bg-yellow-100 dark:text-yellow-300 dark:border-yellow-700 dark:hover:bg-yellow-900/30"
                    >
                      <Clock className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                      {t('processQueue')} ({queueSize})
                    </Button>
                  )}
                  {queueSize > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearRequestQueue}
                      className={`${!isOnline ? 'text-yellow-700 border-yellow-300 hover:bg-yellow-100 dark:text-yellow-300 dark:border-yellow-700 dark:hover:bg-yellow-900/30' : 'text-red-700 border-red-300 hover:bg-red-100 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900/30'}`}
                    >
                      {t('clearQueue')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Partial Failure Alert */}
      {partialFailure && (
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20">
          <CardContent className="pt-6">
            <div className="flex items-start space-x-4">
              <div className="shrink-0">
                <AlertTriangle className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-orange-800 dark:text-orange-200">{t('partialFailure')}</h3>
                <p className="mt-1 text-sm text-orange-700 dark:text-orange-300">
                  {t('partialFailureDesc', { successCount: partialFailure.successCount, totalCount: partialFailure.totalCount })}
                </p>
                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPartialFailure(null)}
                    className="text-orange-700 border-orange-300 hover:bg-orange-100 dark:text-orange-300 dark:border-orange-700 dark:hover:bg-orange-900/30"
                  >
                    {t('dismiss')}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Slow Connection Warning */}
      {isOnline && isSlowConnection && (
        <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {t('slowConnection')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="relative overflow-hidden rounded-4xl border border-border bg-card text-card-foreground shadow-2xl shadow-muted/50">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_34%),radial-gradient(circle_at_bottom_right,hsl(var(--accent)/0.42),transparent_30%)]" />
        <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full border border-border bg-muted/30 blur-xs" />
        <div className="absolute -bottom-24 left-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <Badge className="w-fit border border-primary/30 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/15">
                <Sparkles className={`h-3.5 w-3.5 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('projectCommandCenter')}
              </Badge>
              <div>
                <h1 className="text-4xl font-black tracking-tight sm:text-5xl">{t('projectsTitle')}</h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                  {isBackendDown ? t('backendUnavailable') : t('projectsOverviewDesc')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {projects.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsBulkMode(!isBulkMode)}
                  disabled={!isOnline}
                  className="border-border bg-background/80 text-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {isBulkMode ? t('exitBulkMode') : t('bulkSelect')}
                </Button>
              )}
              {canImportExport && (
                <>
                  {projects.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsExportDialogOpen(true)}
                      disabled={!isOnline || isBackendDown}
                      className="border-border bg-background/80 text-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                      {t('export')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsImportDialogOpen(true)}
                    disabled={!isOnline || isBackendDown}
                    className="border-border bg-background/80 text-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Upload className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('import')}
                  </Button>
                </>
              )}
              <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
                <DialogTrigger asChild>
                  <Button disabled={!isOnline} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('addNewProject')}
                  </Button>
                </DialogTrigger>
              </Dialog>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-2xl border border-border bg-background/70 p-4 backdrop-blur-sm">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{t('allProjects')}</div>
              <div className="mt-2 text-3xl font-black">{projects.length}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-4 backdrop-blur-sm">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{t('activeProjects')}</div>
              <div className="mt-2 text-3xl font-black text-primary">{projectSummary.active}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-4 backdrop-blur-sm">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{t('inactiveProjects')}</div>
              <div className="mt-2 text-3xl font-black text-muted-foreground">{projectSummary.inactive}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-4 backdrop-blur-sm">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{t('totalSuites')}</div>
              <div className="mt-2 text-3xl font-black text-primary">{projectSummary.suites}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-4 backdrop-blur-sm">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{t('totalCases')}</div>
              <div className="mt-2 text-3xl font-black text-primary">{projectSummary.cases}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-4 backdrop-blur-sm">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{t('totalRuns')}</div>
              <div className="mt-2 text-3xl font-black text-primary">{projectSummary.runs}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Bulk Operations Bar */}
      {isBulkMode && projects.length > 0 && (
        <div className="rounded-2xl border border-border bg-muted/60 p-4 shadow-xs">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 rounded-full bg-card px-3 py-2 shadow-xs">
                <Checkbox
                  checked={selectedProjects.size === projects.length}
                  onCheckedChange={toggleAllProjects}
                />
                <span className="text-sm font-semibold text-foreground">
                  {selectedProjects.size} {t('selectedOf')} {projects.length}
                </span>
              </div>
              {selectedProjects.size > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsBulkArchiveDialogOpen(true)}
                    disabled={isBackendDown}
                  >
                    <Archive className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                    {t('archive')} ({selectedProjects.size})
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsBulkDeleteDialogOpen(true)}
                    disabled={isBackendDown}
                  >
                    <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                    {t('delete')} ({selectedProjects.size})
                  </Button>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedProjects(new Set())}
              className="self-start lg:self-auto"
            >
              {t('clearSelection')}
            </Button>
          </div>
        </div>
      )}

      {/* Projects List */}
      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">{t('projectPortfolio')}</h2>
            <p className="text-sm text-muted-foreground">{t('projectPortfolioDesc', { count: projects.length })}</p>
          </div>
          {selectedProject && !isBulkMode && (
            <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 px-3 py-1 text-primary">
              {t('selectedProjectLabel', { name: selectedProject.name })}
            </Badge>
          )}
        </div>

        {/* Search, filter & sort toolbar */}
        {!isLoading && !isBackendDown && projects.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isRTL ? 'right-3' : 'left-3'}`} />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('searchProjectsPlaceholder')}
                className={isRTL ? 'pr-9' : 'pl-9'}
                aria-label={t('searchProjectsPlaceholder')}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px]" aria-label={t('filterByStatus')}>
                    <SelectValue placeholder={t('filterByStatus')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allStatuses')}</SelectItem>
                    <SelectItem value="active">{t('active')}</SelectItem>
                    <SelectItem value="inactive">{t('inactive')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[170px]" aria-label={t('sortByLabel')}>
                    <SelectValue placeholder={t('sortByLabel')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name-asc">{t('sortNameAsc')}</SelectItem>
                    <SelectItem value="name-desc">{t('sortNameDesc')}</SelectItem>
                    <SelectItem value="created-desc">{t('sortNewest')}</SelectItem>
                    <SelectItem value="created-asc">{t('sortOldest')}</SelectItem>
                    <SelectItem value="cases-desc">{t('sortMostCases')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Always rendered so showing/hiding it never shifts the controls above. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearProjectFilters}
                className={hasActiveFilters ? '' : 'invisible pointer-events-none'}
                aria-hidden={!hasActiveFilters}
                tabIndex={hasActiveFilters ? 0 : -1}
              >
                <X className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                {t('clearFilters')}
              </Button>
            </div>
          </div>
        )}

        {/* Result count */}
        {!isLoading && !isBackendDown && filteredProjects.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('showingRange', { start: rangeStart, end: rangeEnd, total: filteredProjects.length })}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {isLoading ? (
          <div className="col-span-full overflow-hidden rounded-4xl border border-border bg-card shadow-xs">
            <div className="flex items-center justify-center px-6 py-16">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                </div>
                <p className="mt-4 text-sm font-medium text-muted-foreground">{t('loadingProjects')}</p>
              </div>
            </div>
          </div>
        ) : paginatedProjects.length > 0 ? (
          paginatedProjects.map((project) => {
            const isInactiveProject = project.status === 'inactive';

            return (
            <Card
              key={project.id}
              role="button"
              tabIndex={0}
              aria-label={t('openProjectAria', { name: project.name })}
              aria-pressed={selectedProject?.id === project.id}
              className={`group relative cursor-pointer overflow-hidden rounded-[1.75rem] shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-muted/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                isInactiveProject ? 'border-dashed border-muted-foreground/40 bg-muted/30 hover:border-muted-foreground/60' : 'border-border bg-card hover:border-primary/30'
              } ${
                selectedProject?.id === project.id ? 'ring-2 ring-primary shadow-xl shadow-muted' : ''
              } ${
                selectedProjects.has(project.id) ? 'ring-2 ring-primary/70 shadow-xl shadow-muted' : ''
              }`}
              onClick={() => {
                if (isBulkMode) {
                  toggleProjectSelection(project.id);
                } else {
                  handleSelectProject(project);
                }
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.target !== e.currentTarget) return;
                e.preventDefault();
                if (isBulkMode) {
                  toggleProjectSelection(project.id);
                } else {
                  handleSelectProject(project);
                }
              }}
            >
              <div className={`absolute inset-x-0 top-0 h-0.5 ${isInactiveProject ? 'bg-muted-foreground/50' : 'bg-primary'}`} />
              <CardHeader className="space-y-0 p-4 pb-3">
                <div className="flex items-start gap-3">
                  {isBulkMode && (
                    <Checkbox
                      checked={selectedProjects.has(project.id)}
                      onCheckedChange={() => toggleProjectSelection(project.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1"
                    />
                  )}
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-xs transition-transform group-hover:scale-105 ${
                    isInactiveProject ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
                  }`}>
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <CardTitle className="truncate text-base font-bold tracking-tight text-foreground">{project.name}</CardTitle>
                      {selectedProject?.id === project.id && !isBulkMode && (
                        <ChevronRight className={`h-4 w-4 shrink-0 text-primary ${isRTL ? 'rotate-180' : ''}`} />
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">
                      {project.description || t('noDescription')}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={`px-2 py-0 text-[11px] ${getProjectStatusClasses(project.status)}`}>
                    {getProjectStatusLabel(project.status)}
                  </Badge>
                  {(project.owner_name || project.owner_id) && (
                    <Badge variant="outline" className="flex items-center gap-1 border-border bg-muted px-2 py-0 text-[11px] text-muted-foreground">
                      <UserIcon className="h-3 w-3 shrink-0" />
                      <span className="max-w-[120px] truncate">{project.owner_name || t('ownerIdLabel', { id: project.owner_id })}</span>
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-0">
                {/* Metric tiles double as drill-down navigation */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleViewTestSuites(project); }}
                    title={t('suites')}
                    className="flex flex-col items-center gap-0.5 rounded-lg bg-muted/70 py-2 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <TestTube className={`h-3.5 w-3.5 ${isInactiveProject ? 'text-muted-foreground' : 'text-primary'}`} />
                    <span className="text-lg font-bold leading-none text-foreground">{project.test_suites_count ?? 0}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('suites')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleViewTestCases(project); }}
                    title={t('cases')}
                    className="flex flex-col items-center gap-0.5 rounded-lg bg-muted/70 py-2 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <FileText className={`h-3.5 w-3.5 ${isInactiveProject ? 'text-muted-foreground' : 'text-primary'}`} />
                    <span className="text-lg font-bold leading-none text-foreground">{project.test_cases_count ?? 0}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('cases')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleViewTestRuns(project); }}
                    title={t('runs')}
                    className="flex flex-col items-center gap-0.5 rounded-lg bg-muted/70 py-2 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <PlayCircle className={`h-3.5 w-3.5 ${isInactiveProject ? 'text-muted-foreground' : 'text-primary'}`} />
                    <span className="text-lg font-bold leading-none text-foreground">{project.test_runs_count ?? 0}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('runs')}</span>
                  </button>
                </div>

                {/* Footer: created date + management actions */}
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {t('created')}: {new Date(project.created_at).toLocaleDateString()}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStatusProject(project);
                        setNewStatus(project.status);
                        setIsStatusDialogOpen(true);
                      }}
                      title={t('changeProjectStatus')}
                      className="h-8 w-8 rounded-lg p-0"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditDialog(project);
                      }}
                      title={t('editProject')}
                      className="h-8 w-8 rounded-lg p-0"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/projects/${project.id}/members`);
                      }}
                      title={t('manageMembers')}
                      className="h-8 w-8 rounded-lg p-0"
                    >
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCloneProject(project);
                        setCloneName(`${project.name} (Copy)`);
                        setCloneDescription(project.description || '');
                        setIsCloneDialogOpen(true);
                      }}
                      title={t('cloneProject')}
                      className="h-8 w-8 rounded-lg p-0"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDeleteDialog(project);
                      }}
                      className="h-8 w-8 rounded-lg p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title={t('deleteProject')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })
        ) : projects.length > 0 ? (
          <div className="col-span-full">
            <Card className="overflow-hidden rounded-4xl border-dashed border-border bg-muted/40">
              <CardContent className="px-6 py-14">
                <div className="mx-auto max-w-md text-center">
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Search className="h-8 w-8" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">{t('noProjectsMatchFilters')}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{t('noProjectsMatchFiltersDesc')}</p>
                  <Button variant="outline" size="sm" className="mt-5" onClick={clearProjectFilters}>
                    <X className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                    {t('clearFilters')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : isBackendDown ? (
          <div className="col-span-full">
            <Card className="overflow-hidden rounded-4xl border-dashed border-border bg-muted/40">
              <CardContent className="px-6 py-14">
                <div className="mx-auto max-w-lg text-center">
                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-destructive/10 text-destructive">
                    <WifiOff className="h-10 w-10" />
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-foreground">{t('backendConnectionLost')}</h3>
                  <p className="mt-3 text-muted-foreground">
                    {t('backendConnectionLostDesc')}
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <Button
                      onClick={() => window.location.reload()}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                      {t('retryConnection')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setIsBackendDown(false)}
                    >
                      {t('checkStatus')}
                    </Button>
                  </div>
                  <div className="mt-6 rounded-2xl bg-card p-4 text-sm text-muted-foreground shadow-xs">
                    <p className="font-semibold text-foreground">{t('possibleCauses')}</p>
                    <div className="mt-2 space-y-1">
                      <p>{t('causeBackendNotRunning')}</p>
                      <p>{t('causeNetworkIssues')}</p>
                      <p>{t('causeServerInactive')}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="col-span-full">
            <Card className="relative overflow-hidden rounded-4xl border-dashed border-border bg-card">
              <div className="absolute left-8 top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
              <div className="absolute bottom-8 right-8 h-32 w-32 rounded-full bg-accent/40 blur-2xl" />
              <CardContent className="relative px-6 py-16">
                <div className="mx-auto max-w-xl text-center">
                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-xl shadow-muted">
                    <FolderOpen className="h-10 w-10" />
                  </div>
                  <h3 className="text-3xl font-black tracking-tight text-foreground">{t('startFirstProject')}</h3>
                  <p className="mt-4 text-muted-foreground leading-7">
                    {t('startFirstProjectDesc', { appName })}
                  </p>
                  <div className="mt-7 space-y-4">
                    <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
                      <DialogTrigger asChild>
                        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                          <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                          {t('createFirstProject')}
                        </Button>
                      </DialogTrigger>
                    </Dialog>
                    <div className="flex flex-wrap justify-center gap-2 text-sm text-muted-foreground">
                      <Badge variant="outline" className="bg-background/70"><TestTube className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />{t('organizeTestSuites')}</Badge>
                      <Badge variant="outline" className="bg-background/70"><BarChart3 className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />{t('trackTestRuns')}</Badge>
                      <Badge variant="outline" className="bg-background/70"><AlertTriangle className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />{t('manageDefects')}</Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        </div>

        {/* Pagination */}
        {!isLoading && !isBackendDown && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              {t('previous')}
            </Button>
            <span className="px-3 text-sm font-medium text-muted-foreground">
              {t('pageOf', { current: safePage, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
            >
              {t('next')}
              {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </section>

      {!isLoading && !isBackendDown && (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Archive className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight text-foreground">{t('archivedProjects')}</h2>
                <p className="text-sm text-muted-foreground">
                  {showArchivedProjects
                    ? t('archivedProjectsAreaDesc', { count: archivedProjects.length })
                    : t('archivedProjectsToggleDesc')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="show-archived-projects" className="text-sm font-medium">
                {t('showArchivedProjects')}
              </Label>
              <Switch
                id="show-archived-projects"
                checked={showArchivedProjects}
                onCheckedChange={setShowArchivedProjects}
                disabled={!isOnline || isBackendDown}
                aria-label={t('showArchivedProjects')}
              />
            </div>
          </div>

          {showArchivedProjects && (
            <div className="border-t border-border pt-4">
              {isArchivedLoading ? (
                <div className="flex items-center justify-center rounded-xl bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
                  <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'} animate-spin`} />
                  {t('loadingArchivedProjects')}
                </div>
              ) : archivedError ? (
                <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
                  <span>{archivedError}</span>
                  <Button variant="outline" size="sm" onClick={fetchArchivedProjects}>
                    <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                    {t('retryConnection')}
                  </Button>
                </div>
              ) : archivedProjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
                  <h3 className="text-base font-semibold text-foreground">{t('noArchivedProjects')}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t('noArchivedProjectsDesc')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {archivedProjects.map((project) => (
                    <Card key={project.id} className="overflow-hidden rounded-[1.25rem] border-dashed border-muted-foreground/30 bg-muted/30 shadow-none">
                      <CardHeader className="space-y-0 p-4 pb-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                            <Archive className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <CardTitle className="truncate text-base font-bold tracking-tight text-foreground">{project.name}</CardTitle>
                            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {project.description || t('noDescription')}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={`px-2 py-0 text-[11px] ${getProjectStatusClasses(project.status)}`}>
                            {getProjectStatusLabel(project.status)}
                          </Badge>
                          <Badge variant="outline" className="border-border bg-background/60 px-2 py-0 text-[11px] text-muted-foreground">
                            {t('created')}: {new Date(project.created_at).toLocaleDateString()}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 p-4 pt-0">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-lg bg-background/70 py-2">
                            <div className="text-sm font-bold text-foreground">{project.test_suites_count ?? 0}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">{t('suites')}</div>
                          </div>
                          <div className="rounded-lg bg-background/70 py-2">
                            <div className="text-sm font-bold text-foreground">{project.test_cases_count ?? 0}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">{t('cases')}</div>
                          </div>
                          <div className="rounded-lg bg-background/70 py-2">
                            <div className="text-sm font-bold text-foreground">{project.test_runs_count ?? 0}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">{t('runs')}</div>
                          </div>
                        </div>
                        <div className="flex justify-end gap-1 border-t border-border pt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setStatusProject(project);
                              setNewStatus(project.status);
                              setIsStatusDialogOpen(true);
                            }}
                            title={t('changeProjectStatus')}
                            className="h-8 w-8 rounded-lg p-0"
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenEditDialog(project)}
                            title={t('editProject')}
                            className="h-8 w-8 rounded-lg p-0"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenDeleteDialog(project)}
                            className="h-8 w-8 rounded-lg p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            title={t('deleteProject')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Create Project Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[425px]" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('createNewProject')}</DialogTitle>
            <DialogDescription>
              {t('createNewProjectDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                {t('name')}
              </Label>
              <div className="col-span-3 space-y-1">
                <Input
                  ref={projectNameInputRef}
                  id="name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className={projectName.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
                  placeholder={t('enterProjectName')}
                  maxLength={200}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('enterProjectName')}</span>
                  <span>{projectName.length}/200</span>
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
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder={t('enterProjectDescription')}
                  rows={3}
                  maxLength={1000}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('enterProjectDescription')}</span>
                  <span>{projectDescription.length}/1000</span>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="text-xs text-muted-foreground mb-2 sm:mb-0 sm:mr-auto">
              {t('toSubmit')}
            </div>
            <Button
              variant="outline"
              onClick={() => handleDialogClose(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              onClick={handleCreateProject}
              disabled={!projectName.trim() || isCreating}
              className="transition-all duration-200"
            >
              {isCreating ? t('creating') : t('createProject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent isRTL={isRTL}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsavedChanges')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('unsavedChangesMessage')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleUnsavedConfirm(false)}>
              {t('continueEditing')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handleUnsavedConfirm(true)} className="bg-destructive hover:bg-destructive/90">
              {t('discardChangesModal')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Project Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent
          isRTL={isRTL}
          className="sm:max-w-[425px]"
          onKeyDown={(e) => handleSubmitOnEnter(e, handleUpdateProject, Boolean(projectName.trim()) && Boolean(editingProject))}
        >
          <DialogHeader>
            <DialogTitle>{t('editProject')}</DialogTitle>
            <DialogDescription>
              {t('editProjectDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-name" className="text-right">
                {t('name')}
              </Label>
              <Input
                id="edit-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="col-span-3"
                placeholder={t('enterProjectName')}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="edit-description" className="text-right pt-2">
                {t('description')}
              </Label>
              <Textarea
                id="edit-description"
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                className="col-span-3"
                placeholder={t('enterProjectDescription')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false);
                setEditingProject(null);
                setProjectName('');
                setProjectDescription('');
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              onClick={handleUpdateProject}
              disabled={!projectName.trim()}
            >
              {t('updateProject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog */}
      <Dialog open={isStatusDialogOpen} onOpenChange={setIsStatusDialogOpen}>
        <DialogContent
          isRTL={isRTL}
          className="sm:max-w-[425px]"
          onKeyDown={(e) => handleSubmitOnEnter(e, handleStatusChange, Boolean(newStatus) && Boolean(statusProject))}
        >
          <DialogHeader>
            <DialogTitle>{t('changeProjectStatus')}</DialogTitle>
            <DialogDescription>
              {t('changeProjectStatusDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="status" className="text-right">
                {t('status')}
              </Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('selectStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('active')}</SelectItem>
                  <SelectItem value="inactive">{t('inactive')}</SelectItem>
                  <SelectItem value="archived">{t('archived')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsStatusDialogOpen(false);
                setStatusProject(null);
                setNewStatus('');
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              onClick={handleStatusChange}
              disabled={!newStatus}
            >
              {t('changeStatus')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone Project Dialog */}
      <Dialog open={isCloneDialogOpen} onOpenChange={setIsCloneDialogOpen}>
        <DialogContent
          isRTL={isRTL}
          className="sm:max-w-[425px]"
          onKeyDown={(e) => handleSubmitOnEnter(e, handleCloneProject, Boolean(cloneName.trim()) && Boolean(cloneProject))}
        >
          <DialogHeader>
            <DialogTitle>{t('cloneProject')}</DialogTitle>
            <DialogDescription>
              {t('cloneProjectDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="clone-name" className="text-right">
                {t('name')}
              </Label>
              <Input
                id="clone-name"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                className="col-span-3"
                placeholder={t('enterClonedProjectName')}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="clone-description" className="text-right pt-2">
                {t('description')}
              </Label>
              <Textarea
                id="clone-description"
                value={cloneDescription}
                onChange={(e) => setCloneDescription(e.target.value)}
                className="col-span-3"
                placeholder={t('enterClonedProjectDescription')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCloneDialogOpen(false);
                setCloneProject(null);
                setCloneName('');
                setCloneDescription('');
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              onClick={handleCloneProject}
              disabled={!cloneName.trim()}
            >
              {t('cloneProject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <AlertDialogContent
          isRTL={isRTL}
          onKeyDown={(e) => handleSubmitOnEnter(e, handleBulkDelete, bulkConfirmationText === `DELETE ${selectedProjects.size}`)}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              {t('bulkDeleteProjects')}
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t('bulkDeleteWarning', { count: selectedProjects.size })}
            </AlertDialogDescription>
            <div className="space-y-4">
              <div className="text-sm">
                <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {t('bulkDeleteWarning', { count: selectedProjects.size })}
                </p>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mb-3">
                  <p className="font-semibold text-red-800 dark:text-red-200 mb-2">
                    {t('bulkDeleteWarningText')}
                  </p>
                  <ul className="text-xs text-red-700 dark:text-red-300 space-y-1 ml-4 list-disc">
                    <li>{t('bulkDeleteItem1')}</li>
                    <li>{t('bulkDeleteItem2')}</li>
                    <li>{t('bulkDeleteItem3')}</li>
                    <li>{t('bulkDeleteItem4')}</li>
                    <li>{t('bulkDeleteItem5')}</li>
                    <li>{t('bulkDeleteItem6')}</li>
                    <li>{t('bulkDeleteItem7')}</li>
                  </ul>
                </div>
                <p className="text-red-600 dark:text-red-400 font-semibold mb-2">
                  {t('cannotUndo')}
                </p>
                <div className="mt-4">
                  <Label htmlFor="bulk-confirm-text" className="text-sm font-medium">
                    {t('toConfirmType')} <span className="font-bold">DELETE {selectedProjects.size}</span>
                  </Label>
                  <Input
                    id="bulk-confirm-text"
                    value={bulkConfirmationText}
                    onChange={(e) => setBulkConfirmationText(e.target.value)}
                    placeholder={t('typeConfirmationText')}
                    className="mt-2"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsBulkDeleteDialogOpen(false);
              setBulkConfirmationText('');
            }}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={bulkConfirmationText !== `DELETE ${selectedProjects.size}`}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {t('deleteCountProjects', { count: selectedProjects.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Archive Confirmation Dialog */}
      <AlertDialog open={isBulkArchiveDialogOpen} onOpenChange={setIsBulkArchiveDialogOpen}>
        <AlertDialogContent
          isRTL={isRTL}
          onKeyDown={(e) => handleSubmitOnEnter(e, handleBulkArchive, selectedProjects.size > 0)}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
              <Archive className="h-5 w-5" />
              {t('bulkArchiveProjects')}
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t('bulkArchiveWarning', { count: selectedProjects.size })}
            </AlertDialogDescription>
            <div className="space-y-4">
              <div className="text-sm">
                <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {t('bulkArchiveWarning', { count: selectedProjects.size })}
                </p>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3 mb-3">
                  <p className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                    {t('bulkArchiveActionText')}
                  </p>
                  <ul className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1 ml-4 list-disc">
                    <li>{t('bulkArchiveItem1')}</li>
                    <li>{t('bulkArchiveItem2')}</li>
                    <li>{t('bulkArchiveItem3')}</li>
                    <li>{t('bulkArchiveItem4')}</li>
                  </ul>
                </div>
                <p className="text-yellow-600 dark:text-yellow-400 font-semibold mb-2">
                  {t('archivedCanRestore')}
                </p>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsBulkArchiveDialogOpen(false)}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkArchive}
              className="bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-600"
            >
              {t('archiveCountProjects', { count: selectedProjects.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent
          isRTL={isRTL}
          onKeyDown={(e) => handleSubmitOnEnter(e, handleDeleteProject, deleteConfirmationName === projectToDelete?.name)}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              {t('deleteProject')}
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t('deleteProjectWarning')}
            </AlertDialogDescription>
            <div className="space-y-4">
              <div className="text-sm">
                <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {t('deleteProjectWarning')}
                </p>
                <p className="font-bold text-lg text-red-600 dark:text-red-400 mb-3">
                  "{projectToDelete?.name}"
                </p>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mb-3">
                  <p className="font-semibold text-red-800 dark:text-red-200 mb-2">
                    {t('deleteProjectWarningText')}
                  </p>
                  <ul className="text-xs text-red-700 dark:text-red-300 space-y-1 ml-4 list-disc">
                    <li>{t('deleteProjectItem1')}</li>
                    <li>{t('deleteProjectItem2')}</li>
                    <li>{t('deleteProjectItem3')}</li>
                    <li>{t('deleteProjectItem4')}</li>
                    <li>{t('deleteProjectItem5')}</li>
                    <li>{t('deleteProjectItem6')}</li>
                    <li>{t('deleteProjectItem7')}</li>
                    <li>{t('deleteProjectItem8')}</li>
                  </ul>
                </div>
                <p className="text-red-600 dark:text-red-400 font-semibold mb-2">
                  {t('cannotUndo')}
                </p>
                <div className="mt-4">
                  <Label htmlFor="confirm-name" className="text-sm font-medium">
                    {t('toConfirmTypeName')} <span className="font-bold">{projectToDelete?.name}</span>
                  </Label>
                  <Input
                    id="confirm-name"
                    value={deleteConfirmationName}
                    onChange={(e) => setDeleteConfirmationName(e.target.value)}
                    placeholder={t('typeProjectName')}
                    className="mt-2"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsDeleteDialogOpen(false);
              setProjectToDelete(null);
              setDeleteConfirmationName('');
            }}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              disabled={deleteConfirmationName !== projectToDelete?.name}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {t('deleteProject')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export Dialog */}
      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent isRTL={isRTL} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t('exportProjects')}
            </DialogTitle>
            <DialogDescription>
              {t('exportProjectsDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="export-format">{t('exportFormat')}</Label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger id="export-format">
                  <SelectValue placeholder={t('selectFormat')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">{t('jsonFullData')}</SelectItem>
                  <SelectItem value="csv">{t('csvBasicInfo')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground dark:text-gray-400">
                {exportFormat === 'json'
                  ? t('jsonExportDesc')
                  : t('csvExportDesc')}
              </p>
            </div>

            {exportFormat === 'json' && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-data"
                  checked={includeData}
                  onCheckedChange={(checked) => checked !== "indeterminate" && setIncludeData(checked)}
                />
                <Label htmlFor="include-data" className="text-sm">
                  {t('includeRelatedData')}
                </Label>
              </div>
            )}

            {exportFormat === 'json' && includeData && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 dark:bg-yellow-900/20 dark:border-yellow-800">
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  <strong>{t('exportWarning')}</strong>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="export-fields">{t('fieldSelection')}</Label>
              <Input
                id="export-fields"
                value={exportFields}
                onChange={(e) => setExportFields(e.target.value)}
                placeholder={t('fieldSelectionPlaceholder')}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground dark:text-gray-400">
                {t('fieldSelectionDesc')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="export-status-filter">{t('statusFilter')}</Label>
              <Select value={exportStatusFilter} onValueChange={setExportStatusFilter}>
                <SelectTrigger id="export-status-filter">
                  <SelectValue placeholder={t('allStatuses')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allStatuses')}</SelectItem>
                  <SelectItem value="active">{t('active')}</SelectItem>
                  <SelectItem value="inactive">{t('inactive')}</SelectItem>
                  <SelectItem value="archived">{t('archived')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground dark:text-gray-400">
                {t('statusFilterDesc')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleExportProjects} disabled={isExporting}>
              {isExporting ? (
                <>
                  <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'} animate-spin`} />
                  {t('exporting')}
                </>
              ) : (
                <>
                  <FileDown className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('export')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent isRTL={isRTL} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t('importProjects')}
            </DialogTitle>
            <DialogDescription>
              {t('importProjectsDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="import-file">{t('selectFile')}</Label>
              <Input
                id="import-file"
                type="file"
                accept=".json,.csv"
                onChange={handleImportFileChange}
                className="cursor-pointer"
              />
              <p className="text-xs text-muted-foreground dark:text-gray-400">
                {t('supportedFormats')}
              </p>
            </div>

            {importFile && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 dark:bg-blue-900/20 dark:border-blue-800">
                <div className="flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200 truncate">{importFile.name}</p>
                    <p className="text-xs text-blue-600 dark:text-blue-300">
                      {(importFile.size / 1024).toFixed(2)} KB • {importFile.type || t('unknownType')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setImportFile(null);
                      setValidationResult(null);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {validationResult && !showImportPreview && (
              <div className={`rounded-md p-3 ${
                validationResult.valid ? 'bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
              }`}>
                <div className="flex items-start gap-2">
                  {validationResult.valid ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 dark:text-green-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 dark:text-yellow-400" />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${
                      validationResult.valid ? 'text-green-800 dark:text-green-200' : 'text-yellow-800 dark:text-yellow-200'
                    }`}>
                      {validationResult.valid ? t('validationSuccessful') : t('validationCompletedWithIssues')}
                    </p>
                    <p className="text-xs text-gray-600 mt-1 dark:text-gray-400">
                      {validationResult.total_rows} {t('totalRows')} • {validationResult.valid_rows} {t('valid')} • {validationResult.invalid_rows} {t('invalid')}
                    </p>
                    {validationResult.conflicts && validationResult.conflicts.length > 0 && (
                      <p className="text-xs text-yellow-600 mt-1 dark:text-yellow-400">
                        {validationResult.conflicts.length} {t('conflictsDetected')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsImportDialogOpen(false);
              setShowImportPreview(false);
              setImportFile(null);
              setValidationResult(null);
            }}>
              {t('cancel')}
            </Button>
            {!validationResult ? (
              <Button onClick={handleValidateImport} disabled={!importFile}>
                <Upload className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('validatePreview')}
              </Button>
            ) : (
              <Button onClick={() => setShowImportPreview(true)}>
                <Eye className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('reviewImport')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      {showImportPreview && validationResult && importFile && (
        <Dialog open={showImportPreview} onOpenChange={setShowImportPreview}>
          <DialogContent isRTL={isRTL} className="max-w-7xl max-h-[90vh] overflow-y-auto">
            <ProjectImportPreview
              file={importFile}
              validationResult={validationResult}
              onConfirm={handleImportProjects}
              onCancel={() => {
                setShowImportPreview(false);
                setIsImportDialogOpen(false);
                setImportFile(null);
                setValidationResult(null);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
