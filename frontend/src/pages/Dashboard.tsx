import { useMemo, useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, TestTube, PlayCircle, TrendingUp, Users, Bug, FileCheck, Target, ExternalLink, AlertTriangle, Flag, Calendar, Loader2, CheckCircle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { auditAPI, analyticsAPI, getApiErrorMessage } from '@/lib/api';
import { useProjectStore } from '@/stores/projectStore';
import { AuditAction, AuditTrail, EntityType } from '@/types';

// StatCard component moved outside to avoid React 19 issues
interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  trend?: string;
  onClick?: () => void;
}

interface DashboardStatistics {
  totalTestCases: number;
  totalTestSuites: number;
  totalTestRuns: number;
  totalRequirements: number;
  totalDefects: number;
  totalMilestones: number;
  totalTestPlans: number;
  totalProjects: number;
  passRate: number;
  totalExecuted?: number;
  totalNotTested?: number;
}

const StatCard = ({ title, value, icon: Icon, color, trend, onClick }: StatCardProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
  <Card 
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    className="hover:shadow-lg transition-shadow duration-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    onClick={onClick}
    onKeyDown={handleKeyDown}
  >
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
      <Icon className={`h-4 w-4 ${color}`} />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      {trend && (
        <p className="text-xs text-gray-500 mt-1">{trend}</p>
      )}
    </CardContent>
  </Card>
  );
};

const ACTIVITY_LABEL_KEYS: Partial<Record<AuditAction, string>> = {
  create: 'actionCreated',
  update: 'actionUpdated',
  delete: 'actionDeleted',
  execute: 'actionExecuted',
  login: 'actionLoggedIn',
  logout: 'actionLoggedOut',
  assign: 'actionAssigned',
  unassign: 'actionUnassigned',
  approve: 'actionApproved',
  reject: 'actionRejected',
  archive: 'actionArchived',
  restore: 'actionRestored',
  export: 'actionExported',
  import: 'actionImported',
  sync: 'actionSynced',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  not_tested: 'statusNotTested',
  in_progress: 'statusInProgress',
  pending: 'statusPending',
  pass: 'statusPassed',
  passed: 'statusPassed',
  fail: 'statusFailed',
  failed: 'statusFailed',
  block: 'statusBlocked',
  blocked: 'statusBlocked',
  skip: 'statusSkipped',
  skipped: 'statusSkipped',
  completed: 'statusCompleted',
};

const ENTITY_LABEL_KEYS: Partial<Record<EntityType, string>> = {
  test_case: 'entityTestCase',
  test_run: 'entityTestRun',
  test_suite: 'entityTestSuite',
  test_result: 'entityTestResult',
  user: 'entityUser',
  project: 'entityProject',
  defect: 'entityDefect',
  requirement: 'entityRequirement',
  milestone: 'entityMilestone',
  test_plan: 'entityTestPlan',
  custom_field: 'entityCustomField',
  jira_integration: 'entityJiraIntegration',
  notification: 'entityNotification',
  test_case_section: 'entityTestCaseSection',
  test_schedule: 'entityTestSchedule',
  test_execution: 'entityTestExecution',
  invitation: 'entityInvitation',
  shared_step: 'entitySharedStep',
  shared_step_template: 'entitySharedStepTemplate',
  system_setting: 'entitySystemSetting',
  global_parameter: 'entityGlobalParameter',
  test_execution_settings: 'entityTestExecutionSettings',
  automation_settings: 'entityAutomationSettings',
  kpi_data: 'entityKpiData',
  test_step_result: 'entityTestStepResult',
  shareable_report: 'entityShareableReport',
  root_cause_analysis: 'entityRootCauseAnalysis',
  dashboard_widget: 'entityDashboardWidget',
  traceability_entry: 'entityTraceabilityEntry',
  coverage_report: 'entityCoverageReport',
};

const humanizeToken = (value?: string) => value ? value.replace(/[-_]/g, ' ') : '';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatActivityToken = (value: string | undefined, t: (key: any, params?: Record<string, string | number>) => string) => {
  if (!value) return '';
  const normalized = value.toLowerCase();
  const actionKey = ACTIVITY_LABEL_KEYS[normalized as AuditAction];
  const statusKey = STATUS_LABEL_KEYS[normalized];
  return actionKey ? t(actionKey as any) : statusKey ? t(statusKey as any) : humanizeToken(value);
};

