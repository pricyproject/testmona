import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tagsAPI } from '@/lib/api';
import type { Tag } from '@/types';

// Centralised query keys for the test-case tag catalog so queries and
// post-mutation invalidation share the same cache slot.
export const tagKeys = {
  all: ['tags'] as const,
  list: (projectId: number | null) => ['tags', 'list', projectId] as const,
};

export function useProjectTags(projectId: number | null) {
  return useQuery<Tag[]>({
    queryKey: tagKeys.list(projectId),
    queryFn: () => (projectId ? tagsAPI.getAll(projectId) : Promise.resolve([])),
    enabled: projectId != null,
  });
}

// Mutations invalidate both the tag catalog and any test-case lists, since
// renaming/merging/deleting a tag changes how cases render.
function useTagMutationInvalidation(projectId: number | null) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: tagKeys.list(projectId) });
    queryClient.invalidateQueries({ queryKey: ['testCases'] });
    queryClient.invalidateQueries({ queryKey: ['test-cases'] });
  };
}

export function useCreateTag(projectId: number | null) {
  const invalidate = useTagMutationInvalidation(projectId);
  return useMutation({
    mutationFn: (tag: { project_id: number; name: string; color?: string; description?: string }) =>
      tagsAPI.create(tag),
    onSuccess: invalidate,
  });
}

export function useUpdateTag(projectId: number | null) {
  const invalidate = useTagMutationInvalidation(projectId);
  return useMutation({
    mutationFn: ({ id, tag }: { id: number; tag: { name?: string; color?: string; description?: string; is_active?: boolean } }) =>
      tagsAPI.update(id, tag),
    onSuccess: invalidate,
  });
}

export function useDeleteTag(projectId: number | null) {
  const invalidate = useTagMutationInvalidation(projectId);
  return useMutation({
    mutationFn: (id: number) => tagsAPI.remove(id),
    onSuccess: invalidate,
  });
}

export function useMergeTags(projectId: number | null) {
  const invalidate = useTagMutationInvalidation(projectId);
  return useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number }) => tagsAPI.merge(id, targetId),
    onSuccess: invalidate,
  });
}
