import { useQuery } from '@tanstack/react-query';
import { projectsAPI } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { canWrite as globalCanWrite, isAdminUser, roleCanWrite } from '@/utils/roles';

/**
 * Project-aware permissions for the current user.
 *
 * `usePermissions` only knows the user's *global* role, so a globally read-only
 * viewer who was elevated (tester/manager/…) in a specific project is wrongly
 * treated as unable to write there. This hook layers the user's effective
 * per-project role (from `/my-projects`) on top of the global role so write
 * controls can be shown in the projects where they actually apply.
 *
 * UX gating only — the backend remains the security boundary. When `projectId`
 * is null/undefined this falls back to global permissions.
 */
export function useProjectPermissions(projectId?: number | null) {
  const user = useAuthStore((state) => state.user);
  const baseCanWrite = globalCanWrite(user);

  // Only consult per-project roles when the global role wouldn't already grant
  // write — avoids a needless request for admins/managers/testers.
  const needsProjectRole = !!projectId && !baseCanWrite && !isAdminUser(user);

  const { data: myProjects } = useQuery({
    queryKey: ['myProjects', user?.id],
    queryFn: () => projectsAPI.getMyProjects(),
    enabled: needsProjectRole,
    staleTime: 5 * 60 * 1000,
  });

  let projectRole: string | null = null;
  if (projectId && myProjects) {
    const match = myProjects.find((entry) => entry.project?.id === projectId);
    projectRole = match?.role ?? null;
  }

  const canWrite = baseCanWrite || (needsProjectRole ? roleCanWrite(projectRole) : false);

  return {
    user,
    isAdmin: isAdminUser(user),
    projectRole,
    canWrite,
  };
}
