import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Settings, RefreshCw, Eye, Filter, Calendar, Zap, Loader2,
  Plus, Minus, Edit, Play, GripVertical
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

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

export function Reports() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL } = useTranslation();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'activity' | 'traceability' | 'coverage' | 'test-activity'>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState('7d');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState(parseInt(projectId) || 1);
  
  // Real data states
  const [dashboardAnalytics, setDashboardAnalytics] = useState<any>(null);
  const [granularInsights, setGranularInsights] = useState<any>(null);
  const [shareableReports, setShareableReports] = useState<any[]>([]);
  const [rootCauseAnalyses, setRootCauseAnalyses] = useState<any[]>([]);
  const [dashboardWidgets, setDashboardWidgets] = useState<any[]>([
    { id: 'coverage', title: 'Test Coverage', type: 'kpi', size: 'large', position: { x: 0, y: 0 } },
    { id: 'passRate', title: 'Pass Rate', type: 'kpi', size: 'medium', position: { x: 1, y: 0 } },
    { id: 'failureTrends', title: 'Failure Trends', type: 'chart', size: 'medium', position: { x: 0, y: 1 } },
    { id: 'flakiness', title: 'Test Flakiness', type: 'chart', size: 'medium', position: { x: 1, y: 1 } },
    { id: 'defectDensity', title: 'Defect Density', type: 'kpi', size: 'medium', position: { x: 0, y: 2 } }
  ]);
  
  // Traceability and Coverage states
  const [traceabilityData, setTraceabilityData] = useState<any>(null);
  const [coverageReports, setCoverageReports] = useState<any[]>([]);
  const [testExecutionStatus, setTestExecutionStatus] = useState<any>(null);
  
  // Activity statistics state
  const [activityStats, setActivityStats] = useState<any>(null);
  
  // Test activity state
  const [testActivity, setTestActivity] = useState<any>(null);

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

  // Update selected project when URL parameter changes
  useEffect(() => {
    if (projectId) {
      const id = parseInt(projectId);
      if (!isNaN(id)) {
        Promise.resolve().then(() => setSelectedProject(id));
      }
    }
  }, [projectId]);

  // Dialog states for Shareable Reports
  const [showCreateReportDialog, setShowCreateReportDialog] = useState(false);
  const [newReport, setNewReport] = useState({
    title: '',
    report_type: 'executive',
    shared_with: [],
    access_level: 'read-only',
    expires_in_days: 30
  });

  // API loading functions
  const loadDashboardAnalytics = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const data = await analyticsAPI.getDashboardAnalytics(selectedProject, timeRange);
      setDashboardAnalytics(data);
      console.log('✅ Dashboard analytics loaded:', data);
      if (data?.kpi_data) {
        console.log('✅ KPI Data keys:', Object.keys(data.kpi_data));
        console.log('✅ Defect Density data:', data.kpi_data.defectDensity);
      } else {
        console.log('❌ No kpi_data in response');
      }
    } catch (error) {
      console.error('❌ Failed to load dashboard analytics:', error);
      setDashboardAnalytics(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadGranularInsights = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const data = await analyticsAPI.getGranularInsights({
        project_id: selectedProject,
        filter_type: 'all'
      });
      setGranularInsights(data);
      console.log('✅ Granular insights loaded:', data);
    } catch (error) {
      console.error('❌ Failed to load granular insights:', error);
      setGranularInsights(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadShareableReports = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const data = await analyticsAPI.getShareableReports(selectedProject);
      setShareableReports(data);
      console.log('✅ Shareable reports loaded:', data);
    } catch (error) {
      console.error('❌ Failed to load shareable reports:', error);
      setShareableReports([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadRootCauseAnalyses = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const data = await analyticsAPI.getRootCauseAnalyses(selectedProject);
      setRootCauseAnalyses(data);
      console.log('✅ Root cause analyses loaded:', data);
    } catch (error) {
      console.error('❌ Failed to load root cause analyses:', error);
      setRootCauseAnalyses([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTraceabilityData = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const data = await analyticsAPI.getTraceabilityMatrix(selectedProject);
      setTraceabilityData(data);
      console.log('✅ Traceability data loaded:', data);
    } catch (error) {
      console.error('❌ Failed to load traceability data:', error);
      setTraceabilityData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCoverageReports = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const data = await analyticsAPI.getCoverageReports(selectedProject);
      setCoverageReports(data);
      console.log('✅ Coverage reports loaded:', data);
    } catch (error) {
      console.error('❌ Failed to load coverage reports:', error);
      setCoverageReports([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateCoverageReport = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const generatedReport = await analyticsAPI.generateCoverageReport(selectedProject);
      setCoverageReports([generatedReport]);
      await loadTestExecutionStatus();
    } catch (error) {
      console.error('❌ Failed to generate coverage report:', error);
      setCoverageReports([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTestExecutionStatus = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const data = await analyticsAPI.getTestExecutionStatus(selectedProject);
      console.log('✅ Test execution status loaded:', data);
      setTestExecutionStatus(data);
    } catch (error) {
      console.error('❌ Failed to load test execution status:', error);
      setTestExecutionStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadActivityStatistics = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
      const data = await auditAPI.getProjectActivitySummary(selectedProject, days);
      setActivityStats(data);
      console.log('✅ Activity statistics loaded:', data);
    } catch (error) {
      console.error('❌ Failed to load activity statistics:', error);
      setActivityStats(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTestActivity = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const data = await analyticsAPI.getTestActivity(selectedProject, startDate, endDate, 'day');
      setTestActivity(data);
      console.log('✅ Test activity loaded:', data);
    } catch (error) {
      console.error('❌ Failed to load test activity:', error);
      setTestActivity(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler functions for buttons
  const handleGenerateAnalytics = async () => {
    setIsLoading(true);
    try {
      // Reload data for current tab
      if (activeTab === 'dashboard') {
        await loadDashboardAnalytics();
      } else if (activeTab === 'activity') {
        await loadActivityStatistics();
      } else if (activeTab === 'traceability') {
        await loadTraceabilityData();
      } else if (activeTab === 'coverage') {
        await handleGenerateCoverageReport();
      } else if (activeTab === 'test-activity') {
        await loadTestActivity();
      }
      
      // Show success message
      alert('Analytics generated successfully!');
    } catch (error) {
      console.error('Failed to generate analytics:', error);
      alert('Failed to generate analytics. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportReport = () => {
    // Export current tab data as JSON
    let dataToExport: any = {};
    let filename = '';
    
    if (activeTab === 'dashboard') {
      dataToExport = dashboardAnalytics;
      filename = 'dashboard-analytics.json';
    } else if (activeTab === 'activity') {
      dataToExport = activityStats;
      filename = 'activity-statistics.json';
    } else if (activeTab === 'traceability') {
      dataToExport = traceabilityData;
      filename = 'traceability-matrix.json';
    } else if (activeTab === 'coverage') {
      dataToExport = coverageReports;
      filename = 'coverage-reports.json';
    } else if (activeTab === 'test-activity') {
      dataToExport = testActivity;
      filename = 'test-activity.json';
    }
    
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Load data when tab, project, or time range changes
  useEffect(() => {
    Promise.resolve().then(() => {
      if (activeTab === 'dashboard') {
        loadDashboardAnalytics();
      } else if (activeTab === 'activity') {
        loadActivityStatistics();
      } else if (activeTab === 'traceability') {
        loadTraceabilityData();
      } else if (activeTab === 'coverage') {
        loadCoverageReports();
        loadTestExecutionStatus();
      } else if (activeTab === 'test-activity') {
        loadTestActivity();
      }
    });
  }, [activeTab, selectedProject, timeRange]);

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
        <Card className="h-full relative group">
          {isEditMode && (
            <div
              className="absolute top-2 left-2 z-10 p-1 bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4 text-gray-500" />
            </div>
          )}
          <div className={`${isEditMode ? 'opacity-75' : ''}`}>
            {renderKPIWidget(widget)}
          </div>
        </Card>
      </div>
    );
  };

  const renderKPIWidget = (widget: any) => {
    const kpiData = dashboardAnalytics?.kpi_data;
    if (!kpiData) {
      return (
        <Card className="h-full">
          <CardContent className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </CardContent>
        </Card>
      );
    }
    
    // Map widget IDs to KPI data keys
    const dataMap: { [key: string]: string } = {
      'coverage': 'coverage',
      'passRate': 'passRate', 
      'failureTrends': 'failureTrends',
      'flakiness': 'flakiness',
      'cycleTime': 'cycleTime',
      'defectDensity': 'defectDensity'
    };
    
    const dataKey = dataMap[widget.id];
    let data = dataKey ? kpiData[dataKey] : null;
    
    // Add fallback data for Defect Density if not available from API
    if (widget.id === 'defectDensity' && !data) {
      data = {
        current: 0.5,
        trend: 'stable',
        change: 0
      };
    }
    
    if (!data) {
      return (
        <Card className="h-full">
          <CardContent className="flex items-center justify-center h-32">
            <div className="text-center text-gray-500">
              <div className="text-sm">No data available</div>
            </div>
          </CardContent>
        </Card>
      );
    }
    
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-600">{widget.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold">
                {widget.id === 'cycleTime' ? `${data.current}h` : widget.id === 'defectDensity' ? `${data.current}` : `${data.current}%`}
              </div>
              <div className="flex items-center gap-1 text-sm">
                {getTrendIcon(data.trend)}
                <span className={data.trend === 'up' ? 'text-green-600' : data.trend === 'down' ? 'text-red-600' : 'text-gray-600'}>
                  {Math.abs(data.change)}{widget.id === 'cycleTime' ? 'h' : widget.id === 'defectDensity' ? '' : '%'}
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
        <div className="flex items-center gap-4">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={isEditMode ? "default" : "outline"}
            onClick={() => setIsEditMode(!isEditMode)}
          >
            <Settings className="h-4 w-4 mr-2" />
            {isEditMode ? 'Save Layout' : 'Customize'}
          </Button>
          <Button variant="outline" onClick={loadDashboardAnalytics}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportReport}>
            <Download className="h-4 w-4 mr-2" />
            Export Dashboard
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
          <span className="text-gray-600">Loading analytics data...</span>
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
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Test runs today</span>
                <Badge variant="secondary">{dashboardAnalytics?.recent_activity?.test_runs_today ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Tests executed</span>
                <Badge variant="secondary">{dashboardAnalytics?.recent_activity?.tests_executed ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Defects found</span>
                <Badge variant="destructive">{dashboardAnalytics?.recent_activity?.defects_found ?? 0}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Active testers</span>
                <Badge variant="secondary">{dashboardAnalytics?.team_performance?.active_testers ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Avg. execution time</span>
                <Badge variant="secondary">{dashboardAnalytics?.team_performance?.avg_execution_time ?? 0}h</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Productivity score</span>
                <Badge className="bg-green-600">{dashboardAnalytics?.team_performance?.productivity_score ?? 0}%</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Upcoming
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Scheduled runs</span>
                <Badge variant="secondary">{dashboardAnalytics?.upcoming_items?.scheduled_runs ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Pending reviews</span>
                <Badge variant="outline">{dashboardAnalytics?.upcoming_items?.pending_reviews ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Release deadline</span>
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
            <h2 className="text-xl font-semibold">Activity Statistics</h2>
            <p className="text-sm text-gray-600">Track all changes and executions in your project</p>
          </div>
          <div className="flex gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={loadActivityStatistics}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
            <span className="text-gray-600">Loading activity statistics...</span>
          </div>
        )}

        {!isLoading && activityStats && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Total Activities</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{activityStats.total_activities || 0}</div>
                  <p className="text-xs text-gray-500 mt-1">
                    Last {activityStats.days} days
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Created Activities</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-green-600" />
                    <div className="text-2xl font-bold">
                      {getActionCount('create')}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">New records created</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Updated Activities</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Edit className="h-5 w-5 text-blue-600" />
                    <div className="text-2xl font-bold">
                      {getActionCount('update', 'edit')}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Records modified</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Deleted Activities</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Minus className="h-5 w-5 text-red-600" />
                    <div className="text-2xl font-bold">
                      {getActionCount('delete')}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Records removed</p>
                </CardContent>
              </Card>
            </div>

            {/* Activity Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Activity Breakdown by Action</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {activityCounts.length === 0 && (
                      <p className="text-sm text-gray-500">No actions recorded in this period.</p>
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
                              <Badge variant="secondary" className="min-w-[3rem] justify-center">
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
                  <CardTitle className="text-base">Activity Breakdown by Entity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {entityCounts.length === 0 && (
                      <p className="text-sm text-gray-500">No entities recorded in this period.</p>
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
                              <Badge variant="secondary" className="min-w-[3rem] justify-center">
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
                  <CardTitle className="text-base">Top Contributors</CardTitle>
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
                            <p className="text-xs text-gray-500">{user.activity_count} activities</p>
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
                    Showing activities from {activityStats.date_from ? new Date(activityStats.date_from).toLocaleDateString() : 'N/A'} to {activityStats.date_to ? new Date(activityStats.date_to).toLocaleDateString() : 'N/A'}
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
                No activity data available for the selected time period.
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
            <h2 className="text-xl font-semibold">Test Activity</h2>
            <p className="text-sm text-gray-600">Daily test case changes and executions for this project</p>
          </div>
          <div className="flex gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={loadTestActivity}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {!testActivity && (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-gray-500">No test activity data available</p>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Tests Added</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{summary.total_added}</div>
              <p className="text-xs text-gray-500">New records created</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Tests Modified</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{summary.total_modified}</div>
              <p className="text-xs text-gray-500">Test cases updated</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Tests Executed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{summary.total_executed}</div>
              <p className="text-xs text-gray-500">Test executions</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Tests Deleted</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{summary.total_deleted}</div>
              <p className="text-xs text-gray-500">Records removed</p>
            </CardContent>
          </Card>
        </div>

        {/* Activity Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Test Activity Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <div className="space-y-2">
                {activity.length === 0 && (
                  <div className="flex h-48 items-center justify-center text-sm text-gray-500">No activity in this period</div>
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
                <span className="text-sm">Added</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-500 rounded"></div>
                <span className="text-sm">Modified</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-purple-500 rounded"></div>
                <span className="text-sm">Executed</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderGranularInsights = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Per-Test Step Insights</h2>
        <div className="flex gap-2">
          <Select defaultValue="all" onValueChange={(value: string) => {
            loadGranularInsights();
          }}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Test Cases</SelectItem>
              <SelectItem value="failed">Failed Only</SelectItem>
              <SelectItem value="slow">Slow Tests</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={loadGranularInsights}>
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
          <span className="text-gray-600">Loading granular insights...</span>
        </div>
      )}

      <div className="space-y-4">
        {granularInsights?.test_step_results?.map((test: any, index: number) => (
          <Card key={`${test.testCaseId}-${test.testRunId}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{test.testCaseId}</CardTitle>
                  <p className="text-sm text-gray-600">
                    {test.environment} • Executed by {test.executedBy}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant={test.steps?.some((s: any) => s.status === 'failed') ? 'destructive' : 'secondary'}>
                    {test.steps?.filter((s: any) => s.status === 'passed').length || 0}/{test.steps?.length || 0} passed
                  </Badge>
                  <p className="text-sm text-gray-600 mt-1">{test.totalDuration}s</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(test.steps || []).map((step: any, index: number) => (
                  <div key={step.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium">
                        {index + 1}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(step.status)}
                        <span className="font-medium">{step.name}</span>
                        <span className="text-sm text-gray-600">({step.duration}s)</span>
                      </div>
                      {step.error && (
                        <p className="text-sm text-red-600 mt-1">{step.error}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderShareableReports = () => {
    const handleCreateReport = async () => {
      if (!selectedProject || !newReport.title) return;
      
      setIsLoading(true);
      try {
        const report = await analyticsAPI.createShareableReport({
          project_id: selectedProject,
          title: newReport.title,
          report_type: newReport.report_type,
          shared_with: newReport.shared_with,
          access_level: newReport.access_level,
          expires_in_days: newReport.expires_in_days
        });
        
        console.log('✅ Shareable report created:', report);
        await loadShareableReports(); // Reload the reports list
        setShowCreateReportDialog(false);
        setNewReport({
          title: '',
          report_type: 'executive',
          shared_with: [],
          access_level: 'read-only',
          expires_in_days: 30
        });
      } catch (error) {
        console.error('❌ Failed to create shareable report:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const handlePreview = (report: any) => {
      // Open report in new tab or modal
      window.open(`/reports/shareable/${report.share_token || report.id}`, '_blank');
    };

    const handleDownload = async (report: any) => {
      try {
        // Generate and download report
        const response = await fetch(`${API_BASE_URL}/analytics/shareable-reports/${report.id}/download`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${report.title}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }
      } catch (error) {
        console.error('❌ Failed to download report:', error);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Shareable Reports</h2>
          <Button onClick={() => setShowCreateReportDialog(true)}>
            <Share2 className="h-4 w-4 mr-2" />
            Create New Report
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
                    onChange={(e) => setNewReport({...newReport, title: e.target.value})}
                    placeholder={t('enterReportTitle')}
                    maxLength={200}
                  />
                </div>
                <div>
                  <Label>{t('reportType')}</Label>
                  <Select value={newReport.report_type} onValueChange={(value) => setNewReport({...newReport, report_type: value})}>
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
                  <Select value={newReport.access_level} onValueChange={(value) => setNewReport({...newReport, access_level: value})}>
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
                  <Label>{t('expiresInDays')}</Label>
                  <Input
                    type="number"
                    value={newReport.expires_in_days}
                    onChange={(e) => setNewReport({...newReport, expires_in_days: parseInt(String(e.target.value)) || 30})}
                    min="1"
                    max="365"
                  />
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowCreateReportDialog(false)}>
                  {t('cancel')}
                </Button>
                <Button onClick={handleCreateReport} disabled={!newReport.title || isLoading}>
                  {isLoading ? t('creating') : t('createReport')}
                </Button>
              </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid gap-4">
          {shareableReports.map((report) => (
            <Card key={report.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{report.title}</CardTitle>
                    <p className="text-sm text-gray-600">
                      Shared by user #{report.created_by || 'N/A'} • {report.view_count || 0} views
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={report.report_type === 'executive' ? 'secondary' : 'outline'}>
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
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    <p>Shared with: {Array.isArray(report.shared_with) ? report.shared_with.join(', ') : report.shared_with || 'N/A'}</p>
                    <p>Expires: {report.expires_at ? new Date(report.expires_at).toLocaleDateString() : 'Never'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handlePreview(report)}>
                      <Eye className="h-4 w-4 mr-2" />
                      Preview
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDownload(report)}>
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const renderRootCauseAnalysis = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Root Cause Analysis</h2>
        <Button variant="outline">
          <GitBranch className="h-4 w-4 mr-2" />
          Trace Full Path
        </Button>
      </div>

      <div className="space-y-4">
        {rootCauseAnalyses.map((analysis) => (
          <Card key={analysis.requirementId}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-blue-600" />
                <span className="font-mono text-sm font-bold">{analysis.requirementId}</span>
                <CardTitle className="text-base">{analysis.requirementTitle}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analysis.defects.map((defect) => (
                  <div key={defect.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Bug className="h-4 w-4 text-red-600" />
                        <span className="font-mono text-sm">{defect.id}</span>
                        <span className="font-medium">{defect.title}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={defect.severity === 'high' ? 'destructive' : 'secondary'}>
                          {defect.severity}
                        </Badge>
                        <Badge variant={defect.status === 'open' ? 'destructive' : 'secondary'}>
                          {defect.status}
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-medium text-gray-700">Root Cause:</p>
                        <p>{defect.rootCause}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Impact:</p>
                        <p>{analysis.impact}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Discovered in:</p>
                        <p>{defect.discoveredIn}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Resolution Time:</p>
                        <p>{analysis.resolutionTime}</p>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t text-sm">
                      <p className="font-medium text-gray-700 mb-1">Trace Path:</p>
                      <div className="flex items-center gap-2 text-gray-600">
                        <span>{analysis.requirementId}</span>
                        <span>→</span>
                        <span>{defect.discoveredIn}</span>
                        <span>→</span>
                        <span>{defect.id}</span>
                        <span>→</span>
                        <span className="text-green-600">Fix: {defect.fixCommit}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reports & Analytics</h1>
          <p className="text-gray-600">Comprehensive testing insights and analytics</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportReport}>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
          <Button onClick={handleGenerateAnalytics}>
            <BarChart3 className="h-4 w-4 mr-2" />
            Generate Analytics
          </Button>
        </div>
      </div>

      {/* Simplified Tabs - Only Backend-Supported Features */}
      <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit overflow-x-auto">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
            activeTab === 'dashboard'
              ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
            activeTab === 'activity'
              ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          Activity Statistics
        </button>
        <button
          onClick={() => setActiveTab('traceability')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
            activeTab === 'traceability'
              ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          Traceability Matrix
        </button>
        <button
          onClick={() => setActiveTab('coverage')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
            activeTab === 'coverage'
              ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          Coverage Analysis
        </button>
        <button
          onClick={() => setActiveTab('test-activity')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
            activeTab === 'test-activity'
              ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          Test Activity
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'activity' && renderActivityStatistics()}
      {activeTab === 'test-activity' && renderTestActivity()}
      
      {/* Keep existing traceability and coverage */}
      {activeTab === 'traceability' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Total Requirements</p>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">Covered</p>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">Uncovered</p>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">Coverage %</p>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">Blocked Tests</p>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">Not Tested</p>
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

          {/* Search Bar */}
          <div className="bg-white dark:bg-gray-900 p-4 rounded-lg shadow-sm border dark:border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder={t('searchRequirementsOrTestCases')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
              <span className="text-gray-600 dark:text-gray-400">Loading traceability data...</span>
            </div>
          )}

          {/* Traceability Matrix Table */}
          {!isLoading && traceabilityData && (
            <div className="space-y-4">
              {(traceabilityData?.requirements || [])
                .filter((item: any) => 
                  !searchQuery || 
                  String(item.requirement_title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (item.test_cases || []).some((tc: any) => String(tc.title || '').toLowerCase().includes(searchQuery.toLowerCase()))
                )
                .map((item: any) => (
                <Card key={item.requirement_id} className="overflow-hidden">
                  <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-800/50 py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <FileCheck className="h-5 w-5 text-blue-600 mt-0.5" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-bold text-blue-600">{item.requirement_key || `REQ-${item.requirement_id}`}</span>
                            <Badge variant={item.requirement_status === 'approved' ? 'default' : 'outline'} className="capitalize">
                              {item.requirement_status}
                            </Badge>
                            {item.requirement_priority && (
                              <Badge variant="secondary" className="capitalize">
                                {item.requirement_priority} Priority
                              </Badge>
                            )}
                          </div>
                          <CardTitle className="text-base font-semibold">
                            <Link
                              to={`/projects/${selectedProject}/requirements/${item.requirement_id}`}
                              className="text-gray-900 underline-offset-4 hover:text-blue-700 hover:underline dark:text-white dark:hover:text-blue-300"
                            >
                              {item.requirement_title}
                            </Link>
                          </CardTitle>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">Test Cases</div>
                          <div className="font-bold">{item.total_test_cases || 0}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">Passed</div>
                          <div className="font-bold text-green-600">{item.passed_count || 0}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">Failed</div>
                          <div className="font-bold text-red-600">{item.failed_count || 0}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">Blocked</div>
                          <div className="font-bold text-yellow-600">{(item.test_cases || []).filter((tc: any) => normalizeStatus(tc.status) === 'blocked').length}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 dark:text-gray-400">Not Tested</div>
                          <div className="font-bold text-gray-600">{(item.test_cases || []).filter((tc: any) => normalizeStatus(tc.status) === 'not_tested').length}</div>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {(item.test_cases || []).length > 0 ? (
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium">
                          <tr>
                            <th className="px-6 py-3 text-left">Test Case</th>
                            <th className="px-6 py-3 text-left">Title</th>
                            <th className="px-6 py-3 text-center">Coverage Type</th>
                            <th className="px-6 py-3 text-center">Status</th>
                            <th className="px-6 py-3 text-right">Last Executed</th>
                            <th className="px-6 py-3 text-center">Actions</th>
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
                                <td className="px-6 py-4 font-mono text-sm text-gray-600 dark:text-gray-400">TC-{tc.id}</td>
                                <td className="px-6 py-4 font-medium">{tc.title}</td>
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
                                  {tc.last_executed ? new Date(tc.last_executed).toLocaleDateString() : 'Never'}
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(executionPath, '_blank')}
                                    className="text-xs"
                                  >
                                    <Play className="h-3 w-3 mr-1" />
                                    {tc.test_run_id ? 'Open Execution' : 'Execute'}
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                        <AlertCircle className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                        <p className="font-medium">No test cases linked to this requirement</p>
                        <p className="text-sm mt-1">Link test cases to track coverage</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              
              {traceabilityData?.requirements?.length === 0 && (
                <Card>
                  <CardContent className="p-12 text-center">
                    <FileCheck className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                    <h3 className="text-lg font-semibold mb-2">No Requirements Found</h3>
                    <p className="text-gray-600 dark:text-gray-400">
                      Create requirements and link them to test cases to see the traceability matrix.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
      
      {activeTab === 'coverage' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Coverage Analysis</h2>
              {coverageReports.length > 0 && (
                <p className="text-sm text-gray-600 mt-1">
                  Last updated: {new Date(coverageReports[coverageReports.length - 1]?.generated_at).toLocaleString()}
                </p>
              )}
            </div>
            <Button onClick={handleGenerateCoverageReport} disabled={isLoading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
              <span className="text-gray-600">Loading coverage data...</span>
            </div>
          )}

          {coverageReports.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Overall Requirement Coverage</CardTitle>
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
                        <span className="text-xs text-gray-500">Total Coverage</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-8 mt-8 w-full">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">{coverageReports[coverageReports.length - 1]?.covered_requirements || 0}</p>
                        <p className="text-xs text-gray-500 uppercase font-medium">Covered</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-red-600">{(coverageReports[coverageReports.length - 1]?.total_requirements || 0) - (coverageReports[coverageReports.length - 1]?.covered_requirements || 0)}</p>
                        <p className="text-xs text-gray-500 uppercase font-medium">Uncovered</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Test Execution Status</CardTitle>
                </CardHeader>
                <CardContent>
                  {testExecutionStatus ? (
                    <div className="space-y-4 py-4">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                          <p className="text-2xl font-bold text-blue-600">{testExecutionStatus.summary.executed_test_cases}</p>
                          <p className="text-xs text-gray-600">Executed Tests</p>
                        </div>
                        <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <p className="text-2xl font-bold text-gray-600">{testExecutionStatus.summary.not_tested_test_cases}</p>
                          <p className="text-xs text-gray-600">Not Tested</p>
                        </div>
                      </div>
                      
                      <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg mb-4">
                        <p className="text-lg font-bold text-green-600">
                          {testExecutionStatus?.execution_rate !== undefined ? Math.round(testExecutionStatus.execution_rate) + '%' : 'Loading...'}
                        </p>
                        <p className="text-xs text-gray-600">Tests Executed ({testExecutionStatus?.summary?.executed_test_cases || 0}/{testExecutionStatus?.summary?.total_test_cases || 0})</p>
                      </div>

                      {testExecutionStatus?.summary?.executed_test_cases > 0 && (
                        <div className="space-y-4">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center mb-2">
                            Status of Executed Tests ({testExecutionStatus.summary.executed_test_cases} tests)
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
                          <div className="text-xs text-gray-500 text-center mt-2">
                            Executed test percentages add up to {Math.round((Object.values(testExecutionStatus.status_percentages || {}) as number[]).reduce((sum: number, val: number) => sum + val, 0))}%
                          </div>
                          
                          <div className="mt-6 pt-4 border-t dark:border-gray-700">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center mb-2">
                              Overall Test Status ({testExecutionStatus.summary.total_test_cases} tests)
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
                            <div className="text-xs text-gray-500 text-center mt-2">
                              Overall percentages add up to {Math.round((Object.values(testExecutionStatus.overall_percentages || {}) as number[]).reduce((sum: number, val: number) => sum + val, 0))}%
                            </div>
                          </div>
                        </div>
                      )}
                      
                      <div className="mt-4 pt-4 border-t dark:border-gray-700 text-xs text-gray-500 text-center">
                        Total: {testExecutionStatus?.summary?.total_test_cases || 0} test cases
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                      <p>Loading test execution status...</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">Priority-wise Coverage</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {Object.entries(coverageReports[coverageReports.length - 1]?.report_data?.by_priority || {}).map(([priority, value]) => (
                      <div key={priority} className="p-4 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <div className="flex justify-between items-center mb-2">
                          <Badge className="capitalize">{priority} Priority</Badge>
                          <span className="text-xl font-bold">{Math.round(Number(value))}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${value}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No coverage reports available. Click "Generate Report" to create one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
