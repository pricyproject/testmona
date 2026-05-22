import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Search, 
  Filter, 
  Eye, 
  Calendar, 
  User, 
  CheckCircle, 
  AlertTriangle,
  Download,
  RefreshCw,
  History,
  Settings,
  FileText,
  GitBranch,
  Users,
  Package,
  Play,
  Plus,
  Trash2,
  LogIn,
  LogOut,
  UserCheck,
  UserMinus,
  Check,
  X,
  Archive,
  ArchiveRestore,
  FileDown,
  FileUp,
  RotateCw
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { auditAPI, getApiErrorMessage } from '@/lib/api';
import { AuditTrail, AuditTrailFilters, AuditAction, EntityType } from '@/types';

const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'actionCreated',
  update: 'actionUpdated',
  delete: 'actionDeleted',
  login: 'actionLoggedIn',
  logout: 'actionLoggedOut',
  execute: 'actionExecuted',
  assign: 'actionAssigned',
  unassign: 'actionUnassigned',
  approve: 'actionApproved',
  reject: 'actionRejected',
  archive: 'actionArchived',
  restore: 'actionRestored',
  export: 'actionExported',
  import: 'actionImported',
  sync: 'actionSynced'
};

const ENTITY_LABELS: Record<EntityType, string> = {
  user: 'entityUser',
  project: 'entityProject',
  test_case: 'entityTestCase',
  test_suite: 'entityTestSuite',
  test_run: 'entityTestRun',
  test_result: 'entityTestResult',
  test_plan: 'entityTestPlan',
  requirement: 'entityRequirement',
  defect: 'entityDefect',
  milestone: 'entityMilestone',
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
  coverage_report: 'entityCoverageReport'
};

const ACTION_ICONS: Record<AuditAction, React.ReactNode> = {
  create: <Plus className="h-3 w-3" />,
  update: <RefreshCw className="h-3 w-3" />,
  delete: <Trash2 className="h-3 w-3" />,
  login: <LogIn className="h-3 w-3" />,
  logout: <LogOut className="h-3 w-3" />,
  execute: <Play className="h-3 w-3" />,
  assign: <UserCheck className="h-3 w-3" />,
  unassign: <UserMinus className="h-3 w-3" />,
  approve: <Check className="h-3 w-3" />,
  reject: <X className="h-3 w-3" />,
  archive: <Archive className="h-3 w-3" />,
  restore: <ArchiveRestore className="h-3 w-3" />,
  export: <FileDown className="h-3 w-3" />,
  import: <FileUp className="h-3 w-3" />,
  sync: <RotateCw className="h-3 w-3" />
};

const ENTITY_ICONS: Record<EntityType, React.ReactNode> = {
  user: <Users className="h-4 w-4" />,
  project: <Package className="h-4 w-4" />,
  test_case: <FileText className="h-4 w-4" />,
  test_suite: <GitBranch className="h-4 w-4" />,
  test_run: <Settings className="h-4 w-4" />,
  test_result: <CheckCircle className="h-4 w-4" />,
  test_plan: <Calendar className="h-4 w-4" />,
  requirement: <FileText className="h-4 w-4" />,
  defect: <AlertTriangle className="h-4 w-4" />,
  milestone: <CheckCircle className="h-4 w-4" />,
  custom_field: <Settings className="h-4 w-4" />,
  jira_integration: <GitBranch className="h-4 w-4" />,
  notification: <AlertTriangle className="h-4 w-4" />,
  test_case_section: <FileText className="h-4 w-4" />,
  test_schedule: <Calendar className="h-4 w-4" />,
  test_execution: <Play className="h-4 w-4" />,
  invitation: <UserCheck className="h-4 w-4" />,
  shared_step: <FileText className="h-4 w-4" />,
  shared_step_template: <FileText className="h-4 w-4" />,
  system_setting: <Settings className="h-4 w-4" />,
  global_parameter: <Settings className="h-4 w-4" />,
  test_execution_settings: <Settings className="h-4 w-4" />,
  automation_settings: <Settings className="h-4 w-4" />,
  kpi_data: <CheckCircle className="h-4 w-4" />,
  test_step_result: <CheckCircle className="h-4 w-4" />,
  shareable_report: <FileDown className="h-4 w-4" />,
  root_cause_analysis: <AlertTriangle className="h-4 w-4" />,
  dashboard_widget: <Settings className="h-4 w-4" />,
  traceability_entry: <GitBranch className="h-4 w-4" />,
  coverage_report: <FileText className="h-4 w-4" />
};

