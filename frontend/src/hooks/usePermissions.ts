import { useAuthStore } from '@/stores/authStore';
import { canWrite, isAdminUser, isViewerRole } from '@/utils/roles';

/**
 * Central role-derived permissions for the current user.
 *
 * UX gating only — the backend is the security boundary (viewers are blocked from
 * all non-self-service writes by the read-only guard in `app/auth.py`). Use this to
 * hide/disable create/edit/delete/execute controls so viewers don't trigger 403s.
 */
export function usePermissions() {
  const user = useAuthStore((state) => state.user);
  return {
    user,
    isAdmin: isAdminUser(user),
    isViewer: isViewerRole(user?.role),
    canWrite: canWrite(user),
  };
}
