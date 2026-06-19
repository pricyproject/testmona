import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { usersAPI, type EffectivePermissions } from '@/lib/api';
import { canWrite as globalCanWrite, isAdminUser } from '@/utils/roles';

/**
 * Project-aware permissions for the current user.
 *
 * Capabilities depend on the user's *effective role in a specific project*: a
 * globally read-only viewer elevated to tester/manager in a project can write
 * (and delete test content) there, while a tester can write everywhere but only
 * delete test content — not project structure. We get the authoritative answer
 * from `/users/me/permissions` (`projects[projectId]` permission set) instead of
 * hardcoding the role table client-side.
 *
 * UX gating only — the backend remains the security boundary. When `projectId`
 * is null/undefined this falls back to the user's global permission set.
 */
export function useProjectPermissions(projectId?: number | null) {
  const user = useAuthStore((state) => state.user);

  const { data: permissions } = useQuery<EffectivePermissions>({
    queryKey: ['myPermissions', user?.id],
    queryFn: () => usersAPI.getMyPermissions(),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const projectPerms =
    projectId != null ? permissions?.projects?.[projectId] : undefined;
  const effective = new Set(projectPerms ?? permissions?.global ?? []);

  // Fall back to the role-derived viewer gate until the permission set loads so
  // controls don't flicker (and admins/managers never get wrongly hidden).
  const baseCanWrite = globalCanWrite(user);

  return {
    user,
    isAdmin: isAdminUser(user),
    canWrite: permissions ? effective.has('write') : baseCanWrite,
    canDelete: effective.has('delete'),
    canExecute: effective.has('execute') || effective.has('write'),
    canManageProject: effective.has('manage_projects'),
    permissions,
  };
}
