/**
 * Shared URL-state contract for project list pages.
 *
 * Every filter-driven list reads the same parameter names so a link from a
 * dashboard, report or saved view can reproduce the view that produced it:
 *
 *   Filter params (default `all`, omitted when at the default):
 *     status, severity, priority, attention, coverage
 *
 *   Scope params (positive integer, omitted when absent):
 *     plan_id, requirement_id, milestone_id
 *
 *   Action / provenance params:
 *     create=1  open the page's create dialog once
 *     source    CTA that produced the link (e.g. "dashboard", "reports")
 *
 *   View params (where the page supports them):
 *     q, page, sort, dir
 *
 * Pages consume the keys that apply to their entity; the parameter names and
 * normalisation stay identical so CTAs can be built once and reused.
 *
 * `parseListUrlState` normalises the contract, `writeListUrlState` preserves
 * unrelated params and prunes defaults so URLs stay clean and shareable.
 */

export const LIST_FILTER_PARAMS = [
  'status',
  'severity',
  'priority',
  'attention',
  'coverage',
] as const;

export type ListFilterParam = (typeof LIST_FILTER_PARAMS)[number];

export const LIST_FILTER_DEFAULTS: Record<ListFilterParam, string> = {
  status: 'all',
  severity: 'all',
  priority: 'all',
  attention: 'all',
  coverage: 'all',
};

export interface ListUrlState {
  status: string;
  severity: string;
  priority: string;
  attention: string;
  coverage: string;
  planId?: number;
  requirementId?: number;
  milestoneId?: number;
  create: boolean;
  source?: string;
  q: string;
  page: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface ListUrlStateInput extends Partial<Omit<ListUrlState, 'planId' | 'requirementId' | 'milestoneId'>> {
  planId?: number | null;
  requirementId?: number | null;
  milestoneId?: number | null;
}

const DEFAULT_FILTER = 'all';
const DEFAULT_PAGE = 1;

export function parsePositiveQueryNumber(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const normalizeFilter = (value: string | null | undefined): string => {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed !== DEFAULT_FILTER ? trimmed : DEFAULT_FILTER;
};

const normalizeSearch = (value: string | null | undefined): string => value?.trim() ?? '';

const normalizePage = (value: string | null | undefined): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE;
};

const normalizeSortDir = (value: string | null | undefined): 'asc' | 'desc' | undefined => {
  if (value === 'asc' || value === 'desc') return value;
  return undefined;
};

/** Keep a URL filter only when the page knows the value; otherwise fall back. */
export function pickAllowedFilter(
  value: string,
  allowed: readonly string[],
  fallback = DEFAULT_FILTER,
): string {
  return value && allowed.includes(value) ? value : fallback;
}

export function parseListUrlState(params: URLSearchParams): ListUrlState {
  return {
    status: normalizeFilter(params.get('status')),
    severity: normalizeFilter(params.get('severity')),
    priority: normalizeFilter(params.get('priority')),
    attention: normalizeFilter(params.get('attention')),
    coverage: normalizeFilter(params.get('coverage')),
    planId: parsePositiveQueryNumber(params.get('plan_id')),
    requirementId: parsePositiveQueryNumber(params.get('requirement_id')),
    milestoneId: parsePositiveQueryNumber(params.get('milestone_id')),
    create: params.get('create') === '1',
    source: params.get('source')?.trim() || undefined,
    q: normalizeSearch(params.get('q')),
    page: normalizePage(params.get('page')),
    sort: params.get('sort')?.trim() || undefined,
    dir: normalizeSortDir(params.get('dir')),
  };
}

export function writeListUrlState(params: URLSearchParams, state: ListUrlStateInput): URLSearchParams {
  const next = new URLSearchParams(params);

  const syncFilter = (key: ListFilterParam, value: string | undefined) => {
    const normalized = normalizeFilter(value ?? DEFAULT_FILTER);
    if (normalized === DEFAULT_FILTER) next.delete(key);
    else next.set(key, normalized);
  };

  LIST_FILTER_PARAMS.forEach((key) => syncFilter(key, state[key]));

  const syncNumber = (key: string, value: number | null | undefined) => {
    if (value != null && Number.isSafeInteger(value) && value > 0) next.set(key, String(value));
    else next.delete(key);
  };
  syncNumber('plan_id', state.planId);
  syncNumber('requirement_id', state.requirementId);
  syncNumber('milestone_id', state.milestoneId);

  if (state.create) next.set('create', '1');
  else next.delete('create');

  const source = state.source?.trim();
  if (source) next.set('source', source);
  else next.delete('source');

  const query = normalizeSearch(state.q);
  if (query) next.set('q', query);
  else next.delete('q');

  const page = state.page ?? DEFAULT_PAGE;
  if (page > DEFAULT_PAGE) next.set('page', String(page));
  else next.delete('page');

  const sort = state.sort?.trim();
  if (sort) next.set('sort', sort);
  else next.delete('sort');

  if (sort && state.dir) next.set('dir', state.dir);
  else next.delete('dir');

  return next;
}

export function buildListUrl(
  path: string,
  state: ListUrlStateInput,
  extraParams?: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams();
  Object.entries(extraParams ?? {}).forEach(([key, value]) => {
    if (value != null && String(value).trim() !== '') params.set(key, String(value));
  });
  const query = writeListUrlState(params, state).toString();
  return query ? `${path}?${query}` : path;
}
