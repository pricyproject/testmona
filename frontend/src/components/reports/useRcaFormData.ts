import { useQuery } from '@tanstack/react-query';
import {
  defectsAPI,
  requirementsAPI,
  testCasesAPI,
  projectAssignmentsAPI,
} from '@/lib/api';
import type { RcaFormData } from './RootCauseAnalysisModal';

const PAGE_SIZE = 100;

async function loadAll<T>(fetchPage: (skip: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await fetchPage(skip);
    const rows = Array.isArray(page) ? page : [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
}

const EMPTY: RcaFormData = { defects: [], requirements: [], testCases: [], members: [] };

/**
 * Linked-entity + member lookups backing the RCA modal's searchable selects.
 * Loaded lazily (when `enabled`, e.g. on first dialog open) and cached per
 * project, so opening the modal repeatedly doesn't re-fetch.
 */
export function useRcaFormData(projectId: number | null | undefined, enabled: boolean) {
  const query = useQuery<RcaFormData>({
    queryKey: ['rca', 'formData', projectId],
    enabled: !!enabled && !!projectId,
    staleTime: 60_000,
    queryFn: async () => {
      const pid = projectId as number;
      const [defects, requirements, testCases, memberRows] = await Promise.all([
        loadAll((skip) => defectsAPI.getAll(pid, skip, PAGE_SIZE)).catch(() => []),
        loadAll((skip) => requirementsAPI.getAll(pid, skip, PAGE_SIZE)).catch(() => []),
        loadAll((skip) =>
          testCasesAPI.getAll(pid, undefined, undefined, 'id', 'asc', skip, PAGE_SIZE),
        ).catch(() => []),
        projectAssignmentsAPI.listMembers(pid).catch(() => []),
      ]);
      const members = (Array.isArray(memberRows) ? memberRows : []).map((m: any) => ({
        id: m.user_id,
        name: m.full_name || m.username || m.email || `User ${m.user_id}`,
      }));
      return { defects, requirements, testCases, members };
    },
  });

  return { formData: query.data ?? EMPTY, isLoading: query.isLoading };
}
