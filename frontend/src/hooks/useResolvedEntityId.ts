import { useEffect, useState } from 'react';
import { seqAPI } from '@/lib/api';

/**
 * Resolve a project-first URL number (the per-project `project_seq`, e.g. the `1`
 * in `/projects/2/requirements/1`) to the global entity id that the detail and
 * sub-resource APIs are keyed on.
 *
 * While the lookup is in flight `id` is `NaN` (so the pages' existing
 * `Number.isFinite` / `!id` guards naturally wait); callers also have `loading`.
 * If the number isn't a per-project sequence (legacy bookmark, or a row not yet
 * numbered) the resolver falls back to treating it as a global id, so old links keep
 * working. A non-numeric param (e.g. a requirement key like `REQ-001`) yields `NaN`;
 * pages that accept string keys handle that case themselves.
 */
export function useResolvedEntityId(
  projectId: number | string | undefined,
  entity: string,
  rawParam: string | number | undefined,
): { id: number; loading: boolean } {
  const [id, setId] = useState<number>(NaN);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const pid = Number(projectId);
    const seq = Number(rawParam);
    if (!Number.isInteger(seq) || seq <= 0 || !Number.isFinite(pid)) {
      setId(NaN);
      setLoading(false);
      return;
    }
    setLoading(true);
    seqAPI
      .resolve(pid, entity, seq)
      .then((resolved) => {
        if (!cancelled) {
          setId(resolved);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setId(seq);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entity, rawParam]);

  return { id, loading };
}