const formatActivityDescription = (description: string | undefined, t: (key: any, params?: Record<string, string | number>) => string) => {
  if (!description) return '';
  return Object.entries(STATUS_LABEL_KEYS).reduce((text, [token, labelKey]) => {
    return text.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), t(labelKey as any));
  }, description);
};

const formatEntityLabel = (entityType: EntityType | undefined, t: (key: any, params?: Record<string, string | number>) => string) => {
  if (!entityType) return '';
  const labelKey = ENTITY_LABEL_KEYS[entityType];
  return labelKey ? t(labelKey as any) : humanizeToken(entityType);
};

const formatDateTime = (value?: string, fallback = '') => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
};

const ActivityIcon = ({ activity }: { activity: AuditTrail }) => {
  const action = activity.action?.toLowerCase();
  const entityType = activity.entity_type?.toLowerCase();

  if (action === 'execute' || entityType === 'test_result') {
    return <CheckCircle className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-400" />;
  }
  if (entityType === 'test_case') return <FileText className="h-[18px] w-[18px] text-blue-600 dark:text-blue-400" />;
  if (entityType === 'test_run') return <PlayCircle className="h-[18px] w-[18px] text-yellow-600 dark:text-yellow-400" />;
  if (entityType === 'test_suite') return <Target className="h-[18px] w-[18px] text-orange-600 dark:text-orange-400" />;
  if (entityType === 'user') return <Users className="h-[18px] w-[18px] text-purple-600 dark:text-purple-400" />;
  if (entityType === 'project') return <FileCheck className="h-[18px] w-[18px] text-indigo-600 dark:text-indigo-400" />;
  if (entityType === 'defect') return <Bug className="h-[18px] w-[18px] text-red-600 dark:text-red-400" />;
  return <Calendar className="h-[18px] w-[18px] text-gray-600 dark:text-gray-400" />;
};

