import { useState, useEffect, useRef } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, ExternalLink, MoreHorizontal, Trash2, Globe, Shield, Database, Layout as LayoutIcon, Cpu, FileText, Link, Users, Settings as SettingsIcon, Tag, Clock, Target, Zap, Layers, Copy, Edit, TrendingUp, FolderTree, AlertCircle, CheckCircle, XCircle, Loader2, RefreshCw, History, AlertTriangle, Rows3, Maximize2, BrainCircuit, KeyRound, PlayCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';
import { Switch } from '@/components/ui/switch';
import { api, testCasesAPI, sectionsAPI, importExportAPI, userPreferencesAPI, enumsAPI, testManagementAPI, systemSettingsAPI, aiManagerAPI, AIManagerSettings, AIProviderConfig, AIProviderName, AIUsageLimitEntry, AIUsageSummary } from '@/lib/api';
import { defectManagementAPI, IssueTrackerIntegration } from '@/lib/defectManagementAPI';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/hooks/useTranslation';
import {
  APP_LOGO_URL_MAX_LENGTH,
  APP_LOGO_URL_SETTING_KEY,
  APP_NAME_MAX_LENGTH,
  APP_NAME_SETTING_KEY,
  DEFAULT_APP_NAME,
  DEFAULT_TIMEZONE_SETTING_KEY,
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_SETTING_KEY,
  SUPPORT_EMAIL_MAX_LENGTH,
  SUPPORT_EMAIL_SETTING_KEY,
  normalizeOptionalSetting,
  useAppName,
} from '@/hooks/useAppName';
import { useToast } from '@/hooks/use-toast';
import { UserManagement } from '@/components/UserManagement';
import { isAdminUser } from '@/utils/roles';

// Test Management Types
interface TestType {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  is_active: boolean;
  usage_count: number;
  created_at: string;
  is_custom?: boolean;
}

interface Priority {
  id: string;
  name: string;
  value: number;
  color: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
  created_at?: string;
  is_custom?: boolean;
}

interface SharedStepTemplate {
  id: string;
  name: string;
  description: string;
  category: 'authentication' | 'database' | 'api' | 'ui' | 'setup' | 'cleanup' | 'validation' | 'reporting';
  tags: string[];
  complexity: 'simple' | 'medium' | 'complex';
  estimated_time: number;
  prerequisites: string[];
  related_steps: string[];
  usage_count: number;
  is_active: boolean;
  created_at: string;
}

interface SharedStepTemplateForm {
  name: string;
  description: string;
  category: SharedStepTemplate['category'];
  tags: string;
  complexity: SharedStepTemplate['complexity'];
  estimated_time: number | '';
  prerequisites: string;
  related_steps: string;
}

type SharedStepTemplateFormErrors = Partial<Record<keyof SharedStepTemplateForm, string>>;

const SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH = 200;
const SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH = 500;
const SHARED_STEP_TEMPLATE_LIST_MAX_ITEMS = 50;
const SHARED_STEP_TEMPLATE_LIST_ITEM_MAX_LENGTH = 100;
const SHARED_STEP_TEMPLATE_MIN_TIME = 1;
const SHARED_STEP_TEMPLATE_MAX_TIME = 1440;

const emptySharedStepTemplateForm = (): SharedStepTemplateForm => ({
  name: '',
  description: '',
  category: 'setup',
  tags: '',
  complexity: 'simple',
  estimated_time: 1,
  prerequisites: '',
  related_steps: ''
});

interface TestExecutionSettings {
  id?: number;
  project_id?: number;
  auto_save_interval: number;
  screenshot_on_failure: boolean;
  video_recording: boolean;
  step_timeout: number;
  retry_attempts: number;
  parallel_execution: boolean;
  max_parallel_threads: number;
  cleanup_on_failure: boolean;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

interface NotificationSettings {
  id?: number;
  project_id?: number;
  email_notifications: boolean;
  slack_notifications: boolean;
  test_failure_alerts: boolean;
  test_completion_reports: boolean;
  weekly_summary: boolean;
  real_time_updates: boolean;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

interface UserNotificationPreferences {
  do_not_disturb: boolean;
  notification_sound_enabled: boolean;
  notifications_muted_until: string | null;
}

interface AutomationSettings {
  id?: number;
  project_id?: number;
  ai_suggestions: boolean;
  smart_step_recommendations: boolean;
  auto_categorization: boolean;
  duplicate_detection: boolean;
  performance_optimization: boolean;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

const defaultAIProviders: AIProviderConfig[] = [
  { provider: 'openai', enabled: false, model: 'gpt-4o-mini', base_url: 'https://api.openai.com/v1', request_timeout_seconds: 60, monthly_token_limit: null },
  { provider: 'openrouter', enabled: false, model: 'openai/gpt-4o-mini', base_url: 'https://openrouter.ai/api/v1', request_timeout_seconds: 60, monthly_token_limit: null },
  { provider: 'anthropic', enabled: false, model: 'claude-3-5-haiku-latest', base_url: 'https://api.anthropic.com/v1', request_timeout_seconds: 60, monthly_token_limit: null },
  { provider: 'huggingface', enabled: false, model: 'openai/gpt-oss-20b', base_url: 'https://router.huggingface.co/v1', request_timeout_seconds: 60, monthly_token_limit: null },
  { provider: 'litellm', enabled: false, model: 'gpt-4o-mini', base_url: 'http://localhost:4000/v1', request_timeout_seconds: 60, monthly_token_limit: null },
];

const defaultAIManagerSettings: AIManagerSettings = {
  active_provider: 'openai',
  per_project_monthly_token_limit: null,
  providers: defaultAIProviders,
};

const aiProviderLabels: Record<AIProviderName, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  anthropic: 'Claude',
  huggingface: 'Hugging Face',
  litellm: 'LiteLLM',
};

export function Settings() {
  const { language, setLanguage, compactMode, setCompactMode } = useAuthStore();
  const { t, isRTL } = useTranslation();
  const { appName, appLogoUrl, setAppName: setStoredAppName, setAppLogoUrl: setStoredAppLogoUrl } = useAppName(false);
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [integrations, setIntegrations] = useState<IssueTrackerIntegration[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [isIntegrationDialogOpen, setIsIntegrationDialogOpen] = useState(false);
  const [isIntegrationFormOpen, setIsIntegrationFormOpen] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<IssueTrackerIntegration | null>(null);
  const [integrationToDelete, setIntegrationToDelete] = useState<IssueTrackerIntegration | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // System configuration state
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [newUserRegistration, setNewUserRegistration] = useState(true);
  const [debugLogging, setDebugLogging] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState(60);
  const [passwordComplexity, setPasswordComplexity] = useState('high');
  const [appNameInput, setAppNameInput] = useState(appName);
  const [appLogoUrlInput, setAppLogoUrlInput] = useState(appLogoUrl);
  const [organizationName, setOrganizationName] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [defaultTimezone, setDefaultTimezone] = useState('UTC');
  const [saving, setSaving] = useState(false);
  
  // Audit trail configuration state
  const [auditTrailEnabled, setAuditTrailEnabled] = useState(true);
  const [auditEntitySettings, setAuditEntitySettings] = useState<Record<string, boolean>>({});
  const [loadingAuditConfig, setLoadingAuditConfig] = useState(false);
  const [savingAuditConfig, setSavingAuditConfig] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setAppNameInput(appName);
  }, [appName]);

  useEffect(() => {
    setAppLogoUrlInput(appLogoUrl);
  }, [appLogoUrl]);
  
  const loadSystemSettings = async () => {
    try {
      const settings = await systemSettingsAPI.getAllSettings();

      const appNameSetting = settings.find(s => s.key === APP_NAME_SETTING_KEY);
      if (appNameSetting) {
        const configuredAppName = appNameSetting.value?.trim() || DEFAULT_APP_NAME;
        setAppNameInput(configuredAppName);
        setStoredAppName(configuredAppName);
      } else {
        await systemSettingsAPI.createSetting(APP_NAME_SETTING_KEY, DEFAULT_APP_NAME, 'Application display name');
        setAppNameInput(DEFAULT_APP_NAME);
        setStoredAppName(DEFAULT_APP_NAME);
      }

      const appLogoUrlSetting = settings.find(s => s.key === APP_LOGO_URL_SETTING_KEY);
      if (appLogoUrlSetting) {
        const configuredLogoUrl = normalizeOptionalSetting(appLogoUrlSetting.value);
        setAppLogoUrlInput(configuredLogoUrl);
        setStoredAppLogoUrl(configuredLogoUrl);
      } else {
        await systemSettingsAPI.createSetting(APP_LOGO_URL_SETTING_KEY, '', 'Application logo URL');
      }

      const organizationSetting = settings.find(s => s.key === ORGANIZATION_NAME_SETTING_KEY);
      if (organizationSetting) {
        setOrganizationName(normalizeOptionalSetting(organizationSetting.value));
      } else {
        await systemSettingsAPI.createSetting(ORGANIZATION_NAME_SETTING_KEY, '', 'Organization display name');
      }

      const supportEmailSetting = settings.find(s => s.key === SUPPORT_EMAIL_SETTING_KEY);
      if (supportEmailSetting) {
        setSupportEmail(normalizeOptionalSetting(supportEmailSetting.value));
      } else {
        await systemSettingsAPI.createSetting(SUPPORT_EMAIL_SETTING_KEY, '', 'Public support email address');
      }

      const timezoneSetting = settings.find(s => s.key === DEFAULT_TIMEZONE_SETTING_KEY);
      if (timezoneSetting) {
        setDefaultTimezone(timezoneSetting.value || 'UTC');
      } else {
        await systemSettingsAPI.createSetting(DEFAULT_TIMEZONE_SETTING_KEY, 'UTC', 'Default timezone');
      }
      
      // Load each setting or create with default if it doesn't exist
      const maintenanceSetting = settings.find(s => s.key === 'maintenance_mode');
      if (maintenanceSetting) {
        setMaintenanceMode(maintenanceSetting.value === 'true');
      } else {
        await systemSettingsAPI.createSetting('maintenance_mode', 'false', 'Enable/disable maintenance mode');
      }

      const signupSetting = settings.find(s => s.key === 'signup_enabled');
      if (signupSetting) {
        setNewUserRegistration(signupSetting.value === 'true');
      } else {
        await systemSettingsAPI.createSetting('signup_enabled', 'true', 'Enable/disable public user registration');
      }

      const debugSetting = settings.find(s => s.key === 'debug_logging');
      if (debugSetting) {
        setDebugLogging(debugSetting.value === 'true');
      } else {
        await systemSettingsAPI.createSetting('debug_logging', 'false', 'Enable detailed logging for troubleshooting');
      }

      const sessionTimeoutSetting = settings.find(s => s.key === 'session_timeout');
      if (sessionTimeoutSetting) {
        setSessionTimeout(parseInt(sessionTimeoutSetting.value) || 60);
      } else {
        await systemSettingsAPI.createSetting('session_timeout', '60', 'Session timeout in minutes');
      }

      const passwordComplexitySetting = settings.find(s => s.key === 'password_complexity');
      if (passwordComplexitySetting) {
        setPasswordComplexity(passwordComplexitySetting.value || 'high');
      } else {
        await systemSettingsAPI.createSetting('password_complexity', 'high', 'Password complexity requirement (low, medium, high)');
      }
    } catch (error) {
      console.error('Failed to load system settings:', error);
      // Set defaults on error
      setMaintenanceMode(false);
      setNewUserRegistration(true);
      setDebugLogging(false);
      setSessionTimeout(60);
      setPasswordComplexity('high');
      setAppNameInput(appName);
      setAppLogoUrlInput(appLogoUrl);
      setOrganizationName('');
      setSupportEmail('');
      setDefaultTimezone('UTC');
    }
  };

  const loadAuditTrailConfig = async () => {
    setLoadingAuditConfig(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        return;
      }

      const response = await api.get('/system/settings/audit-trail-config');
      if (response.data) {
        setAuditTrailEnabled(response.data.enabled ?? true);
        setAuditEntitySettings(response.data.entity_settings || {});
      }
    } catch (error) {
      console.error('Failed to load audit trail config:', error);
      // Set defaults on error
      setAuditTrailEnabled(true);
      setAuditEntitySettings({});
    } finally {
      setLoadingAuditConfig(false);
    }
  };

