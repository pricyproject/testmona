import { useQuery } from '@tanstack/react-query';
import { defectsAPI } from '@/lib/api';

export const defectKeys = {
  list: (projectId: number | null, milestoneId: number | null | undefined) =>
    ['defects', 'list', projectId, milestoneId ?? null] as const,
  formData: (projectId: number | null) => ['defects', 'formData', projectId] as const,
};

export function useDefectsList(
  projectId: number | null,
  milestoneId: number | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: defectKeys.list(projectId, milestoneId),
    queryFn: () => defectsAPI.getAll(projectId as number, 0, 500, { milestoneId }),
    enabled,
  });
}
