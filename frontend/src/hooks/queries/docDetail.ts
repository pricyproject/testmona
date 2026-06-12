import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { docsAPI } from '@/lib/api';
import type { Doc, DocFeedback, DocFeedbackType } from '@/types';

export const docDetailKeys = {
  detail: (docId: number | null) => ['docDetail', docId] as const,
  feedback: (docId: number | null, includeResolved: boolean) =>
    ['docDetail', docId, 'feedback', includeResolved] as const,
};

// Primary document bundle: the doc plus the side panels (space, requirement
// links, stats) loaded alongside it.
export function useDocDetail(docId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: docDetailKeys.detail(docId),
    queryFn: async () => {
      const data = await docsAPI.get(docId as number);
      const [space, links, stats] = await Promise.all([
        docsAPI.getSpace(data.space_id).catch(() => null),
        docsAPI.listRequirementLinks(data.id).catch(() => []),
        data.can_view_stats ? docsAPI.getStats(data.id).catch(() => null) : Promise.resolve(null),
      ]);
      return { doc: data, space, links, stats };
    },
    enabled,
  });
}

// Feedback summary + (editor-only) item list. Re-fetches when the
// include-resolved toggle changes.
export function useDocFeedback(
  docId: number | null,
  canEdit: boolean,
  includeResolved: boolean,
  enabled: boolean,
) {
  return useQuery({
    queryKey: docDetailKeys.feedback(docId, includeResolved),
    queryFn: async () => {
      const [summary, items] = await Promise.all([
        docsAPI.getFeedback(docId as number),
        canEdit ? docsAPI.listFeedback(docId as number, includeResolved) : Promise.resolve([]),
      ]);
      return { summary, items: items as DocFeedback[] };
    },
    enabled,
  });
}

export function useUpdateDoc(docId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => docsAPI.update(docId as number, payload),
    onSuccess: (updated: Doc) => {
      // Patch the cached bundle in place so the page reflects the change without a refetch.
      queryClient.setQueryData(docDetailKeys.detail(docId), (prev: any) =>
        prev ? { ...prev, doc: updated } : prev,
      );
    },
  });
}

export function useDeleteDoc(docId: number | null) {
  return useMutation({
    mutationFn: () => docsAPI.remove(docId as number),
  });
}

export function useSubmitDocFeedback(docId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { feedback_type: DocFeedbackType; comment: string | null; section_text: string | null }) =>
      docsAPI.submitFeedback(docId as number, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['docDetail', docId, 'feedback'] }),
  });
}

export function useClearDocFeedback(docId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => docsAPI.deleteFeedback(docId as number),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['docDetail', docId, 'feedback'] }),
  });
}

export function useResolveDocFeedback(docId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ feedbackId, resolved }: { feedbackId: number; resolved: boolean }) =>
      docsAPI.resolveFeedback(docId as number, feedbackId, resolved),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['docDetail', docId, 'feedback'] }),
  });
}
