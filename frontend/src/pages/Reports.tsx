import { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  FileCheck, CheckCircle, XCircle, AlertCircle, Search, Download, 
  TrendingUp, TrendingDown, Clock, Target, BarChart3,
  Activity, Users, Share2, Lock, FileText, GitBranch, Bug,
  Settings, RefreshCw, Eye, Calendar, Zap, Loader2,
  Plus, Minus, Edit, Play, GripVertical, Copy, Trash2, Info, ChevronLeft, ChevronRight
} from 'lucide-react';
import { analyticsAPI, auditAPI } from '@/lib/api';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type TabKey =
  | 'dashboard'
  | 'activity'
  | 'traceability'
  | 'coverage'
  | 'test-activity'
  | 'granular'
  | 'shareable'
  | 'root-cause';

interface DashboardWidgetDef {
  id: string;
  title: string;
  type: string;
  size: string;
  position: { x: number; y: number };
}

// Canonical set of dashboard KPI widgets. Layout (order) is persisted per project
// in localStorage; the widget definitions themselves always come from here so new
// widgets appear automatically even for users with an older saved layout.
// Widget titles are stored as translation keys (resolved via t() at render time)
// so the dashboard works in every locale.
const DEFAULT_WIDGETS: DashboardWidgetDef[] = [
  { id: 'coverage', title: 'reports_widgetTitleCoverage', type: 'kpi', size: 'large', position: { x: 0, y: 0 } },
  { id: 'passRate', title: 'reports_widgetTitlePassRate', type: 'kpi', size: 'medium', position: { x: 1, y: 0 } },
  { id: 'failureTrends', title: 'reports_widgetTitleFailureTrends', type: 'chart', size: 'medium', position: { x: 0, y: 1 } },
  { id: 'flakiness', title: 'reports_widgetTitleFlakiness', type: 'chart', size: 'medium', position: { x: 1, y: 1 } },
  { id: 'cycleTime', title: 'reports_widgetTitleCycleTime', type: 'kpi', size: 'medium', position: { x: 0, y: 2 } },
  { id: 'defectDensity', title: 'reports_widgetTitleDefectDensity', type: 'kpi', size: 'medium', position: { x: 1, y: 2 } },
];

const widgetLayoutKey = (projectId: number) => `reports.dashboardWidgets.v2.${projectId}`;

const loadWidgetLayout = (projectId: number): DashboardWidgetDef[] => {
  try {
    const raw = localStorage.getItem(widgetLayoutKey(projectId));
    if (!raw) return DEFAULT_WIDGETS;
    const savedIds = JSON.parse(raw);
    if (!Array.isArray(savedIds)) return DEFAULT_WIDGETS;
    const byId = new Map(DEFAULT_WIDGETS.map((w) => [w.id, w]));
    const ordered = savedIds
      .map((id: string) => byId.get(id))
      .filter((w): w is DashboardWidgetDef => Boolean(w));
    // Append widgets that were introduced after this layout was saved.
    const missing = DEFAULT_WIDGETS.filter((w) => !savedIds.includes(w.id));
    return ordered.length ? [...ordered, ...missing] : DEFAULT_WIDGETS;
  } catch {
    return DEFAULT_WIDGETS;
  }
};

const saveWidgetLayout = (projectId: number, widgets: { id: string }[]): boolean => {
  try {
    localStorage.setItem(widgetLayoutKey(projectId), JSON.stringify(widgets.map((w) => w.id)));
    return true;
  } catch {
    return false;
  }
};

// Sentinel widget_type used to mark the layout-config row in dashboard_widgets.
const LAYOUT_WIDGET_TYPE = '__layout__';

// Reconcile a saved id list against the current DEFAULT_WIDGETS so the layout
// gracefully handles widgets added or removed in newer builds.
const reconcileLayoutIds = (savedIds: unknown): DashboardWidgetDef[] => {
  if (!Array.isArray(savedIds)) return DEFAULT_WIDGETS;
  const byId = new Map(DEFAULT_WIDGETS.map((w) => [w.id, w]));
  const ordered = savedIds
    .map((id) => byId.get(String(id)))
    .filter((w): w is DashboardWidgetDef => Boolean(w));
  const missing = DEFAULT_WIDGETS.filter((w) => !(savedIds as string[]).includes(w.id));
  return ordered.length ? [...ordered, ...missing] : DEFAULT_WIDGETS;
};

