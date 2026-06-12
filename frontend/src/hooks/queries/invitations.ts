import { useMutation, useQuery } from '@tanstack/react-query';
import { invitationsAPI } from '@/lib/api';
import type { InvitationAcceptPayload } from '@/lib/api';

export const invitationKeys = {
  all: ['invitations'] as const,
  detail: (token: string | undefined) => ['invitations', 'detail', token] as const,
};

export function useInvitation(token: string | undefined) {
  return useQuery({
    queryKey: invitationKeys.detail(token),
    queryFn: () => invitationsAPI.getByToken(token as string),
    enabled: Boolean(token),
    // An invitation token is single-shot context; don't auto-refetch it.
    retry: false,
    staleTime: Infinity,
  });
}

export function useAcceptInvitation(token: string | undefined) {
  return useMutation({
    mutationFn: (payload: InvitationAcceptPayload) => invitationsAPI.accept(token as string, payload),
  });
}
