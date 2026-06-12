import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { matrixRunsAPI, testSuitesAPI, environmentsAPI, testCasesAPI } from '@/lib/api';
import type { TestCase } from '@/types';

export const matrixRunKeys = {
  all: ['matrixRuns'] as const,
  list: (projectId: number | null) => ['matrixRuns', 'list', projectId] as const,
};

export function useMatrixRuns(projectId: number | null) {
  return useQuery({
    queryKey: matrixRunKeys.list(projectId),
    queryFn: () => matrixRunsAPI.getAll(projectId as number),
    enabled: projectId != null,
  });
}

// Suite + environment option lists for the create dialog; only fetched while
// the dialog is open.
export function useMatrixCreateOptions(projectId: number | null, enabled: boolean) {
  const ready = enabled && projectId != null;
  const suites = useQuery({
    queryKey: ['matrixRuns', 'suiteOptions', projectId],
    queryFn: () => testSuitesAPI.getAll(projectId as number),
    enabled: ready,
  });
  const environments = useQuery({
    queryKey: ['matrixRuns', 'envOptions', projectId],
    queryFn: () => environmentsAPI.getAll(projectId as number),
    enabled: ready,
  });
  return { suites, environments };
}

export function useSuiteCases(projectId: number | null, suiteId: number | null) {
  return useQuery({
    queryKey: ['matrixRuns', 'suiteCases', projectId, suiteId],
    queryFn: () =>
      testCasesAPI.getAll(projectId as number, suiteId as number, undefined, 'id', 'asc', 0, 500) as Promise<TestCase[]>,
    enabled: projectId != null && suiteId != null,
  });
}

export function useCreateMatrixRun(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: any) => matrixRunsAPI.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: matrixRunKeys.list(projectId) }),
  });
}

export function useDeleteMatrixRun(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => matrixRunsAPI.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: matrixRunKeys.list(projectId) }),
  });
}