export function Reports() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  // Backend dashboard_widgets row id holding this user's layout for the current
  // project; null until we've loaded (or attempted to load) it.
  const [layoutWidgetId, setLayoutWidgetId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState('7d');
  const [isEditMode, setIsEditMode] = useState(false);
  // Per-tab loading state. Each loader sets its own tab's flag so that switching
  // between tabs while requests are in flight never crosses streams: the active
  // tab's spinner reflects only its own request, and other tabs' loading shows
  // as a small dot in the tab nav.
  const [loadingByTab, setLoadingByTab] = useState<Partial<Record<TabKey, boolean>>>({});
  const setTabLoading = (tab: TabKey, value: boolean) =>
    setLoadingByTab((prev) => ({ ...prev, [tab]: value }));
  // Derived: whether the currently-visible tab is loading. Existing JSX uses this
  // and behaves correctly because only the active tab's spinner ever shows.
  const isLoading = !!loadingByTab[activeTab];
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState(parseInt(projectId || '') || 1);

  // Monotonic counter used to discard responses from superseded requests (tab
  // switches / project changes / refreshes) so stale data never overwrites fresh data.
  const requestSeq = useRef(0);

  // Real data states
  const [dashboardAnalytics, setDashboardAnalytics] = useState<any>(null);
  const [granularInsights, setGranularInsights] = useState<any>(null);
  const [shareableReports, setShareableReports] = useState<any[]>([]);
  const [rootCauseAnalyses, setRootCauseAnalyses] = useState<any[]>([]);
  const [dashboardWidgets, setDashboardWidgets] = useState<DashboardWidgetDef[]>(
    () => loadWidgetLayout(parseInt(projectId || '') || 1)
  );

  // Traceability and Coverage states
  const [traceabilityData, setTraceabilityData] = useState<any>(null);
  const [coverageReports, setCoverageReports] = useState<any[]>([]);
  const [testExecutionStatus, setTestExecutionStatus] = useState<any>(null);

  // Activity statistics state
  const [activityStats, setActivityStats] = useState<any>(null);

  // Test activity state
  const [testActivity, setTestActivity] = useState<any>(null);

  // Shareable report preview modal
  const [previewReport, setPreviewReport] = useState<any>(null);
  // Fetched report content for the preview modal (null = still loading).
  const [previewContent, setPreviewContent] = useState<any>(null);

  // Granular insights filter — surfaced as a dropdown so the server-side
  // filter_type (all/failed/slow) is actually reachable from the UI.
  const [granularFilter, setGranularFilter] = useState<'all' | 'failed' | 'slow'>('all');

  // Traceability matrix filters (server-side) and pagination.
  const [traceabilityFilters, setTraceabilityFilters] = useState<{
    priority: string;
    coverage_status: string;
    test_status: string;
    search: string;
  }>({ priority: 'all', coverage_status: 'all', test_status: 'all', search: '' });
  const [traceabilityPage, setTraceabilityPage] = useState(0);
  const TRACEABILITY_PAGE_SIZE = 25;

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end event
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setDashboardWidgets((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over?.id);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // Update selected project (and its saved widget layout) when the URL parameter changes.
  // The layout loads from localStorage synchronously (no flicker on returning users),
  // then we asynchronously pull the backend-stored layout and replace it if present so
  // the same user sees the same layout across devices.
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

  // Dialog states for Shareable Reports
  const [showCreateReportDialog, setShowCreateReportDialog] = useState(false);
  const [newReport, setNewReport] = useState({
    title: '',
    report_type: 'executive',
    shared_with: '',
    access_level: 'read-only',
    expires_in_days: 30,
  });

  // Dialog state for Root Cause Analysis create/edit
  const [showCreateAnalysisDialog, setShowCreateAnalysisDialog] = useState(false);
  // When non-null, the dialog is in edit mode for that analysis id.
  const [editingAnalysisId, setEditingAnalysisId] = useState<number | null>(null);
  const [newAnalysis, setNewAnalysis] = useState({
    analysis_title: '',
    root_cause: '',
    severity: 'medium',
    status: 'open',
    impact_assessment: '',
    resolution_time_hours: '',
    fix_commit_hash: '',
    defect_id: '',
    requirement_id: '',
    test_case_id: '',
  });

  // API loading functions. Each returns a success flag and uses requestSeq so that
  // a response from a superseded request can never overwrite fresher data or clear
  // a spinner that a newer request still owns.
  const loadDashboardAnalytics = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('dashboard', true);
    setError(null);
    try {
      const data = await analyticsAPI.getDashboardAnalytics(selectedProject, timeRange);
      if (seq !== requestSeq.current) return true;
      setDashboardAnalytics(data);
      return true;
    } catch (err) {
      console.error('Failed to load dashboard analytics:', err);
      if (seq !== requestSeq.current) return false;
      setDashboardAnalytics(null);
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

  // Coverage tab needs the coverage report and the execution status together;
  // loading them in one call keeps the shared loading flag consistent.
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

  const handleGenerateCoverageReport = () => loadCoverageData(true);

  const loadActivityStatistics = async (): Promise<boolean> => {
    if (!selectedProject) return false;
    const seq = ++requestSeq.current;
    setTabLoading('activity', true);
    setError(null);
    try {
      const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
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
      const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
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

  // Loads the data backing the given tab; returns whether it succeeded.
  const loadTabData = (tab: TabKey): Promise<boolean> => {
    switch (tab) {
      case 'dashboard': return loadDashboardAnalytics();
      case 'activity': return loadActivityStatistics();
      case 'traceability': return loadTraceabilityData();
      case 'coverage': return loadCoverageData(false);
      case 'test-activity': return loadTestActivity();
      case 'granular': return loadGranularInsights();
      case 'shareable': return loadShareableReports();
      case 'root-cause': return loadRootCauseAnalyses();
      default: return Promise.resolve(true);
    }
  };

  // Toggle dashboard edit mode; persist the widget layout when leaving edit mode.
  const handleToggleEditMode = async () => {
    if (isEditMode) {
      // Always update localStorage so an offline / anonymous user still keeps
      // their layout. Then try to push to the backend so it follows the user
      // across devices.
      const local = saveWidgetLayout(selectedProject, dashboardWidgets);
      let synced = local;
      if (currentUser) {
        try {
          const ids = dashboardWidgets.map((w) => w.id);
          if (layoutWidgetId) {
            await analyticsAPI.updateDashboardWidget(layoutWidgetId, {
              widget_config: { ids },
            });
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

  // Refresh the data for the active tab and report the outcome honestly.
  const handleGenerateAnalytics = async () => {
    const tab = activeTab;
    const ok = tab === 'coverage' ? await loadCoverageData(true) : await loadTabData(tab);
    toast({
      title: ok ? t('reports_toast_analyticsUpdated') : t('reports_toast_updateFailed'),
      description: ok
        ? t('reports_toast_analyticsUpdatedDesc')
        : t('reports_toast_updateFailedDesc'),
      variant: ok ? 'default' : 'destructive',
    });
  };

  const handleExportReport = () => {
    const exportMap: Record<TabKey, { data: any; filename: string }> = {
      dashboard: { data: dashboardAnalytics, filename: 'dashboard-analytics.json' },
      activity: { data: activityStats, filename: 'activity-statistics.json' },
      traceability: { data: traceabilityData, filename: 'traceability-matrix.json' },
      coverage: { data: coverageReports, filename: 'coverage-reports.json' },
      'test-activity': { data: testActivity, filename: 'test-activity.json' },
      granular: { data: granularInsights, filename: 'granular-insights.json' },
      shareable: { data: shareableReports, filename: 'shareable-reports.json' },
      'root-cause': { data: rootCauseAnalyses, filename: 'root-cause-analyses.json' },
    };
    const entry = exportMap[activeTab];
    const isEmpty =
      !entry ||
      entry.data == null ||
      (Array.isArray(entry.data) && entry.data.length === 0);
    if (isEmpty) {
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

  // Load data when tab, project, time range, or tab-specific filters change.
  useEffect(() => {
    loadTabData(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedProject, timeRange, granularFilter, traceabilityFilters, traceabilityPage]);

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

  const normalizeStatus = (status?: string) => {
    const statusMap: Record<string, string> = {
      pass: 'passed',
      fail: 'failed',
      block: 'blocked',
      skip: 'skipped',
    };
    const normalized = (status || '').toLowerCase();
    return statusMap[normalized] || normalized || 'not_tested';
  };

  const getStatusIcon = (status: string) => {
    switch (normalizeStatus(status)) {
      case 'passed': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-600" />;
      case 'blocked': return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case 'skipped': return <Clock className="h-4 w-4 text-blue-600" />;
      default: return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Activity className="h-4 w-4 text-gray-500" />;
  };

  // Sortable Widget Component
  const SortableWidget = ({ widget }: { widget: any }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: widget.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`${widget.size === 'large' ? 'col-span-2' : ''} ${isEditMode ? 'cursor-move' : ''}`}
      >
        {/* Plain wrapper — renderKPIWidget already returns its own <Card>, so a
            <Card> here would double-nest borders/padding in edit mode. */}
        <div className="h-full relative group">
          {isEditMode && (
            <div
              className="absolute top-2 left-2 z-10 p-1 bg-white dark:bg-gray-800 rounded-md shadow-xs border border-gray-200 dark:border-gray-700"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4 text-gray-500" />
            </div>
          )}
          <div className={`${isEditMode ? 'opacity-75' : ''}`}>
            {renderKPIWidget(widget)}
          </div>
        </div>
      </div>
    );
  };

  // Per-widget metadata: definition (for tooltip), whether a rising value is good,
  // and a drill-down target (an in-page tab or an external route). Definitions are
  // translation keys resolved via t() at the call site.
  const widgetMeta: Record<
    string,
    { def: string; goodOnUp: boolean; drill: { tab?: TabKey; href?: string } }
  > = {
    coverage: {
      def: t('reports_widgetDefCoverage'),
      goodOnUp: true,
      drill: { tab: 'traceability' },
    },
    passRate: {
      def: t('reports_widgetDefPassRate'),
      goodOnUp: true,
      drill: { tab: 'test-activity' },
    },
    failureTrends: {
      def: t('reports_widgetDefFailureTrends'),
      goodOnUp: false,
      drill: { href: `/projects/${selectedProject}/defects` },
    },
    flakiness: {
      def: t('reports_widgetDefFlakiness'),
      goodOnUp: false,
      drill: { tab: 'granular' },
    },
    cycleTime: {
      def: t('reports_widgetDefCycleTime'),
      goodOnUp: false,
      drill: { tab: 'test-activity' },
    },
    defectDensity: {
      def: t('reports_widgetDefDefectDensity'),
      goodOnUp: false,
      drill: { href: `/projects/${selectedProject}/defects` },
    },
  };

  const renderKPIWidget = (widget: any) => {
    const kpiData = dashboardAnalytics?.kpi_data;
    if (!kpiData) {
      // Spinner only while a request is genuinely in flight; otherwise show a
      // real empty/error state instead of spinning forever after a failure.
      return (
        <Card className="h-full">
          <CardContent className="flex items-center justify-center h-32">
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            ) : (
              <div className="text-center text-gray-500">
                <AlertCircle className="h-6 w-6 mx-auto mb-1 text-gray-400" />
                <div className="text-sm">{error || t('reports_noAnalyticsData')}</div>
              </div>
            )}
          </CardContent>
        </Card>
      );
    }

    const dataMap: { [key: string]: string } = {
      coverage: 'coverage',
      passRate: 'passRate',
      failureTrends: 'failureTrends',
      flakiness: 'flakiness',
      cycleTime: 'cycleTime',
      defectDensity: 'defectDensity',
    };

    const dataKey = dataMap[widget.id];
    const data = dataKey ? kpiData[dataKey] : null;
    const m = widgetMeta[widget.id];

    if (!data) {
      return (
        <Card className="h-full">
          <CardContent className="flex items-center justify-center h-32">
            <div className="text-center text-gray-500">
              <div className="text-sm">{t('reports_noData')}</div>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Semantic trend colour — rising failure rate / flakiness / defect density /
    // cycle time is bad, not good, so green-up/red-down would mislead readers.
    const trendColor = (() => {
      if (!m || data.trend === 'stable') return 'text-gray-500';
      const isUp = data.trend === 'up';
      const isGood = m.goodOnUp ? isUp : !isUp;
      return isGood ? 'text-green-600' : 'text-red-600';
    })();

    const valueSuffix = widget.id === 'cycleTime' ? 'h' : widget.id === 'defectDensity' ? '' : '%';

    const handleDrill = () => {
      if (!m || isEditMode) return;
      if (m.drill.tab) {
        setActiveTab(m.drill.tab);
      } else if (m.drill.href) {
        navigate(m.drill.href);
      }
    };

    const interactive = !!m && !isEditMode;

    return (
      <Card
        className={`h-full ${interactive ? 'cursor-pointer transition-colors hover:border-blue-400 dark:hover:border-blue-500' : ''}`}
        onClick={interactive ? handleDrill : undefined}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={(e) => {
          if (interactive && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleDrill();
          }
        }}
        aria-label={interactive ? `${t(widget.title as any)} — open related view` : undefined}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-1">
            <CardTitle className="text-sm font-medium text-gray-600">{t(widget.title as any)}</CardTitle>
            {m && (
              <span title={m.def} aria-label={m.def} className="text-gray-400">
                <Info className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold">
                {data.current}{valueSuffix}
              </div>
              <div className="flex items-center gap-1 text-sm">
                {data.trend === 'up' ? (
                  <TrendingUp className={`h-4 w-4 ${trendColor}`} />
                ) : data.trend === 'down' ? (
                  <TrendingDown className={`h-4 w-4 ${trendColor}`} />
                ) : (
                  <Activity className={`h-4 w-4 ${trendColor}`} />
                )}
                <span className={trendColor}>
                  {Math.abs(data.change)}{valueSuffix}
                </span>
              </div>
            </div>
            <div className="text-3xl opacity-20">
              {widget.id === 'coverage' && <Target />}
              {widget.id === 'passRate' && <CheckCircle />}
              {widget.id === 'failureTrends' && <XCircle />}
              {widget.id === 'flakiness' && <Zap />}
              {widget.id === 'cycleTime' && <Clock />}
              {widget.id === 'defectDensity' && <Bug />}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">{t('reports_timeLast24h')}</SelectItem>
              <SelectItem value="7d">{t('reports_timeLast7d')}</SelectItem>
              <SelectItem value="30d">{t('reports_timeLast30d')}</SelectItem>
              <SelectItem value="90d">{t('reports_timeLast90d')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={isEditMode ? "default" : "outline-solid"}
            onClick={handleToggleEditMode}
          >
            <Settings className="h-4 w-4 mr-2" />
            {isEditMode ? t('reports_saveLayout') : t('reports_customize')}
          </Button>
          <Button variant="outline" onClick={() => loadDashboardAnalytics()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('reports_refresh')}
          </Button>
          {dashboardAnalytics?.generated_at && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('reports_updatedTime', { time: new Date(dashboardAnalytics.generated_at).toLocaleTimeString() })}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportReport}>
            <Download className="h-4 w-4 mr-2" />
            {t('reports_exportDashboard')}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
          <span className="text-gray-600">{t('reports_loadingAnalyticsData')}</span>
        </div>
      )}

      {/* Drag-and-drop dashboard grid */}
      {isEditMode ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={dashboardWidgets.map(w => w.id)} strategy={verticalListSortingStrategy}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {dashboardWidgets.map((widget) => (
                <SortableWidget key={widget.id} widget={widget} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {dashboardWidgets.map((widget) => (
            <div
              key={widget.id}
              className={`${widget.size === 'large' ? 'col-span-2' : ''}`}
            >
              {renderKPIWidget(widget)}
            </div>
          ))}
        </div>
      )}

      {/* Additional analytics sections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {t('reports_recentActivity')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_testRunsToday')}</span>
                <Badge variant="secondary">{dashboardAnalytics?.recent_activity?.test_runs_today ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_testsExecuted')}</span>
                <Badge variant="secondary">{dashboardAnalytics?.recent_activity?.tests_executed ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_defectsFound')}</span>
                <Badge variant="destructive">{dashboardAnalytics?.recent_activity?.defects_found ?? 0}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t('reports_teamPerformance')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_activeTesters')}</span>
                <Badge variant="secondary">{dashboardAnalytics?.team_performance?.active_testers ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_avgExecutionTime')}</span>
                <Badge variant="secondary">{dashboardAnalytics?.team_performance?.avg_execution_time ?? 0}h</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_productivityScore')}</span>
                <Badge className="bg-green-600">{dashboardAnalytics?.team_performance?.productivity_score ?? 0}%</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {t('reports_upcoming')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_scheduledRuns')}</span>
                <Badge variant="secondary">{dashboardAnalytics?.upcoming_items?.scheduled_runs ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_pendingReviews')}</span>
                <Badge variant="outline">{dashboardAnalytics?.upcoming_items?.pending_reviews ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>{t('reports_releaseDeadline')}</span>
                <Badge variant="destructive">{dashboardAnalytics?.upcoming_items?.release_deadline ?? 'N/A'}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderActivityStatistics = () => {
    const getActionIcon = (action: string) => {
      switch (action.toLowerCase()) {
        case 'create': return <Plus className="h-4 w-4 text-green-600" />;
        case 'update': case 'edit': return <Edit className="h-4 w-4 text-blue-600" />;
        case 'delete': return <Minus className="h-4 w-4 text-red-600" />;
        case 'execute': return <Play className="h-4 w-4 text-purple-600" />;
        default: return <Activity className="h-4 w-4 text-gray-600" />;
      }
    };

    const getEntityIcon = (entityType: string) => {
      switch (entityType.toLowerCase()) {
        case 'test_case': return <FileText className="h-4 w-4" />;
        case 'test_suite': return <FileCheck className="h-4 w-4" />;
        case 'test_run': return <Play className="h-4 w-4" />;
        case 'defect': return <Bug className="h-4 w-4" />;
        default: return <Activity className="h-4 w-4" />;
      }
    };

    const activityCounts = activityStats?.activity_counts || [];
    const entityCounts = activityStats?.entity_counts || [];
    const totalActivities = Math.max(activityStats?.total_activities || 0, 1);
    const maxActionCount = Math.max(1, ...activityCounts.map((item: any) => Number(item.count || 0)));
    const maxEntityCount = Math.max(1, ...entityCounts.map((item: any) => Number(item.count || 0)));
    const getActionCount = (...actions: string[]) => activityCounts
      .filter((item: any) => actions.includes(String(item.action || '').toLowerCase()))
      .reduce((sum: number, item: any) => sum + Number(item.count || 0), 0);
    const getShare = (count: number) => Math.round((Number(count || 0) / totalActivities) * 100);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t('reportsTabActivityStats')}</h2>
            <p className="text-sm text-gray-600">{t('reports_activityStatsSubtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">{t('reports_timeLast24h')}</SelectItem>
                <SelectItem value="7d">{t('reports_timeLast7d')}</SelectItem>
                <SelectItem value="30d">{t('reports_timeLast30d')}</SelectItem>
                <SelectItem value="90d">{t('reports_timeLast90d')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={loadActivityStatistics}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('reports_refresh')}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-600">{t('reports_loadingActivityStats')}</span>
          </div>
        )}

        {!isLoading && activityStats && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">{t('reports_totalActivities')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{activityStats.total_activities || 0}</div>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('reports_lastNDays', { days: activityStats.days })}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">{t('reports_createdActivities')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-green-600" />
                    <div className="text-2xl font-bold">
                      {getActionCount('create')}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{t('reports_newRecordsCreated')}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">{t('reports_updatedActivities')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Edit className="h-5 w-5 text-blue-600" />
                    <div className="text-2xl font-bold">
                      {getActionCount('update', 'edit')}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{t('reports_recordsModified')}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">{t('reports_deletedActivities')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Minus className="h-5 w-5 text-red-600" />
                    <div className="text-2xl font-bold">
                      {getActionCount('delete')}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{t('reports_recordsRemoved')}</p>
                </CardContent>
              </Card>
            </div>

            {/* Activity Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('reports_breakdownByAction')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {activityCounts.length === 0 && (
                      <p className="text-sm text-gray-500">{t('reports_noActionsRecorded')}</p>
                    )}
                    {activityCounts.map((activity: any) => {
                      const count = Number(activity.count || 0);
                      const share = getShare(count);
                      return (
                        <div key={activity.action} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {getActionIcon(activity.action)}
                              <span className="text-sm capitalize truncate">{String(activity.action || '').replace('_', ' ')}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-gray-500">{share}%</span>
                              <Badge variant="secondary" className="min-w-12 justify-center">
                                {count}
                              </Badge>
                            </div>
                          </div>
                          <div className="h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700" title={`${count} of ${activityStats.total_activities || 0} activities (${share}%)`}>
                            <div
                              className="h-2.5 rounded-full bg-blue-600"
                              style={{ width: `${Math.max(4, Math.min(100, (count / maxActionCount) * 100))}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('reports_breakdownByEntity')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {entityCounts.length === 0 && (
                      <p className="text-sm text-gray-500">{t('reports_noEntitiesRecorded')}</p>
                    )}
                    {entityCounts.map((entity: any) => {
                      const count = Number(entity.count || 0);
                      const share = getShare(count);
                      return (
                        <div key={entity.entity_type} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {getEntityIcon(entity.entity_type)}
                              <span className="text-sm capitalize truncate">{String(entity.entity_type || '').replace('_', ' ')}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-gray-500">{share}%</span>
                              <Badge variant="secondary" className="min-w-12 justify-center">
                                {count}
                              </Badge>
                            </div>
                          </div>
                          <div className="h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700" title={`${count} of ${activityStats.total_activities || 0} activities (${share}%)`}>
                            <div
                              className="h-2.5 rounded-full bg-green-600"
                              style={{ width: `${Math.max(4, Math.min(100, (count / maxEntityCount) * 100))}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top Contributors */}
            {activityStats.top_users && activityStats.top_users.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('reports_topContributors')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {activityStats.top_users.map((user: any, index: number) => (
                      <div key={user.user_id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-medium">
                            #{index + 1}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{user.full_name || user.username || `User ${user.user_id}`}</p>
                            <p className="text-xs text-gray-500">{user.activity_count} {t('reports_activitiesCountLabel')}</p>
                          </div>
                        </div>
                        <Badge variant="outline">{user.activity_count}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Time Period Info */}
            <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-blue-900 dark:text-blue-100">
                  <Calendar className="h-4 w-4" />
                  <span>
                    {t('reports_showingActivities', {
                      start: activityStats.date_from ? new Date(activityStats.date_from).toLocaleDateString() : 'N/A',
                      end: activityStats.date_to ? new Date(activityStats.date_to).toLocaleDateString() : 'N/A',
                    })}
                  </span>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {!isLoading && !activityStats && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Activity className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-600 text-center">
                {t('reports_noActivityData')}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  const renderTestActivity = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      );
    }

    const activitySource = testActivity?.activity || testActivity?.activity_data || [];
    const activity = Array.isArray(activitySource) ? activitySource : [];
    const summary = testActivity?.summary || {
      total_added: activity.reduce((sum: number, item: any) => sum + Number(item.added || 0), 0),
      total_modified: activity.reduce((sum: number, item: any) => sum + Number(item.modified || 0), 0),
      total_executed: activity.reduce((sum: number, item: any) => sum + Number(item.executed || 0), 0),
      total_deleted: activity.reduce((sum: number, item: any) => sum + Number(item.deleted || 0), 0),
    };
    const maxActivityTotal = Math.max(
      1,
      ...activity.map((day: any) => Number(day.added || 0) + Number(day.modified || 0) + Number(day.executed || 0))
    );

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t('reportsTabTestActivity')}</h2>
            <p className="text-sm text-gray-600">{t('reports_testActivitySubtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">{t('reports_timeLast24h')}</SelectItem>
                <SelectItem value="7d">{t('reports_timeLast7d')}</SelectItem>
                <SelectItem value="30d">{t('reports_timeLast30d')}</SelectItem>
                <SelectItem value="90d">{t('reports_timeLast90d')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={loadTestActivity}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('reports_refresh')}
            </Button>
          </div>
        </div>

        {!testActivity && (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-gray-500">{t('reports_noTestActivity')}</p>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{t('reports_testsAdded')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{summary.total_added}</div>
              <p className="text-xs text-gray-500">{t('reports_newRecordsCreated')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{t('reports_testsModifiedLabel')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{summary.total_modified}</div>
              <p className="text-xs text-gray-500">{t('reports_testCasesUpdated')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{t('reports_testsExecutedLabel')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{summary.total_executed}</div>
              <p className="text-xs text-gray-500">{t('reports_testExecutions')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{t('reports_testsDeleted')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{summary.total_deleted}</div>
              <p className="text-xs text-gray-500">{t('reports_recordsRemoved')}</p>
            </CardContent>
          </Card>
        </div>

        {/* Activity Chart */}
        <Card>
          <CardHeader>
            <CardTitle>{t('reports_testActivityOverTime')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <div className="space-y-2">
                {activity.length === 0 && (
                  <div className="flex h-48 items-center justify-center text-sm text-gray-500">{t('reports_noActivityInPeriod')}</div>
                )}
                {activity.slice(-14).map((day: any) => (
                  <div key={day.date} className="flex items-center gap-2">
                    <div className="w-24 text-xs text-gray-600">{new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    <div className="flex-1 flex gap-1">
                      {day.added > 0 && (
                        <div 
                          className="bg-green-500 h-6 flex items-center justify-center text-xs text-white rounded"
                          style={{ width: `${(Number(day.added || 0) / maxActivityTotal) * 100}%`, minWidth: '20px' }}
                          title={`${day.added} added`}
                        >
                          {day.added}
                        </div>
                      )}
                      {day.modified > 0 && (
                        <div 
                          className="bg-blue-500 h-6 flex items-center justify-center text-xs text-white rounded"
                          style={{ width: `${(Number(day.modified || 0) / maxActivityTotal) * 100}%`, minWidth: '20px' }}
                          title={`${day.modified} modified`}
                        >
                          {day.modified}
                        </div>
                      )}
                      {day.executed > 0 && (
                        <div 
                          className="bg-purple-500 h-6 flex items-center justify-center text-xs text-white rounded"
                          style={{ width: `${(Number(day.executed || 0) / maxActivityTotal) * 100}%`, minWidth: '20px' }}
                          title={`${day.executed} executed`}
                        >
                          {day.executed}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded"></div>
                <span className="text-sm">{t('reports_legendAdded')}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-500 rounded"></div>
                <span className="text-sm">{t('reports_legendModified')}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-purple-500 rounded"></div>
                <span className="text-sm">{t('reports_legendExecuted')}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderGranularInsights = () => {
    const insights: any[] = granularInsights?.insights || [];
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t('reportsTabGranular')}</h2>
            <p className="text-sm text-gray-600">{t('reports_granularSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={granularFilter} onValueChange={(v) => setGranularFilter(v as 'all' | 'failed' | 'slow')}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('reports_filterAllMetrics')}</SelectItem>
                <SelectItem value="failed">{t('reports_filterFailureRelated')}</SelectItem>
                <SelectItem value="slow">{t('reports_filterExecutionSpeed')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => loadGranularInsights()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('reports_refresh')}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-600">{t('reports_loadingGranular')}</span>
          </div>
        )}

        {!isLoading && insights.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BarChart3 className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-600 text-center">
                {error || t('reports_noInsights')}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && insights.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {insights.map((insight, index) => (
              <Card key={`${insight.category}-${insight.metric}-${index}`}>
                <CardHeader className="pb-2">
                  <Badge variant="outline" className="w-fit text-xs">{insight.category}</Badge>
                  <CardTitle className="text-sm font-medium text-gray-600 mt-2">{insight.metric}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">{insight.value}</span>
                    {/* Direction only, in a neutral colour: "up" is good for some
                        metrics (coverage) and bad for others (failure rate), so
                        green/red here would be misleading. */}
                    <span className="flex items-center text-gray-400" title={`Trend: ${insight.trend}`}>
                      {insight.trend === 'up' ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : insight.trend === 'down' ? (
                        <TrendingDown className="h-4 w-4" />
                      ) : (
                        <Activity className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                  {insight.details && (
                    <p className="text-xs text-gray-500 mt-2">{insight.details}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderShareableReports = () => {
    const handleCreateReport = async () => {
      const title = newReport.title.trim();
      if (!selectedProject || !title) return;

      setTabLoading('shareable', true);
      try {
        const sharedWith = newReport.shared_with
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        await analyticsAPI.createShareableReport({
          project_id: selectedProject,
          title,
          report_type: newReport.report_type,
          shared_with: sharedWith,
          access_level: newReport.access_level,
          expires_in_days: newReport.expires_in_days,
        });
        setShowCreateReportDialog(false);
        setNewReport({
          title: '',
          report_type: 'executive',
          shared_with: '',
          access_level: 'read-only',
          expires_in_days: 30,
        });
        await loadShareableReports();
        toast({
          title: t('reports_toast_reportCreated'),
          description: t('reports_toast_reportCreatedDesc', { title }),
        });
      } catch (err) {
        console.error('Failed to create shareable report:', err);
        toast({
          title: t('reports_toast_couldNotCreateReport'),
          description: t('reports_toast_couldNotCreateReportDesc'),
          variant: 'destructive',
        });
      } finally {
        setTabLoading('shareable', false);
      }
    };

    const handleCopyLink = async (report: any) => {
      if (!report.share_token) return;
      const url = `${window.location.origin}/shared-reports/${report.share_token}`;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          // Fallback for older browsers / non-secure contexts
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        toast({
          title: t('reports_toast_linkCopied'),
          description: t('reports_toast_linkCopiedDesc'),
        });
      } catch (err) {
        console.error('Copy link failed:', err);
        toast({
          title: t('reports_toast_couldNotCopyLink'),
          description: url,
          variant: 'destructive',
        });
      }
    };

    // Preview fetches via the download endpoint so the content is always the real
    // analytics snapshot (and legacy stub reports get regenerated server-side).
    const handlePreview = async (report: any) => {
      setPreviewReport(report);
      setPreviewContent(null);
      try {
        const data = await analyticsAPI.downloadShareableReport(report.id);
        setPreviewContent(data?.report_content ?? {});
      } catch (err) {
        console.error('Failed to load report preview:', err);
        setPreviewContent({ error: 'Preview could not be loaded. The report may have expired.' });
      }
    };

    const handleDownload = async (report: any) => {
      try {
        const data = await analyticsAPI.downloadShareableReport(report.id);
        const safeName = String(report.title || `report-${report.id}`).replace(/[^\w.-]+/g, '_');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        toast({
          title: t('reports_toast_downloadReady'),
          description: t('reports_toast_downloadReadyDesc', { filename: `${safeName}.json` }),
        });
      } catch (err) {
        console.error('Failed to download report:', err);
        toast({
          title: t('reports_toast_downloadFailed'),
          description: t('reports_toast_downloadFailedDesc'),
          variant: 'destructive',
        });
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t('reportsTabShareable')}</h2>
            <p className="text-sm text-gray-600">{t('reports_shareableSubtitle')}</p>
          </div>
          <Button onClick={() => setShowCreateReportDialog(true)}>
            <Share2 className="h-4 w-4 mr-2" />
            {t('reports_createNewReport')}
          </Button>
        </div>

        {/* Create Report Dialog */}
        <Dialog open={showCreateReportDialog} onOpenChange={setShowCreateReportDialog}>
          <DialogContent isRTL={isRTL} className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('createNewShareableReport')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('reportTitle')}</Label>
                <Input
                  value={newReport.title}
                  onChange={(e) => setNewReport({ ...newReport, title: e.target.value })}
                  placeholder={t('enterReportTitle')}
                  maxLength={200}
                />
              </div>
              <div>
                <Label>{t('reportType')}</Label>
                <Select value={newReport.report_type} onValueChange={(value) => setNewReport({ ...newReport, report_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="executive">{t('executive')}</SelectItem>
                    <SelectItem value="technical">{t('technical')}</SelectItem>
                    <SelectItem value="summary">{t('summary')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('accessLevel')}</Label>
                <Select value={newReport.access_level} onValueChange={(value) => setNewReport({ ...newReport, access_level: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read-only">{t('readOnly')}</SelectItem>
                    <SelectItem value="edit">{t('edit')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('sharedWith')}</Label>
                <Input
                  value={newReport.shared_with}
                  onChange={(e) => setNewReport({ ...newReport, shared_with: e.target.value })}
                  placeholder={t('sharedWithPlaceholder')}
                />
              </div>
              <div>
                <Label>{t('expiresInDays')}</Label>
                <Input
                  type="number"
                  value={newReport.expires_in_days}
                  onChange={(e) => setNewReport({ ...newReport, expires_in_days: parseInt(String(e.target.value)) || 30 })}
                  min="1"
                  max="365"
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowCreateReportDialog(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={handleCreateReport} disabled={!newReport.title.trim() || isLoading}>
                {isLoading ? t('creating') : t('createReport')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Preview Dialog */}
        <Dialog
          open={!!previewReport}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewReport(null);
              setPreviewContent(null);
            }
          }}
        >
          <DialogContent isRTL={isRTL} className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{previewReport?.title || 'Report preview'}</DialogTitle>
            </DialogHeader>
            {previewReport && (
              <div className="space-y-4 text-sm max-h-[65vh] overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="capitalize">{previewReport.report_type}</Badge>
                  <Badge variant="outline" className="capitalize">{previewReport.access_level}</Badge>
                  <Badge variant="outline">{previewReport.view_count || 0} views</Badge>
                </div>

                {previewContent === null ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  </div>
                ) : previewContent?.error ? (
                  <p className="text-gray-500">{previewContent.error}</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-500">
                      Generated by {previewContent.generated_by || 'N/A'}
                      {previewContent.generated_at
                        ? ` • ${new Date(previewContent.generated_at).toLocaleString()}`
                        : ''}
                    </p>

                    {previewContent.kpis && (
                      <div>
                        <p className="font-medium text-gray-700 mb-2">{t('reports_previewKeyMetrics')}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            ['coverage_percent', 'Coverage', '%'],
                            ['pass_rate_percent', 'Pass Rate', '%'],
                            ['failure_rate_percent', 'Failure Rate', '%'],
                            ['flakiness_percent', 'Flakiness', '%'],
                            ['cycle_time_hours', 'Cycle Time', 'h'],
                            ['defect_density', 'Defect Density', ''],
                          ] as [string, string, string][]).map(([key, label, unit]) => (
                            <div key={key} className="rounded-lg border dark:border-gray-700 px-3 py-2">
                              <div className="text-xs text-gray-500">{label}</div>
                              <div className="text-lg font-semibold">
                                {previewContent.kpis[key] ?? 0}{unit}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {previewContent.summary && (
                      <div>
                        <p className="font-medium text-gray-700 mb-2">{t('reports_previewProjectSummary')}</p>
                        <div className="grid grid-cols-2 gap-x-4">
                          {([
                            ['total_test_cases', 'Test Cases'],
                            ['total_test_suites', 'Test Suites'],
                            ['total_test_runs', 'Test Runs'],
                            ['total_requirements', 'Requirements'],
                            ['total_defects', 'Defects'],
                          ] as [string, string][]).map(([key, label]) => (
                            <div
                              key={key}
                              className="flex justify-between border-b border-gray-100 dark:border-gray-800 py-1"
                            >
                              <span className="text-gray-600">{label}</span>
                              <span className="font-medium">{previewContent.summary[key] ?? 0}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {previewContent.recent_activity && (
                      <div>
                        <p className="font-medium text-gray-700 mb-2">{t('reports_previewRecentActivity')}</p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {([
                            ['test_runs_today', 'Runs today'],
                            ['tests_executed', 'Tests executed'],
                            ['defects_found', 'Defects found'],
                          ] as [string, string][]).map(([key, label]) => (
                            <div key={key} className="rounded-lg border dark:border-gray-700 px-2 py-2">
                              <div className="text-lg font-semibold">
                                {previewContent.recent_activity[key] ?? 0}
                              </div>
                              <div className="text-xs text-gray-500">{label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {previewContent.data_available === false && (
                      <p className="text-xs text-gray-500">
                        {t('reports_previewDataUnavailable')}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setPreviewReport(null);
                  setPreviewContent(null);
                }}
              >
                {t('reports_previewClose')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-600">{t('reports_loadingShareable')}</span>
          </div>
        )}

        {!isLoading && shareableReports.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Share2 className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-600 text-center">
                {error || t('reports_noShareableReports')}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && shareableReports.length > 0 && (
          <div className="grid gap-4">
            {shareableReports.map((report) => (
              <Card key={report.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{report.title}</CardTitle>
                      <p className="text-sm text-gray-600">
                        {t('reports_sharedByUser', { id: report.created_by ?? 'N/A', views: report.view_count || 0 })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={report.report_type === 'executive' ? 'secondary' : 'outline-solid'} className="capitalize">
                        {report.report_type}
                      </Badge>
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <Lock className="h-3 w-3" />
                        {report.access_level}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm text-gray-600">
                      <p>
                        {t('reports_sharedWithLabel')}{' '}
                        {Array.isArray(report.shared_with) && report.shared_with.length
                          ? report.shared_with.join(', ')
                          : t('reports_noOneYet')}
                      </p>
                      <p>{t('reports_expiresLabel')} {report.expires_at ? new Date(report.expires_at).toLocaleDateString() : t('reports_never')}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handlePreview(report)}>
                        <Eye className="h-4 w-4 mr-2" />
                        {t('reports_preview')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyLink(report)}
                        disabled={!report.share_token}
                        title={report.share_token ? t('reports_copyLink') : ''}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        {t('reports_copyLink')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDownload(report)}>
                        <Download className="h-4 w-4 mr-2" />
                        {t('reports_download')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderRootCauseAnalysis = () => {
    const severityVariant = (severity: string) =>
      severity === 'high' || severity === 'critical' ? 'destructive' : 'secondary';

    const resetAnalysisForm = () => {
      setNewAnalysis({
        analysis_title: '',
        root_cause: '',
        severity: 'medium',
        status: 'open',
        impact_assessment: '',
        resolution_time_hours: '',
        fix_commit_hash: '',
        defect_id: '',
        requirement_id: '',
        test_case_id: '',
      });
      setEditingAnalysisId(null);
    };

    const openCreateDialog = () => {
      resetAnalysisForm();
      setShowCreateAnalysisDialog(true);
    };

    const openEditDialog = (analysis: any) => {
      setNewAnalysis({
        analysis_title: analysis.analysis_title || '',
        root_cause: analysis.root_cause || '',
        severity: analysis.severity || 'medium',
        status: analysis.status || 'open',
        impact_assessment: analysis.impact_assessment || '',
        resolution_time_hours:
          analysis.resolution_time_hours != null ? String(analysis.resolution_time_hours) : '',
        fix_commit_hash: analysis.fix_commit_hash || '',
        defect_id: analysis.defect_id != null ? String(analysis.defect_id) : '',
        requirement_id: analysis.requirement_id != null ? String(analysis.requirement_id) : '',
        test_case_id: analysis.test_case_id != null ? String(analysis.test_case_id) : '',
      });
      setEditingAnalysisId(analysis.id);
      setShowCreateAnalysisDialog(true);
    };

    const handleSaveAnalysis = async () => {
      const title = newAnalysis.analysis_title.trim();
      const rootCause = newAnalysis.root_cause.trim();
      if (!selectedProject || !title || !rootCause) return;
      const payload = {
        project_id: selectedProject,
        analysis_title: title,
        root_cause: rootCause,
        severity: newAnalysis.severity,
        status: newAnalysis.status,
        impact_assessment: newAnalysis.impact_assessment.trim() || null,
        resolution_time_hours: newAnalysis.resolution_time_hours
          ? Number(newAnalysis.resolution_time_hours)
          : null,
        fix_commit_hash: newAnalysis.fix_commit_hash.trim() || null,
        defect_id: newAnalysis.defect_id ? Number(newAnalysis.defect_id) : null,
        requirement_id: newAnalysis.requirement_id ? Number(newAnalysis.requirement_id) : null,
        test_case_id: newAnalysis.test_case_id ? Number(newAnalysis.test_case_id) : null,
      };
      const isEdit = editingAnalysisId != null;
      setTabLoading('root-cause', true);
      try {
        if (isEdit) {
          await analyticsAPI.updateRootCauseAnalysis(editingAnalysisId!, payload);
        } else {
          await analyticsAPI.createRootCauseAnalysis(payload);
        }
        setShowCreateAnalysisDialog(false);
        resetAnalysisForm();
        await loadRootCauseAnalyses();
        toast({
          title: isEdit ? t('reports_toast_analysisUpdated') : t('reports_toast_analysisAdded'),
          description: isEdit
            ? t('reports_toast_analysisUpdatedDesc', { title })
            : t('reports_toast_analysisAddedDesc', { title }),
        });
      } catch (err) {
        console.error('Failed to save root cause analysis:', err);
        toast({
          title: isEdit ? t('reports_toast_couldNotUpdateAnalysis') : t('reports_toast_couldNotAddAnalysis'),
          description: t('reports_toast_analysisSaveFailed'),
          variant: 'destructive',
        });
      } finally {
        setTabLoading('root-cause', false);
      }
    };

    const handleDeleteAnalysis = async (analysis: any) => {
      if (!window.confirm(t('reports_rcaDeleteConfirm', { title: analysis.analysis_title }))) {
        return;
      }
      try {
        await analyticsAPI.deleteRootCauseAnalysis(analysis.id);
        await loadRootCauseAnalyses();
        toast({
          title: t('reports_toast_analysisDeleted'),
          description: t('reports_toast_analysisDeletedDesc', { title: analysis.analysis_title }),
        });
      } catch (err) {
        console.error('Failed to delete root cause analysis:', err);
        toast({
          title: t('reports_toast_couldNotDeleteAnalysis'),
          description: t('reports_toast_analysisDeleteFailed'),
          variant: 'destructive',
        });
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t('reportsTabRootCause')}</h2>
            <p className="text-sm text-gray-600">{t('reports_rcaSubtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              {t('addRootCauseAnalysis')}
            </Button>
            <Button variant="outline" onClick={() => loadRootCauseAnalyses()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('reports_refresh')}
            </Button>
          </div>
        </div>

        {/* Create / Edit Root Cause Analysis Dialog */}
        <Dialog
          open={showCreateAnalysisDialog}
          onOpenChange={(open) => {
            setShowCreateAnalysisDialog(open);
            if (!open) resetAnalysisForm();
          }}
        >
          <DialogContent isRTL={isRTL} className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('addRootCauseAnalysis')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div>
                <Label>{t('analysisTitle')}</Label>
                <Input
                  value={newAnalysis.analysis_title}
                  onChange={(e) => setNewAnalysis({ ...newAnalysis, analysis_title: e.target.value })}
                  placeholder={t('enterAnalysisTitle')}
                  maxLength={200}
                />
              </div>
              <div>
                <Label>{t('rootCause')}</Label>
                <Textarea
                  value={newAnalysis.root_cause}
                  onChange={(e) => setNewAnalysis({ ...newAnalysis, root_cause: e.target.value })}
                  placeholder={t('describeRootCause')}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('severity')}</Label>
                  <Select value={newAnalysis.severity} onValueChange={(value) => setNewAnalysis({ ...newAnalysis, severity: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t('low')}</SelectItem>
                      <SelectItem value="medium">{t('medium')}</SelectItem>
                      <SelectItem value="high">{t('high')}</SelectItem>
                      <SelectItem value="critical">{t('critical')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t('status')}</Label>
                  <Select value={newAnalysis.status} onValueChange={(value) => setNewAnalysis({ ...newAnalysis, status: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">{t('open')}</SelectItem>
                      <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
                      <SelectItem value="resolved">{t('resolved')}</SelectItem>
                      <SelectItem value="closed">{t('closed')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>{t('impactAssessment')}</Label>
                <Textarea
                  value={newAnalysis.impact_assessment}
                  onChange={(e) => setNewAnalysis({ ...newAnalysis, impact_assessment: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('resolutionTimeHours')}</Label>
                  <Input
                    type="number"
                    min="0"
                    value={newAnalysis.resolution_time_hours}
                    onChange={(e) => setNewAnalysis({ ...newAnalysis, resolution_time_hours: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t('linkedDefectId')}</Label>
                  <Input
                    type="number"
                    min="1"
                    value={newAnalysis.defect_id}
                    onChange={(e) => setNewAnalysis({ ...newAnalysis, defect_id: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('reports_rcaRequirementIdLabel')}</Label>
                  <Input
                    type="number"
                    min="1"
                    value={newAnalysis.requirement_id}
                    onChange={(e) => setNewAnalysis({ ...newAnalysis, requirement_id: e.target.value })}
                    placeholder={t('reports_rcaOptionalPlaceholder')}
                  />
                </div>
                <div>
                  <Label>{t('reports_rcaTestCaseIdLabel')}</Label>
                  <Input
                    type="number"
                    min="1"
                    value={newAnalysis.test_case_id}
                    onChange={(e) => setNewAnalysis({ ...newAnalysis, test_case_id: e.target.value })}
                    placeholder={t('reports_rcaOptionalPlaceholder')}
                  />
                </div>
              </div>
              <div>
                <Label>{t('fixCommitHash')}</Label>
                <Input
                  value={newAnalysis.fix_commit_hash}
                  onChange={(e) => setNewAnalysis({ ...newAnalysis, fix_commit_hash: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateAnalysisDialog(false);
                  resetAnalysisForm();
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleSaveAnalysis}
                disabled={!newAnalysis.analysis_title.trim() || !newAnalysis.root_cause.trim() || isLoading}
              >
                {isLoading ? t('creating') : editingAnalysisId != null ? t('save') : t('add')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-600">{t('reports_loadingRCA')}</span>
          </div>
        )}

        {!isLoading && rootCauseAnalyses.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <GitBranch className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-600 text-center">
                {error || t('reports_noRCA')}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && rootCauseAnalyses.length > 0 && (
          <div className="space-y-4">
            {rootCauseAnalyses.map((analysis) => (
              <Card key={analysis.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <FileCheck className="h-5 w-5 text-blue-600" />
                      <CardTitle className="text-base">
                        {analysis.analysis_title || `Analysis #${analysis.id}`}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={severityVariant(analysis.severity)} className="capitalize">
                        {analysis.severity || 'unknown'}
                      </Badge>
                      <Badge variant={analysis.status === 'open' ? 'destructive' : 'secondary'} className="capitalize">
                        {String(analysis.status || 'open').replace('_', ' ')}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(analysis)}
                        aria-label={t('reports_rcaEditAria')}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteAnalysis(analysis)}
                        aria-label={t('reports_rcaDeleteAria')}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="md:col-span-2">
                      <p className="font-medium text-gray-700">{t('reports_rcaRootCauseLabel')}</p>
                      <p className="text-gray-600">{analysis.root_cause || t('reports_rcaNotDocumented')}</p>
                    </div>
                    {analysis.impact_assessment && (
                      <div className="md:col-span-2">
                        <p className="font-medium text-gray-700">{t('reports_rcaImpactLabel')}</p>
                        <p className="text-gray-600">{analysis.impact_assessment}</p>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-700">{t('reports_rcaResolutionTimeLabel')}</p>
                      <p className="text-gray-600">
                        {analysis.resolution_time_hours != null ? `${analysis.resolution_time_hours}h` : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-700">{t('reports_rcaLinkedDefect')}</p>
                      <p className="text-gray-600">
                        {analysis.defect_id ? (
                          <Link
                            to={`/projects/${selectedProject}/defects`}
                            className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                          >
                            #{analysis.defect_id}
                          </Link>
                        ) : (
                          'N/A'
                        )}
                      </p>
                    </div>
                    {analysis.requirement_id && (
                      <div>
                        <p className="font-medium text-gray-700">{t('reports_rcaLinkedRequirement')}</p>
                        <p className="text-gray-600">
                          <Link
                            to={`/projects/${selectedProject}/requirements/${analysis.requirement_id}`}
                            className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                          >
                            REQ #{analysis.requirement_id}
                          </Link>
                        </p>
                      </div>
                    )}
                    {analysis.test_case_id && (
                      <div>
                        <p className="font-medium text-gray-700">{t('reports_rcaLinkedTestCase')}</p>
                        <p className="text-gray-600">
                          <Link
                            to={`/projects/${selectedProject}/test-cases/${analysis.test_case_id}`}
                            className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                          >
                            TC-{analysis.test_case_id}
                          </Link>
                        </p>
                      </div>
                    )}
                    {analysis.fix_commit_hash && (
                      <div>
                        <p className="font-medium text-gray-700">{t('reports_rcaFixCommit')}</p>
                        <p className="font-mono text-xs text-green-600">{analysis.fix_commit_hash}</p>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-700">{t('reports_rcaRecorded')}</p>
                      <p className="text-gray-600">
                        {analysis.created_at ? new Date(analysis.created_at).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('reportsPageTitle')}</h1>
          <p className="text-gray-600">{t('reportsPageSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportReport}>
            <Download className="h-4 w-4 mr-2" />
            {t('reportsExportReport')}
          </Button>
          <Button onClick={handleGenerateAnalytics}>
            <BarChart3 className="h-4 w-4 mr-2" />
            {t('reportsGenerateAnalytics')}
          </Button>
        </div>
      </div>

      {/* Tab navigation, grouped by area */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {([
          { group: t('reportsGroupOverview'), tabs: [{ key: 'dashboard', label: t('reportsTabDashboard') }] },
          { group: t('reportsGroupCoverage'), tabs: [
            { key: 'traceability', label: t('reportsTabTraceability') },
            { key: 'coverage', label: t('reportsTabCoverage') },
          ] },
          { group: t('reportsGroupActivity'), tabs: [
            { key: 'activity', label: t('reportsTabActivityStats') },
            { key: 'test-activity', label: t('reportsTabTestActivity') },
          ] },
          { group: t('reportsGroupAnalysis'), tabs: [
            { key: 'granular', label: t('reportsTabGranular') },
            { key: 'root-cause', label: t('reportsTabRootCause') },
          ] },
          { group: t('reportsGroupReports'), tabs: [{ key: 'shareable', label: t('reportsTabShareable') }] },
        ] as { group: string; tabs: { key: TabKey; label: string }[] }[]).map((cluster) => (
          <div key={cluster.group} className="flex flex-col gap-1">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {cluster.group}
            </span>
            <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
              {cluster.tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                    activeTab === tab.key
                      ? 'bg-white dark:bg-gray-700 shadow-xs text-blue-600 dark:text-blue-400'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  {/* Per-tab activity dot: tells the user another tab is fetching
                      without crowding the active tab's content. */}
                  {loadingByTab[tab.key] && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"
                      aria-label="loading"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Surface load failures instead of leaving the page silently empty */}
      {error && !isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'activity' && renderActivityStatistics()}
      {activeTab === 'test-activity' && renderTestActivity()}
      {activeTab === 'granular' && renderGranularInsights()}
      {activeTab === 'shareable' && renderShareableReports()}
      {activeTab === 'root-cause' && renderRootCauseAnalysis()}

      {/* Traceability and coverage are rendered inline below */}
      {activeTab === 'traceability' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_totalRequirements')}</p>
                    <p className="text-2xl font-bold mt-1">{traceabilityData?.total_requirements || 0}</p>
                  </div>
                  <FileCheck className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_coveredLabel')}</p>
                    <p className="text-2xl font-bold mt-1 text-green-600">{traceabilityData?.covered_requirements || 0}</p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_uncoveredLabel')}</p>
                    <p className="text-2xl font-bold mt-1 text-red-600">{traceabilityData?.uncovered_requirements || 0}</p>
                  </div>
                  <AlertCircle className="h-8 w-8 text-red-600" />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_coveragePercentLabel')}</p>
                    <p className="text-2xl font-bold mt-1">
                      {traceabilityData?.total_requirements 
                        ? Math.round((traceabilityData.covered_requirements / traceabilityData.total_requirements) * 100)
                        : 0}%
                    </p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_blockedTests')}</p>
                    <p className="text-2xl font-bold mt-1 text-yellow-600">
                      {traceabilityData?.requirements?.reduce((total: number, req: any) => 
                        total + req.test_cases.filter((tc: any) => tc.status === 'blocked' || tc.status === 'block').length, 0) || 0}
                    </p>
                  </div>
                  <AlertCircle className="h-8 w-8 text-yellow-600" />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_notTestedLabel')}</p>
                    <p className="text-2xl font-bold mt-1 text-gray-600">
                      {traceabilityData?.requirements?.reduce((total: number, req: any) => 
                        total + req.test_cases.filter((tc: any) => tc.status === 'not_tested').length, 0) || 0}
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-gray-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter Bar — search and dropdowns are server-side; pagination resets on change */}
          <div className="bg-white dark:bg-gray-900 p-4 rounded-lg shadow-xs border dark:border-gray-700">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-4 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t('searchRequirementsOrTestCases')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="md:col-span-3">
                <Select
                  value={traceabilityFilters.priority}
                  onValueChange={(v) => {
                    setTraceabilityFilters((prev) => ({ ...prev, priority: v }));
                    setTraceabilityPage(0);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('reports_filterPriorityAll')}</SelectItem>
                    <SelectItem value="critical">{t('reports_filterPriorityCritical')}</SelectItem>
                    <SelectItem value="high">{t('reports_filterPriorityHigh')}</SelectItem>
                    <SelectItem value="medium">{t('reports_filterPriorityMedium')}</SelectItem>
                    <SelectItem value="low">{t('reports_filterPriorityLow')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Select
                  value={traceabilityFilters.coverage_status}
                  onValueChange={(v) => {
                    setTraceabilityFilters((prev) => ({ ...prev, coverage_status: v }));
                    setTraceabilityPage(0);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('reports_filterCoverageAll')}</SelectItem>
                    <SelectItem value="covered">{t('reports_coveredLabel')}</SelectItem>
                    <SelectItem value="uncovered">{t('reports_uncoveredLabel')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3">
                <Select
                  value={traceabilityFilters.test_status}
                  onValueChange={(v) => {
                    setTraceabilityFilters((prev) => ({ ...prev, test_status: v }));
                    setTraceabilityPage(0);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('reports_filterStatusAll')}</SelectItem>
                    <SelectItem value="passed">{t('reports_statusPassed')}</SelectItem>
                    <SelectItem value="failed">{t('reports_statusFailed')}</SelectItem>
                    <SelectItem value="blocked">{t('reports_statusBlocked')}</SelectItem>
                    <SelectItem value="skipped">{t('reports_statusSkipped')}</SelectItem>
                    <SelectItem value="not_tested">{t('reports_statusNotTested')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(traceabilityFilters.priority !== 'all' ||
              traceabilityFilters.coverage_status !== 'all' ||
              traceabilityFilters.test_status !== 'all' ||
              searchQuery) && (
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>
                  {t('reports_showingMatched', {
                    matched: traceabilityData?.matched_requirements ?? 0,
                    total: traceabilityData?.total_requirements ?? 0,
                  })}
                </span>
                <button
                  className="text-blue-600 hover:underline"
                  onClick={() => {
                    setSearchQuery('');
                    setTraceabilityFilters({ priority: 'all', coverage_status: 'all', test_status: 'all', search: '' });
                    setTraceabilityPage(0);
                  }}
                >
                  {t('reports_clearFilters')}
                </button>
              </div>
            )}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
              <span className="text-gray-600 dark:text-gray-400">{t('reports_loadingTraceability')}</span>
            </div>
          )}

          {/* Traceability Matrix Table — server already filtered/paginated */}
          {!isLoading && traceabilityData && (
            <div className="space-y-4">
              {(traceabilityData?.requirements || [])
                .map((item: any) => (
                <Card key={item.requirement_id} className="overflow-hidden">
                  <CardHeader className="bg-linear-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-800/50 py-4">
                    {/* Header stacks vertically on mobile so the per-status counts
                        don't crowd the title. */}
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <FileCheck className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-bold text-blue-600">{item.requirement_key || `REQ-${item.requirement_id}`}</span>
                            <Badge variant={item.requirement_status === 'approved' ? 'default' : 'outline-solid'} className="capitalize">
                              {item.requirement_status}
                            </Badge>
                            {item.requirement_priority && (
                              <Badge variant="secondary" className="capitalize">
                                {t('reports_xPriority', { name: item.requirement_priority })}
                              </Badge>
                            )}
                          </div>
                          <CardTitle className="text-base font-semibold wrap-break-word">
                            <Link
                              to={`/projects/${selectedProject}/requirements/${item.requirement_id}`}
                              className="text-gray-900 underline-offset-4 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
                            >
                              {item.requirement_title}
                            </Link>
                          </CardTitle>
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-3 text-sm md:flex md:items-center md:gap-4">
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatTestCases')}</div>
                          <div className="font-bold">{item.total_test_cases || 0}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatPassed')}</div>
                          <div className="font-bold text-green-600">{item.passed_count || 0}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatFailed')}</div>
                          <div className="font-bold text-red-600">{item.failed_count || 0}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatBlocked')}</div>
                          <div className="font-bold text-yellow-600">{(item.test_cases || []).filter((tc: any) => normalizeStatus(tc.status) === 'blocked').length}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('reports_reqStatNotTested')}</div>
                          <div className="font-bold text-gray-600">{(item.test_cases || []).filter((tc: any) => normalizeStatus(tc.status) === 'not_tested').length}</div>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {(item.test_cases || []).length > 0 ? (
                      <>
                        {/* Desktop table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium">
                              <tr>
                                <th className="px-6 py-3 text-left">{t('reports_colTestCase')}</th>
                                <th className="px-6 py-3 text-left">{t('reports_colTitle')}</th>
                                <th className="px-6 py-3 text-center">{t('reports_colCoverageType')}</th>
                                <th className="px-6 py-3 text-center">{t('reports_colStatus')}</th>
                                <th className="px-6 py-3 text-right">{t('reports_colLastExecuted')}</th>
                                <th className="px-6 py-3 text-center">{t('reports_colActions')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y dark:divide-gray-700">
                              {(item.test_cases || []).map((tc: any) => {
                                const executionPath = tc.test_run_id
                                  ? `/projects/${selectedProject}/test-runs/${tc.test_run_id}/test-cases/${tc.id}`
                                  : `/projects/${selectedProject}/test-cases/${tc.id}/execute`;
                                const normalizedStatus = normalizeStatus(tc.status);

                                return (
                                  <tr key={tc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                    <td className="px-6 py-4">
                                      <Link
                                        to={`/projects/${selectedProject}/test-cases/${tc.id}`}
                                        className="font-mono text-sm text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                                      >
                                        TC-{tc.id}
                                      </Link>
                                    </td>
                                    <td className="px-6 py-4 font-medium">
                                      <Link
                                        to={`/projects/${selectedProject}/test-cases/${tc.id}`}
                                        className="text-gray-900 underline-offset-4 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
                                      >
                                        {tc.title}
                                      </Link>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                      <Badge variant="outline" className="capitalize text-xs">
                                        {tc.coverage_type || 'functional'}
                                      </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                      <Link
                                        to={executionPath}
                                        className="flex items-center justify-center gap-2 rounded-md px-2 py-1 underline-offset-4 hover:bg-blue-50 hover:text-blue-700 hover:underline dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                                      >
                                        {getStatusIcon(tc.status)}
                                        <span className="capitalize text-sm">{normalizedStatus.replace('_', ' ')}</span>
                                      </Link>
                                    </td>
                                    <td className="px-6 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                                      {tc.last_executed ? new Date(tc.last_executed).toLocaleDateString() : t('reports_never')}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => window.open(executionPath, '_blank')}
                                        className="text-xs"
                                      >
                                        <Play className="h-3 w-3 mr-1" />
                                        {tc.test_run_id ? t('reports_openExecution') : t('reports_execute')}
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {/* Mobile cards — the same rows, restacked so nothing overflows a phone viewport */}
                        <div className="md:hidden divide-y dark:divide-gray-700">
                          {(item.test_cases || []).map((tc: any) => {
                            const executionPath = tc.test_run_id
                              ? `/projects/${selectedProject}/test-runs/${tc.test_run_id}/test-cases/${tc.id}`
                              : `/projects/${selectedProject}/test-cases/${tc.id}/execute`;
                            const normalizedStatus = normalizeStatus(tc.status);
                            return (
                              <div key={tc.id} className="p-4 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <Link
                                      to={`/projects/${selectedProject}/test-cases/${tc.id}`}
                                      className="font-mono text-xs text-blue-600 dark:text-blue-400"
                                    >
                                      TC-{tc.id}
                                    </Link>
                                    <div className="font-medium wrap-break-word">
                                      <Link
                                        to={`/projects/${selectedProject}/test-cases/${tc.id}`}
                                        className="text-gray-900 dark:text-white"
                                      >
                                        {tc.title}
                                      </Link>
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="capitalize text-xs shrink-0">
                                    {tc.coverage_type || 'functional'}
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <Link
                                    to={executionPath}
                                    className="flex items-center gap-1.5 rounded-md px-2 py-1 -ml-2 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                  >
                                    {getStatusIcon(tc.status)}
                                    <span className="capitalize">{normalizedStatus.replace('_', ' ')}</span>
                                  </Link>
                                  <span className="text-xs text-gray-500">
                                    {tc.last_executed ? new Date(tc.last_executed).toLocaleDateString() : t('reports_never')}
                                  </span>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open(executionPath, '_blank')}
                                  className="text-xs w-full"
                                >
                                  <Play className="h-3 w-3 mr-1" />
                                  {tc.test_run_id ? t('reports_openExecution') : t('reports_execute')}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                        <AlertCircle className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                        <p className="font-medium">{t('reports_noTCsLinked')}</p>
                        <p className="text-sm mt-1">{t('reports_linkTCsToTrack')}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              
              {traceabilityData?.requirements?.length === 0 && (
                <Card>
                  <CardContent className="p-12 text-center">
                    <FileCheck className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                    <h3 className="text-lg font-semibold mb-2">{t('reports_noRequirementsFound')}</h3>
                    <p className="text-gray-600 dark:text-gray-400">
                      {searchQuery ||
                      traceabilityFilters.priority !== 'all' ||
                      traceabilityFilters.coverage_status !== 'all' ||
                      traceabilityFilters.test_status !== 'all'
                        ? t('reports_noReqsFilteredMsg')
                        : t('reports_noReqsMsg')}
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <Link
                        to={`/projects/${selectedProject}/requirements`}
                        className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        {t('reports_manageRequirements')}
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Pagination controls — only when there's more than one page */}
              {traceabilityData &&
                (traceabilityData.matched_requirements ?? 0) > TRACEABILITY_PAGE_SIZE && (
                  <div className="flex items-center justify-between rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      {t('reports_paginationShowing')}{' '}
                      <strong>
                        {traceabilityPage * TRACEABILITY_PAGE_SIZE + 1}–
                        {Math.min(
                          (traceabilityPage + 1) * TRACEABILITY_PAGE_SIZE,
                          traceabilityData.matched_requirements,
                        )}
                      </strong>{' '}
                      {t('reports_paginationOf')} <strong>{traceabilityData.matched_requirements}</strong>
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={traceabilityPage === 0}
                        onClick={() => setTraceabilityPage((p) => Math.max(0, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        {t('reports_paginationPrevious')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          (traceabilityPage + 1) * TRACEABILITY_PAGE_SIZE >=
                          (traceabilityData.matched_requirements ?? 0)
                        }
                        onClick={() => setTraceabilityPage((p) => p + 1)}
                      >
                        {t('reports_paginationNext')}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      )}
      
      {activeTab === 'coverage' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{t('reportsTabCoverage')}</h2>
              {coverageReports.length > 0 && (
                <p className="text-sm text-gray-600 mt-1">
                  {t('reports_coverageLastUpdated', { time: new Date(coverageReports[coverageReports.length - 1]?.generated_at).toLocaleString() })}
                </p>
              )}
            </div>
            <Button onClick={handleGenerateCoverageReport} disabled={isLoading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('reports_generateReport')}
            </Button>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
              <span className="text-gray-600">{t('reports_loadingCoverage')}</span>
            </div>
          )}

          {coverageReports.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('reports_overallReqCoverage')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-center justify-center py-6">
                    <div className="relative w-48 h-48">
                      <svg className="w-full h-full" viewBox="0 0 36 36">
                        <path
                          className="text-gray-200 dark:text-gray-700 stroke-current"
                          strokeWidth="3"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="text-blue-600 stroke-current"
                          strokeWidth="3"
                          strokeDasharray={`${coverageReports[coverageReports.length - 1]?.coverage_percentage || 0}, 100`}
                          strokeLinecap="round"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-4xl font-bold">{coverageReports[coverageReports.length - 1]?.coverage_percentage || 0}%</span>
                        <span className="text-xs text-gray-500">{t('reports_totalCoverage')}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-8 mt-8 w-full">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">{coverageReports[coverageReports.length - 1]?.covered_requirements || 0}</p>
                        <p className="text-xs text-gray-500 uppercase font-medium">{t('reports_coveredLabel')}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-red-600">{(coverageReports[coverageReports.length - 1]?.total_requirements || 0) - (coverageReports[coverageReports.length - 1]?.covered_requirements || 0)}</p>
                        <p className="text-xs text-gray-500 uppercase font-medium">{t('reports_uncoveredLabel')}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('reports_testExecutionStatus')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {testExecutionStatus ? (
                    <div className="space-y-4 py-4">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                          <p className="text-2xl font-bold text-blue-600">{testExecutionStatus.summary.executed_test_cases}</p>
                          <p className="text-xs text-gray-600">{t('reports_executedTests')}</p>
                        </div>
                        <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <p className="text-2xl font-bold text-gray-600">{testExecutionStatus.summary.not_tested_test_cases}</p>
                          <p className="text-xs text-gray-600">{t('reports_notTestedLabel')}</p>
                        </div>
                      </div>

                      <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg mb-4">
                        <p className="text-lg font-bold text-green-600">
                          {testExecutionStatus?.execution_rate !== undefined ? Math.round(testExecutionStatus.execution_rate) + '%' : '...'}
                        </p>
                        <p className="text-xs text-gray-600">
                          {t('reports_testsExecutedOf', {
                            executed: testExecutionStatus?.summary?.executed_test_cases || 0,
                            total: testExecutionStatus?.summary?.total_test_cases || 0,
                          })}
                        </p>
                      </div>

                      {testExecutionStatus?.summary?.executed_test_cases > 0 && (
                        <div className="space-y-4">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center mb-2">
                            {t('reports_statusOfExecuted', { n: testExecutionStatus.summary.executed_test_cases })}
                          </p>
                          {Object.entries(testExecutionStatus.status_percentages || {}).map(([status, value]) => (
                            <div key={status} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="capitalize">{status.replace('_', ' ')}</span>
                                <span className="font-bold">{Math.round(Number(value))}% ({Math.round((Number(value) / 100) * testExecutionStatus.summary.executed_test_cases)} tests)</span>
                              </div>
                              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${
                                    status === 'passed' ? 'bg-green-500' :
                                    status === 'failed' ? 'bg-red-500' :
                                    status === 'blocked' ? 'bg-yellow-500' : 
                                    status === 'skipped' ? 'bg-blue-500' : 'bg-gray-400'
                                  }`}
                                  style={{ width: `${value}%` }}
                                ></div>
                              </div>
                            </div>
                          ))}

                          <div className="mt-6 pt-4 border-t dark:border-gray-700">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center mb-2">
                              {t('reports_overallTestStatus', { n: testExecutionStatus.summary.total_test_cases })}
                            </p>
                            {Object.entries(testExecutionStatus.overall_percentages || {}).map(([status, value]) => (
                              <div key={status} className="space-y-1">
                                <div className="flex justify-between text-sm">
                                  <span className="capitalize">{status.replace('_', ' ')}</span>
                                  <span className="font-bold">{Math.round(Number(value))}% ({Math.round((Number(value) / 100) * testExecutionStatus.summary.total_test_cases)} tests)</span>
                                </div>
                                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full ${
                                      status === 'passed' ? 'bg-green-500' :
                                      status === 'failed' ? 'bg-red-500' :
                                      status === 'blocked' ? 'bg-yellow-500' : 
                                      status === 'skipped' ? 'bg-blue-500' : 
                                      status === 'not_tested' ? 'bg-gray-400' : 'bg-gray-400'
                                    }`}
                                    style={{ width: `${value}%` }}
                                  ></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="mt-4 pt-4 border-t dark:border-gray-700 text-xs text-gray-500 text-center">
                        {t('reports_totalTestCases', { n: testExecutionStatus?.summary?.total_test_cases || 0 })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      {isLoading ? (
                        <>
                          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                          <p>{t('reports_loadingTestExecution')}</p>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                          <p>{error || t('reports_noTestExecutionData')}</p>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">{t('reports_priorityWiseCoverage')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {Object.entries(coverageReports[coverageReports.length - 1]?.report_data?.by_priority || {}).map(([priority, value]) => {
                      const detail = (value && typeof value === 'object'
                        ? value
                        : { coverage: Number(value) || 0, covered: 0, total: 0 }) as { coverage: number; covered: number; total: number };
                      // Drill-down: jump to the traceability tab with this priority preselected.
                      const drillDown = () => {
                        if (detail.total === 0) return;
                        setTraceabilityFilters({
                          priority,
                          coverage_status: 'all',
                          test_status: 'all',
                          search: '',
                        });
                        setTraceabilityPage(0);
                        setSearchQuery('');
                        setActiveTab('traceability');
                      };
                      const clickable = detail.total > 0;
                      return (
                        <div
                          key={priority}
                          className={`p-4 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 ${
                            clickable ? 'cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors' : ''
                          }`}
                          onClick={clickable ? drillDown : undefined}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          onKeyDown={(e) => {
                            if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault();
                              drillDown();
                            }
                          }}
                          aria-label={clickable ? t('reports_priorityOpenInTraceability', { priority }) : undefined}
                        >
                          <div className="flex justify-between items-center mb-2">
                            <Badge className="capitalize">{t('reports_xPriority', { name: priority })}</Badge>
                            <span className="text-xl font-bold">
                              {detail.total > 0 ? `${Math.round(detail.coverage)}%` : '—'}
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full"
                              style={{ width: `${detail.total > 0 ? detail.coverage : 0}%` }}
                            ></div>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            {detail.total > 0
                              ? t('reports_reqsCovered', { covered: detail.covered, total: detail.total })
                              : t('reports_noReqsAtPriority')}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              {t('reports_noCoverageReports')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
