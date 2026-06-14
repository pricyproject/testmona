import { useQuery } from '@tanstack/react-query';
import { projectAssignmentsAPI } from '@/lib/api';
import { defectManagementAPI, type DefectComment } from '@/lib/defectManagementAPI';
import type { MemberOption } from '@/components/comments/MentionTextarea';

export const defectCommentKeys = {
  list: (projectId: number, defectId: number) => ['defectComments', projectId, defectId] as const,
  members: (projectId: number) => ['defectComments', 'members', projectId] as const,
};

export function useDefectComments(projectId: number, defectId: number, enabled: boolean) {
  return useQuery({
    queryKey: defectCommentKeys.list(projectId, defectId),
    queryFn: () => defectManagementAPI.getDefectComments(projectId, defectId) as Promise<DefectComment[]>,
    enabled,
  });
}

// Project members for @mention autocomplete (best-effort; de-duped + filtered to
// this project, matching the requirement comment members loader).
export function useDefectCommentMembers(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: defectCommentKeys.members(projectId),
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
