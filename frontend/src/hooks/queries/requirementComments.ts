import { useQuery } from '@tanstack/react-query';
import { requirementsAPI, projectAssignmentsAPI } from '@/lib/api';
import type { RequirementComment } from '@/types';

interface MemberOption {
  user_id: number;
  username: string;
  full_name?: string | null;
}

export const requirementCommentKeys = {
  list: (requirementId: number) => ['requirementComments', requirementId] as const,
  members: (projectId: number) => ['requirementComments', 'members', projectId] as const,
};

export function useRequirementComments(requirementId: number, enabled: boolean) {
  return useQuery({
    queryKey: requirementCommentKeys.list(requirementId),
    queryFn: () => requirementsAPI.listComments(requirementId) as Promise<RequirementComment[]>,
    enabled,
  });
}

// Project members for @mention autocomplete (best-effort; de-duped + filtered to
// this project, matching the previous inline loader).
export function useRequirementCommentMembers(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: requirementCommentKeys.members(projectId),
    queryFn: async () => {
      const rows: any[] = await projectAssignmentsAPI.listMembers(projectId);
      const seen = new Set<number>();
      return rows.reduce<MemberOption[]>((acc, r) => {
        if (Number(r.project_id) !== projectId || !r.user_id || !r.username || seen.has(r.user_id)) {
          return acc;
        }
        seen.add(r.user_id);
        acc.push({ user_id: r.user_id, username: r.username, full_name: r.full_name });
        return acc;
      }, []);
    },
    enabled,
  });
}