export function Dashboard() {
  const { t, isRTL } = useTranslation();
  const navigate = useNavigate();
  const { selectedProject } = useProjectStore();
  const [recentActivities, setRecentActivities] = useState<AuditTrail[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActivityLoading, setIsActivityLoading] = useState(true);
  const [statsError, setStatsError] = useState('');
  const [activityError, setActivityError] = useState('');
  
  useEffect(() => {
    const controller = new AbortController();
    const projectId = selectedProject?.id;

    const loadRecentActivities = async () => {
      setIsActivityLoading(true);
      setActivityError('');
      try {
        const response = await auditAPI.getAuditTrails({ limit: 10, project_id: projectId }, controller.signal);
        setRecentActivities(response.items);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Failed to load recent activities:', error);
        setRecentActivities([]);
        setActivityError(getApiErrorMessage(error, t('failedToLoadRecentActivity')));
      } finally {
        if (!controller.signal.aborted) {
          setIsActivityLoading(false);
        }
      }
    };

    const loadDashboardStats = async () => {
      setIsLoading(true);
      setStatsError('');
      try {
        const stats = await analyticsAPI.getDashboardStatistics(projectId, controller.signal);
        setDashboardStats(stats);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('❌ Failed to load dashboard statistics:', error);
        setDashboardStats(null);
        setStatsError(getApiErrorMessage(error, t('failedToLoadDashboardStats')));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadRecentActivities();
    loadDashboardStats();

    return () => controller.abort();
  }, [selectedProject?.id, t]);

  const handleActivityClick = (activity: AuditTrail) => {
    // Only navigate if the activity belongs to the selected project or if no project is selected
    // This prevents users from being navigated to projects they don't have access to
    const targetProjectId = activity.project_id;
    const shouldNavigate = !selectedProject || selectedProject.id === targetProjectId;
    
    if (!shouldNavigate) {
      // If activity belongs to a different project, show message or do nothing
      // This prevents confusing context switching
      return;
    }
    
    if (activity.entity_type === 'user') {
      navigate('/settings');
      return;
    }

    if (activity.entity_type === 'project') {
      navigate(activity.entity_id ? `/projects/${activity.entity_id}` : '/projects');
      return;
    }

    // Use the activity's project_id if available, otherwise use selected project
    const projectId = targetProjectId || selectedProject?.id;
    
    if (!projectId) {
      // If no project context, don't navigate
      return;
    }
    
    // Handle real audit trail data
    switch (activity.entity_type) {
      case 'test_case':
        if (activity.entity_id) {
          navigate(`/projects/${projectId}/test-cases/${activity.entity_id}`);
        } else {
          navigate(`/projects/${projectId}/test-cases`);
        }
        break;
      case 'test_run':
        if (activity.entity_id) {
          navigate(`/projects/${projectId}/test-runs/${activity.entity_id}`);
        } else {
          navigate(`/projects/${projectId}/test-runs`);
        }
        break;
      case 'test_suite':
        if (activity.entity_id) {
          navigate(`/projects/${projectId}/test-suites/${activity.entity_id}`);
        } else {
          navigate(`/projects/${projectId}/test-suites`);
        }
        break;
      case 'requirement':
        navigate(`/projects/${projectId}/requirements${activity.entity_id ? `/${activity.entity_id}` : ''}`);
        break;
      case 'defect':
        navigate(`/projects/${projectId}/defects`);
        break;
      case 'test_plan':
        navigate(`/projects/${projectId}/test-plans`);
        break;
      case 'milestone':
        navigate(`/projects/${projectId}/milestones`);
        break;
      default:
        // For other entity types, navigate to activity management
        navigate('/activity-management');
        break;
    }
  };
  const stats = useMemo(() => {
    if (!dashboardStats) {
      // Return empty stats while loading
      return {
        totalTests: 0,
        totalTestSuites: 0,
        totalTestRuns: 0,
        passRate: 0,
        totalRequirements: 0,
        totalDefects: 0,
        totalMilestones: 0,
      totalTestPlans: 0,
      totalProjects: 0,
      totalExecuted: 0,
      totalNotTested: 0,
      recentActivity: recentActivities
    };
    }

    const totalTests = dashboardStats.totalTestCases || 0;
    const totalTestSuites = dashboardStats.totalTestSuites || 0;
    const totalTestRuns = dashboardStats.totalTestRuns || 0;
    const passRate = dashboardStats.passRate || 0;

    return {
      totalTests,
      totalTestSuites,
      totalTestRuns,
      passRate,
      totalRequirements: dashboardStats.totalRequirements || 0,
      totalDefects: dashboardStats.totalDefects || 0,
      totalMilestones: dashboardStats.totalMilestones || 0,
      totalTestPlans: dashboardStats.totalTestPlans || 0,
      totalProjects: dashboardStats.totalProjects || 0,
      totalExecuted: dashboardStats.totalExecuted || 0,
      totalNotTested: dashboardStats.totalNotTested || 0,
      recentActivity: recentActivities
    };
  }, [dashboardStats, recentActivities]);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t('dashboard')}</h1>
            <p className="text-gray-600 dark:text-gray-400">
              {selectedProject 
                ? t('viewingDataFor', { name: selectedProject.name }) 
                : t('welcomeToTestManagement')}
            </p>
          </div>
          {selectedProject && (
            <Badge variant="outline" className="text-sm px-3 py-1">
              <Target className={`h-3.5 w-3.5 ${isRTL ? 'ml-1.5' : 'mr-1.5'}`} />
              {selectedProject.name}
            </Badge>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className={`h-8 w-8 animate-spin text-blue-600 ${isRTL ? 'ml-2' : 'mr-2'}`} />
          <span className="text-gray-600">{t('loadingDashboardStats')}</span>
        </div>
      )}

      {statsError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {statsError}
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t('testCasesTitle')}
          value={stats.totalTests}
          icon={FileText}
          color="text-blue-600"
          trend={t('active')}
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/test-cases` : '/projects')}
        />
        <StatCard
          title={t('testSuites')}
          value={stats.totalTestSuites}
          icon={TestTube}
          color="text-green-600"
          trend={t('organizedTestSuites')}
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/test-suites` : '/projects')}
        />
        <StatCard
          title={t('testRuns')}
          value={stats.totalTestRuns}
          icon={PlayCircle}
          color="text-yellow-600"
          trend={t('completedExecutions')}
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/test-runs` : '/projects')}
        />
        <StatCard
          title={t('passRate')}
          value={`${stats.passRate}%`}
          icon={TrendingUp}
          color="text-purple-600"
          trend={t('overallSuccessRate')}
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/test-runs` : '/projects')}
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t('requirements')}
          value={stats.totalRequirements}
          icon={FileCheck}
          color="text-indigo-600"
          trend={t('trackedRequirements')}
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/requirements` : '/projects')}
        />
        <StatCard
          title={t('defects')}
          value={stats.totalDefects}
          icon={AlertTriangle}
          color="text-red-600"
          trend={t('openDefects')}
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/defects` : '/projects')}
        />
        <StatCard
          title={t('milestones')}
          value={stats.totalMilestones}
          icon={Flag}
          color="text-orange-600"
          trend={t('activeMilestones')}
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/milestones` : '/projects')}
        />
        <StatCard
          title={t('testPlans')}
          value={stats.totalTestPlans}
          icon={Calendar}
          color="text-teal-600"
          trend={t('plannedExecutions')}
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/test-plans` : '/projects')}
        />
      </div>

      {/* Recent Activity */}
      <Card className="border-gray-200 dark:border-gray-800 shadow-xs">
        <CardHeader className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold text-gray-900 dark:text-white">{t('recentActivity')}</CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/activity-management')}
              className="h-8 px-3 text-xs font-medium hover:bg-white dark:hover:bg-gray-800 transition-colors"
            >
              <ExternalLink className={`h-3.5 w-3.5 ${isRTL ? 'ml-1.5' : 'mr-1.5'}`} />
              {t('viewAllActivities')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isActivityLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 px-4 text-sm text-gray-600 dark:text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <span>{t('loadingRecentActivity')}</span>
            </div>
          ) : activityError ? (
            <div role="alert" className="m-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {activityError}
            </div>
          ) : recentActivities.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-3">
                <Calendar className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{t('noRecentActivity')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('activityWillAppear')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {stats.recentActivity.map((activity, index) => (
                <div 
                  key={activity.id || index} 
                  className="flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-all duration-150 group"
                  onClick={() => handleActivityClick(activity)}
                >
                  <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-gray-100 dark:bg-gray-800 group-hover:scale-105 transition-transform">
                    <ActivityIcon activity={activity} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-white font-medium leading-snug">
                      <span>{formatActivityToken(activity.action, t) || t('unknown')}</span>
                      {activity.entity_type && <span className="text-gray-600 dark:text-gray-400 font-normal"> {formatEntityLabel(activity.entity_type, t)}</span>}
                      {activity.description && <span className="text-gray-600 dark:text-gray-400 font-normal">: {formatActivityDescription(activity.description, t)}</span>}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatDateTime(activity.created_at, t('unknownTime'))}
                    </p>
                  </div>
                  <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ExternalLink className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card 
          className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/test-cases` : '/projects')}
        >
          <CardContent className="p-6 text-center">
            <FileText className="h-8 w-8 text-blue-600 mx-auto mb-2" />
            <h3 className="font-semibold">{t('createTestCase')}</h3>
            <p className="text-sm text-gray-600">{t('addNewTestCase')}</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/test-runs` : '/projects')}
        >
          <CardContent className="p-6 text-center">
            <PlayCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
            <h3 className="font-semibold">{t('startTestRun')}</h3>
            <p className="text-sm text-gray-600">{t('executeTests')}</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/defects` : '/projects')}
        >
          <CardContent className="p-6 text-center">
            <Bug className="h-8 w-8 text-red-600 mx-auto mb-2" />
            <h3 className="font-semibold">{t('reportDefect')}</h3>
            <p className="text-sm text-gray-600">{t('logNewIssue')}</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
          onClick={() => navigate(selectedProject ? `/projects/${selectedProject.id}/reports` : '/projects')}
        >
          <CardContent className="p-6 text-center">
            <FileCheck className="h-8 w-8 text-purple-600 mx-auto mb-2" />
            <h3 className="font-semibold">{t('viewReports')}</h3>
            <p className="text-sm text-gray-600">{t('checkAnalytics')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
