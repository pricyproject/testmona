import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sharedStepsAPI } from '@/lib/api';
import type { SharedStep, SharedStepCreate } from '@/types';

export const sharedStepKeys = {
  all: ['sharedSteps'] as const,
  list: (projectId: number | undefined) => ['sharedSteps', 'list', projectId] as const,
};

export function useSharedSteps(projectId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: sharedStepKeys.list(projectId),
    queryFn: ({ signal }) => sharedStepsAPI.getAll(projectId as number, 0, 100, signal) as Promise<SharedStep[]>,
    enabled,
  });
}

export function useCreateSharedStep(projectId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SharedStepCreate) => sharedStepsAPI.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sharedStepKeys.list(projectId) }),
  });
}

export function useUpdateSharedStep(projectId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SharedStepCreate> }) =>
      sharedStepsAPI.update(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sharedStepKeys.list(projectId) }),
  });
}

export function useDeleteSharedStep(projectId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => sharedStepsAPI.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sharedStepKeys.list(projectId) }),
  });
}
