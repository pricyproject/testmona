import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { environmentsAPI } from '@/lib/api';

// Centralised query keys for the environments domain so every consumer
// (queries + cache invalidation after mutations) refers to the same cache slot.
export const environmentKeys = {
  all: ['environments'] as const,
  list: (projectId: number | null) => ['environments', 'list', projectId] as const,
  detail: (id: number) => ['environments', 'detail', id] as const,
};

export function useEnvironments(projectId: number | null) {
  return useQuery({
    queryKey: environmentKeys.list(projectId),
    // Only fetch when a project is selected; otherwise resolve to an empty list.
    queryFn: () => (projectId ? environmentsAPI.getAll(projectId) : Promise.resolve([])),
  });
}

export function useCreateEnvironment(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (environment: any) => environmentsAPI.create(environment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.list(projectId) });
    },
  });
}

export function useUpdateEnvironment(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, environment }: { id: number; environment: any }) =>
      environmentsAPI.update(id, environment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.list(projectId) });
    },
  });
}

export function useDeleteEnvironment(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => environmentsAPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.list(projectId) });
    },
  });
}
