import {
  CheckCircle, XCircle, AlertCircle, Clock, TrendingUp, TrendingDown, Activity,
} from 'lucide-react';

// The reports page is organised around three user-task sections rather than one
// tab per backing report. Each section pulls together several analytics queries.
export type SectionKey = 'overview' | 'coverage-risk' | 'activity';

// Each section is reachable at /projects/:projectId/reports/:section. This is the
// source of truth for which URL slugs are valid section routes.
export const SECTION_KEYS: SectionKey[] = ['overview', 'coverage-risk', 'activity'];

export const isSectionKey = (value: string | undefined): value is SectionKey =>
  !!value && (SECTION_KEYS as string[]).includes(value);

// Fine-grained loading keys — one per backing query — so each panel can show its
// own spinner independently of the others in the same section.
export type LoadKey =
  | 'dashboard'
  | 'granular'
  | 'shareable'
  | 'traceability'
  | 'coverage'
  | 'activity'
  | 'test-activity';

export interface DashboardWidgetDef {
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
export const DEFAULT_WIDGETS: DashboardWidgetDef[] = [
  { id: 'coverage', title: 'reports_widgetTitleCoverage', type: 'kpi', size: 'large', position: { x: 0, y: 0 } },
  { id: 'passRate', title: 'reports_widgetTitlePassRate', type: 'kpi', size: 'medium', position: { x: 1, y: 0 } },
  { id: 'failureTrends', title: 'reports_widgetTitleFailureTrends', type: 'chart', size: 'medium', position: { x: 0, y: 1 } },
  { id: 'flakiness', title: 'reports_widgetTitleFlakiness', type: 'chart', size: 'medium', position: { x: 1, y: 1 } },
  { id: 'cycleTime', title: 'reports_widgetTitleCycleTime', type: 'kpi', size: 'medium', position: { x: 0, y: 2 } },
  { id: 'defectDensity', title: 'reports_widgetTitleDefectDensity', type: 'kpi', size: 'medium', position: { x: 1, y: 2 } },
];

export const widgetLayoutKey = (projectId: number) => `reports.dashboardWidgets.v2.${projectId}`;

export const loadWidgetLayout = (projectId: number): DashboardWidgetDef[] => {
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

export const saveWidgetLayout = (projectId: number, widgets: { id: string }[]): boolean => {
  try {
    localStorage.setItem(widgetLayoutKey(projectId), JSON.stringify(widgets.map((w) => w.id)));
    return true;
  } catch {
    return false;
  }
};

// Sentinel widget_type used to mark the layout-config row in dashboard_widgets.
export const LAYOUT_WIDGET_TYPE = '__layout__';

// Reconcile a saved id list against the current DEFAULT_WIDGETS so the layout
// gracefully handles widgets added or removed in newer builds.
export const reconcileLayoutIds = (savedIds: unknown): DashboardWidgetDef[] => {
  if (!Array.isArray(savedIds)) return DEFAULT_WIDGETS;
  const byId = new Map(DEFAULT_WIDGETS.map((w) => [w.id, w]));
  const ordered = savedIds
    .map((id) => byId.get(String(id)))
    .filter((w): w is DashboardWidgetDef => Boolean(w));
  const missing = DEFAULT_WIDGETS.filter((w) => !(savedIds as string[]).includes(w.id));
  return ordered.length ? [...ordered, ...missing] : DEFAULT_WIDGETS;
};

export const normalizeStatus = (status?: string) => {
  const statusMap: Record<string, string> = {
    pass: 'passed',
    fail: 'failed',
    block: 'blocked',
    skip: 'skipped',
  };
  const normalized = (status || '').toLowerCase();
  return statusMap[normalized] || normalized || 'not_started';
};

export const getStatusIcon = (status: string) => {
  switch (normalizeStatus(status)) {
    case 'passed': return <CheckCircle className="h-4 w-4 text-green-600" />;
    case 'failed': return <XCircle className="h-4 w-4 text-red-600" />;
    case 'blocked': return <AlertCircle className="h-4 w-4 text-yellow-600" />;
    case 'skipped': return <Clock className="h-4 w-4 text-blue-600" />;
    default: return <AlertCircle className="h-4 w-4 text-gray-400" />;
  }
};

export const getTrendIcon = (trend: string) => {
  if (trend === 'up') return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-600" />;
  return <Activity className="h-4 w-4 text-gray-500" />;
};
