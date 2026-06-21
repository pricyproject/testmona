import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity, Edit3, FileText, Info, Loader2, Minus, Package, Play, Plus, RefreshCw,
  Settings, ShieldOff, Users,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { isAdminUser } from '@/utils/roles';
import { ReportsData } from '@/hooks/useReportsData';

type TFunc = ReturnType<typeof useTranslation>['t'];

const TIME_RANGES = [
  { value: '24h', key: 'reports_timeLast24h' },
  { value: '7d', key: 'reports_timeLast7d' },
  { value: '30d', key: 'reports_timeLast30d' },
  { value: '90d', key: 'reports_timeLast90d' },
] as const;

// Action tone palette — semantic, restrained. Maps an audit action to a single
// accent used for both the icon chip and the breakdown bar, so a glance at the
// chart matches the legend exactly.
const ACTION_TONE: Record<string, { bar: string; chip: string }> = {
  create: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' },
  update: { bar: 'bg-blue-500', chip: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' },
  delete: { bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' },
  execute: { bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300' },
  login: { bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300' },
  logout: { bar: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};

const DEFAULT_TONE = { bar: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  test_case: <FileText className="h-4 w-4" />,
  test_suite: <Package className="h-4 w-4" />,
  test_run: <Play className="h-4 w-4" />,
  defect: <Activity className="h-4 w-4" />,
  user: <Users className="h-4 w-4" />,
  project: <Package className="h-4 w-4" />,
};

const humanize = (value: string) => String(value || '').replace(/_/g, ' ').trim();

export function ActivitySection({ ctx }: { ctx: ReportsData }) {
  const { t } = useTranslation();
  const isAdmin = isAdminUser(useAuthStore((s) => s.user));
  const {
    activityStats, testActivity, timeRange, setTimeRange,
    loadActivityStatistics, loadTestActivity,
  } = ctx;
  const loading = !!ctx.loadingByTab.activity || !!ctx.loadingByTab['test-activity'];

  // --- Audit-logging status -----------------------------------------------
  // Lets us distinguish "nothing happened in this range" from "audit logging is
  // switched off", so we never present a wall of misleading zeros. `off` means
  // no project activity can be recorded at all (global flag off, or every
  // project-relevant entity disabled); `disabled` lists partially-muted types.
  const audit = useMemo(() => ({
    enabled: activityStats?.audit_enabled ?? true,
    disabled: (activityStats?.audit_disabled_entities as string[] | undefined) ?? [],
    off: !!activityStats?.audit_effectively_off,
  }), [activityStats]);

  // --- Derived: activity statistics ---------------------------------------
  const stats = useMemo(() => {
    const activityCounts: any[] = activityStats?.activity_counts || [];
    const entityCounts: any[] = activityStats?.entity_counts || [];
    const topUsers: any[] = activityStats?.top_users || [];
    const total = Number(activityStats?.total_activities || 0);
    const maxAction = Math.max(1, ...activityCounts.map((a) => Number(a.count || 0)));
    const maxEntity = Math.max(1, ...entityCounts.map((e) => Number(e.count || 0)));
    const contributors = new Set(topUsers.map((u) => u.user_id)).size || topUsers.length;

    const countOf = (...actions: string[]) =>
      activityCounts
        .filter((a) => actions.includes(String(a.action || '').toLowerCase()))
        .reduce((sum, a) => sum + Number(a.count || 0), 0);

    return {
      total,
      contributors,
      created: countOf('create'),
      updated: countOf('update', 'edit'),
      deleted: countOf('delete'),
      activityCounts,
      entityCounts,
      topUsers,
      maxAction,
      maxEntity,
      share: (n: number) => (total > 0 ? Math.round((Number(n || 0) / total) * 100) : 0),
    };
  }, [activityStats]);

  // --- Derived: daily test activity chart ---------------------------------
  const chart = useMemo(() => {
    const source: any[] = Array.isArray(testActivity?.activity)
      ? testActivity.activity
      : Array.isArray(testActivity?.activity_data) ? testActivity.activity_data : [];
    // Render every bucket the backend returned for the selected range — do NOT
    // truncate to a fixed window, or a "90 days" selection would silently show
    // only the last 30 (contradicting the range-scoped KPIs). The x-axis thins
    // its own ticks to stay readable.
    const points = source.map((day) => ({
      label: new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      added: Number(day.added || 0),
      modified: Number(day.modified || 0),
      executed: Number(day.executed || 0),
    }));
    // Prefer the backend's range-wide summary; fall back to summing the points.
    const summary = testActivity?.summary || {};
    const sumOf = (key: 'added' | 'modified' | 'executed') =>
      points.reduce((acc, p) => acc + p[key], 0);
    const totals = {
      added: Number(summary.total_added ?? sumOf('added')),
      modified: Number(summary.total_modified ?? sumOf('modified')),
      executed: Number(summary.total_executed ?? sumOf('executed')),
    };
    const hasSignal = points.some((p) => p.added + p.modified + p.executed > 0);
    return { points, totals, hasSignal };
  }, [testActivity]);

  const refresh = () => { void loadActivityStatistics(); void loadTestActivity(); };

  // --- Full-section empty state -------------------------------------------
  const hasAnyData = !!activityStats || !!testActivity;
  if (!loading && !hasAnyData) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
            <Activity className="h-6 w-6" />
          </span>
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('reports_activityEmptyTitle')}</h3>
          <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">{t('reports_activityEmptyDesc')}</p>
        </CardContent>
      </Card>
    );
  }

  // Header + unified toolbar — shared across the normal and audit-off layouts.
  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight">{t('reports_activityTitle')}</h2>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{t('reports_activitySubtitle')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[150px]" aria-label={t('reports_activityRangeLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{t(r.key as any)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={refresh} disabled={loading} className="gap-2">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          {t('reports_refresh')}
        </Button>
      </div>
    </div>
  );

  // Test-activity chart — sourced from test-data timestamps, NOT the audit log,
  // so it stays meaningful (and is shown) even when audit logging is paused.
  const chartCard = (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold tracking-tight">{t('reports_activityChartTitle')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('reports_activityChartSubtitle')}</p>
          </div>
          {chart.hasSignal && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5">
              <ChartTotal color="bg-emerald-500" label={t('reports_activityLegendAdded')} value={chart.totals.added} />
              <ChartTotal color="bg-blue-500" label={t('reports_activityLegendModified')} value={chart.totals.modified} />
              <ChartTotal color="bg-violet-500" label={t('reports_activityLegendExecuted')} value={chart.totals.executed} />
            </div>
          )}
        </div>

        {loading && !testActivity ? (
          <div className="flex h-72 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : !chart.hasSignal ? (
          <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <Activity className="mb-2 h-8 w-8 text-gray-400" />
            {t('reports_activityNoChart')}
          </div>
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart.points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="currentColor" className="text-gray-200 dark:text-gray-700" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-400" dy={6} interval="preserveStartEnd" minTickGap={28} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-400" width={36} />
                  <Tooltip
                    cursor={{ fill: 'currentColor', className: 'text-gray-100 dark:text-gray-700', fillOpacity: 0.4 }}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                  />
                  <Bar dataKey="added" name={t('reports_activityLegendAdded')} stackId="a" fill="#10b981" maxBarSize={28} />
                  <Bar dataKey="modified" name={t('reports_activityLegendModified')} stackId="a" fill="#3b82f6" maxBarSize={28} />
                  <Bar dataKey="executed" name={t('reports_activityLegendExecuted')} stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartLegend
              items={[
                { color: 'bg-emerald-500', label: t('reports_activityLegendAdded') },
                { color: 'bg-blue-500', label: t('reports_activityLegendModified') },
                { color: 'bg-violet-500', label: t('reports_activityLegendExecuted') },
              ]}
            />
          </>
        )}
        {/* Source note — resolves the apparent contradiction of a populated chart
            sitting next to audit-driven panels that read zero. */}
        <p className="mt-3 text-center text-xs text-gray-400 dark:text-gray-500">{t('reports_activityChartSource')}</p>
      </CardContent>
    </Card>
  );

  // Audit logging is entirely off → the audit-driven panels would only show
  // misleading zeros. Show an honest explanation (plus the still-valid chart)
  // instead of a wall of empty states.
  if (audit.off) {
    return (
      <div className="space-y-6">
        {header}
        <AuditPausedBanner t={t} isAdmin={isAdmin} />
        {chartCard}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {/* Partial-mute notice: some resource types aren't being logged, so the
          breakdowns below are incomplete. */}
      {audit.disabled.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-200/80">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('reports_activityAuditPartial', { entities: audit.disabled.map(humanize).join(', ') })}</span>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile
          icon={<Activity className="h-4 w-4" />}
          tone="blue"
          label={t('reports_activityKpiTotal')}
          hint={t('reports_activityKpiTotalHint')}
          value={stats.total}
          loading={loading}
        />
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          tone="violet"
          label={t('reports_activityKpiContributors')}
          hint={t('reports_activityKpiContributorsHint')}
          value={stats.contributors}
          loading={loading}
        />
        <KpiTile
          icon={<Plus className="h-4 w-4" />}
          tone="emerald"
          label={t('reports_activityKpiCreated')}
          value={stats.created}
          loading={loading}
        />
        <KpiTile
          icon={<Edit3 className="h-4 w-4" />}
          tone="blue"
          label={t('reports_activityKpiUpdated')}
          value={stats.updated}
          loading={loading}
        />
        <KpiTile
          icon={<Minus className="h-4 w-4" />}
          tone="rose"
          label={t('reports_activityKpiDeleted')}
          value={stats.deleted}
          loading={loading}
        />
      </div>

      {/* Test activity chart */}
      {chartCard}

      {/* Breakdown grid: by action + by resource */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BreakdownCard
          t={t}
          title={t('reports_activityByActionTitle')}
          loading={loading}
          loadingKey="reports_loadingActivityStats"
          emptyKey="reports_noActionsRecorded"
          isEmpty={stats.activityCounts.length === 0}
        >
          {stats.activityCounts.map((a) => {
            const count = Number(a.count || 0);
            const tone = ACTION_TONE[String(a.action || '').toLowerCase()] || DEFAULT_TONE;
            return (
              <BreakdownRow
                key={a.action}
                icon={<ActionGlyph action={String(a.action || '')} />}
                label={humanize(String(a.action || ''))}
                count={count}
                share={stats.share(count)}
                barWidth={(count / stats.maxAction) * 100}
                barClass={tone.bar}
              />
            );
          })}
        </BreakdownCard>

        <BreakdownCard
          t={t}
          title={t('reports_activityByEntityTitle')}
          loading={loading}
          loadingKey="reports_loadingActivityStats"
          emptyKey="reports_noEntitiesRecorded"
          isEmpty={stats.entityCounts.length === 0}
        >
          {stats.entityCounts.map((e) => {
            const count = Number(e.count || 0);
            return (
              <BreakdownRow
                key={e.entity_type}
                icon={ENTITY_ICONS[String(e.entity_type || '').toLowerCase()] ?? <Package className="h-4 w-4" />}
                label={humanize(String(e.entity_type || ''))}
                count={count}
                share={stats.share(count)}
                barWidth={(count / stats.maxEntity) * 100}
                barClass="bg-blue-500"
              />
            );
          })}
        </BreakdownCard>
      </div>

      {/* Top contributors */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="mb-4 text-base font-semibold tracking-tight">{t('reports_activityTopContributorsTitle')}</h3>
          {loading && stats.topUsers.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : stats.topUsers.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('reports_activityTopContributorsEmpty')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(() => {
                const maxUser = Math.max(1, Number(stats.topUsers[0]?.activity_count || 0));
                return stats.topUsers.map((user, index) => {
                const count = Number(user.activity_count || 0);
                const name = user.full_name || user.username || `${t('auditUser')} ${user.user_id}`;
                return (
                  <div key={user.user_id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{name}</span>
                        <span className="shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-200">{count}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${(count / maxUser) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
                });
              })()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------- Sub-components ----------------------------- */

// Shown when audit logging is fully off — explains *why* the activity
// statistics are empty and (for admins) links straight to the toggle.
function AuditPausedBanner({ t, isAdmin }: { t: TFunc; isAdmin: boolean }) {
  return (
    <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-900/10">
      <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300">
          <ShieldOff className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">{t('reports_activityAuditOffTitle')}</h3>
          <p className="mt-1 text-sm leading-relaxed text-amber-800/80 dark:text-amber-200/70">
            {isAdmin ? t('reports_activityAuditOffAdminDesc') : t('reports_activityAuditOffDesc')}
          </p>
        </div>
        {isAdmin && (
          <Link
            to="/administrator?tab=audit"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0 gap-2 bg-white dark:bg-transparent')}
          >
            <Settings className="h-4 w-4" />
            {t('reports_activityAuditOffCta')}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function KpiTile({
  icon, label, hint, value, tone, loading,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  value: number;
  tone: 'blue' | 'violet' | 'emerald' | 'rose';
  loading?: boolean;
}) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
  };
  return (
    <Card>
      <CardContent className="flex h-full items-center gap-3 py-4">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>
        <div className="min-w-0">
          {loading ? (
            <span className="block h-6 w-12 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          ) : (
            <p className="text-2xl font-semibold leading-none tracking-tight">{value}</p>
          )}
          <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={hint || label}>{hint || label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTotal({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2.5 w-2.5 rounded-full', color)} />
      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{value}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
    </div>
  );
}

function ChartLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-gray-100 pt-4 dark:border-gray-800">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', item.color)} />
          <span className="text-xs text-gray-600 dark:text-gray-400">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function BreakdownCard({
  t, title, children, loading, loadingKey, emptyKey, isEmpty,
}: {
  t: TFunc;
  title: string;
  children: React.ReactNode;
  loading: boolean;
  loadingKey: string;
  emptyKey: string;
  isEmpty: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="mb-4 text-base font-semibold tracking-tight">{title}</h3>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t(loadingKey as any)}
          </div>
        ) : isEmpty ? (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t(emptyKey as any)}</p>
        ) : (
          <div className="space-y-3.5">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function BreakdownRow({
  icon, label, count, share, barWidth, barClass,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  share: number;
  barWidth: number;
  barClass: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-gray-300">
          <span className="shrink-0 text-gray-400">{icon}</span>
          <span className="truncate text-sm capitalize">{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-gray-400">{share}%</span>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{count}</span>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className={cn('h-full rounded-full transition-all', barClass)} style={{ width: `${Math.max(2, Math.min(100, barWidth))}%` }} />
      </div>
    </div>
  );
}

function ActionGlyph({ action }: { action: string }) {
  const tone = ACTION_TONE[action.toLowerCase()] || DEFAULT_TONE;
  const icon =
    action.toLowerCase() === 'create' ? <Plus className="h-3 w-3" />
    : action.toLowerCase() === 'update' || action.toLowerCase() === 'edit' ? <Edit3 className="h-3 w-3" />
    : action.toLowerCase() === 'delete' ? <Minus className="h-3 w-3" />
    : action.toLowerCase() === 'execute' ? <Play className="h-3 w-3" />
    : <Activity className="h-3 w-3" />;
  return <span className={cn('flex h-5 w-5 items-center justify-center rounded-md', tone.chip)}>{icon}</span>;
}
