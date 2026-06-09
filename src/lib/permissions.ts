/**
 * Role + access-level definitions. The same source of truth used by the
 * frontend (for hiding controls) and the backend (for authorization).
 *
 * Backend checks are mandatory; frontend hiding is just UX.
 */

export type Role = "super_admin" | "admin" | "creator" | "viewer";
export const ROLES: Role[] = ["super_admin", "admin", "creator", "viewer"];

export type AccessLevel = "read" | "write" | "admin";
export const ACCESS_LEVELS: AccessLevel[] = ["read", "write", "admin"];

export function roleFromString(s: unknown): Role | null {
  return typeof s === "string" && (ROLES as string[]).includes(s)
    ? (s as Role)
    : null;
}

export function accessLevelFromString(s: unknown): AccessLevel | null {
  return typeof s === "string" && (ACCESS_LEVELS as string[]).includes(s)
    ? (s as AccessLevel)
    : null;
}

export type Session = {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: Role;
};

// ---- High-level role checks ----------------------------------------------

export function isSuperAdmin(s: Session): boolean {
  return s.role === "super_admin";
}

export function isAdmin(s: Session): boolean {
  return s.role === "super_admin" || s.role === "admin";
}

export function canManageUsers(s: Session): boolean {
  return isAdmin(s);
}

/** Only super admins can change another user's role or invite super admins. */
export function canChangeRoles(s: Session): boolean {
  return isSuperAdmin(s);
}

export function canManagePodcastAccess(s: Session): boolean {
  return isAdmin(s);
}

export function canViewAudit(s: Session): boolean {
  return isAdmin(s);
}

export function canSyncMetrics(s: Session): boolean {
  return isAdmin(s);
}

/** Admins always have access to every podcast; others must be assigned. */
export function adminHasGlobalAccess(s: Session): boolean {
  return isAdmin(s);
}

// ---- Display helpers ------------------------------------------------------

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  creator: "Creator",
  viewer: "Viewer",
};

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  read: "Read",
  write: "Write",
  admin: "Admin",
};
