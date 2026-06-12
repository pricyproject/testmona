import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { defectsAPI, requirementsAPI, projectAssignmentsAPI, testResultsAPI } from '@/lib/api';

export const defectDetailKeys = {
  detail: (defectId: number | null) => ['defectDetail', defectId] as const,
  requirements: (projectId: number | null) => ['defectDetail', 'requirements', projectId] as const,
  members: (projectId: number | null) => ['defectDetail', 'members', projectId] as const,
};

export function useDefectDetail(defectId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: defectDetailKeys.detail(defectId),
    queryFn: ({ signal }) => defectsAPI.getDetail(defectId as number, signal),
    enabled,
  });
}

export function useDefectEditRequirements(projectId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: defectDetailKeys.requirements(projectId),
    queryFn: async () => {
      const items = await requirementsAPI.getAll(projectId as number, 0, 500);
      return Array.isArray(items) ? items : [];
    },
    enabled,
  });
}

export function useDefectProjectMembers(projectId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: defectDetailKeys.members(projectId),
    queryFn: async () => {
      const rows = await projectAssignmentsAPI.listMembers(projectId as number);
      return (Array.isArray(rows) ? rows : []).map((m: any) => ({
        id: m.user_id,
        name: m.full_name || m.username || m.email || `User ${m.user_id}`,
      }));
    },
    enabled,
  });
}

export function useUpdateDefect(defectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => defectsAPI.update(defectId as number, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: defectDetailKeys.detail(defectId) }),
  });
}

export function useUpdateDefectSnapshot(defectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ testResultId, linkId, clearFailingStep }: { testResultId: number; linkId: number; clearFailingStep: boolean }) =>
      testResultsAPI.updateDefectLinkSnapshot(testResultId, linkId, { clear_failing_step: clearFailingStep }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: defectDetailKeys.detail(defectId) }),
  });
}
