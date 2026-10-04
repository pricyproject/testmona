import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { docsAPI } from '@/lib/api';
import type { Doc, DocFeedback, DocFeedbackType } from '@/types';

export const docDetailKeys = {
  detail: (docId: number | null) => ['docDetail', docId] as const,
  // `canEdit` is part of the key because it changes what the queryFn fetches (the
  // editor-only items list). The mutations invalidate by the `[…, 'feedback']`
  // prefix, so both canEdit/includeResolved variants are still caught.
  feedback: (docId: number | null, canEdit: boolean, includeResolved: boolean) =>
    ['docDetail', docId, 'feedback', canEdit, includeResolved] as const,
};

// Settles to `null` instead of throwing so one failing side panel can't take the
// whole document down — but the caller can still tell "it failed" from "it's empty",
// which a bare `.catch(() => null)` erased.
const settle = async <T,>(p: Promise<T>): Promise<{ data: T | null; failed: boolean }> =>
  p.then((data) => ({ data, failed: false })).catch(() => ({ data: null, failed: true }));

// Primary document bundle: the doc plus the side panels (space, requirement
// links, stats) loaded alongside it.
export function useDocDetail(docId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: docDetailKeys.detail(docId),
    queryFn: async () => {
      // Throws on failure, so a 500 surfaces as an error rather than "not found".
      const data = await docsAPI.get(docId as number);
      const [space, links, stats] = await Promise.all([
        settle(docsAPI.getSpace(data.space_id)),
        settle(docsAPI.listRequirementLinks(data.id)),
        data.can_view_stats
          ? settle(docsAPI.getStats(data.id))
          : Promise.resolve({ data: null, failed: false }),
      ]);
      return {
        doc: data,
        space: space.data,
        links: (links.data ?? []) as Awaited<ReturnType<typeof docsAPI.listRequirementLinks>>,
        stats: stats.data,
        panelsFailed: space.failed || links.failed || stats.failed,
        linksFailed: links.failed,
        statsFailed: stats.failed,
      };
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
    queryKey: docDetailKeys.feedback(docId, canEdit, includeResolved),
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: docDetailKeys.detail(docId) }),
  });
}

export function useDeleteDoc(docId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => docsAPI.remove(docId as number),
    // Either way the cached bundle is stale: gone on success, possibly still listed
    // on failure. Back-navigation must not render a deleted doc's cached body.
    onSettled: () => {
      queryClient.removeQueries({ queryKey: docDetailKeys.detail(docId) });
      queryClient.invalidateQueries({ queryKey: docDetailKeys.detail(docId) });
    },
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
