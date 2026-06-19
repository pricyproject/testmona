export const USER_ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  TESTER: 'tester',
  VIEWER: 'viewer',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export function normalizeRole(role?: string | null): string {
  return role?.trim().toLowerCase() ?? '';
}

export function isAdminRole(role?: string | null): boolean {
  return normalizeRole(role) === USER_ROLES.ADMIN;
}

export function isAdminUser(user?: { role?: string | null; is_superuser?: boolean } | null): boolean {
  return Boolean(user?.is_superuser || isAdminRole(user?.role));
}

export function isViewerRole(role?: string | null): boolean {
  return normalizeRole(role) === USER_ROLES.VIEWER;
}

/**
 * Whether a user may perform write actions (create/edit/delete/execute content).
 * Superusers always can; known viewers cannot; any other/unknown role is allowed
 * (the backend still enforces RBAC — incl. the viewer read-only guard — as the
 * source of truth, so this is UX gating only).
 */
export function canWrite(user?: { role?: string | null; is_superuser?: boolean } | null): boolean {
  return Boolean(user?.is_superuser) || !isViewerRole(user?.role);
}

/**
 * Backwards-compatible alias for {@link canWrite}, kept so existing call sites
 * (test execution, requirements) don't need to change.
 */
export const canWriteResults = canWrite;

/**
 * Whether a (project-level) role grants write access. Mirrors the backend
 * ROLE_PERMISSIONS table: admin/manager/tester can write, viewer cannot.
 * Unknown roles default to read-only (the backend stays the source of truth).
 */
export function roleCanWrite(role?: string | null): boolean {
  const normalized = normalizeRole(role);
  return (
    normalized === USER_ROLES.ADMIN ||
    normalized === USER_ROLES.MANAGER ||
    normalized === USER_ROLES.TESTER
  );
}
