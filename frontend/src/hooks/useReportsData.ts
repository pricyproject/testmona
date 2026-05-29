import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/authStore';
import { analyticsAPI, auditAPI } from '@/lib/api';
import {
  DashboardWidgetDef,
  LoadKey,
  SectionKey,
  DEFAULT_WIDGETS,
  LAYOUT_WIDGET_TYPE,
  loadWidgetLayout,
  saveWidgetLayout,
  reconcileLayoutIds,
} from '@/components/reports/reportsUtils';

const timeRangeToDays = (timeRange: string) =>
  timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

export interface TraceabilityFilters {
  priority: string;
  coverage_status: string;
  test_status: string;
  search: string;
}

/**
 * Owns all of the reports page's data fetching and view state. Splitting this out
 * of the page component keeps the section components purely presentational and lets
 * each panel show its own loading state via `loadingByTab`.
 *
 * A monotonic `requestSeq` discards responses from superseded requests (section
 * switches / project changes / refreshes) so stale data never overwrites fresh data.
 */
export function useReportsData(projectId: string | undefined) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const currentUser = useAuthStore((s) => s.user);

  const [layoutWidgetId, setLayoutWidgetId] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState('7d');
  const [isEditMode, setIsEditMode] = useState(false);
  const [loadingByTab, setLoadingByTab] = useState<Partial<Record<LoadKey, boolean>>>({});
  const setTabLoading = (tab: LoadKey, value: boolean) =>
    setLoadingByTab((prev) => ({ ...prev, [tab]: value }));
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState(parseInt(projectId || '') || 1);

  const requestSeq = useRef(0);

  // Real data states
  const [dashboardAnalytics, setDashboardAnalytics] = useState<any>(null);
  const [analyticsTimeSeries, setAnalyticsTimeSeries] = useState<any>(null);
  const [granularInsights, setGranularInsights] = useState<any>(null);
  const [shareableReports, setShareableReports] = useState<any[]>([]);
  const [rootCauseAnalyses, setRootCauseAnalyses] = useState<any[]>([]);
  const [dashboardWidgets, setDashboardWidgets] = useState<DashboardWidgetDef[]>(
    () => loadWidgetLayout(parseInt(projectId || '') || 1)
  );

  const [traceabilityData, setTraceabilityData] = useState<any>(null);
  const [coverageReports, setCoverageReports] = useState<any[]>([]);
  const [testExecutionStatus, setTestExecutionStatus] = useState<any>(null);
  const [activityStats, setActivityStats] = useState<any>(null);
  const [testActivity, setTestActivity] = useState<any>(null);

  const [granularFilter, setGranularFilter] = useState<'all' | 'failed' | 'slow'>('all');

  const [traceabilityFilters, setTraceabilityFilters] = useState<TraceabilityFilters>({
    priority: 'all',
    coverage_status: 'all',
    test_status: 'all',
    search: '',
  });
  const [traceabilityPage, setTraceabilityPage] = useState(0);
  const TRACEABILITY_PAGE_SIZE = 25;

  // Update selected project (and its saved widget layout) when the URL parameter changes.
  useEffect(() => {
    if (!projectId) return;
    const id = parseInt(projectId);
    if (Number.isNaN(id)) return;
    setSelectedProject(id);
    setDashboardWidgets(loadWidgetLayout(id));
    setLayoutWidgetId(null);

    if (!currentUser) return;
    let cancelled = false;
    analyticsAPI
      .getDashboardWidgets(id)
      .then((widgets: any[]) => {
        if (cancelled) return;
        const layoutWidget = (widgets || []).find(
          (w: any) => w?.widget_type === LAYOUT_WIDGET_TYPE,
        );
        if (layoutWidget) {
          setLayoutWidgetId(layoutWidget.id);
          const ids = layoutWidget.widget_config?.ids;
          if (Array.isArray(ids)) {
            setDashboardWidgets(reconcileLayoutIds(ids));
          }
        }
      })
      .catch((err) => {
        // Failure is non-fatal — localStorage layout already applied.
        console.error('Failed to load dashboard layout from backend:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, currentUser]);

  const loadDashboardAnalytics = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('dashboard', true);
    setError(null);
    try {
      const [data, timeSeries] = await Promise.all([
        analyticsAPI.getDashboardAnalytics(selectedProject, timeRange),
        analyticsAPI.getAnalyticsTimeSeries(selectedProject, timeRange),
      ]);
      if (seq !== requestSeq.current) return true;
      setDashboardAnalytics(data);
      setAnalyticsTimeSeries(timeSeries);
      return true;
    } catch (err) {
      console.error('Failed to load dashboard analytics:', err);
      if (seq !== requestSeq.current) return false;
      setDashboardAnalytics(null);
      setAnalyticsTimeSeries(null);
      setError('Failed to load dashboard analytics.');
      return false;
    } finally {
      if (seq === requestSeq.current) setTabLoading('dashboard', false);
    }
  };

  const loadGranularInsights = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('granular', true);
    setError(null);
    try {
      const data = await analyticsAPI.getGranularInsights({
        project_id: selectedProject,
        filter_type: granularFilter,
        time_range: timeRange,
      });
      if (seq !== requestSeq.current) return true;
      setGranularInsights(data);
      return true;
    } catch (err) {
      console.error('Failed to load granular insights:', err);
      if (seq !== requestSeq.current) return false;
      setGranularInsights(null);
      setError('Failed to load granular insights.');
      return false;
    } finally {
      if (seq === requestSeq.current) setTabLoading('granular', false);
    }
  };

  const loadShareableReports = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('shareable', true);
    setError(null);
    try {
      const data = await analyticsAPI.getShareableReports(selectedProject);
      if (seq !== requestSeq.current) return true;
      setShareableReports(Array.isArray(data) ? data : []);
      return true;
    } catch (err) {
      console.error('Failed to load shareable reports:', err);
      if (seq !== requestSeq.current) return false;
      setShareableReports([]);
      setError('Failed to load shareable reports.');
      return false;
    } finally {
      if (seq === requestSeq.current) setTabLoading('shareable', false);
    }
  };

  const loadRootCauseAnalyses = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('root-cause', true);
    setError(null);
    try {
      const data = await analyticsAPI.getRootCauseAnalyses(selectedProject);
      if (seq !== requestSeq.current) return true;
      setRootCauseAnalyses(Array.isArray(data) ? data : []);
      return true;
    } catch (err) {
      console.error('Failed to load root cause analyses:', err);
      if (seq !== requestSeq.current) return false;
      setRootCauseAnalyses([]);
      setError('Failed to load root cause analyses.');
      return false;
    } finally {
      if (seq === requestSeq.current) setTabLoading('root-cause', false);
    }
  };

  const loadTraceabilityData = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('traceability', true);
    setError(null);
    try {
      const data = await analyticsAPI.getTraceabilityMatrix(selectedProject, {
        priority: traceabilityFilters.priority === 'all' ? undefined : traceabilityFilters.priority,
        coverage_status: traceabilityFilters.coverage_status === 'all' ? undefined : traceabilityFilters.coverage_status,
        test_status: traceabilityFilters.test_status === 'all' ? undefined : traceabilityFilters.test_status,
        search: traceabilityFilters.search || undefined,
        skip: traceabilityPage * TRACEABILITY_PAGE_SIZE,
        limit: TRACEABILITY_PAGE_SIZE,
      });
      if (seq !== requestSeq.current) return true;
      setTraceabilityData(data);
      return true;
    } catch (err) {
      console.error('Failed to load traceability data:', err);
      if (seq !== requestSeq.current) return false;
      setTraceabilityData(null);
      setError('Failed to load traceability data.');
      return false;
    } finally {
      if (seq === requestSeq.current) setTabLoading('traceability', false);
    }
  };

  // Coverage panel needs the coverage report and the execution status together.
  const loadCoverageData = async (generate = false): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('coverage', true);
    setError(null);
    try {
      const [coverage, executionStatus] = await Promise.all([
        generate
          ? analyticsAPI.generateCoverageReport(selectedProject)
          : analyticsAPI.getCoverageReports(selectedProject),
        analyticsAPI.getTestExecutionStatus(selectedProject),
      ]);
      if (seq !== requestSeq.current) return true;
      setCoverageReports(Array.isArray(coverage) ? coverage : [coverage]);
      setTestExecutionStatus(executionStatus);
      return true;
    } catch (err) {
      console.error('Failed to load coverage data:', err);
      if (seq !== requestSeq.current) return false;
      setCoverageReports([]);
      setTestExecutionStatus(null);
      setError('Failed to load coverage data.');
      return false;
    } finally {
      if (seq === requestSeq.current) setTabLoading('coverage', false);
    }
  };

  const loadActivityStatistics = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('activity', true);
    setError(null);
    try {
      const days = timeRangeToDays(timeRange);
      const data = await auditAPI.getProjectActivitySummary(selectedProject, days);
      if (seq !== requestSeq.current) return true;
      setActivityStats(data);
      return true;
    } catch (err) {
      console.error('Failed to load activity statistics:', err);
      if (seq !== requestSeq.current) return false;
      setActivityStats(null);
      setError('Failed to load activity statistics.');
      return false;
    } finally {
      if (seq === requestSeq.current) setTabLoading('activity', false);
    }
  };

  const loadTestActivity = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('test-activity', true);
    setError(null);
    try {
      const days = timeRangeToDays(timeRange);
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const data = await analyticsAPI.getTestActivity(selectedProject, startDate, endDate, 'day');
      if (seq !== requestSeq.current) return true;
      setTestActivity(data);
      return true;
    } catch (err) {
      console.error('Failed to load test activity:', err);
      if (seq !== requestSeq.current) return false;
      setTestActivity(null);
      setError('Failed to load test activity.');
      return false;
    } finally {
      if (seq === requestSeq.current) setTabLoading('test-activity', false);
    }
  };

  const handleGenerateCoverageReport = () => loadCoverageData(true);

  // Load all data backing a section. Loaders run sequentially so the requestSeq
  // staleness guard still protects against a mid-load section switch.
  const loadSection = async (section: SectionKey, generateCoverage = false): Promise<boolean> => {
    switch (section) {
      case 'overview':
        return loadDashboardAnalytics();
      case 'coverage-risk': {
        const a = await loadTraceabilityData();
        const b = await loadCoverageData(generateCoverage);
        const c = await loadGranularInsights();
        const d = await loadRootCauseAnalyses();
        return a && b && c && d;
      }
      case 'activity': {
        const a = await loadActivityStatistics();
        const b = await loadTestActivity();
        return a && b;
      }
      default:
        return true;
    }
  };

  const sectionLoading = (section: SectionKey): boolean => {
    switch (section) {
      case 'overview':
        return !!loadingByTab.dashboard;
      case 'coverage-risk':
        return !!(loadingByTab.traceability || loadingByTab.coverage || loadingByTab.granular || loadingByTab['root-cause']);
      case 'activity':
        return !!(loadingByTab.activity || loadingByTab['test-activity']);
      default:
        return false;
    }
  };

  // Toggle dashboard edit mode; persist the widget layout when leaving edit mode.
  const handleToggleEditMode = async () => {
    if (isEditMode) {
      const local = saveWidgetLayout(selectedProject, dashboardWidgets);
      let synced = local;
      if (currentUser) {
        try {
          const ids = dashboardWidgets.map((w) => w.id);
          if (layoutWidgetId) {
            await analyticsAPI.updateDashboardWidget(layoutWidgetId, { widget_config: { ids } });
          } else {
            const created = await analyticsAPI.createDashboardWidget({
              user_id: currentUser.id,
              project_id: selectedProject,
              widget_type: LAYOUT_WIDGET_TYPE,
              widget_title: 'Dashboard Layout',
              widget_config: { ids },
              position_x: 0,
              position_y: 0,
              width: 1,
              height: 1,
              is_visible: true,
            });
            if (created?.id) setLayoutWidgetId(created.id);
          }
        } catch (err) {
          console.error('Failed to sync layout to backend:', err);
          synced = false;
        }
      }
      toast({
        title: synced ? t('reports_toast_layoutSaved') : t('reports_toast_layoutSavedLocallyOnly'),
        description: synced
          ? currentUser
            ? t('reports_toast_layoutSavedSynced')
            : t('reports_toast_layoutSavedLocal')
          : t('reports_toast_layoutPartialSave'),
        variant: synced ? 'default' : 'destructive',
      });
    }
    setIsEditMode((prev) => !prev);
  };

  // Refresh the data for the active section and report the outcome honestly.
  const handleGenerateAnalytics = async () => {
    const section = activeSection;
    const ok = await loadSection(section, section === 'coverage-risk');
    toast({
      title: ok ? t('reports_toast_analyticsUpdated') : t('reports_toast_updateFailed'),
      description: ok
        ? t('reports_toast_analyticsUpdatedDesc')
        : t('reports_toast_updateFailedDesc'),
      variant: ok ? 'default' : 'destructive',
    });
  };

  // Build an export payload for the current section. Returns null when there's
  // nothing to export.
  const buildExport = (section: SectionKey): { data: any; filename: string } | null => {
    if (section === 'overview') {
      if (!dashboardAnalytics) return null;
      return { data: { dashboard: dashboardAnalytics, timeSeries: analyticsTimeSeries }, filename: 'overview-analytics.json' };
    }
    if (section === 'coverage-risk') {
      const hasData = (coverageReports && coverageReports.length) || traceabilityData;
      if (!hasData) return null;
      return {
        data: {
          coverage: coverageReports,
          traceability: traceabilityData,
          granular_insights: granularInsights,
          root_cause_analyses: rootCauseAnalyses,
        },
        filename: 'coverage-and-risk.json',
      };
    }
    if (section === 'activity') {
      if (!activityStats && !testActivity) return null;
      return { data: { activity: activityStats, test_activity: testActivity }, filename: 'activity-report.json' };
    }
    return null;
  };

  const handleExportReport = () => {
    const entry = buildExport(activeSection);
    if (!entry) {
      toast({
        title: t('reports_toast_nothingToExport'),
        description: t('reports_toast_loadDataFirst'),
        variant: 'destructive',
      });
      return;
    }
    const blob = new Blob([JSON.stringify(entry.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: t('reports_toast_exportReady'),
      description: t('reports_toast_exportReadyDesc', { filename: entry.filename }),
    });
  };

  // Load data when section, project, time range, or section-specific filters change.
  useEffect(() => {
    loadSection(activeSection);
  }, [activeSection, selectedProject, timeRange, granularFilter, traceabilityFilters, traceabilityPage]);

  // Debounce free-text traceability search → applied filter (server-side).
  useEffect(() => {
    const handle = setTimeout(() => {
      setTraceabilityFilters((prev) =>
        prev.search === searchQuery ? prev : { ...prev, search: searchQuery }
      );
      setTraceabilityPage(0);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  return {
    // identity / view state
    selectedProject,
    activeSection,
    setActiveSection,
    searchQuery,
    setSearchQuery,
    timeRange,
    setTimeRange,
    isEditMode,
    setIsEditMode,
    error,
    loadingByTab,
    sectionLoading,
    // data
    dashboardAnalytics,
    analyticsTimeSeries,
    granularInsights,
    shareableReports,
    rootCauseAnalyses,
    dashboardWidgets,
    setDashboardWidgets,
    traceabilityData,
    coverageReports,
    testExecutionStatus,
    activityStats,
    testActivity,
    // filters
    granularFilter,
    setGranularFilter,
    traceabilityFilters,
    setTraceabilityFilters,
    traceabilityPage,
    setTraceabilityPage,
    TRACEABILITY_PAGE_SIZE,
    // loaders / actions
    loadDashboardAnalytics,
    loadGranularInsights,
    loadShareableReports,
    loadRootCauseAnalyses,
    loadTraceabilityData,
    loadCoverageData,
    loadActivityStatistics,
    loadTestActivity,
    handleGenerateCoverageReport,
    handleToggleEditMode,
    handleGenerateAnalytics,
    handleExportReport,
  };
}

export type ReportsData = ReturnType<typeof useReportsData>;
