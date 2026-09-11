/**
 * The four account roles (Company.role / User.role in Postgres) and which
 * ones get admin-level UI/API access. Kept in one place because "is this
 * role allowed to see the admin pages" is checked from several files
 * (require-admin.ts, the sidebar, Settings) and used to silently drift.
 *
 * Developer is admin-equivalent for now, plus the one thing Admin itself
 * doesn't get: seeing every company and switching between them (see
 * CompanySwitcher.tsx) — an internal/engineering account, not a
 * per-company one.
 */
export const ROLES = ["Admin", "Developer", "User", "Viewer"] as const;
export type AppRole = (typeof ROLES)[number];

const ADMIN_ROLES: ReadonlySet<string> = new Set(["Admin", "Developer"]);

export function isAdminRole(role: string | null | undefined): boolean {
  return role != null && ADMIN_ROLES.has(role);
}

export function isValidRole(role: unknown): role is AppRole {
  return typeof role === "string" && (ROLES as readonly string[]).includes(role);
}
