import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity, AlertCircle, Bug, Calendar, CheckCircle, Clock,
  Download, Info, Loader2, RefreshCw, Settings, Target, TrendingDown, TrendingUp, Users,
  XCircle, Zap, GripVertical,
} from 'lucide-react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ReportsData } from '@/hooks/useReportsData';
import { SectionKey } from '@/components/reports/reportsUtils';

interface WidgetMeta {
  def: string;
  goodOnUp: boolean;
  drill: { section?: SectionKey; href?: string };
}

export function OverviewSection({ ctx }: { ctx: ReportsData }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    timeRange, setTimeRange, isEditMode, handleToggleEditMode, loadDashboardAnalytics,
    handleExportReport, dashboardAnalytics, analyticsTimeSeries, dashboardWidgets,
    setDashboardWidgets, setActiveSection, error, selectedProject,
  } = ctx;
  const isLoading = ctx.sectionLoading('overview');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  // Per-widget metadata: definition (for tooltip), whether a rising value is good,
  // and a drill-down target (an in-page section or an external route).
  const widgetMeta: Record<string, WidgetMeta> = {
    coverage: { def: t('reports_widgetDefCoverage'), goodOnUp: true, drill: { section: 'coverage-risk' } },
    passRate: { def: t('reports_widgetDefPassRate'), goodOnUp: true, drill: { section: 'coverage-risk' } },
    failureTrends: { def: t('reports_widgetDefFailureTrends'), goodOnUp: false, drill: { href: `/projects/${selectedProject}/defects` } },
    flakiness: { def: t('reports_widgetDefFlakiness'), goodOnUp: false, drill: { section: 'coverage-risk' } },
    cycleTime: { def: t('reports_widgetDefCycleTime'), goodOnUp: false, drill: { section: 'activity' } },
    defectDensity: { def: t('reports_widgetDefDefectDensity'), goodOnUp: false, drill: { href: `/projects/${selectedProject}/defects` } },
  };

  const renderKPIWidget = (widget: any) => {
    const kpiData = dashboardAnalytics?.kpi_data;
    if (!kpiData) {
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

    const data = kpiData[widget.id];
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
      if (m.drill.section) {
        setActiveSection(m.drill.section);
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

  const SortableWidget = ({ widget }: { widget: any }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
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
          <div className={`${isEditMode ? 'opacity-75' : ''}`}>{renderKPIWidget(widget)}</div>
        </div>
      </div>
    );
  };

  const renderQualityTrendChart = () => {
    const points = Array.isArray(analyticsTimeSeries?.points) ? analyticsTimeSeries.points : [];
    const compactPoints = points.map((point: any) => ({
      ...point,
      label: new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      passRate: Number(point.pass_rate || 0),
      failureRate: Number(point.failure_rate || 0),
      executed: Number(point.executed || 0),
      defects: Number(point.defects_found || 0),
      testCasesAdded: Number(point.test_cases_added || 0),
    }));
    const hasSignal = compactPoints.some((point: any) => point.executed > 0 || point.defects > 0 || point.testCasesAdded > 0);

    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">{t('reports_qualityTrendTitle')}</CardTitle>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_qualityTrendSubtitle')}</p>
            </div>
            {analyticsTimeSeries?.summary && (
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">
                  {t('reports_trendExecuted', { count: analyticsTimeSeries.summary.total_executed || 0 })}
                </Badge>
                <Badge variant="outline">
                  {t('reports_trendDefects', { count: analyticsTimeSeries.summary.total_defects || 0 })}
                </Badge>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : !compactPoints.length || !hasSignal ? (
            <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <Activity className="mb-2 h-8 w-8 text-gray-400" />
              {t('reports_noTrendData')}
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={compactPoints} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis
                    yAxisId="rate"
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <YAxis
                    yAxisId="count"
                    orientation="right"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                  />
                  <Tooltip
                    formatter={(value: any, name: any) => {
                      if (name === t('reports_trendPassRate') || name === t('reports_trendFailureRate')) {
                        return [`${value}%`, name];
                      }
                      return [value, name];
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="count" dataKey="executed" name={t('reports_trendExecutedLabel')} fill="#64748b" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="count" dataKey="testCasesAdded" name={t('reports_trendAddedLabel')} fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="count" dataKey="defects" name={t('reports_trendDefectsLabel')} fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Area
                    yAxisId="rate"
                    type="monotone"
                    dataKey="passRate"
                    name={t('reports_trendPassRate')}
                    stroke="#16a34a"
                    strokeWidth={2}
                    fill="#16a34a"
                    fillOpacity={0.12}
                  />
                  <Area
                    yAxisId="rate"
                    type="monotone"
                    dataKey="failureRate"
                    name={t('reports_trendFailureRate')}
                    stroke="#dc2626"
                    strokeWidth={2}
                    fill="#dc2626"
                    fillOpacity={0.08}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
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
          <Button variant={isEditMode ? 'default' : 'outline-solid'} onClick={handleToggleEditMode}>
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

      {isEditMode ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={dashboardWidgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
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
            <div key={widget.id} className={`${widget.size === 'large' ? 'col-span-2' : ''}`}>
              {renderKPIWidget(widget)}
            </div>
          ))}
        </div>
      )}

      {renderQualityTrendChart()}

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
}
