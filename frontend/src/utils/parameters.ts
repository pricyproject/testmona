// Parameter resolution shared across the test-case lifecycle.
//
// Test step text can reference reusable values via `${name}` placeholders. Two
// sources feed those placeholders:
//   - Global parameters: project-wide constants (single key->value), resolved
//     the same way everywhere the case is shown or executed.
//   - Dataset rows: per-iteration values that override a same-named global
//     parameter during a data-driven run.
// Unknown placeholders are always left untouched so the author still sees the
// template.

import { globalParametersAPI, type GlobalParameter } from '@/lib/api';

export type ParameterMap = Record<string, string>;

// `${ name }` — leading/trailing whitespace inside the braces is tolerated.
const PLACEHOLDER = /\$\{([^}]+)\}/g;

/** Build a name->value map from a list of global parameters. */
export function paramsToMap(params: GlobalParameter[]): ParameterMap {
  const map: ParameterMap = {};
  for (const p of params) {
    if (p && p.is_active !== false && p.name) map[p.name] = p.value ?? '';
  }
  return map;
}

/**
 * Replace `${name}` placeholders in `text` with values from `map`. Unknown
 * placeholders are returned verbatim.
 */
export function resolveParameters(text: string | null | undefined, map: ParameterMap): string {
  if (!text) return text || '';
  if (!map || Object.keys(map).length === 0) return text;
  return text.replace(PLACEHOLDER, (match, key) => {
    const k = String(key).trim();
    return Object.prototype.hasOwnProperty.call(map, k) ? (map[k] ?? '') : match;
  });
}

/** Distinct placeholder keys referenced in `text` (in first-seen order). */
export function referencedKeys(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const k = String(m[1]).trim();
    if (k && !seen.includes(k)) seen.push(k);
  }
  return seen;
}

/**
 * Load global parameters usable for resolution within a project: the project's
 * own parameters plus, best-effort, cross-project globals — with project values
 * overriding global ones of the same name. Cross-project globals are admin-only
 * to read, so that request is allowed to fail silently for regular members.
 */
export async function loadProjectParameters(projectId: number): Promise<GlobalParameter[]> {
  const [projectParams, globalParams] = await Promise.all([
    globalParametersAPI.list(projectId).catch(() => [] as GlobalParameter[]),
    globalParametersAPI.list().catch(() => [] as GlobalParameter[]),
  ]);
  // Project params override cross-project globals of the same name.
  const byName = new Map<string, GlobalParameter>();
  for (const p of globalParams) byName.set(p.name, p);
  for (const p of projectParams) byName.set(p.name, p);
  return Array.from(byName.values());
}