  const handleSaveAuditTrailConfig = async () => {
    setSavingAuditConfig(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast({
          title: t('error'),
          description: t('authenticationRequired'),
          variant: 'destructive',
        });
        return;
      }

      await api.put('/system/settings/audit-trail-config', {
        enabled: auditTrailEnabled,
        entity_settings: auditEntitySettings
      });

      toast({
        title: t('success'),
        description: t('auditConfigSaved'),
      });
    } catch (error) {
      console.error('Failed to save audit trail config:', error);
      toast({
        title: t('error'),
        description: t('auditConfigSaveFailed'),
        variant: 'destructive',
      });
    } finally {
      setSavingAuditConfig(false);
    }
  };

  const handleResetAuditTrailConfig = async () => {
    if (!confirm(t('confirmResetAuditTrailConfig'))) {
      return;
    }

    setSavingAuditConfig(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast({
          title: t('error'),
          description: t('authenticationRequired'),
          variant: 'destructive',
        });
        return;
      }

      const response = await api.post('/system/settings/audit-trail-config/reset');
      if (response.data) {
        setAuditTrailEnabled(response.data.enabled ?? true);
        setAuditEntitySettings(response.data.entity_settings || {});
      }

      toast({
        title: t('success'),
        description: t('auditConfigReset'),
      });
    } catch (error) {
      console.error('Failed to reset audit trail config:', error);
      toast({
        title: t('error'),
        description: t('auditConfigResetFailed'),
        variant: 'destructive',
      });
    } finally {
      setSavingAuditConfig(false);
    }
  };

  const handleEntityAuditToggle = (entityType: string, enabled: boolean) => {
    // If global audit is disabled, prevent toggling entity-specific settings
    if (!auditTrailEnabled) {
      return;
    }
    setAuditEntitySettings(prev => ({
      ...prev,
      [entityType]: enabled
    }));
  };

  const handleDeleteAllAuditTrails = async () => {
    setShowDeleteConfirm(true);
  };

  const confirmDeleteAllAuditTrails = async () => {
    setShowDeleteConfirm(false);
    setSavingAuditConfig(true);
    try {
      const response = await fetch(`${API_BASE_URL}/system/settings/audit-trails/all`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete audit trails');
      }

      const data = await response.json();
      toast({
        title: t('success'),
        description: data.message || t('deleteAllAuditTrailsSuccess'),
      });
    } catch (error) {
      console.error('Error deleting audit trails:', error);
      toast({
        title: t('error'),
        description: t('deleteAllAuditTrailsError'),
        variant: 'destructive',
      });
    } finally {
      setSavingAuditConfig(false);
    }
  };
  
  // Test Management Settings State - Remove mock data, will load from API
  const [testTypes, setTestTypes] = useState<TestType[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [sharedStepTemplates, setSharedStepTemplates] = useState<SharedStepTemplate[]>([]);
  const [loadingTestManagement, setLoadingTestManagement] = useState(false);
  const [testManagementError, setTestManagementError] = useState<string | null>(null);
  
  const [testExecutionSettings, setTestExecutionSettings] = useState<TestExecutionSettings>({
    auto_save_interval: 30,
    screenshot_on_failure: true,
    video_recording: false,
    step_timeout: 300,
    retry_attempts: 2,
    parallel_execution: true,
    max_parallel_threads: 4,
    cleanup_on_failure: true
  });
  
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    email_notifications: true,
    slack_notifications: false,
    test_failure_alerts: true,
    test_completion_reports: true,
    weekly_summary: true,
    real_time_updates: false
  });
  
  const [userNotificationPrefs, setUserNotificationPrefs] = useState<UserNotificationPreferences>({
    do_not_disturb: false,
    notification_sound_enabled: true,
    notifications_muted_until: null
  });
  
  const [automationSettings, setAutomationSettings] = useState<AutomationSettings>({
    ai_suggestions: false,
    smart_step_recommendations: true,
    auto_categorization: false,
    duplicate_detection: true,
    performance_optimization: true
  });
  const [aiManagerSettings, setAIManagerSettings] = useState<AIManagerSettings>(defaultAIManagerSettings);
  const [aiUsage, setAIUsage] = useState<AIUsageSummary | null>(null);
  const [loadingAIManager, setLoadingAIManager] = useState(false);
  const [savingAIManager, setSavingAIManager] = useState(false);
  const [resettingAIUsage, setResettingAIUsage] = useState(false);
  const [clearingAIRecentActions, setClearingAIRecentActions] = useState(false);
  const [testingAIProvider, setTestingAIProvider] = useState<AIProviderName | null>(null);
  const [aiTestPrompt, setAITestPrompt] = useState('Reply with exactly: TestMona AI is ready.');
  const [aiTestResult, setAITestResult] = useState<any>(null);
  const [aiActionStatusFilter, setAIActionStatusFilter] = useState('all');
  const [aiActionProviderFilter, setAIActionProviderFilter] = useState('all');
  const [aiActionPage, setAIActionPage] = useState(1);
  const [resetAIUsageConfirmOpen, setResetAIUsageConfirmOpen] = useState(false);
  const [clearAIRecentActionsConfirmOpen, setClearAIRecentActionsConfirmOpen] = useState(false);
  
  // Dialog states for different forms
  const [testTypeDialogOpen, setTestTypeDialogOpen] = useState(false);
  const [priorityDialogOpen, setPriorityDialogOpen] = useState(false);
  const [sharedStepDialogOpen, setSharedStepDialogOpen] = useState(false);
  const [sharedStepSubmitting, setSharedStepSubmitting] = useState(false);
  const [sharedStepFormErrors, setSharedStepFormErrors] = useState<SharedStepTemplateFormErrors>({});
  
  // Seamless UX states
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const testTypeNameInputRef = useRef<HTMLInputElement>(null);
  const priorityNameInputRef = useRef<HTMLInputElement>(null);
  const sharedStepNameInputRef = useRef<HTMLInputElement>(null);
  
  // Edit mode state
  const [editingTestType, setEditingTestType] = useState<TestType | null>(null);
  const [editingPriority, setEditingPriority] = useState<Priority | null>(null);
  const [editingSharedStep, setEditingSharedStep] = useState<SharedStepTemplate | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<'testType' | 'priority' | 'sharedStep' | null>(null);
  const [testTypeToDelete, setTestTypeToDelete] = useState<string | null>(null);
  const [priorityToDelete, setPriorityToDelete] = useState<string | null>(null);
  const [sharedStepToDelete, setSharedStepToDelete] = useState<string | null>(null);
  
  // Form states
  const [testTypeForm, setTestTypeForm] = useState({ name: '', description: '', color: '#3B82F6', icon: '🖱️' });
  const [priorityForm, setPriorityForm] = useState({ name: '', value: 2, color: '#F59E0B', description: '', is_default: false });
  const [sharedStepForm, setSharedStepForm] = useState<SharedStepTemplateForm>(emptySharedStepTemplateForm());
  
  // Auto-focus on input when dialogs open
  useEffect(() => {
    if (testTypeDialogOpen && testTypeNameInputRef.current) {
      setTimeout(() => testTypeNameInputRef.current?.focus(), 100);
    }
  }, [testTypeDialogOpen]);

  useEffect(() => {
    if (priorityDialogOpen && priorityNameInputRef.current) {
      setTimeout(() => priorityNameInputRef.current?.focus(), 100);
    }
  }, [priorityDialogOpen]);

  useEffect(() => {
    if (sharedStepDialogOpen && sharedStepNameInputRef.current) {
      setTimeout(() => sharedStepNameInputRef.current?.focus(), 100);
    }
  }, [sharedStepDialogOpen]);

  // Track unsaved changes for test type form
  useEffect(() => {
    setHasUnsavedChanges(
      testTypeForm.name.trim() !== '' || 
      testTypeForm.description.trim() !== ''
    );
  }, [testTypeForm.name, testTypeForm.description]);

  // Track unsaved changes for priority form
  useEffect(() => {
    setHasUnsavedChanges(
      priorityForm.name.trim() !== '' || 
      priorityForm.description.trim() !== ''
    );
  }, [priorityForm.name, priorityForm.description]);

  // Track unsaved changes for shared step form
  useEffect(() => {
    setHasUnsavedChanges(
      sharedStepForm.name.trim() !== '' || 
      sharedStepForm.description.trim() !== ''
    );
  }, [sharedStepForm.name, sharedStepForm.description]);

  // Seamless UX handlers
  const handleDialogClose = (dialogType: 'testType' | 'priority' | 'sharedStep', open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      if (dialogType === 'testType') setTestTypeDialogOpen(open);
      if (dialogType === 'priority') setPriorityDialogOpen(open);
      if (dialogType === 'sharedStep') setSharedStepDialogOpen(open);
      if (!open) {
        setTestTypeForm({ name: '', description: '', color: '#3B82F6', icon: '🖱️' });
        setPriorityForm({ name: '', value: 2, color: '#F59E0B', description: '', is_default: false });
        setSharedStepForm(emptySharedStepTemplateForm());
        setSharedStepFormErrors({});
        setHasUnsavedChanges(false);
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      setTestTypeForm({ name: '', description: '', color: '#3B82F6', icon: '🖱️' });
      setPriorityForm({ name: '', value: 2, color: '#F59E0B', description: '', is_default: false });
      setSharedStepForm(emptySharedStepTemplateForm());
      setSharedStepFormErrors({});
      setHasUnsavedChanges(false);
      setTestTypeDialogOpen(false);
      setPriorityDialogOpen(false);
      setSharedStepDialogOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, handler: () => void) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  };
  
  // UI preferences state
  // compactMode is now managed by authStore

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
  
  // Dynamic placeholders based on tracker type
  const getPlaceholders = () => {
    const placeholders: Record<string, any> = {
      jira: {
        name: t('integrationNamePlaceholder'),
        apiUrl: 'https://your-domain.atlassian.net',
        projectKey: 'TEST',
        projectKeyLabel: t('projectKeyLabel'),
        projectKeyDesc: t('projectKeyDesc')
      },
      github: {
        name: t('githubIntegrationNamePlaceholder'),
        apiUrl: 'https://api.github.com',
        projectKey: 'owner/repo',
        projectKeyLabel: t('repositoryLabel'),
        projectKeyDesc: t('repositoryDesc')
      },
      gitlab: {
        name: t('gitlabIntegrationNamePlaceholder'),
        apiUrl: 'https://gitlab.com/api/v4',
        projectKey: 'namespace/project',
        projectKeyLabel: t('projectPathLabel'),
        projectKeyDesc: t('projectPathDesc')
      },
      'azure-devops': {
        name: t('azureDevopsIntegrationNamePlaceholder'),
        apiUrl: 'https://dev.azure.com/your-org',
        projectKey: t('projectNamePlaceholder'),
        projectKeyLabel: t('projectNameLabel'),
        projectKeyDesc: t('projectNameDesc')
      },
      linear: {
        name: t('linearIntegrationNamePlaceholder'),
        apiUrl: 'https://api.linear.app',
        projectKey: t('teamKeyPlaceholder'),
        projectKeyLabel: t('teamKeyLabel'),
        projectKeyDesc: t('teamKeyDesc')
      },
      asana: {
        name: t('asanaIntegrationNamePlaceholder'),
        apiUrl: 'https://app.asana.com/api/1.0',
        projectKey: t('projectGidPlaceholder'),
        projectKeyLabel: t('projectGidLabel'),
        projectKeyDesc: t('projectGidDesc')
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

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setProjects([]);
        setSelectedProjectId(null);
        return;
      }

      const response = await api.get('/projects');
      const projectData = Array.isArray(response.data) ? response.data : [];
      setProjects(projectData);
      setSelectedProjectId(projectData.length > 0 ? projectData[0].id : null);
    } catch (error) {
      console.error('Failed to load projects:', error);
      setProjects([]);
      setSelectedProjectId(null);
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadAIManager = async () => {
    if (!isAdminUser(user)) return;
    setLoadingAIManager(true);
    try {
      const [settings, usage] = await Promise.all([
        aiManagerAPI.getSettings(),
        aiManagerAPI.getUsage(),
      ]);
      setAIManagerSettings({
        active_provider: settings.active_provider,
        per_project_monthly_token_limit: settings.per_project_monthly_token_limit ?? null,
        providers: defaultAIProviders.map((defaults) => ({
          ...defaults,
          ...(settings.providers.find((provider) => provider.provider === defaults.provider) || {}),
          api_key: '',
        })),
      });
      setAIUsage(usage);
    } catch (error) {
      console.error('Failed to load AI manager:', error);
      showErrorToast(getErrorDetail(error, t('failedToLoadAIManager')));
    } finally {
      setLoadingAIManager(false);
    }
  };

  useEffect(() => {
    loadProjects();
    loadTestManagementSettings();
    loadSystemSettings();
    loadAuditTrailConfig();
    loadAIManager();
  }, []);

  useEffect(() => {
    setAIActionPage(1);
  }, [aiActionStatusFilter, aiActionProviderFilter]);

  useEffect(() => {
    if (selectedProjectId) {
      loadIntegrations();
    } else {
      setLoadingIntegrations(false);
    }
  }, [selectedProjectId]);

  const loadTestManagementSettings = async () => {
    setLoadingTestManagement(true);
    setTestManagementError(null);
    
    try {
      // Load test type definitions from database API only
      const token = localStorage.getItem('token');
      if (!token) {
        setTestManagementError(t('authenticationRequiredLoginAgain'));
        setLoadingTestManagement(false);
        return;
      }

      const testTypesResponse = await api.get('/test-type-definitions/');
      const testTypesData = testTypesResponse.data;
      const mappedTestTypes = testTypesData.map((type: any) => ({
        id: type.id.toString(),
        name: type.name,
        description: type.description || `${type.name} test execution`,
        color: type.color,
        icon: type.icon,
        is_active: type.is_active,
        usage_count: type.usage_count || 0,
        created_at: type.created_at,
        is_custom: true // All loaded from database are considered custom (editable)
      }));
      setTestTypes(mappedTestTypes);

      // Load priority definitions from database API only
      const prioritiesResponse = await api.get('/priority-definitions/');
      const prioritiesData = prioritiesResponse.data;
      const mappedPriorities = prioritiesData.map((priority: any) => ({
        id: priority.id.toString(),
        name: priority.name,
        value: priority.value,
        color: priority.color,
        description: priority.description || `${priority.name} priority issues`,
        is_default: priority.is_default,
        is_active: priority.is_active,
        created_at: priority.created_at,
        is_custom: true // All loaded from database are considered custom (editable)
      }));
      setPriorities(mappedPriorities);

      // Load shared step templates from API
      try {
        const templatesData = await testManagementAPI.getSharedStepTemplates();
        setSharedStepTemplates(templatesData.map((template: any) => ({
          id: template.id.toString(),
          name: template.name,
          description: template.description || '',
          category: template.category,
          tags: template.tags || [],
          complexity: template.complexity,
          estimated_time: template.estimated_time,
          prerequisites: template.prerequisites || [],
          related_steps: template.related_steps || [],
          usage_count: template.usage_count || 0,
          is_active: template.is_active,
          created_at: template.created_at
        })));
      } catch (error) {
        console.log('Shared step templates not available, will show empty state');
      }

      // Load settings (these will be fetched when needed)
      try {
        const [executionSettings, notificationSettings, automationSettings, userNotificationPrefs] = await Promise.all([
          testManagementAPI.getTestExecutionSettings(),
          testManagementAPI.getNotificationSettings(),
          testManagementAPI.getAutomationSettings(),
          testManagementAPI.getUserNotificationPreferences()
        ]);
        
        if (executionSettings) setTestExecutionSettings(executionSettings);
        if (notificationSettings) setNotificationSettings(notificationSettings);
        if (automationSettings) setAutomationSettings(automationSettings);
        if (userNotificationPrefs) setUserNotificationPrefs(userNotificationPrefs);
      } catch (error) {
        console.log('Settings not yet created, will use defaults');
      }
      
      console.log('Test management settings loaded successfully from API');
    } catch (error) {
      console.error('Failed to load test management settings:', error);
      setTestManagementError(t('failedToLoadTestManagementSettings'));
    } finally {
      setLoadingTestManagement(false);
    }
  };

  // Helper functions for default colors and icons
  const getDefaultTestTypeColor = (value: string): string => {
    const colors: Record<string, string> = {
      manual: '#3B82F6',
      automated: '#10B981',
      smoke: '#F59E0B',
      regression: '#EF4444',
      integration: '#8B5CF6',
      security: '#6366F1',
      performance: '#EC4899',
      usability: '#14B8A6'
    };
    return colors[value] || '#6B7280';
  };

  const getDefaultTestTypeIcon = (value: string): string => {
    const icons: Record<string, string> = {
      manual: '🖱️',
      automated: '🤖',
      smoke: '💨',
      regression: '🔄',
      integration: '🔗',
      security: '🔒',
      performance: '⚡',
      usability: '👥'
    };
    return icons[value] || '📋';
  };

  const getDefaultPriorityColor = (value: string): string => {
    const colors: Record<string, string> = {
      low: '#10B981',
      medium: '#F59E0B',
      high: '#F97316',
      critical: '#DC2626'
    };
    return colors[value] || '#6B7280';
  };

  const getPriorityValue = (value: string): number => {
    const values: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };
    return values[value] || 2;
  };

  const loadIntegrations = async () => {
    if (!selectedProjectId) return;
    
    setLoadingIntegrations(true);
    try {
      const data = await defectManagementAPI.getIssueTrackerIntegrations(selectedProjectId);
      setIntegrations(data);
	    } catch (error) {
	      console.error('Failed to load integrations:', error);
	      showErrorToast(t('failedToLoadIntegrations'));
    } finally {
      setLoadingIntegrations(false);
    }
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
    if (!selectedProjectId) return;
    
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

	      showErrorToast(t('pleaseFixErrorsBeforeSaving'));
      return;
    }

    try {
      if (editingIntegration) {
        await defectManagementAPI.updateIssueTrackerIntegration(
          selectedProjectId,
          editingIntegration.id,
          integrationForm
        );
	        showSuccessToast(t('integrationUpdatedSuccessfully'));
      } else {
        await defectManagementAPI.createIssueTrackerIntegration(
          selectedProjectId,
          integrationForm
        );
	        showSuccessToast(t('integrationCreatedSuccessfully'));
      }
      setIsIntegrationFormOpen(false);
      setValidationErrors({});
      setTouchedFields({});
      loadIntegrations();
    } catch (error) {
	      console.error('Failed to save integration:', error);
	      showErrorToast(getErrorDetail(error, t('integrationSaveFailed')));
    }
  };

  const confirmDeleteIntegration = async () => {
    if (!selectedProjectId) return;
    if (!integrationToDelete) return;

    try {
      await defectManagementAPI.deleteIssueTrackerIntegration(selectedProjectId, integrationToDelete.id);
      showSuccessToast(t('integrationDeletedSuccessfully'));
      setIntegrationToDelete(null);
      loadIntegrations();
    } catch (error) {
      console.error('Failed to delete integration:', error);
      showErrorToast(getErrorDetail(error, t('integrationDeleteFailed')));
    }
  };

  const handleTestConnection = async (integrationId: number) => {
    if (!selectedProjectId) return;
    
    setIsTestingConnection(true);
    try {
      const result = await defectManagementAPI.testIssueTrackerConnection(selectedProjectId, integrationId);
	      if (result.success) {
	        showSuccessToast(t('connectionTestPassed'));
	      } else {
	        toast({
	          title: t('connectionFailed'),
	          description: result.message || t('connectionTestFailed'),
	          variant: 'destructive',
	        });
	      }
	    } catch (error) {
	      console.error('Connection test failed:', error);
	      showErrorToast(getErrorDetail(error, t('connectionTestFailed')));
    } finally {
      setIsTestingConnection(false);
    }
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

  const getErrorDetail = (error: unknown, fallback: string) => {
    const apiError = error as any;
    const detail = apiError?.response?.data?.detail;

    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'msg' in item) return String(item.msg);
          return '';
        })
        .filter(Boolean);
      if (messages.length > 0) return messages.join(', ');
    }

    if (detail && typeof detail === 'object' && 'msg' in detail) {
      return String(detail.msg);
    }

    return (typeof detail === 'string' && detail) || apiError?.message || fallback;
  };

  const showSuccessToast = (description: string) => {
    toast({
      title: t('success'),
      description,
    });
  };

  const showErrorToast = (description: string) => {
    toast({
      title: t('error'),
      description,
      variant: 'destructive',
    });
  };

  const updateAIProvider = (providerName: AIProviderName, updates: Partial<AIProviderConfig>) => {
    setAIManagerSettings((current) => ({
      ...current,
      providers: current.providers.map((provider) =>
        provider.provider === providerName ? { ...provider, ...updates } : provider
      ),
    }));
  };

  const handleSaveAIManager = async () => {
    setSavingAIManager(true);
    try {
      const payload: AIManagerSettings = {
        active_provider: aiManagerSettings.active_provider,
        per_project_monthly_token_limit: aiManagerSettings.per_project_monthly_token_limit || null,
        providers: aiManagerSettings.providers.map((provider) => ({
          ...provider,
          api_key: provider.api_key?.trim() || undefined,
          monthly_token_limit: provider.monthly_token_limit || null,
        })),
      };
      const savedSettings = await aiManagerAPI.updateSettings(payload);
      setAIManagerSettings({
        active_provider: savedSettings.active_provider,
        per_project_monthly_token_limit: savedSettings.per_project_monthly_token_limit ?? null,
        providers: defaultAIProviders.map((defaults) => ({
          ...defaults,
          ...(savedSettings.providers.find((provider) => provider.provider === defaults.provider) || {}),
          api_key: '',
        })),
      });
      showSuccessToast(t('aiManagerSaved'));
    } catch (error) {
      console.error('Failed to save AI manager:', error);
      showErrorToast(getErrorDetail(error, t('failedToSaveAIManager')));
    } finally {
      setSavingAIManager(false);
    }
  };

  const handleTestAIProvider = async (provider: AIProviderName) => {
    setTestingAIProvider(provider);
    setAITestResult(null);
    try {
      const result = await aiManagerAPI.testProvider(provider, aiTestPrompt.trim() || undefined);
      setAITestResult(result);
      const usage = await aiManagerAPI.getUsage();
      setAIUsage(usage);
      showSuccessToast(t('aiConnectionTestPassed', { provider: aiProviderLabels[provider] }));
    } catch (error) {
      console.error('AI connection test failed:', error);
      showErrorToast(getErrorDetail(error, t('aiConnectionTestFailed')));
    } finally {
      setTestingAIProvider(null);
    }
  };

  const handleResetAIUsage = async () => {
    setResettingAIUsage(true);
    try {
      const usage = await aiManagerAPI.resetUsage();
      setAIUsage(usage);
      setAIActionPage(1);
      showSuccessToast(t('aiUsageResetSuccess'));
    } catch (error) {
      console.error('Failed to reset AI usage:', error);
      showErrorToast(getErrorDetail(error, t('aiUsageResetFailed')));
    } finally {
      setResettingAIUsage(false);
      setResetAIUsageConfirmOpen(false);
    }
  };

  const handleClearAIRecentActions = async () => {
    setClearingAIRecentActions(true);
    try {
      const usage = await aiManagerAPI.clearRecentActions();
      setAIUsage(usage);
      setAIActionPage(1);
      showSuccessToast(t('aiRecentActionsCleared'));
    } catch (error) {
      console.error('Failed to clear AI recent actions:', error);
      showErrorToast(getErrorDetail(error, t('aiRecentActionsClearFailed')));
    } finally {
      setClearingAIRecentActions(false);
      setClearAIRecentActionsConfirmOpen(false);
    }
  };

  const resetSharedStepTemplateForm = () => {
    setSharedStepForm(emptySharedStepTemplateForm());
    setSharedStepFormErrors({});
    setEditingSharedStep(null);
    setIsEditMode(false);
  };

  const parseTemplateList = (value: string) => {
    const seen = new Set<string>();
    return value
      .split(',')
      .map(item => item.trim())
      .filter((item) => {
        if (!item) return false;
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const validateTemplateList = (
    value: string,
    field: keyof SharedStepTemplateForm,
    label: string,
    errors: SharedStepTemplateFormErrors
  ) => {
    const items = parseTemplateList(value);
    if (items.length > SHARED_STEP_TEMPLATE_LIST_MAX_ITEMS) {
      errors[field] = t('sharedStepTemplateListTooLong', { field: label, max: SHARED_STEP_TEMPLATE_LIST_MAX_ITEMS });
      return;
    }

    if (items.some(item => item.length > SHARED_STEP_TEMPLATE_LIST_ITEM_MAX_LENGTH)) {
      errors[field] = t('sharedStepTemplateListItemTooLong', { field: label, max: SHARED_STEP_TEMPLATE_LIST_ITEM_MAX_LENGTH });
    }
  };

  const validateSharedStepTemplateForm = () => {
    const errors: SharedStepTemplateFormErrors = {};
    const name = sharedStepForm.name.trim();
    const description = sharedStepForm.description.trim();
    const estimatedTime = Number(sharedStepForm.estimated_time);

    if (!name) {
      errors.name = t('fieldRequired', { field: t('name') });
    } else if (name.length > SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH) {
      errors.name = t('sharedStepTemplateFieldTooLong', { field: t('name'), max: SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH });
    }

    if (description.length > SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH) {
      errors.description = t('sharedStepTemplateFieldTooLong', { field: t('description'), max: SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH });
    }

    if (!Number.isInteger(estimatedTime) || estimatedTime < SHARED_STEP_TEMPLATE_MIN_TIME || estimatedTime > SHARED_STEP_TEMPLATE_MAX_TIME) {
      errors.estimated_time = t('sharedStepTemplateEstimatedTimeRange', {
        min: SHARED_STEP_TEMPLATE_MIN_TIME,
        max: SHARED_STEP_TEMPLATE_MAX_TIME
      });
    }

    validateTemplateList(sharedStepForm.tags, 'tags', t('tags'), errors);
    validateTemplateList(sharedStepForm.prerequisites, 'prerequisites', t('prerequisites'), errors);
    validateTemplateList(sharedStepForm.related_steps, 'related_steps', t('relatedSteps'), errors);

    setSharedStepFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const buildSharedStepTemplatePayload = () => ({
    name: sharedStepForm.name.trim(),
    description: sharedStepForm.description.trim() || null,
    category: sharedStepForm.category,
    tags: parseTemplateList(sharedStepForm.tags),
    complexity: sharedStepForm.complexity,
    estimated_time: Number(sharedStepForm.estimated_time),
    prerequisites: parseTemplateList(sharedStepForm.prerequisites),
    related_steps: parseTemplateList(sharedStepForm.related_steps)
  });

  const mapSharedStepTemplate = (template: any): SharedStepTemplate => ({
    id: template.id.toString(),
    name: template.name,
    description: template.description || '',
    category: template.category,
    tags: template.tags || [],
    complexity: template.complexity,
    estimated_time: template.estimated_time,
    prerequisites: template.prerequisites || [],
    related_steps: template.related_steps || [],
    usage_count: template.usage_count || 0,
    is_active: template.is_active,
    created_at: template.created_at
  });

  const handleSharedStepDialogOpenChange = (open: boolean) => {
    setSharedStepDialogOpen(open);
    if (!open) {
      resetSharedStepTemplateForm();
    }
  };

  const validateBrandingSettings = (): {
    appName: string;
    appLogoUrl: string;
    organizationName: string;
    supportEmail: string;
    defaultTimezone: string;
  } | null => {
    const normalizedAppName = appNameInput.trim();
    const normalizedLogoUrl = appLogoUrlInput.trim();
    const normalizedOrganizationName = organizationName.trim();
    const normalizedSupportEmail = supportEmail.trim();
    const normalizedTimezone = defaultTimezone.trim() || 'UTC';

    if (!normalizedAppName) {
      showErrorToast(t('appNameValidationRequired'));
      return null;
    }

    if (normalizedAppName.length > APP_NAME_MAX_LENGTH) {
      showErrorToast(t('appNameValidationLength', { max: APP_NAME_MAX_LENGTH }));
      return null;
    }

    if (normalizedLogoUrl) {
      if (normalizedLogoUrl.length > APP_LOGO_URL_MAX_LENGTH) {
        showErrorToast(t('appLogoUrlValidationLength', { max: APP_LOGO_URL_MAX_LENGTH }));
        return null;
      }

      try {
        const parsedLogoUrl = new URL(normalizedLogoUrl);
        if (!['http:', 'https:'].includes(parsedLogoUrl.protocol)) {
          showErrorToast(t('appLogoUrlValidationProtocol'));
          return null;
        }
      } catch {
        showErrorToast(t('appLogoUrlValidationInvalid'));
        return null;
      }
    }

    if (normalizedOrganizationName.length > ORGANIZATION_NAME_MAX_LENGTH) {
      showErrorToast(t('organizationNameValidationLength', { max: ORGANIZATION_NAME_MAX_LENGTH }));
      return null;
    }

    if (normalizedSupportEmail) {
      if (normalizedSupportEmail.length > SUPPORT_EMAIL_MAX_LENGTH) {
        showErrorToast(t('supportEmailValidationLength', { max: SUPPORT_EMAIL_MAX_LENGTH }));
        return null;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedSupportEmail)) {
        showErrorToast(t('supportEmailValidationInvalid'));
        return null;
      }
    }

    if (!normalizedTimezone || normalizedTimezone.length > 80) {
      showErrorToast(t('defaultTimezoneValidationInvalid'));
      return null;
    }

    return {
      appName: normalizedAppName,
      appLogoUrl: normalizedLogoUrl,
      organizationName: normalizedOrganizationName,
      supportEmail: normalizedSupportEmail,
      defaultTimezone: normalizedTimezone,
    };
  };

  const handleSaveAppName = async () => {
    const brandingSettings = validateBrandingSettings();
    if (!brandingSettings) return;

    setSaving(true);
    try {
      await saveBrandingSettings(brandingSettings);
      showSuccessToast(t('brandingUpdated', { appName: brandingSettings.appName }));
    } catch (error) {
      console.error('Failed to save branding settings:', error);
      showErrorToast(getErrorDetail(error, t('brandingUpdateFailed')));
    } finally {
      setSaving(false);
    }
  };

  const saveSystemSetting = async (key: string, value: string, description: string) => {
    try {
      await systemSettingsAPI.updateSetting(key, value, description);
    } catch (error) {
      if ((error as any)?.response?.status === 404) {
        await systemSettingsAPI.createSetting(key, value, description);
        return;
      }
      throw error;
    }
  };

  const saveBrandingSettings = async (brandingSettings: {
    appName: string;
    appLogoUrl: string;
    organizationName: string;
    supportEmail: string;
    defaultTimezone: string;
  }) => {
    await Promise.all([
      saveSystemSetting(APP_NAME_SETTING_KEY, brandingSettings.appName, 'Application display name'),
      saveSystemSetting(APP_LOGO_URL_SETTING_KEY, brandingSettings.appLogoUrl, 'Application logo URL'),
      saveSystemSetting(ORGANIZATION_NAME_SETTING_KEY, brandingSettings.organizationName, 'Organization display name'),
      saveSystemSetting(SUPPORT_EMAIL_SETTING_KEY, brandingSettings.supportEmail, 'Public support email address'),
      saveSystemSetting(DEFAULT_TIMEZONE_SETTING_KEY, brandingSettings.defaultTimezone, 'Default timezone'),
    ]);

    setAppNameInput(brandingSettings.appName);
    setAppLogoUrlInput(brandingSettings.appLogoUrl);
    setOrganizationName(brandingSettings.organizationName);
    setSupportEmail(brandingSettings.supportEmail);
    setDefaultTimezone(brandingSettings.defaultTimezone);
    setStoredAppName(brandingSettings.appName);
    setStoredAppLogoUrl(brandingSettings.appLogoUrl);
  };

  const handleSaveSystemConfiguration = async () => {
    const brandingSettings = validateBrandingSettings();
    if (!brandingSettings) return;

    // Validate session_timeout
    if (sessionTimeout < 1 || sessionTimeout > 1440) {
      toast({
          title: t('error'),
          description: t('sessionTimeoutValidation'),
        variant: 'destructive',
      });
      return;
    }

    // Validate password_complexity
    if (!['low', 'medium', 'high'].includes(passwordComplexity)) {
      toast({
          title: t('error'),
          description: t('passwordComplexityValidation'),
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      await saveBrandingSettings(brandingSettings);

      // Save all system settings to API
      const results = await Promise.allSettled([
        systemSettingsAPI.updateSetting('maintenance_mode', maintenanceMode.toString(), 'Enable/disable maintenance mode'),
        systemSettingsAPI.updateSetting('signup_enabled', newUserRegistration.toString(), 'Enable/disable public user registration'),
        systemSettingsAPI.updateSetting('debug_logging', debugLogging.toString(), 'Enable detailed logging for troubleshooting'),
        systemSettingsAPI.updateSetting('session_timeout', sessionTimeout.toString(), 'Session timeout in minutes'),
        systemSettingsAPI.updateSetting('password_complexity', passwordComplexity, 'Password complexity requirement (low, medium, high)'),
      ]);

      // Check for any failed updates
      const failedUpdates = results.filter(r => r.status === 'rejected');
      if (failedUpdates.length > 0) {
        console.error('Some settings failed to save:', failedUpdates);
        toast({
          title: t('partialSuccess'),
          description: t('settingsPartialSaveFailed', { count: failedUpdates.length }),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('success'),
          description: t('systemConfigurationSaved'),
        });
      }
    } catch (error) {
      console.error('Failed to save system configuration:', error);
      toast({
        title: t('error'),
        description: getErrorDetail(error, t('systemConfigurationSaveFailed')),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClearSystemCache = async () => {
    try {
      // Simulate API call to clear cache
	      await new Promise(resolve => setTimeout(resolve, 500));
	      console.log('System cache cleared');
	      showSuccessToast(t('systemCacheCleared'));
	    } catch (error) {
	      console.error('Failed to clear system cache:', error);
	      showErrorToast(t('systemCacheClearFailed'));
	    }
	  };

  const handleResetUserPreferences = () => {
    setCompactMode(false);
    setLanguage('en');
    showSuccessToast(t('preferencesReset'));
  };

  const handleCompactModeChange = (enabled: boolean) => {
    setCompactMode(enabled);
    showSuccessToast(enabled ? t('compactModeEnabled') : t('compactModeDisabled'));
  };

  // Test Management Handlers
  const handleCreateTestType = async () => {
    if (isEditMode) {
      handleUpdateTestType();
      return;
    }
    
    try {
      setIsCreating(true);
	      const token = localStorage.getItem('token');
	      if (!token) {
	        showErrorToast(t('authenticationRequired'));
	        return;
	      }

      const response = await api.post('/test-type-definitions/', {
        name: testTypeForm.name,
        description: testTypeForm.description,
        color: testTypeForm.color,
        icon: testTypeForm.icon,
        created_by: user?.id || 1
      });
      const newTestType = response.data;
        const mappedTestType = {
          id: newTestType.id.toString(),
          name: newTestType.name,
          description: newTestType.description,
          color: newTestType.color,
          icon: newTestType.icon,
          is_active: newTestType.is_active,
          usage_count: newTestType.usage_count,
          created_at: newTestType.created_at,
          is_custom: true
        };
        
        setTestTypes([...testTypes, mappedTestType]);
        setTestTypeForm({ name: '', description: '', color: '#3B82F6', icon: '🖱️' });
        setHasUnsavedChanges(false);
        setTestTypeDialogOpen(false);
	        showSuccessToast(t('testTypeCreatedSuccessfully', { name: newTestType.name }));
	    } catch (error: any) {
	      console.error('Failed to create test type:', error);
	      showErrorToast(getErrorDetail(error, t('failedToCreateTestType')));
	    } finally {
      setIsCreating(false);
    }
  };

  const handleCreatePriority = async () => {
    if (isEditMode) {
      handleUpdatePriority();
      return;
    }
    
    try {
	      const token = localStorage.getItem('token');
	      if (!token) {
	        showErrorToast(t('authenticationRequired'));
	        return;
	      }

      const response = await api.post('/priority-definitions/', {
        name: priorityForm.name,
        value: priorityForm.value,
        color: priorityForm.color,
        description: priorityForm.description,
        is_default: priorityForm.is_default,
        created_by: user?.id || 1
      });
      const newPriority = response.data;
        const mappedPriority = {
          id: newPriority.id.toString(),
          name: newPriority.name,
          value: newPriority.value,
          color: newPriority.color,
          description: newPriority.description,
          is_default: newPriority.is_default,
          is_active: newPriority.is_active,
          created_at: newPriority.created_at,
          is_custom: true
        };
        
        // If this is set as default, remove default from others
        if (priorityForm.is_default) {
          setPriorities(priorities.map(p => ({ ...p, is_default: false })));
        }
        
        setPriorities([...priorities, mappedPriority]);
        setPriorityForm({ name: '', value: 2, color: '#F59E0B', description: '', is_default: false });
        setPriorityDialogOpen(false);
	        showSuccessToast(t('priorityCreatedSuccessfully', { name: newPriority.name }));
	    } catch (error: any) {
	      console.error('Failed to create priority:', error);
	      showErrorToast(getErrorDetail(error, t('failedToCreatePriority')));
	    }
	  };

  const handleCreateSharedStep = async () => {
    if (isEditMode) {
      handleUpdateSharedStep();
      return;
    }

    if (!validateSharedStepTemplateForm()) {
      showErrorToast(t('pleaseFixErrorsBeforeSaving'));
      return;
    }
    
    try {
      setSharedStepSubmitting(true);
      const newSharedStep = await testManagementAPI.createSharedStepTemplate(buildSharedStepTemplatePayload());
      
      setSharedStepTemplates(current => [...current, mapSharedStepTemplate(newSharedStep)]);
      resetSharedStepTemplateForm();
      setSharedStepDialogOpen(false);
	      showSuccessToast(t('sharedStepTemplateCreatedSuccessfully'));
	    } catch (error: any) {
	      console.error('Failed to create shared step template:', error);
	      showErrorToast(getErrorDetail(error, t('failedToCreateSharedStepTemplate')));
	    } finally {
	      setSharedStepSubmitting(false);
	    }
	  };

  const handleEditTestType = (type: TestType) => {
    setEditingTestType(type);
    setTestTypeForm({
      name: type.name,
      description: type.description,
      color: type.color,
      icon: type.icon
    });
    setIsEditMode(true);
    setTestTypeDialogOpen(true);
  };

  const handleDuplicateTestType = (type: TestType) => {
    setEditingTestType(null);
    setTestTypeForm({
      name: `${type.name} (Copy)`,
      description: type.description,
      color: type.color,
      icon: type.icon
    });
    setIsEditMode(false);
    setTestTypeDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (deleteType === 'testType' && testTypeToDelete) {
      try {
	        const token = localStorage.getItem('token');
	        if (!token) {
	          showErrorToast(t('authenticationRequired'));
	          return;
	        }

        await api.delete(`/test-type-definitions/${testTypeToDelete}`);
          setTestTypes(testTypes.map(type => 
            type.id === testTypeToDelete ? { ...type, is_active: false } : type
          ));
	      } catch (error: any) {
	        console.error('Failed to delete test type:', error);
	        showErrorToast(getErrorDetail(error, t('failedToDeleteTestType')));
	      }
    } else if (deleteType === 'priority' && priorityToDelete) {
      try {
	        const token = localStorage.getItem('token');
	        if (!token) {
	          showErrorToast(t('authenticationRequired'));
	          return;
	        }

        await api.delete(`/priority-definitions/${priorityToDelete}`);
          setPriorities(priorities.map(priority => 
            priority.id === priorityToDelete ? { ...priority, is_active: false } : priority
          ));
	      } catch (error: any) {
	        console.error('Failed to delete priority:', error);
	        showErrorToast(getErrorDetail(error, t('failedToDeletePriority')));
	      }
    } else if (deleteType === 'sharedStep' && sharedStepToDelete) {
      try {
        await testManagementAPI.deleteSharedStepTemplate(parseInt(sharedStepToDelete));
        setSharedStepTemplates(sharedStepTemplates.map(step => 
          step.id === sharedStepToDelete ? { ...step, is_active: false } : step
        ));
	      } catch (error) {
	        console.error('Failed to delete shared step template:', error);
	        showErrorToast(t('failedToDeleteSharedStepTemplate'));
	      }
    }
    
    setDeleteConfirmOpen(false);
    setDeleteType(null);
    setTestTypeToDelete(null);
    setPriorityToDelete(null);
    setSharedStepToDelete(null);
  };

  const handleDeleteTestType = (id: string) => {
    setTestTypeToDelete(id);
    setDeleteType('testType');
    setDeleteConfirmOpen(true);
  };

  const handleUpdateTestType = async () => {
    if (!editingTestType) return;
    
    try {
	      const token = localStorage.getItem('token');
	      if (!token) {
	        showErrorToast(t('authenticationRequired'));
	        return;
	      }

      const response = await api.put(`/test-type-definitions/${editingTestType.id}`, {
        name: testTypeForm.name,
        description: testTypeForm.description,
        color: testTypeForm.color,
        icon: testTypeForm.icon
      });
      const updatedTestType = response.data;
        setTestTypes(testTypes.map(type => 
          type.id === editingTestType.id ? {
            ...type,
            name: updatedTestType.name,
            description: updatedTestType.description,
            color: updatedTestType.color,
            icon: updatedTestType.icon
          } : type
        ));
        setTestTypeForm({ name: '', description: '', color: '#3B82F6', icon: '🖱️' });
        setEditingTestType(null);
        setIsEditMode(false);
        setTestTypeDialogOpen(false);
	        showSuccessToast(t('testTypeUpdatedSuccessfully'));
	    } catch (error: any) {
	      console.error('Failed to update test type:', error);
	      showErrorToast(getErrorDetail(error, t('failedToUpdateTestType')));
	    }
  };

  const handleEditPriority = (priority: Priority) => {
    setEditingPriority(priority);
    setPriorityForm({
      name: priority.name,
      value: priority.value,
      color: priority.color,
      description: priority.description,
      is_default: priority.is_default
    });
    setIsEditMode(true);
    setPriorityDialogOpen(true);
  };

  const handleDuplicatePriority = (priority: Priority) => {
    const existingValues = priorities.map(p => p.value);
    let newValue = priority.value;
    
    // Find a lower available value
    while (existingValues.includes(newValue) && newValue > 1) {
      newValue--;
    }
    
    // If no lower value available, try higher values
    if (existingValues.includes(newValue)) {
      newValue = priority.value + 1;
      while (existingValues.includes(newValue) && newValue < 10) {
        newValue++;
      }
    }
    
    // If all values 1-10 are taken, show error
    if (existingValues.includes(newValue)) {
	      showErrorToast(t('priorityDuplicateUnavailable'));
      return;
    }
    
    setEditingPriority(null);
    setPriorityForm({
      name: `${priority.name} (Copy)`,
      value: newValue,
      color: priority.color,
      description: priority.description,
      is_default: false
    });
    setIsEditMode(false);
    setPriorityDialogOpen(true);
  };

  const handleDeletePriority = (id: string) => {
    setPriorityToDelete(id);
    setDeleteType('priority');
    setDeleteConfirmOpen(true);
  };

  const handleUpdatePriority = async () => {
    if (!editingPriority) return;
    
    try {
	      const token = localStorage.getItem('token');
	      if (!token) {
	        showErrorToast(t('authenticationRequired'));
	        return;
	      }

      const response = await api.put(`/priority-definitions/${editingPriority.id}`, {
        name: priorityForm.name,
        value: priorityForm.value,
        color: priorityForm.color,
        description: priorityForm.description,
        is_default: priorityForm.is_default
      });
      const updatedPriority = response.data;
        setPriorities(priorities.map(priority => 
          priority.id === editingPriority.id ? {
            ...priority,
            name: updatedPriority.name,
            value: updatedPriority.value,
            color: updatedPriority.color,
            description: updatedPriority.description,
            is_default: updatedPriority.is_default
          } : priority
        ));
        setPriorityForm({ name: '', value: 2, color: '#F59E0B', description: '', is_default: false });
        setEditingPriority(null);
        setIsEditMode(false);
        setPriorityDialogOpen(false);
	        showSuccessToast(t('priorityUpdatedSuccessfully'));
	    } catch (error: any) {
	      console.error('Failed to update priority:', error);
	      showErrorToast(getErrorDetail(error, t('failedToUpdatePriority')));
	    }
  };

  const handleEditSharedStep = (step: SharedStepTemplate) => {
    setEditingSharedStep(step);
    setSharedStepFormErrors({});
    setSharedStepForm({
      name: step.name,
      description: step.description,
      category: step.category,
      tags: step.tags.join(', '),
      complexity: step.complexity,
      estimated_time: step.estimated_time || 1,
      prerequisites: step.prerequisites.join(', '),
      related_steps: step.related_steps.join(', ')
    });
    setIsEditMode(true);
    setSharedStepDialogOpen(true);
  };

  const handleDuplicateSharedStep = (step: SharedStepTemplate) => {
    setEditingSharedStep(null);
    setSharedStepFormErrors({});
    setSharedStepForm({
      name: `${step.name} (Copy)`,
      description: step.description,
      category: step.category,
      tags: step.tags.join(', '),
      complexity: step.complexity,
      estimated_time: step.estimated_time || 1,
      prerequisites: step.prerequisites.join(', '),
      related_steps: step.related_steps.join(', ')
    });
    setIsEditMode(false);
    setSharedStepDialogOpen(true);
  };

  const handleDeleteSharedStep = (id: string) => {
    setSharedStepToDelete(id);
    setDeleteType('sharedStep');
    setDeleteConfirmOpen(true);
  };

  const handleUpdateSharedStep = async () => {
    if (!editingSharedStep) return;

    if (!validateSharedStepTemplateForm()) {
      showErrorToast(t('pleaseFixErrorsBeforeSaving'));
      return;
    }
    
    try {
      setSharedStepSubmitting(true);
      const updatedStep = await testManagementAPI.updateSharedStepTemplate(
        parseInt(editingSharedStep.id),
        buildSharedStepTemplatePayload()
      );
      
      setSharedStepTemplates(sharedStepTemplates.map(step => 
        step.id === editingSharedStep.id ? {
          ...step,
          name: updatedStep.name,
          description: updatedStep.description || '',
          category: updatedStep.category,
          tags: updatedStep.tags || [],
          complexity: updatedStep.complexity,
          estimated_time: updatedStep.estimated_time,
          prerequisites: updatedStep.prerequisites || [],
          related_steps: updatedStep.related_steps || []
        } : step
      ));
      
      resetSharedStepTemplateForm();
      setSharedStepDialogOpen(false);
	      showSuccessToast(t('sharedStepTemplateUpdatedSuccessfully'));
	    } catch (error: any) {
	      console.error('Failed to update shared step template:', error);
	      showErrorToast(getErrorDetail(error, t('failedToUpdateSharedStepTemplate')));
	    } finally {
	      setSharedStepSubmitting(false);
	    }
  };

  const handleSaveTestManagementSettings = async () => {
    setSaving(true);
    try {
      // Save all settings in parallel
      const promises = [];
      
      // Only save settings that have been loaded from API (have IDs)
      if (testExecutionSettings && 'id' in testExecutionSettings) {
        promises.push(testManagementAPI.updateTestExecutionSettings(testExecutionSettings.id, testExecutionSettings));
      }
      
      if (notificationSettings && 'id' in notificationSettings) {
        promises.push(testManagementAPI.updateNotificationSettings(notificationSettings.id, notificationSettings));
      }
      
      // Save user notification preferences
      promises.push(testManagementAPI.updateUserNotificationPreferences(userNotificationPrefs));
      
      if (automationSettings && 'id' in automationSettings) {
        promises.push(testManagementAPI.updateAutomationSettings(automationSettings.id, automationSettings));
      }
      
	      await Promise.all(promises);

	      console.log('Test management settings saved successfully!');
	      showSuccessToast(t('testManagementSettingsSaved'));
	    } catch (error) {
	      console.error('Failed to save test management settings:', error);
	      showErrorToast(t('testManagementSettingsSaveFailed'));
	    } finally {
      setSaving(false);
    }
  };

  const compactModeEffects = [
    t('compactAppliesNavigation'),
    t('compactAppliesCards'),
    t('compactAppliesTables'),
    t('compactAppliesForms'),
    t('compactAppliesDialogs'),
  ];
  const aiRecentEvents = Array.isArray(aiUsage?.recent_events) ? aiUsage.recent_events : [];
  const filteredAIRecentEvents = aiRecentEvents.filter((event: any) => {
    const statusMatches = aiActionStatusFilter === 'all'
      || (aiActionStatusFilter === 'succeeded' && event.success)
      || (aiActionStatusFilter === 'failed' && !event.success);
    const providerMatches = aiActionProviderFilter === 'all' || event.provider === aiActionProviderFilter;
    return statusMatches && providerMatches;
  });
  const aiActionPageSize = 8;
  const aiActionTotalPages = Math.max(1, Math.ceil(filteredAIRecentEvents.length / aiActionPageSize));
  const normalizedAIActionPage = Math.min(aiActionPage, aiActionTotalPages);
  const visibleAIRecentEvents = filteredAIRecentEvents.slice(
    (normalizedAIActionPage - 1) * aiActionPageSize,
    normalizedAIActionPage * aiActionPageSize,
  );
  const activeAIProvider = aiManagerSettings.providers.find((provider) => provider.provider === aiManagerSettings.active_provider);
  const aiUsageLimits = aiUsage?.limits;
  const activeProviderLimit = aiUsageLimits?.active_provider_limit || null;
  const projectMonthlyLimit = aiUsageLimits?.project_monthly_limit;
  const formatAIUsageNumber = (value?: number | null) => Number(value || 0).toLocaleString();
  const getAIUsagePercent = (limit?: AIUsageLimitEntry | null) => Math.min(100, Math.max(0, Math.round(limit?.percent_used || 0)));
  const getAIUsageProgressClass = (status?: AIUsageLimitEntry['status']) => {
    if (status === 'exceeded') return 'bg-red-600';
    if (status === 'warning') return 'bg-amber-500';
    if (status === 'ok') return 'bg-emerald-600';
    return 'bg-slate-400';
  };
  const getAIUsageBadgeVariant = (status?: AIUsageLimitEntry['status']) => status === 'exceeded' ? 'destructive' : 'outline';
  const getAIUsageStatusLabel = (status?: AIUsageLimitEntry['status']) => {
    if (status === 'exceeded') return t('aiUsageLimitExceeded');
    if (status === 'warning') return t('aiUsageLimitNear');
    if (status === 'ok') return t('aiUsageLimitHealthy');
    return t('aiUsageLimitUnlimited');
  };
  const getAIUsageLimitLabel = (limit?: AIUsageLimitEntry | null) => limit?.limit
    ? t('aiUsageVsLimit', { used: formatAIUsageNumber(limit.used_tokens), limit: formatAIUsageNumber(limit.limit) })
    : t('aiUsageUnlimitedUsed', { used: formatAIUsageNumber(limit?.used_tokens || 0) });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('manageSettings')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('manageSettings')}</p>
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="inline-flex h-12 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground w-full">
          <TabsTrigger value="general" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs">
            <Globe className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
            {t('general')}
          </TabsTrigger>
          <TabsTrigger value="test-management" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs">
            <FileText className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
            {t('testManagement')}
          </TabsTrigger>
          {isAdminUser(user) && (
            <TabsTrigger value="ai-manager" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs">
              <BrainCircuit className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
              {t('aiManager')}
            </TabsTrigger>
          )}
          <TabsTrigger value="integrations" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs">
            <Link className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
            {t('integrations')}
          </TabsTrigger>
          {isAdminUser(user) && (
            <TabsTrigger value="users" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs">
              <Users className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
              {t('users')}
            </TabsTrigger>
          )}
          {isAdminUser(user) && (
            <TabsTrigger value="audit" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs">
              <History className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
              {t('auditTrails')}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card className="settings-density-card overflow-hidden border-slate-200/80 shadow-xs dark:border-slate-800">
            <CardHeader className="border-b border-slate-100 bg-linear-to-br from-slate-50 via-white to-cyan-50 dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-cyan-950/30">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200">
                      {compactMode ? t('compactModeOn') : t('compactModeOff')}
                    </Badge>
                    <CardTitle className="text-xl">{t('interfaceDensity')}</CardTitle>
                  </div>
                  <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">{t('compactModeDesc')}</p>
                </div>
                <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-xs dark:border-slate-800 dark:bg-slate-950">
                  <Button
                    type="button"
                    variant={!compactMode ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => handleCompactModeChange(false)}
                    className="gap-2 rounded-xl"
                    aria-pressed={!compactMode}
                  >
                    <Maximize2 className="h-4 w-4" />
                    {t('comfortableMode')}
                  </Button>
                  <Button
                    type="button"
                    variant={compactMode ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => handleCompactModeChange(true)}
                    className="gap-2 rounded-xl"
                    aria-pressed={compactMode}
                  >
                    <Rows3 className="h-4 w-4" />
                    {t('compactMode')}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              <div className={`settings-density-preview ${compactMode ? 'is-compact' : ''}`}>
                <div className="preview-panel">
                  <div className="preview-topline">
                    <span>{t('densityPreview')}</span>
                    <span>{compactMode ? t('moreRowsVisible') : t('comfortableSpacing')}</span>
                  </div>
                  <div className="preview-row">
                    <span className="preview-dot bg-emerald-500" />
                    <span>{t('sampleTestRun')}</span>
                    <strong>{compactMode ? '86%' : '72%'}</strong>
                  </div>
                  <div className="preview-row">
                    <span className="preview-dot bg-blue-500" />
                    <span>{t('sampleRequirement')}</span>
                    <strong>{compactMode ? '12' : '8'}</strong>
                  </div>
                  <div className="preview-row">
                    <span className="preview-dot bg-amber-500" />
                    <span>{t('sampleDefect')}</span>
                    <strong>{compactMode ? '4' : '3'}</strong>
                  </div>
                </div>
                <div className="preview-copy">
                  <h3>{compactMode ? t('compactModePreviewTitle') : t('comfortableModePreviewTitle')}</h3>
                  <p>{compactMode ? t('compactModePreviewDesc') : t('comfortableModePreviewDesc')}</p>
                </div>
              </div>

              <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40 sm:grid-cols-2 lg:grid-cols-5">
                {compactModeEffects.map((effect) => (
                  <div key={effect} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                    <span>{effect}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-base">{t('language')}</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('languageDesc')}</p>
                  </div>
                  <Select
                    value={language}
                    onValueChange={(value) => {
                      setLanguage(value as 'en' | 'fa' | 'ar');
                      showSuccessToast(t('languageUpdated'));
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="fa">فارسی</SelectItem>
                      <SelectItem value="ar">العربية</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-sm text-gray-500 dark:text-gray-400">{t('generalSettingsApplyImmediately')}</p>
            </CardContent>
          </Card>

	          <div className="flex justify-end">
	            <Button className="px-8" variant="outline" onClick={handleResetUserPreferences}>
	              {t('resetPreferences')}
	            </Button>
	          </div>

          {isAdminUser(user) && (
          <Card>
            <CardHeader className="border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <SettingsIcon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                <CardTitle>{t('systemConfiguration')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label className="text-base">{t('branding')}</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t('brandingDescription', { appName })}
                    </p>
                  </div>
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-sm font-bold text-white">
                    {appLogoUrlInput ? (
                      <img src={appLogoUrlInput} alt={appNameInput || appName} className="h-full w-full rounded-2xl object-cover" />
                    ) : (
                      (appNameInput || appName).slice(0, 2).toUpperCase()
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="app-name">{t('appName')}</Label>
                    <Input
                      id="app-name"
                      value={appNameInput}
                      onChange={(event) => setAppNameInput(event.target.value)}
                      maxLength={APP_NAME_MAX_LENGTH}
                      placeholder={t('appNamePlaceholder')}
                      disabled={saving}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t('appNameCharacterLimit', { max: APP_NAME_MAX_LENGTH })}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="app-logo-url">{t('appLogoUrl')}</Label>
                    <Input
                      id="app-logo-url"
                      value={appLogoUrlInput}
                      onChange={(event) => setAppLogoUrlInput(event.target.value)}
                      maxLength={APP_LOGO_URL_MAX_LENGTH}
                      placeholder={t('appLogoUrlPlaceholder')}
                      disabled={saving}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('appLogoUrlDescription')}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="organization-name">{t('organizationName')}</Label>
                    <Input
                      id="organization-name"
                      value={organizationName}
                      onChange={(event) => setOrganizationName(event.target.value)}
                      maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                      placeholder={t('organizationNamePlaceholder')}
                      disabled={saving}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="support-email">{t('supportEmail')}</Label>
                    <Input
                      id="support-email"
                      type="email"
                      value={supportEmail}
                      onChange={(event) => setSupportEmail(event.target.value)}
                      maxLength={SUPPORT_EMAIL_MAX_LENGTH}
                      placeholder={t('supportEmailPlaceholder')}
                      disabled={saving}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="default-timezone">{t('timezone')}</Label>
                    <Input
                      id="default-timezone"
                      value={defaultTimezone}
                      onChange={(event) => setDefaultTimezone(event.target.value)}
                      placeholder={t('defaultTimezonePlaceholder')}
                      disabled={saving}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('defaultTimezoneDescription')}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
	                <div className="flex items-center justify-between">
	                  <div className="space-y-0.5">
	                    <Label className="text-base">{t('maintenanceMode')}</Label>
	                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('maintenanceModeDesc')}</p>
	                  </div>
	                  <Switch
	                    checked={maintenanceMode}
	                    onCheckedChange={setMaintenanceMode}
	                    disabled={saving}
	                  />
	                </div>
	                {maintenanceMode && (
	                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
	                    {t('maintenanceModePreview', { appName: appNameInput || appName })}
	                  </div>
	                )}
	                <div className="flex items-center justify-between">
	                  <div className="space-y-0.5">
	                    <Label className="text-base">{t('newUserRegistration')}</Label>
	                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('newUserRegistrationDesc')}</p>
	                  </div>
	                  <Switch
	                    checked={newUserRegistration}
	                    onCheckedChange={setNewUserRegistration}
	                    disabled={saving}
	                  />
	                </div>
	                <div className="flex items-center justify-between">
	                  <div className="space-y-0.5">
	                    <Label className="text-base">{t('debugLogging')}</Label>
	                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('debugLoggingDesc')}</p>
	                  </div>
	                  <Switch
	                    checked={debugLogging}
	                    onCheckedChange={setDebugLogging}
	                    disabled={saving}
	                  />
	                </div>
	                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
	                  <div className="space-y-2">
	                    <Label htmlFor="session-timeout">{t('sessionTimeout')}</Label>
	                    <Input
	                      id="session-timeout"
	                      type="number"
	                      min="1"
	                      max="1440"
	                      value={sessionTimeout}
	                      onChange={(event) => setSessionTimeout(Number(event.target.value))}
	                      disabled={saving}
	                    />
	                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('sessionTimeoutDesc')}</p>
	                  </div>
	                  <div className="space-y-2">
	                    <Label htmlFor="password-complexity">{t('passwordComplexity')}</Label>
	                    <Select value={passwordComplexity} onValueChange={setPasswordComplexity} disabled={saving}>
	                      <SelectTrigger id="password-complexity">
	                        <SelectValue />
	                      </SelectTrigger>
	                      <SelectContent>
	                        <SelectItem value="low">{t('passwordComplexityLow')}</SelectItem>
	                        <SelectItem value="medium">{t('passwordComplexityMedium')}</SelectItem>
	                        <SelectItem value="high">{t('passwordComplexityHigh')}</SelectItem>
	                      </SelectContent>
	                    </Select>
	                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('passwordComplexityDesc')}</p>
	                  </div>
	                </div>
	                <div className="flex justify-end">
	                  <Button onClick={handleSaveSystemConfiguration} disabled={saving}>
	                    {saving ? t('saving') : t('saveChanges')}
	                  </Button>
	                </div>
	              </div>
            </CardContent>
          </Card>
          )}
        </TabsContent>

        <TabsContent value="test-management" className="space-y-6">
          {/* Test Types Management */}
          <Card className="border-0 shadow-xs">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <div className="w-10 h-10 bg-linear-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                    <Tag className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('testTypesManagementTitle')}</CardTitle>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('testTypesManagementDesc')}</p>
                  </div>
                </div>
                <Dialog open={testTypeDialogOpen} onOpenChange={(open) => handleDialogClose('testType', open)}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                      {t('addTestType')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent isRTL={isRTL} className="sm:max-w-[580px]" onKeyDown={(e) => handleKeyDown(e, handleCreateTestType)}>
                    <DialogHeader className="pb-4">
                      <DialogTitle className="text-xl font-semibold text-gray-900 dark:text-gray-100">{isEditMode ? t('editTestType') : t('createNewTestType')}</DialogTitle>
                      <DialogDescription className="text-gray-600">
                        {isEditMode ? t('updateTestTypeDetails') : t('addTestTypeDesc')}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-6 py-6">
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <Label htmlFor="test-type-name" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t('name')}</Label>
                          <Input
                            ref={testTypeNameInputRef}
                            id="test-type-name"
                            value={testTypeForm.name}
                            onChange={(e) => setTestTypeForm({...testTypeForm, name: e.target.value})}
                            placeholder={t('testTypeNamePlaceholder')}
                            className={testTypeForm.name.trim() === '' ? 'h-11 rounded-lg border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/20' : 'h-11 rounded-lg border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'}
                            maxLength={100}
                          />
                          <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>{t('testTypeNameHelp')}</span>
                            <span>{testTypeForm.name.length}/100</span>
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="test-type-description" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t('description')}</Label>
                          <Textarea
                            id="test-type-description"
                            value={testTypeForm.description}
                            onChange={(e) => setTestTypeForm({...testTypeForm, description: e.target.value})}
                            placeholder={t('testTypeDescriptionPlaceholder')}
                            rows={3}
                            className="rounded-lg border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-none"
                            maxLength={500}
                          />
                          <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>{t('testTypeDescriptionHelp')}</span>
                            <span>{testTypeForm.description.length}/500</span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="test-type-color" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t('color')}</Label>
                          <div className="flex items-center space-x-3 rtl:space-x-reverse">
                            <Input
                              id="test-type-color"
                              type="color"
                              value={testTypeForm.color}
                              onChange={(e) => setTestTypeForm({...testTypeForm, color: e.target.value})}
                              className="h-11 w-20 rounded-lg border-gray-200 cursor-pointer"
                            />
                            <div className="flex-1">
                              <div className="h-11 rounded-lg border border-gray-200 flex items-center px-3 bg-gray-50">
                                <span className="text-sm font-mono text-gray-600 dark:text-gray-400">{testTypeForm.color}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="test-type-icon" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t('icon')}</Label>
                          <Input
                            id="test-type-icon"
                            value={testTypeForm.icon}
                            onChange={(e) => setTestTypeForm({...testTypeForm, icon: e.target.value})}
                            placeholder="🚀"
                            className="h-11 rounded-lg border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                          />
                        </div>
                      </div>
                    </div>
                    <DialogFooter className="pt-4 border-t flex-col sm:flex-row gap-2">
                      <div className="text-xs text-gray-500 mb-2 sm:mb-0 sm:mr-auto">
                        {t('toSubmit')}
                      </div>
                      <Button variant="outline" onClick={() => handleDialogClose('testType', false)} className="px-6 py-2 rounded-lg">
                        {t('cancel')}
                      </Button>
                      <Button onClick={handleCreateTestType} disabled={!testTypeForm.name.trim() || isCreating}>
                        {isCreating ? t('creating') : (isEditMode ? t('updateTestType') : t('createTestType'))}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Delete Confirmation Dialog */}
                <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                  <AlertDialogContent isRTL={isRTL}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {deleteType === 'testType' && t('confirmDeleteTestType')}
                        {deleteType === 'priority' && t('confirmDeletePriority')}
                        {deleteType === 'sharedStep' && t('confirmDeleteSharedStep')}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {deleteType === 'testType' && t('deleteTestTypeDesc')}
                        {deleteType === 'priority' && t('deletePriorityDesc')}
                        {deleteType === 'sharedStep' && t('deleteSharedStepDesc')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-600 hover:bg-red-700">
                        {t('delete')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loadingTestManagement ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="ml-3 rtl:ml-0 rtl:mr-3 text-gray-600 dark:text-gray-400">{t('loadingTestTypes')}</span>
                </div>
              ) : testManagementError ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <AlertCircle className="h-12 w-12 text-red-500 mb-3" />
                  <p className="text-red-600 text-center mb-4">{testManagementError}</p>
                  <Button onClick={loadTestManagementSettings}>
                    {t('retry')}
                  </Button>
                </div>
              ) : testTypes.filter(type => type.is_active).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Layers className="h-12 w-12 text-gray-400 dark:text-gray-500 mb-3" />
                  <p className="text-gray-600 dark:text-gray-400 text-center mb-4">{t('noTestTypesFoundDesc')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {testTypes.filter(type => type.is_active).map((type) => (
                    <div key={type.id} className="group relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 hover:shadow-lg transition-all duration-200 hover:border-blue-300 dark:hover:border-blue-500">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl shadow-xs" style={{ backgroundColor: type.color }}>
                        {type.icon}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 rounded-lg border-gray-200 shadow-lg">
                          <DropdownMenuItem onClick={() => handleEditTestType(type)} className="rounded-lg">
                            <Edit className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 text-gray-500 dark:text-gray-400" />
                            <span>{t('edit')}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicateTestType(type)} className="rounded-lg">
                            <Copy className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 text-gray-500 dark:text-gray-400" />
                            <span>{t('duplicate')}</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDeleteTestType(type.id)} className="rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50">
                            <Trash2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                            <span>{t('delete')}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-lg">{type.name}</h4>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 line-clamp-2">{type.description || t('noDescriptionProvided')}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 rtl:space-x-reverse">
                          <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                            <div className="w-2 h-2 rounded-full bg-green-400 mr-1.5"></div>
                            <span>{t('active')}</span>
                          </div>
                          <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-medium">{type.usage_count}</span>
                            <span className="ml-1 rtl:ml-0 rtl:mr-1">{t('uses')}</span>
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(type.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Priorities Management */}
          <Card className="border-0 shadow-xs">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <div className="w-10 h-10 bg-linear-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center">
                    <AlertCircle className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('prioritiesManagementTitle')}</CardTitle>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('prioritiesManagementDesc')}</p>
                  </div>
                </div>
                <Dialog open={priorityDialogOpen} onOpenChange={setPriorityDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                      {t('addPriority')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent isRTL={isRTL} className="sm:max-w-[500px]">
                    <DialogHeader className="pb-4">
                      <DialogTitle className="text-xl font-semibold text-gray-900 dark:text-gray-100">{isEditMode ? t('editPriorityLevel') : t('createNewPriorityLevel')}</DialogTitle>
                      <DialogDescription className="text-gray-600">
                        {isEditMode ? t('updatePriorityDetails') : t('addPriorityDesc')}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="priority-name" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t('name')}</Label>
                          <Input
                            id="priority-name"
                            value={priorityForm.name}
                            onChange={(e) => setPriorityForm({...priorityForm, name: e.target.value})}
                            placeholder={t('priorityNamePlaceholder')}
                            className="h-10 rounded-lg border-gray-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                          />
                        </div>
                        <div>
                          <Label htmlFor="priority-value" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t('priorityValueRange')}</Label>
                          <Input
                            id="priority-value"
                            type="number"
                            min="1"
                            max="10"
                            value={priorityForm.value}
                            onChange={(e) => setPriorityForm({...priorityForm, value: parseInt(e.target.value)})}
                            className="h-10 rounded-lg border-gray-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="priority-description" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t('description')}</Label>
                        <Textarea
                          id="priority-description"
                          value={priorityForm.description}
                          onChange={(e) => setPriorityForm({...priorityForm, description: e.target.value})}
                          placeholder={t('priorityDescriptionPlaceholder')}
                          rows={2}
                          className="rounded-lg border-gray-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 resize-none"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="priority-color" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t('color')}</Label>
                          <div className="flex items-center space-x-2 rtl:space-x-reverse">
                            <Input
                              id="priority-color"
                              type="color"
                              value={priorityForm.color}
                              onChange={(e) => setPriorityForm({...priorityForm, color: e.target.value})}
                              className="h-10 w-16 rounded-lg border-gray-200 cursor-pointer"
                            />
                            <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">{priorityForm.color}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 rtl:space-x-reverse">
                          <Switch
                            id="priority-default"
                            checked={priorityForm.is_default}
                            onCheckedChange={(checked) => setPriorityForm({...priorityForm, is_default: checked})}
                            className="data-[state=checked]:bg-orange-600"
                          />
                          <Label htmlFor="priority-default" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">{t('default')}</Label>
                        </div>
                      </div>
                    </div>
                    <DialogFooter className="pt-4 border-t">
                      <Button variant="outline" onClick={() => {
                        setPriorityDialogOpen(false);
                        setEditingPriority(null);
                        setIsEditMode(false);
                        setPriorityForm({ name: '', value: 2, color: '#F59E0B', description: '', is_default: false });
                      }} className="px-6 py-2 rounded-lg">
                        {t('cancel')}
                      </Button>
                      <Button onClick={handleCreatePriority} disabled={!priorityForm.name.trim()}>
                        {isEditMode ? t('updatePriority') : t('createPriority')}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loadingTestManagement ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="ml-3 rtl:ml-0 rtl:mr-3 text-gray-600 dark:text-gray-400">{t('loadingPriorities')}</span>
                </div>
              ) : testManagementError ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <AlertCircle className="h-12 w-12 text-red-500 mb-3" />
                  <p className="text-red-600 text-center mb-4">{testManagementError}</p>
                  <Button onClick={loadTestManagementSettings}>
                    {t('retry')}
                  </Button>
                </div>
              ) : priorities.filter(priority => priority.is_active).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <AlertCircle className="h-12 w-12 text-gray-400 dark:text-gray-500 mb-3" />
                  <p className="text-gray-600 dark:text-gray-400 text-center mb-4">{t('noPrioritiesFoundDesc')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {priorities.filter(priority => priority.is_active).sort((a, b) => b.value - a.value).map((priority) => (
                  <div key={priority.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <div className="flex items-center space-x-3 rtl:space-x-reverse">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: priority.color }}>
                        <span className="text-white font-bold text-xs">{priority.value}</span>
                      </div>
                      <div>
                        <div className="flex items-center space-x-2 rtl:space-x-reverse">
                          <h4 className="font-semibold text-gray-900 dark:text-gray-100">{priority.name}</h4>
                          {priority.is_default && (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200 px-2 py-0.5 rounded-full text-xs font-medium">
                              {t('default')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{priority.description || t('noDescriptionProvided')}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{t('priorityValueInline', { value: priority.value })}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg hover:bg-gray-100">
                            <MoreHorizontal className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 rounded-lg border-gray-200 shadow-lg">
                          <DropdownMenuItem onClick={() => handleEditPriority(priority)} className="rounded-lg text-sm">
                            <Edit className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 text-gray-500 dark:text-gray-400" />
                            <span>{t('edit')}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicatePriority(priority)} className="rounded-lg text-sm">
                            <Copy className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 text-gray-500 dark:text-gray-400" />
                            <span>{t('duplicate')}</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDeletePriority(priority.id)} className="rounded-lg text-sm text-red-600 hover:text-red-700 hover:bg-red-50">
                            <Trash2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                            <span>{t('delete')}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shared Steps Templates */}
          <Card>
            <CardHeader className="border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <Layers className="h-5 w-5 text-purple-600" />
                  <CardTitle>{t('sharedStepTemplates')}</CardTitle>
                </div>
                <Dialog open={sharedStepDialogOpen} onOpenChange={handleSharedStepDialogOpenChange}>
                  <DialogTrigger asChild>
                    <Button onClick={resetSharedStepTemplateForm}>
                      <Plus className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                      {t('addTemplate')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent isRTL={isRTL} className="sm:max-w-[600px]">
                    <DialogHeader>
                      <DialogTitle>{isEditMode ? t('editSharedStepTemplate') : t('addSharedStepTemplate')}</DialogTitle>
                      <DialogDescription>
                        {isEditMode ? t('updateSharedStepTemplateDesc') : t('createSharedStepTemplateDesc')}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="step-name" className="text-end">{t('name')}</Label>
                        <div className="col-span-3 space-y-1">
                          <Input
                            id="step-name"
                            ref={sharedStepNameInputRef}
                            value={sharedStepForm.name}
                            onChange={(e) => {
                              setSharedStepForm({...sharedStepForm, name: e.target.value});
                              setSharedStepFormErrors(current => ({ ...current, name: undefined }));
                            }}
                            className={sharedStepFormErrors.name ? 'border-red-300 focus:border-red-500' : ''}
                            placeholder={t('sharedStepNamePlaceholder')}
                            maxLength={SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH}
                            aria-invalid={Boolean(sharedStepFormErrors.name)}
                          />
                          <div className="flex justify-between text-xs text-gray-500">
                            <span className="text-red-600">{sharedStepFormErrors.name}</span>
                            <span>{t('characterCount', { count: sharedStepForm.name.length, max: SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH })}</span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 items-start gap-4">
                        <Label htmlFor="step-description" className="text-end pt-2">{t('description')}</Label>
                        <div className="col-span-3 space-y-1">
                          <Textarea
                            id="step-description"
                            value={sharedStepForm.description}
                            onChange={(e) => {
                              setSharedStepForm({...sharedStepForm, description: e.target.value});
                              setSharedStepFormErrors(current => ({ ...current, description: undefined }));
                            }}
                            className={sharedStepFormErrors.description ? 'border-red-300 focus:border-red-500' : ''}
                            placeholder={t('stepDescriptionPlaceholder')}
                            rows={2}
                            maxLength={SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH}
                            aria-invalid={Boolean(sharedStepFormErrors.description)}
                          />
                          <div className="flex justify-between text-xs text-gray-500">
                            <span className="text-red-600">{sharedStepFormErrors.description}</span>
                            <span>{t('characterCount', { count: sharedStepForm.description.length, max: SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH })}</span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="step-category" className="text-end">{t('category')}</Label>
                        <Select value={sharedStepForm.category} onValueChange={(value: any) => setSharedStepForm({...sharedStepForm, category: value})}>
                          <SelectTrigger className="col-span-3">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="authentication">{t('authentication')}</SelectItem>
                            <SelectItem value="database">{t('database')}</SelectItem>
                            <SelectItem value="api">{t('api')}</SelectItem>
                            <SelectItem value="ui">{t('ui')}</SelectItem>
                            <SelectItem value="setup">{t('setup')}</SelectItem>
                            <SelectItem value="cleanup">{t('cleanup')}</SelectItem>
                            <SelectItem value="validation">{t('validation')}</SelectItem>
                            <SelectItem value="reporting">{t('reporting')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="step-complexity" className="text-end">{t('complexity')}</Label>
                        <Select value={sharedStepForm.complexity} onValueChange={(value: any) => setSharedStepForm({...sharedStepForm, complexity: value})}>
                          <SelectTrigger className="col-span-3">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="simple">{t('simple')}</SelectItem>
                            <SelectItem value="medium">{t('medium')}</SelectItem>
                            <SelectItem value="complex">{t('complex')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="step-time" className="text-end">{t('estimatedTimeMinutes')}</Label>
                        <Input
                          id="step-time"
                          type="number"
                          min="1"
                          max={SHARED_STEP_TEMPLATE_MAX_TIME}
                          value={sharedStepForm.estimated_time}
                          onChange={(e) => {
                            setSharedStepForm({
                              ...sharedStepForm,
                              estimated_time: e.target.value === '' ? '' : Number(e.target.value)
                            });
                            setSharedStepFormErrors(current => ({ ...current, estimated_time: undefined }));
                          }}
                          className={`col-span-3 ${sharedStepFormErrors.estimated_time ? 'border-red-300 focus:border-red-500' : ''}`}
                          aria-invalid={Boolean(sharedStepFormErrors.estimated_time)}
                        />
                        {sharedStepFormErrors.estimated_time && (
                          <p className="col-span-3 col-start-2 text-xs text-red-600">{sharedStepFormErrors.estimated_time}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="step-tags" className="text-end">{t('tags')}</Label>
                        <div className="col-span-3 space-y-1">
                          <Input
                            id="step-tags"
                            value={sharedStepForm.tags}
                            onChange={(e) => {
                              setSharedStepForm({...sharedStepForm, tags: e.target.value});
                              setSharedStepFormErrors(current => ({ ...current, tags: undefined }));
                            }}
                            className={sharedStepFormErrors.tags ? 'border-red-300 focus:border-red-500' : ''}
                            placeholder={t('tagsPlaceholder')}
                            aria-invalid={Boolean(sharedStepFormErrors.tags)}
                          />
                          {sharedStepFormErrors.tags && <p className="text-xs text-red-600">{sharedStepFormErrors.tags}</p>}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 items-start gap-4">
                        <Label htmlFor="step-prerequisites" className="text-end pt-2">{t('prerequisites')}</Label>
                        <div className="col-span-3 space-y-1">
                          <Textarea
                            id="step-prerequisites"
                            value={sharedStepForm.prerequisites}
                            onChange={(e) => {
                              setSharedStepForm({...sharedStepForm, prerequisites: e.target.value});
                              setSharedStepFormErrors(current => ({ ...current, prerequisites: undefined }));
                            }}
                            className={sharedStepFormErrors.prerequisites ? 'border-red-300 focus:border-red-500' : ''}
                            placeholder={t('prerequisitesPlaceholder')}
                            rows={2}
                            aria-invalid={Boolean(sharedStepFormErrors.prerequisites)}
                          />
                          {sharedStepFormErrors.prerequisites && <p className="text-xs text-red-600">{sharedStepFormErrors.prerequisites}</p>}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 items-start gap-4">
                        <Label htmlFor="step-related" className="text-end pt-2">{t('relatedSteps')}</Label>
                        <div className="col-span-3 space-y-1">
                          <Textarea
                            id="step-related"
                            value={sharedStepForm.related_steps}
                            onChange={(e) => {
                              setSharedStepForm({...sharedStepForm, related_steps: e.target.value});
                              setSharedStepFormErrors(current => ({ ...current, related_steps: undefined }));
                            }}
                            className={sharedStepFormErrors.related_steps ? 'border-red-300 focus:border-red-500' : ''}
                            placeholder={t('relatedStepsPlaceholder')}
                            rows={2}
                            aria-invalid={Boolean(sharedStepFormErrors.related_steps)}
                          />
                          {sharedStepFormErrors.related_steps && <p className="text-xs text-red-600">{sharedStepFormErrors.related_steps}</p>}
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => {
                        handleSharedStepDialogOpenChange(false);
                      }} disabled={sharedStepSubmitting}>{t('cancel')}</Button>
                      <Button onClick={handleCreateSharedStep} disabled={sharedStepSubmitting || !sharedStepForm.name.trim()}>
                        {sharedStepSubmitting && <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" />}
                        {sharedStepSubmitting ? (isEditMode ? t('updating') : t('creating')) : (isEditMode ? t('updateTemplate') : t('createTemplate'))}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {sharedStepTemplates.filter(step => step.is_active).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <AlertCircle className="h-12 w-12 text-gray-400 dark:text-gray-500 mb-3" />
                  <p className="text-gray-600 dark:text-gray-400 text-center mb-4">{t('noSharedStepTemplatesFoundDesc')}</p>
                </div>
              ) : (
              <div className="space-y-4">
                {sharedStepTemplates.filter(step => step.is_active).map((step) => (
                  <div key={step.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <h4 className="font-semibold">{step.name}</h4>
                        <Badge variant="outline">{t(step.category as any)}</Badge>
                        <Badge variant={step.complexity === 'simple' ? 'default' : step.complexity === 'medium' ? 'secondary' : 'destructive'}>
                          {t(step.complexity as any)}
                        </Badge>
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                          <Clock className="h-3 w-3 mr-1 rtl:mr-0 rtl:ml-1" />
                          {t('minutesShort', { count: step.estimated_time })}
                        </div>
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                          <TrendingUp className="h-3 w-3 mr-1 rtl:mr-0 rtl:ml-1" />
                          {t('usedTimes', { count: step.usage_count })}
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{step.description}</p>
                      <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                        <div className="flex flex-wrap gap-1">
                          {step.tags.map((tag, index) => (
                            <span key={index} className="bg-gray-100 px-2 py-1 rounded">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="ml-4 rtl:ml-0 rtl:mr-4">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleEditSharedStep(step)}>
                          <Edit className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                          {t('edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicateSharedStep(step)}>
                          <Copy className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                          {t('duplicate')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDeleteSharedStep(step.id)} className="text-red-600">
                          <Trash2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                          {t('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
              )}
            </CardContent>
          </Card>

          {/* Test Execution Settings */}
          <Card>
            <CardHeader className="border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <Target className="h-5 w-5 text-green-600" />
                <CardTitle>{t('testExecutionSettingsTitle')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('autoSaveInterval')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('autoSaveIntervalDesc')}</p>
                    </div>
                    <Input
                      type="number"
                      min="10"
                      max="300"
                      value={testExecutionSettings.auto_save_interval}
                      onChange={(e) => setTestExecutionSettings({...testExecutionSettings, auto_save_interval: parseInt(e.target.value)})}
                      className="w-20"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('screenshotOnFailure')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('screenshotOnFailureDesc')}</p>
                    </div>
                    <Switch
                      checked={testExecutionSettings.screenshot_on_failure}
                      onCheckedChange={(checked) => setTestExecutionSettings({...testExecutionSettings, screenshot_on_failure: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('videoRecording')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('videoRecordingDesc')}</p>
                    </div>
                    <Switch
                      checked={testExecutionSettings.video_recording}
                      onCheckedChange={(checked) => setTestExecutionSettings({...testExecutionSettings, video_recording: checked})}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('stepTimeout')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('stepTimeoutDesc')}</p>
                    </div>
                    <Input
                      type="number"
                      min="30"
                      max="3600"
                      value={testExecutionSettings.step_timeout}
                      onChange={(e) => setTestExecutionSettings({...testExecutionSettings, step_timeout: parseInt(e.target.value)})}
                      className="w-20"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('retryAttempts')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('retryAttemptsDesc')}</p>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max="5"
                      value={testExecutionSettings.retry_attempts}
                      onChange={(e) => setTestExecutionSettings({...testExecutionSettings, retry_attempts: parseInt(e.target.value)})}
                      className="w-20"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('parallelExecution')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('parallelExecutionDesc')}</p>
                    </div>
                    <Switch
                      checked={testExecutionSettings.parallel_execution}
                      onCheckedChange={(checked) => setTestExecutionSettings({...testExecutionSettings, parallel_execution: checked})}
                    />
                  </div>
                </div>
              </div>
              {testExecutionSettings.parallel_execution && (
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-base">{t('maxParallelThreads')}</Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('maxParallelThreadsDesc')}</p>
                  </div>
                  <Input
                    type="number"
                    min="1"
                    max="16"
                    value={testExecutionSettings.max_parallel_threads}
                    onChange={(e) => setTestExecutionSettings({...testExecutionSettings, max_parallel_threads: parseInt(e.target.value)})}
                    className="w-20"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notification Settings */}
          <Card>
            <CardHeader className="border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <Zap className="h-5 w-5 text-yellow-600" />
                <CardTitle>{t('notificationSettingsTitle')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('emailNotifications')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('emailNotificationsDesc')}</p>
                    </div>
                    <Switch
                      checked={notificationSettings.email_notifications}
                      onCheckedChange={(checked) => setNotificationSettings({...notificationSettings, email_notifications: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('slackNotifications')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('slackNotificationsDesc')}</p>
                    </div>
                    <Switch
                      checked={notificationSettings.slack_notifications}
                      onCheckedChange={(checked) => setNotificationSettings({...notificationSettings, slack_notifications: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('testFailureAlerts')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('testFailureAlertsDesc')}</p>
                    </div>
                    <Switch
                      checked={notificationSettings.test_failure_alerts}
                      onCheckedChange={(checked) => setNotificationSettings({...notificationSettings, test_failure_alerts: checked})}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('testCompletionReports')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('testCompletionReportsDesc')}</p>
                    </div>
                    <Switch
                      checked={notificationSettings.test_completion_reports}
                      onCheckedChange={(checked) => setNotificationSettings({...notificationSettings, test_completion_reports: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('weeklySummary')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('weeklySummaryDesc')}</p>
                    </div>
                    <Switch
                      checked={notificationSettings.weekly_summary}
                      onCheckedChange={(checked) => setNotificationSettings({...notificationSettings, weekly_summary: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('realtimeUpdates')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('realtimeUpdatesDesc')}</p>
                    </div>
                    <Switch
                      checked={notificationSettings.real_time_updates}
                      onCheckedChange={(checked) => setNotificationSettings({...notificationSettings, real_time_updates: checked})}
                    />
                  </div>
                </div>
              </div>
              
              {/* User Notification Preferences */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{t('personalNotificationPreferences')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('doNotDisturb')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('doNotDisturbDesc')}</p>
                    </div>
                    <Switch
                      checked={userNotificationPrefs.do_not_disturb}
                      onCheckedChange={(checked) => setUserNotificationPrefs({...userNotificationPrefs, do_not_disturb: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('notificationSound')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('notificationSoundDesc')}</p>
                    </div>
                    <Switch
                      checked={userNotificationPrefs.notification_sound_enabled}
                      onCheckedChange={(checked) => setUserNotificationPrefs({...userNotificationPrefs, notification_sound_enabled: checked})}
                    />
                  </div>
                </div>
                {userNotificationPrefs.notifications_muted_until && (
                  <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      {t('notificationsMutedUntil', { date: new Date(userNotificationPrefs.notifications_muted_until).toLocaleString() })}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Automation Settings */}
          <Card>
            <CardHeader className="border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <Cpu className="h-5 w-5 text-indigo-600" />
                <CardTitle>{t('automationAiSettings')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('aiSuggestions')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiSuggestionsDesc')}</p>
                    </div>
                    <Switch
                      checked={automationSettings.ai_suggestions}
                      onCheckedChange={(checked) => setAutomationSettings({...automationSettings, ai_suggestions: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('smartStepRecommendations')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('smartStepRecommendationsDesc')}</p>
                    </div>
                    <Switch
                      checked={automationSettings.smart_step_recommendations}
                      onCheckedChange={(checked) => setAutomationSettings({...automationSettings, smart_step_recommendations: checked})}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('autoCategorization')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('autoCategorizationDesc')}</p>
                    </div>
                    <Switch
                      checked={automationSettings.auto_categorization}
                      onCheckedChange={(checked) => setAutomationSettings({...automationSettings, auto_categorization: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('duplicateDetection')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('duplicateDetectionDesc')}</p>
                    </div>
                    <Switch
                      checked={automationSettings.duplicate_detection}
                      onCheckedChange={(checked) => setAutomationSettings({...automationSettings, duplicate_detection: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">{t('performanceOptimization')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('performanceOptimizationDesc')}</p>
                    </div>
                    <Switch
                      checked={automationSettings.performance_optimization}
                      onCheckedChange={(checked) => setAutomationSettings({...automationSettings, performance_optimization: checked})}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2 rounded-lg" onClick={handleSaveTestManagementSettings} disabled={saving}>
              {saving ? t('saving') : t('saveTestManagementSettings')}
            </Button>
          </div>
        </TabsContent>

        {isAdminUser(user) && (
          <TabsContent value="ai-manager" className="space-y-6">
            <Card>
              <CardHeader className="border-b border-gray-100 dark:border-gray-800">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    <BrainCircuit className="h-5 w-5 text-indigo-600" />
                    <div>
                      <CardTitle>{t('aiManager')}</CardTitle>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiManagerDesc')}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={loadAIManager} disabled={loadingAIManager}>
                      <RefreshCw className={`h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 ${loadingAIManager ? 'animate-spin' : ''}`} />
                      {t('refresh')}
                    </Button>
                    <Button variant="outline" onClick={() => setResetAIUsageConfirmOpen(true)} disabled={resettingAIUsage || loadingAIManager}>
                      {resettingAIUsage ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
                      {t('resetAIUsage')}
                    </Button>
                    <Button onClick={handleSaveAIManager} disabled={savingAIManager}>
                      {savingAIManager ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
                      {savingAIManager ? t('saving') : t('saveAIManager')}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiTotalRequests')}</p>
                    <p className="mt-1 text-2xl font-semibold">{aiUsage?.totals?.requests ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiTotalTokens')}</p>
                    <p className="mt-1 text-2xl font-semibold">{aiUsage?.totals?.total_tokens ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiPromptTokens')}</p>
                    <p className="mt-1 text-2xl font-semibold">{aiUsage?.totals?.prompt_tokens ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiFailures')}</p>
                    <p className="mt-1 text-2xl font-semibold">{aiUsage?.totals?.failures ?? 0}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-slate-50 p-4 dark:border-gray-700 dark:bg-slate-950">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('activeAIProviderStatus')}</p>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {activeAIProvider
                          ? `${aiProviderLabels[activeAIProvider.provider]} · ${activeAIProvider.model || t('model')}`
                          : t('aiTokenMissing')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={activeAIProvider?.enabled ? 'outline' : 'destructive'}>
                        {activeAIProvider?.enabled ? t('enabled') : t('disabled')}
                      </Badge>
                      <Badge variant={activeAIProvider?.token_configured || activeAIProvider?.api_key_required === false ? 'outline' : 'destructive'}>
                        {activeAIProvider?.token_configured
                          ? t('aiTokenConfiguredShort')
                          : activeAIProvider?.api_key_required === false
                            ? t('aiTokenOptional')
                            : t('aiTokenMissing')}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                        <h3 className="font-semibold">{t('monthlyUsageLimitIndicator')}</h3>
                        <Badge variant={getAIUsageBadgeVariant(activeProviderLimit?.status)}>
                          {getAIUsageStatusLabel(activeProviderLimit?.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {t('monthlyUsageLimitSummary', {
                          provider: activeAIProvider ? aiProviderLabels[activeAIProvider.provider] : t('unknown'),
                          month: aiUsageLimits?.current_month || t('currentMonth'),
                        })}
                      </p>
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                          <span>{getAIUsageLimitLabel(activeProviderLimit)}</span>
                          <span>{activeProviderLimit?.limit ? t('aiUsagePercentUsed', { percent: getAIUsagePercent(activeProviderLimit) }) : t('unlimited')}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className={`h-full rounded-full ${getAIUsageProgressClass(activeProviderLimit?.status)}`}
                            style={{ width: `${activeProviderLimit?.limit ? getAIUsagePercent(activeProviderLimit) : 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 lg:w-72">
                      <p className="font-medium">{t('projectMonthlyTokenLimit')}</p>
                      <p className="mt-1 text-gray-600 dark:text-gray-400">
                        {projectMonthlyLimit?.limit
                          ? t('projectUsageLimitSummary', {
                              limit: formatAIUsageNumber(projectMonthlyLimit.limit),
                              projects: projectMonthlyLimit.total_projects,
                            })
                          : t('projectUsageLimitDisabled')}
                      </p>
                      {(projectMonthlyLimit?.projects_over_limit || projectMonthlyLimit?.projects_near_limit) ? (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          {t('projectUsageLimitAlerts', {
                            near: projectMonthlyLimit.projects_near_limit,
                            over: projectMonthlyLimit.projects_over_limit,
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label>{t('activeAIProvider')}</Label>
                    <Select value={aiManagerSettings.active_provider} onValueChange={(value) => setAIManagerSettings((current) => ({ ...current, active_provider: value as AIProviderName }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {aiManagerSettings.providers.map((provider) => (
                          <SelectItem key={provider.provider} value={provider.provider}>
                            {aiProviderLabels[provider.provider]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('projectMonthlyTokenLimit')}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={aiManagerSettings.per_project_monthly_token_limit ?? ''}
                      onChange={(event) => setAIManagerSettings((current) => ({
                        ...current,
                        per_project_monthly_token_limit: event.target.value ? Number(event.target.value) : null,
                      }))}
                      placeholder={t('unlimited')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('aiTestPrompt')}</Label>
                    <Input value={aiTestPrompt} onChange={(event) => setAITestPrompt(event.target.value)} maxLength={1000} />
                  </div>
                </div>

                <div className="space-y-4">
                  {aiManagerSettings.providers.map((provider) => {
                    const providerUsage: Record<string, number> = aiUsage?.providers?.[provider.provider] || {};
                    const providerLimit = aiUsageLimits?.providers?.[provider.provider] || null;
                    return (
                      <div key={provider.provider} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={provider.enabled}
                              onCheckedChange={(checked) => updateAIProvider(provider.provider, { enabled: checked })}
                            />
                            <div>
                              <h3 className="font-semibold">{aiProviderLabels[provider.provider]}</h3>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {provider.token_configured
                                  ? t('aiTokenConfigured', { token: provider.api_key_masked || '' })
                                  : provider.api_key_required === false
                                    ? t('aiTokenOptional')
                                    : t('aiTokenMissing')}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{t('aiProviderTokens', { count: providerUsage.total_tokens ?? 0 })}</Badge>
                            <Badge variant={getAIUsageBadgeVariant(providerLimit?.status)}>
                              {getAIUsageStatusLabel(providerLimit?.status)}
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleTestAIProvider(provider.provider)}
                              disabled={testingAIProvider === provider.provider || !provider.enabled}
                            >
                              {testingAIProvider === provider.provider ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
                              {t('testAIProvider')}
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 rounded-md bg-slate-50 p-3 dark:bg-slate-950">
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                            <span>{t('monthlyUsage')}</span>
                            <span>{getAIUsageLimitLabel(providerLimit)}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                            <div
                              className={`h-full rounded-full ${getAIUsageProgressClass(providerLimit?.status)}`}
                              style={{ width: `${providerLimit?.limit ? getAIUsagePercent(providerLimit) : 100}%` }}
                            />
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                          <div className="space-y-2 xl:col-span-2">
                            <Label>{t('apiToken')}</Label>
                            <Input
                              type="password"
                              value={provider.api_key || ''}
                              onChange={(event) => updateAIProvider(provider.provider, { api_key: event.target.value })}
                              placeholder={provider.token_configured ? t('leaveBlankToKeepToken') : provider.api_key_required === false ? t('optionalApiToken') : t('enterApiToken')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('model')}</Label>
                            <Input value={provider.model} onChange={(event) => updateAIProvider(provider.provider, { model: event.target.value })} />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('requestTimeoutSeconds')}</Label>
                            <Input
                              type="number"
                              min={5}
                              max={300}
                              value={provider.request_timeout_seconds}
                              onChange={(event) => updateAIProvider(provider.provider, { request_timeout_seconds: Number(event.target.value) || 60 })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('monthlyTokenLimit')}</Label>
                            <Input
                              type="number"
                              min={1}
                              value={provider.monthly_token_limit ?? ''}
                              onChange={(event) => updateAIProvider(provider.provider, { monthly_token_limit: event.target.value ? Number(event.target.value) : null })}
                              placeholder={t('unlimited')}
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2 xl:col-span-5">
                            <Label>{t('baseUrl')}</Label>
                            <Input value={provider.base_url} onChange={(event) => updateAIProvider(provider.provider, { base_url: event.target.value })} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {aiTestResult && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">
                    <p className="font-medium">{t('latestAITestResult')}</p>
                    <p className="mt-1">{aiTestResult.message}</p>
                    <p className="mt-2 text-xs">
                      {aiProviderLabels[aiTestResult.provider as AIProviderName] || aiTestResult.provider} · {aiTestResult.model} · {t('aiProviderTokens', { count: aiTestResult.usage?.total_tokens ?? 0 })}
                    </p>
                  </div>
                )}

                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="font-semibold">{t('recentAIActions')}</h3>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {t('recentAIActionsRetention', { count: aiRecentEvents.length })}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="grid gap-2 sm:grid-cols-2 lg:w-[360px]">
                        <Select value={aiActionStatusFilter} onValueChange={setAIActionStatusFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder={t('status')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t('allStatuses')}</SelectItem>
                            <SelectItem value="succeeded">{t('aiActionSucceeded')}</SelectItem>
                            <SelectItem value="failed">{t('aiActionFailed')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={aiActionProviderFilter} onValueChange={setAIActionProviderFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder={t('provider')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t('allProviders')}</SelectItem>
                            {aiManagerSettings.providers.map((provider) => (
                              <SelectItem key={provider.provider} value={provider.provider}>
                                {aiProviderLabels[provider.provider]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setClearAIRecentActionsConfirmOpen(true)}
                        disabled={clearingAIRecentActions || aiRecentEvents.length === 0}
                      >
                        {clearingAIRecentActions ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
                        {t('clearRecentAIActions')}
                      </Button>
                    </div>
                  </div>
                  {visibleAIRecentEvents.length > 0 ? (
                    <>
                      <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
                        <div className="hidden grid-cols-[1fr_140px_120px_170px] gap-3 border-b border-gray-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-gray-500 dark:border-gray-700 dark:bg-slate-950 md:grid">
                          <span>{t('action')}</span>
                          <span>{t('provider')}</span>
                          <span>{t('tokens')}</span>
                          <span>{t('created')}</span>
                        </div>
                        {visibleAIRecentEvents.map((event: any, index: number) => (
                          <div key={`${event.created_at || index}-${event.operation || 'ai'}`} className="grid gap-2 border-b border-gray-100 px-3 py-3 text-sm last:border-b-0 dark:border-gray-800 md:grid-cols-[1fr_140px_120px_170px] md:items-center">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={event.success ? 'outline' : 'destructive'}>
                                  {event.success ? t('aiActionSucceeded') : t('aiActionFailed')}
                                </Badge>
                                <span className="font-medium capitalize">{String(event.operation || 'completion').replace(/_/g, ' ')}</span>
                              </div>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {event.project_id ? `${t('projectIdLabel')}: ${event.project_id}` : t('global')}
                                {event.user_id ? ` · ${t('userIdLabel')}: ${event.user_id}` : ''}
                              </p>
                              {!event.success && event.error && (
                                <p className="mt-1 truncate text-xs text-red-600 dark:text-red-400" title={event.error}>{event.error}</p>
                              )}
                            </div>
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {aiProviderLabels[event.provider as AIProviderName] || event.provider || t('unknown')}
                            </span>
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {t('aiProviderTokens', { count: event.total_tokens ?? 0 })}
                            </span>
                            <time className="text-xs text-gray-500 dark:text-gray-400">
                              {event.created_at ? new Date(event.created_at).toLocaleString() : t('unknown')}
                            </time>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
                        <span>{t('showingRecentAIActions', { shown: visibleAIRecentEvents.length, total: filteredAIRecentEvents.length })}</span>
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => setAIActionPage((current) => Math.max(1, current - 1))} disabled={normalizedAIActionPage <= 1}>
                            {t('previous')}
                          </Button>
                          <span>{t('paginationPage', { page: normalizedAIActionPage, total: aiActionTotalPages })}</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => setAIActionPage((current) => Math.min(aiActionTotalPages, current + 1))} disabled={normalizedAIActionPage >= aiActionTotalPages}>
                            {t('next')}
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      {t('noRecentAIActions')}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            <AlertDialog open={resetAIUsageConfirmOpen} onOpenChange={setResetAIUsageConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('resetAIUsageConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('resetAIUsageConfirmDesc')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={resettingAIUsage}>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetAIUsage} disabled={resettingAIUsage}>
                    {resettingAIUsage ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : null}
                    {t('resetAIUsage')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={clearAIRecentActionsConfirmOpen} onOpenChange={setClearAIRecentActionsConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('clearRecentAIActionsConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('clearRecentAIActionsConfirmDesc')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={clearingAIRecentActions}>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearAIRecentActions} disabled={clearingAIRecentActions || aiRecentEvents.length === 0}>
                    {clearingAIRecentActions ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : null}
                    {t('clearRecentAIActions')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        )}

        <TabsContent value="integrations" className="space-y-6">
          <Card>
            <CardHeader className="border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <Link className="h-5 w-5 text-blue-600" />
                  <CardTitle>{t('issueTrackerIntegrationsTitle')}</CardTitle>
                </div>
                <Button onClick={handleAddIntegration} disabled={!selectedProjectId}>
                  <Plus className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                  {t('addIntegration')}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2">
                <Label htmlFor="project-select">{t('selectProject')}</Label>
                <Select
                  value={selectedProjectId?.toString()}
                  onValueChange={(value) => setSelectedProjectId(parseInt(value))}
                  disabled={loadingProjects}
                >
                  <SelectTrigger>
                    {loadingProjects ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t('loadingProjects')}</span>
                      </div>
                    ) : projects.length === 0 ? (
                      <span>{t('noProjectsAvailable')}</span>
                    ) : (
                      <SelectValue placeholder={t('selectProject')} />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id.toString()}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!selectedProjectId ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <FolderTree className="h-12 w-12 mx-auto mb-4 text-gray-300 dark:text-gray-500" />
                  <p>{t('selectProjectToViewIntegrations')}</p>
                </div>
              ) : loadingIntegrations ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : integrations.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Link className="h-12 w-12 mx-auto mb-4 text-gray-300 dark:text-gray-500" />
                  <p>{t('noIntegrationsTitle')}</p>
                  <p className="text-sm">{t('noIntegrationsDesc')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {integrations.map((integration) => (
                    <Card key={integration.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-semibold">{integration.name}</h4>
                              {!integration.is_active && (
                                <Badge variant="outline" className="text-xs">{t('inactive')}</Badge>
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
                                {t('lastSync')}: {new Date(integration.last_sync).toLocaleString()}
                              </p>
                            )}
                            {integration.sync_error && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                <AlertCircle className="h-3 w-3 inline mr-1 rtl:mr-0 rtl:ml-1" />
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
                                <RefreshCw className="h-4 w-4" />
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
	                              onClick={() => setIntegrationToDelete(integration)}
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
            </CardContent>
	          </Card>

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
                      placeholder={editingIntegration ? t('apiTokenLeaveBlank') : t('apiTokenPlaceholder')}
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

                <div className="flex items-center space-x-2 rtl:space-x-reverse">
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
                      <AlertCircle className="h-4 w-4 inline mr-2 rtl:mr-0 rtl:ml-2" />
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
        </TabsContent>

        {isAdminUser(user) && (
          <TabsContent value="users" className="space-y-6">
            <Card>
              <CardHeader className="border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <Users className="h-5 w-5 text-purple-600" />
                  <CardTitle>{t('userManagement')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <UserManagement />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="audit" className="space-y-6">
          <Card>
            <CardHeader className="border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <History className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                  <CardTitle>{t('auditTrailConfig')}</CardTitle>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetAuditTrailConfig}
                    disabled={savingAuditConfig || loadingAuditConfig}
                  >
                    <RefreshCw className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                    {t('resetToDefaults')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveAuditTrailConfig}
                    disabled={savingAuditConfig || loadingAuditConfig}
                  >
                    {savingAuditConfig ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                    )}
                    {t('saveConfiguration')}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              {loadingAuditConfig ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div className="space-y-0.5">
                      <Label className="text-base font-semibold">{t('enableAuditTrailsGlobally')}</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('enableAuditTrailsGloballyDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={auditTrailEnabled}
                      onCheckedChange={setAuditTrailEnabled}
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-semibold">{t('entitySpecificSettings')}</Label>
                      <Badge variant={auditTrailEnabled ? "default" : "secondary"}>
                        {auditTrailEnabled ? t('auditStatusActive') : t('auditStatusDisabled')}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t('entitySpecificSettingsDesc')}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {[
                        { key: 'user', label: t('auditEntityUser') },
                        { key: 'project', label: t('auditEntityProject') },
                        { key: 'test_case', label: t('auditEntityTestCase') },
                        { key: 'test_suite', label: t('auditEntityTestSuite') },
                        { key: 'test_run', label: t('auditEntityTestRun') },
                        { key: 'test_result', label: t('auditEntityTestResult') },
                        { key: 'test_plan', label: t('auditEntityTestPlan') },
                        { key: 'requirement', label: t('auditEntityRequirement') },
                        { key: 'defect', label: t('auditEntityDefect') },
                        { key: 'milestone', label: t('auditEntityMilestone') },
                        { key: 'custom_field', label: t('auditEntityCustomField') },
                        { key: 'system_setting', label: t('auditEntitySystemSetting') },
                      ].map((entity) => (
                        <div
                          key={entity.key}
                          className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                        >
                          <Label className="text-sm font-medium cursor-pointer">
                            {entity.label}
                          </Label>
                          <Switch
                            checked={auditEntitySettings[entity.key] !== false}
                            onCheckedChange={(checked) => handleEntityAuditToggle(entity.key, checked)}
                            disabled={!auditTrailEnabled}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {!auditTrailEnabled && (
                    <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                          {t('auditTrailsDisabled')}
                        </p>
                        <p className="text-sm text-yellow-700 dark:text-yellow-300">
                          {t('auditTrailsDisabledDesc')}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <div>
                        <p className="text-sm font-medium text-red-800 dark:text-red-200">
                          {t('deleteAllAuditTrails')}
                        </p>
                        <p className="text-sm text-red-700 dark:text-red-300">
                          {t('deleteAllAuditTrailsDesc')}
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteAllAuditTrails}
                        disabled={savingAuditConfig}
                      >
                        {savingAuditConfig ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                        )}
                        {t('deleteAllAuditTrails')}
                      </Button>
                    </div>
                  </div>

                  <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                    <AlertDialogContent isRTL={isRTL}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('confirmDeleteAllAuditTrails')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDeleteAllAuditTrails} className="bg-red-600 hover:bg-red-700">
                          {t('delete')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
