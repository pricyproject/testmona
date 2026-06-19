import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { usersAPI, type EffectivePermissions } from '@/lib/api';
import { canWrite, isAdminUser, isViewerRole } from '@/utils/roles';

/**
 * Central role-derived permissions for the current user.
 *
 * UX gating only — the backend is the security boundary (viewers are blocked from
 * all non-self-service writes by the read-only guard in `app/auth.py`). Use this to
 * hide/disable create/edit/delete/execute controls so users don't trigger 403s.
 *
 * `canWrite`/`isViewer`/`isAdmin` are derived from the user's global role (no
 * request needed). `canDelete`/`canExecute`/`canManageProject` reflect the user's
 * effective **global** permission set fetched from `/users/me/permissions` (the
 * server is the source of truth — we no longer mirror the role table client-side).
 * For project-scoped decisions use {@link useProjectPermissions}.
 */
export function usePermissions() {
  const user = useAuthStore((state) => state.user);

  const { data: permissions } = useQuery<EffectivePermissions>({
    queryKey: ['myPermissions', user?.id],
    queryFn: () => usersAPI.getMyPermissions(),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const globalPerms = new Set(permissions?.global ?? []);

  return {
    user,
    isAdmin: isAdminUser(user),
    isViewer: isViewerRole(user?.role),
    canWrite: canWrite(user),
    canDelete: globalPerms.has('delete'),
    canExecute: globalPerms.has('execute') || globalPerms.has('write'),
    canManageProject: globalPerms.has('manage_projects'),
    permissions,
  };
}
