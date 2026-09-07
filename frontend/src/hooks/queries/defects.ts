import { useQuery } from '@tanstack/react-query';
import { defectsAPI } from '@/lib/api';

export const defectKeys = {
  list: (projectId: number | null, milestoneId: number | null | undefined) =>
    ['defects', 'list', projectId, milestoneId ?? null] as const,
  formData: (projectId: number | null) => ['defects', 'formData', projectId] as const,
};

const PAGE_SIZE = 200;
// Guard against a runaway loop if the server ever ignores `skip`.
const MAX_PAGES = 100;

/**
 * Every defect in the project. The page filters, sorts, counts and paginates
 * client-side, so a single capped request would silently drop defects past the
 * cap from the board columns, the summary tiles and the search results — this
 * pages through until the server returns a short page.
 */
export function useDefectsList(
  projectId: number | null,
  milestoneId: number | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: defectKeys.list(projectId, milestoneId),
    queryFn: async () => {
      const all: any[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const rows = await defectsAPI.getAll(projectId as number, page * PAGE_SIZE, PAGE_SIZE, {
          milestoneId,
        });
        const batch = Array.isArray(rows) ? rows : [];
        all.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      }
      return all;
    },
    enabled,
  });
}
