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
