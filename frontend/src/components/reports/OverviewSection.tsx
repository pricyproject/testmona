import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Bug, Calendar, CheckCircle, Clock,
  Download, Info, Loader2, Minus, RefreshCw, Settings, Target, TrendingDown, TrendingUp, Users,
  XCircle, Zap, GripVertical,
} from 'lucide-react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
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

// Series shown on the quality-trend chart. Kept in one place so the legend,
// tooltip and <Bar>/<Area>/<Line> elements never drift apart.
const TREND_SERIES = [
  { key: 'passRate', labelKey: 'reports_trendPassRate', color: '#10b981' },
  { key: 'failureRate', labelKey: 'reports_trendFailureRate', color: '#f43f5e' },
  { key: 'executed', labelKey: 'reports_trendExecutedLabel', color: '#94a3b8' },
  { key: 'testCasesAdded', labelKey: 'reports_trendAddedLabel', color: '#3b82f6' },
  { key: 'defects', labelKey: 'reports_trendDefectsLabel', color: '#ef4444' },
] as const;

export function OverviewSection({ ctx }: { ctx: ReportsData }) {
  const { t, isRTL } = useTranslation();
  const { formatDate, formatDateTime } = useDateFormat();
  const navigate = useNavigate();
  const {
    timeRange, setTimeRange, isEditMode, handleToggleEditMode, loadDashboardAnalytics,
    handleExportReport, dashboardAnalytics, analyticsTimeSeries, dashboardWidgets,
    setDashboardWidgets, error, selectedProject,
  } = ctx;
  const isLoading = ctx.sectionLoading('overview');

  // Series the user has switched off from the legend.
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
  const toggleSeries = (key: string) =>
    setHiddenSeries((prev) => ({ ...prev, [key]: !prev[key] }));

  // Normalise the raw time-series into chart-ready points. The backend ships a
  // date-keyed daily bucket; labels are locale-aware and the raw date is kept so
  // the tooltip can render a full, timezone-safe date.
  const trendPoints = useMemo(() => {
    const points = Array.isArray(analyticsTimeSeries?.points) ? analyticsTimeSeries.points : [];
    return points.map((point: any) => ({
      date: point.date,
      label: formatDate(point.date, { month: 'short', day: 'numeric' }),
      passRate: Number(point.pass_rate || 0),
      failureRate: Number(point.failure_rate || 0),
      executed: Number(point.executed || 0),
      passed: Number(point.passed || 0),
      defects: Number(point.defects_found || 0),
      testCasesAdded: Number(point.test_cases_added || 0),
    }));
  }, [analyticsTimeSeries, formatDate]);

  // Period aggregates. `delta` compares the pass rate of the second half of the
  // *active* days against the first half, giving an honest "is it getting better
  // or worse" read instead of a noisy first-vs-last-day comparison.
  const trendStats = useMemo(() => {
    const executed = trendPoints.reduce((sum, p) => sum + p.executed, 0);
    const passed = trendPoints.reduce((sum, p) => sum + p.passed, 0);
    const defects = trendPoints.reduce((sum, p) => sum + p.defects, 0);
    const added = trendPoints.reduce((sum, p) => sum + p.testCasesAdded, 0);
    const active = trendPoints.filter((p) => p.executed > 0);
    const rateOf = (rows: typeof trendPoints) => {
      const e = rows.reduce((s, p) => s + p.executed, 0);
      const pa = rows.reduce((s, p) => s + p.passed, 0);
      return e > 0 ? (pa / e) * 100 : 0;
    };
    let delta = 0;
    if (active.length >= 2) {
      const mid = Math.ceil(active.length / 2);
      delta = rateOf(active.slice(mid)) - rateOf(active.slice(0, mid));
    }
    return {
      executed,
      defects,
      added,
      activeDays: active.length,
      avgPassRate: executed > 0 ? (passed / executed) * 100 : 0,
      delta,
      hasSignal: executed > 0 || defects > 0 || added > 0,
    };
  }, [trendPoints]);

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
        // Navigate so the drilled-into section becomes a real, linkable URL.
        navigate(`/projects/${selectedProject}/reports/${m.drill.section}`);
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
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">{t(widget.title as any)}</CardTitle>
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
    const seriesLabel = (key: string) =>
      t(TREND_SERIES.find((s) => s.key === key)!.labelKey as any);

    // A short, honest read of the period: which way is the pass rate moving?
    const delta = Math.round(trendStats.delta * 10) / 10;
    const improving = delta >= 1;
    const declining = delta <= -1;
    const InsightIcon = improving ? ArrowUpRight : declining ? ArrowDownRight : Minus;
    const insightTone = improving
      ? 'text-emerald-600 dark:text-emerald-400'
      : declining
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-gray-500 dark:text-gray-400';
    const insightText = improving
      ? t('reports_trendInsightImproved', { points: Math.abs(delta).toFixed(1) })
      : declining
        ? t('reports_trendInsightDeclined', { points: Math.abs(delta).toFixed(1) })
        : t('reports_trendInsightSteady');

    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">{t('reports_qualityTrendTitle')}</CardTitle>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_qualityTrendSubtitle')}</p>
            </div>
            {trendStats.hasSignal && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">{t('reports_trendExecuted', { count: trendStats.executed })}</Badge>
                <Badge variant="outline">{t('reports_trendDefects', { count: trendStats.defects })}</Badge>
                <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {t('reports_trendAvgPass', { value: Math.round(trendStats.avgPassRate) })}
                </Badge>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && !trendPoints.length ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : !trendPoints.length || !trendStats.hasSignal ? (
            <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 px-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <Activity className="mb-2 h-8 w-8 text-gray-400" />
              {t('reports_noTrendData')}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className={insightTone} aria-hidden>
                  <InsightIcon className="h-4 w-4" />
                </span>
                <span>{insightText}</span>
              </div>
              {/* Charts stay LTR internally; RTL users instead get a reversed time
                  axis so the direction of time reads correctly in every locale. */}
              <div className="mt-1 h-72" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendPoints} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendExecFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="trendPassFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="currentColor" className="text-gray-200 dark:text-gray-700" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: 'currentColor' }}
                      className="text-gray-400"
                      dy={6}
                      minTickGap={28}
                      interval="preserveStartEnd"
                      reversed={isRTL}
                    />
                    <YAxis
                      yAxisId="rate"
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: 'currentColor' }}
                      className="text-gray-400"
                      width={34}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <YAxis
                      yAxisId="count"
                      orientation="right"
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: 'currentColor' }}
                      className="text-gray-400"
                      width={34}
                    />
                    <Tooltip
                      content={(props) => <TrendTooltip {...props} hidden={hiddenSeries} />}
                      cursor={{ stroke: '#94a3b8', strokeOpacity: 0.4, strokeDasharray: '4 4' }}
                    />
                    <ReferenceLine
                      yAxisId="rate"
                      y={trendStats.avgPassRate}
                      stroke="#10b981"
                      strokeDasharray="3 5"
                      strokeOpacity={0.45}
                      label={{
                        value: `${t('reports_trendAvg')} ${Math.round(trendStats.avgPassRate)}%`,
                        position: 'insideTopLeft',
                        fill: '#10b981',
                        fontSize: 10,
                      }}
                    />
                    <Area
                      yAxisId="count"
                      type="monotone"
                      dataKey="executed"
                      name={seriesLabel('executed')}
                      hide={!!hiddenSeries.executed}
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      fill="url(#trendExecFill)"
                    />
                    <Bar yAxisId="count" dataKey="testCasesAdded" name={seriesLabel('testCasesAdded')} hide={!!hiddenSeries.testCasesAdded} fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={20} />
                    <Bar yAxisId="count" dataKey="defects" name={seriesLabel('defects')} hide={!!hiddenSeries.defects} fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={20} />
                    <Area
                      yAxisId="rate"
                      type="monotone"
                      dataKey="passRate"
                      name={seriesLabel('passRate')}
                      hide={!!hiddenSeries.passRate}
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fill="url(#trendPassFill)"
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      yAxisId="rate"
                      type="monotone"
                      dataKey="failureRate"
                      name={seriesLabel('failureRate')}
                      hide={!!hiddenSeries.failureRate}
                      stroke="#f43f5e"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Interactive legend doubles as a series filter, keeping five series
                  readable without a wall of static legend text. */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                {TREND_SERIES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggleSeries(s.key)}
                    aria-pressed={!hiddenSeries[s.key]}
                    className={cn(
                      'flex items-center gap-1.5 text-xs transition-opacity hover:opacity-100',
                      hiddenSeries[s.key] ? 'opacity-40' : 'opacity-90',
                    )}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-gray-600 dark:text-gray-300">{seriesLabel(s.key)}</span>
                  </button>
                ))}
              </div>
            </>
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
              {t('reports_updatedTime', { time: formatDateTime(dashboardAnalytics.generated_at, { timeStyle: 'medium' }) })}
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
                <Badge variant="destructive">{dashboardAnalytics?.upcoming_items?.milestone?.target_date
                  ? formatDate(dashboardAnalytics.upcoming_items.milestone.target_date, { dateStyle: 'medium', timeZone: 'UTC' })
                  : (dashboardAnalytics?.upcoming_items?.release_deadline ?? 'N/A')}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Custom tooltip: theme-aware, locale-aware, and shows one row per *visible*
// series with the correct unit. Recharts injects `active`/`payload`.
function TrendTooltip({ active, payload, hidden }: any) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const rows = [
    { key: 'passRate', label: t('reports_trendPassRate'), value: `${point.passRate ?? 0}%` },
    { key: 'failureRate', label: t('reports_trendFailureRate'), value: `${point.failureRate ?? 0}%` },
    { key: 'executed', label: t('reports_trendExecutedLabel'), value: point.executed ?? 0 },
    { key: 'testCasesAdded', label: t('reports_trendAddedLabel'), value: point.testCasesAdded ?? 0 },
    { key: 'defects', label: t('reports_trendDefectsLabel'), value: point.defects ?? 0 },
  ].filter((row) => !hidden?.[row.key]);

  return (
    <div className="min-w-[11rem] rounded-xl border border-gray-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
      <p className="mb-1.5 font-semibold text-gray-700 dark:text-gray-200">
        {point.date ? formatDate(point.date, { dateStyle: 'medium', timeZone: 'UTC' }) : ''}
      </p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: TREND_SERIES.find((s) => s.key === row.key)?.color }}
              />
              {row.label}
            </span>
            <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