const ENTITY_TYPES = Object.keys(ENTITY_LABELS) as EntityType[];

export function ActivityManagement() {
  const { t, isRTL } = useTranslation();
  const [auditTrails, setAuditTrails] = useState<AuditTrail[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState<AuditAction | 'all'>('all');
  const [selectedEntityType, setSelectedEntityType] = useState<EntityType | 'all'>('all');
  const [dateRange, setDateRange] = useState('all');
  const [selectedAuditTrail, setSelectedAuditTrail] = useState<AuditTrail | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const requestIdRef = useRef(0);

  const getActionLabel = (action: AuditAction) => {
    const key = ACTION_LABELS[action];
    return key ? t(key as any) : action;
  };

  const getEntityLabel = (entityType: EntityType) => {
    const key = ENTITY_LABELS[entityType];
    return key ? t(key as any) : entityType.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  };

  const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const baseFilters = useMemo((): AuditTrailFilters => ({
    limit,
    offset,
    search: debouncedSearchQuery || undefined,
    action: selectedAction !== 'all' ? selectedAction : undefined,
    entity_type: selectedEntityType !== 'all' ? selectedEntityType : undefined
  }), [limit, offset, debouncedSearchQuery, selectedAction, selectedEntityType]);

  const buildFilters = useCallback((overrides: AuditTrailFilters = {}): AuditTrailFilters => {
    const now = new Date();
    const dateFrom = dateRange === 'today' ? getLocalDateString(now) :
      dateRange === 'week' ? getLocalDateString(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)) :
      dateRange === 'month' ? getLocalDateString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)) :
      undefined;

    return {
      ...baseFilters,
      date_from: dateFrom,
      ...overrides
    };
  }, [baseFilters, dateRange]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
      setOffset(0);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  const loadAuditTrails = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const activeFilters = buildFilters();
    setLoading(true);
    setLoadError('');
    try {
      const response = await auditAPI.getAuditTrails(activeFilters);
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (response.total > 0 && activeFilters.offset !== undefined && activeFilters.limit && activeFilters.offset >= response.total) {
        setOffset(Math.floor((response.total - 1) / activeFilters.limit) * activeFilters.limit);
        return;
      }
      setAuditTrails(response.items);
      setTotal(response.total);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      console.error('Failed to load audit trails:', error);
      setAuditTrails([]);
      setTotal(0);
      setLoadError(getApiErrorMessage(error, t('failedToLoadAuditTrails')));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [buildFilters, t]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadAuditTrails();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadAuditTrails]);

  const handleViewDetails = (auditTrail: AuditTrail) => {
    setSelectedAuditTrail(auditTrail);
    setDetailDialogOpen(true);
  };

  const exportAuditTrails = async () => {
    setExporting(true);
    try {
      const pageSize = 1000;
      let exportOffset = 0;
      let exportTotal = 0;
      const allAuditTrails: AuditTrail[] = [];

      do {
        const response = await auditAPI.getAuditTrails(buildFilters({ limit: pageSize, offset: exportOffset }));
        allAuditTrails.push(...response.items);
        exportTotal = response.total;
        exportOffset += pageSize;

        if (response.items.length === 0) {
          break;
        }
      } while (allAuditTrails.length < exportTotal);
      
      if (!allAuditTrails || allAuditTrails.length === 0) {
        alert(t('noAuditTrailsToExport'));
        return;
      }

      const csvValue = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      
      const csvContent = [
        t('csvHeader'),
        ...allAuditTrails.map(audit => 
          [
            audit.id,
            audit.user_id,
            audit.action,
            audit.entity_type,
            audit.entity_id,
            audit.project_id,
            audit.description,
            audit.ip_address,
            audit.user_agent,
            audit.created_at
          ].map(csvValue).join(',')
        )
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-trails-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export audit trails:', error);
      alert(t('failedToExportAuditTrails'));
    } finally {
      setExporting(false);
    }
  };

  const getActionBadge = (action: AuditAction) => {
    const variants: Record<AuditAction, string> = {
      create: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      update: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      delete: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      login: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      logout: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
      execute: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      assign: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
      unassign: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      approve: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      reject: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      archive: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
      restore: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
      export: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
      import: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
      sync: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400'
    };
    return variants[action] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  const getEntityBadge = (entityType: EntityType) => {
    const variants: Record<EntityType, string> = {
      user: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      project: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      test_case: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      test_suite: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      test_run: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      test_result: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      test_plan: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
      requirement: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
      defect: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      milestone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
      custom_field: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
      jira_integration: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
      notification: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
      test_case_section: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400',
      test_schedule: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
      test_execution: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      invitation: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
      shared_step: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      shared_step_template: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
      system_setting: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400',
      global_parameter: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
      test_execution_settings: 'bg-stone-100 text-stone-800 dark:bg-stone-900/30 dark:text-stone-400',
      automation_settings: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      kpi_data: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
      test_step_result: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      shareable_report: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
      root_cause_analysis: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      dashboard_widget: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
      traceability_entry: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
      coverage_report: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400'
    };
    return variants[entityType] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  const getUserDisplayName = (auditTrail: AuditTrail) => (
    auditTrail.user_full_name || auditTrail.username || `${t('auditUser')} ${auditTrail.user_id}`
  );

  const formatDateTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t('notAvailable') : date.toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('activityManagement')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('activityManagementDescription')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadAuditTrails} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </Button>
          <Button variant="outline" onClick={exportAuditTrails} disabled={exporting || loading} className="gap-2">
            <Download className="h-4 w-4" />
            {t('export')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            {t('auditFilters')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>{t('search')}</Label>
              <div className="relative">
                <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 ${isRTL ? 'right-3' : 'left-3'}`} />
                <Input
                  placeholder={t('searchActivities')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full ${isRTL ? 'pr-9' : 'pl-9'}`}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('action')}</Label>
              <Select value={selectedAction} onValueChange={(value) => {
                setSelectedAction(value as AuditAction | 'all');
                setOffset(0);
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allActions')}</SelectItem>
                  {Object.entries(ACTION_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{t(label as any)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('entityType')}</Label>
              <Select value={selectedEntityType} onValueChange={(value) => {
                setSelectedEntityType(value as EntityType | 'all');
                setOffset(0);
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allEntityTypes')}</SelectItem>
                  {ENTITY_TYPES.map((entityType) => (
                    <SelectItem key={entityType} value={entityType}>{getEntityLabel(entityType)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('dateRange')}</Label>
              <Select value={dateRange} onValueChange={(value) => {
                setDateRange(value);
                setOffset(0);
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allTime')}</SelectItem>
                  <SelectItem value="today">{t('today')}</SelectItem>
                  <SelectItem value="week">{t('last7Days')}</SelectItem>
                  <SelectItem value="month">{t('last30Days')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activities Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{t('auditTrails')} ({auditTrails.length} of {total})</span>
            <Button variant="outline" size="sm" onClick={loadAuditTrails} className="gap-2" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {t('refresh')}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span>{t('loadingAuditTrails')}</span>
            </div>
          ) : loadError ? (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {loadError}
            </div>
          ) : auditTrails.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>{t('noAuditTrailsFound')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('auditAction')}</TableHead>
                  <TableHead>{t('entityType')}</TableHead>
                  <TableHead>{t('entityId')}</TableHead>
                  <TableHead>{t('auditDescription')}</TableHead>
                  <TableHead>{t('userId')}</TableHead>
                  <TableHead>{t('ipAddress')}</TableHead>
                  <TableHead>{t('timestamp')}</TableHead>
                  <TableHead>{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditTrails.map((auditTrail) => (
                  <TableRow key={auditTrail.id}>
                    <TableCell>
                      <Badge className={`${getActionBadge(auditTrail.action)} inline-flex items-center gap-1.5 px-2.5 py-1 whitespace-nowrap`}>
                        {ACTION_ICONS[auditTrail.action]}
                        <span>{getActionLabel(auditTrail.action)}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${getEntityBadge(auditTrail.entity_type)} inline-flex items-center gap-1.5 px-2.5 py-1 whitespace-nowrap`}>
                        {ENTITY_ICONS[auditTrail.entity_type]}
                        <span>{getEntityLabel(auditTrail.entity_type)}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>{auditTrail.entity_id || '-'}</TableCell>
                    <TableCell className="max-w-xs truncate">{auditTrail.description || '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {getUserDisplayName(auditTrail)}
                          </span>
                        </div>
                        <span className={`text-xs text-gray-500 dark:text-gray-400 ${isRTL ? 'mr-5' : 'ml-5'}`}>
                          {t('idPrefix')}: {auditTrail.user_id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{auditTrail.ip_address || '-'}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-sm">
                          {formatDateTime(auditTrail.created_at)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('viewDetails')}
                          onClick={() => handleViewDetails(auditTrail)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('showingEntries', { start: total > 0 ? offset + 1 : 0, end: total > 0 ? Math.min(offset + limit, total) : 0, total })}
                </span>
                <Select value={limit.toString()} onValueChange={(value) => {
                  setLimit(parseInt(value));
                  setOffset(0);
                }}>
                  <SelectTrigger className="w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-gray-600 dark:text-gray-400">{t('perPage')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0 || total === 0}
                >
                  {t('previousItem')}
                </Button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('auditPageOf', { current: total > 0 ? Math.floor(offset / limit) + 1 : 0, total: total > 0 ? Math.ceil(total / limit) : 0 })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newOffset = offset + limit;
                    const maxOffset = total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
                    setOffset(Math.min(newOffset, maxOffset));
                  }}
                  disabled={offset + limit >= total || total === 0}
                >
                  {t('nextItem')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Trail Details Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[800px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t('auditTrailDetails')}
            </DialogTitle>
          </DialogHeader>
          {selectedAuditTrail && (
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>{t('auditAction')}</Label>
                  <Badge className={`${getActionBadge(selectedAuditTrail.action)} inline-flex items-center gap-1.5 px-2.5 py-1 whitespace-nowrap`}>
                    {ACTION_ICONS[selectedAuditTrail.action]}
                    <span>{getActionLabel(selectedAuditTrail.action)}</span>
                  </Badge>
                </div>
                <div>
                  <Label>{t('entityType')}</Label>
                  <Badge className={`${getEntityBadge(selectedAuditTrail.entity_type)} inline-flex items-center gap-1.5 px-2.5 py-1 whitespace-nowrap`}>
                    {ENTITY_ICONS[selectedAuditTrail.entity_type]}
                    <span>{getEntityLabel(selectedAuditTrail.entity_type)}</span>
                  </Badge>
                </div>
                <div>
                  <Label>{t('entityId')}</Label>
                  <p className="text-sm font-medium">{selectedAuditTrail.entity_id ?? '-'}</p>
                </div>
                <div>
                  <Label>{t('auditProjectId')}</Label>
                  <p className="text-sm font-medium">{selectedAuditTrail.project_id ?? '-'}</p>
                </div>
                <div>
                  <Label>{t('userId')}</Label>
                  <p className="text-sm font-medium">{getUserDisplayName(selectedAuditTrail)} ({t('idPrefix')}: {selectedAuditTrail.user_id})</p>
                </div>
                <div>
                  <Label>{t('ipAddress')}</Label>
                  <p className="text-sm font-medium">{selectedAuditTrail.ip_address || '-'}</p>
                </div>
              </div>
              <div>
                <Label>{t('auditDescription')}</Label>
                <p className="text-sm">{selectedAuditTrail.description || t('noDescriptionAvailable')}</p>
              </div>
              <div>
                <Label>{t('timestamp')}</Label>
                <p className="text-sm">{formatDateTime(selectedAuditTrail.created_at)}</p>
              </div>
              <div>
                <Label>{t('userAgent')}</Label>
                <p className="text-sm font-mono bg-gray-100 dark:bg-gray-800 p-2 rounded">
                  {selectedAuditTrail.user_agent || t('notAvailable')}
                </p>
              </div>
              {selectedAuditTrail.old_values && (
                <div>
                  <Label>{t('oldValues')}</Label>
                  <Textarea 
                    value={JSON.stringify(selectedAuditTrail.old_values, null, 2)} 
                    readOnly 
                    className="mt-1 font-mono text-sm"
                    rows={4}
                  />
                </div>
              )}
              {selectedAuditTrail.new_values && (
                <div>
                  <Label>{t('newValues')}</Label>
                  <Textarea 
                    value={JSON.stringify(selectedAuditTrail.new_values, null, 2)} 
                    readOnly 
                    className="mt-1 font-mono text-sm"
                    rows={4}
                  />
                </div>
              )}
              {selectedAuditTrail.field_changes && (
                <div>
                  <Label>{t('fieldChanges')}</Label>
                  <Textarea 
                    value={JSON.stringify(selectedAuditTrail.field_changes, null, 2)} 
                    readOnly 
                    className="mt-1 font-mono text-sm"
                    rows={3}
                  />
                </div>
              )}
              {selectedAuditTrail.additional_metadata && (
                <div>
                  <Label>{t('additionalMetadata')}</Label>
                  <Textarea 
                    value={JSON.stringify(selectedAuditTrail.additional_metadata, null, 2)} 
                    readOnly 
                    className="mt-1 font-mono text-sm"
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDetailDialogOpen(false)}>{t('close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
