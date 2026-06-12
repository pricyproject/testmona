import { useQuery } from '@tanstack/react-query';
import { requirementsAPI, requirementFoldersAPI } from '@/lib/api';

export const requirementKeys = {
  list: (projectId: number | null, milestoneId: number | null | undefined) =>
    ['requirements', 'list', projectId, milestoneId ?? null] as const,
  folders: (projectId: number | null) => ['requirements', 'folders', projectId] as const,
};

// Requirements list + coverage map. Coverage is best-effort: a failure there
// must not block the list from rendering.
export function useRequirementsList(
  projectId: number | null,
  milestoneId: number | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: requirementKeys.list(projectId, milestoneId),
    queryFn: async () => {
      const [data, coverage] = await Promise.all([
        requirementsAPI.getAll(projectId as number, 0, 1000, { milestoneId }),
        requirementsAPI.coverage(projectId as number).catch(() => ({ items: [] as any[] })),
      ]);
      const coverageMap: Record<number, any> = {};
      for (const item of coverage.items) coverageMap[item.requirement_id] = item;
      return { requirements: (Array.isArray(data) ? data : []) as any[], coverageMap };
    },
    enabled,
  });
}

export function useRequirementFolders(projectId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: requirementKeys.folders(projectId),
    queryFn: async () => {
      const list = await requirementFoldersAPI.list(projectId as number);
      return (Array.isArray(list) ? list : []) as any[];
    },
    enabled,
  });
}
