/**
 * Demo-only shortcut: the image is carried as a data URL and lands in
 * localStorage with the conversation. Real uploads go to object storage and
 * this becomes a signed URL.
 */
export type Attachment = {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg";
  dataUrl: string;
};

/** Permission level. Distinct from `title`, which is just what they do. */
export type Role = "admin" | "member" | "viewer";

/**
 * Placeholder company name. Once a real database is connected, this comes from
 * the tenant record rather than being hardcoded.
 */
export const DEFAULT_COMPANY = "Company";

export type User = {
  id: string;
  name: string;
  email: string;
  company: string;
  /** Job title — "CEO", "Data Analyst", … — not a permission. */
  title: string;
  role: Role;
  joinedAt: string;
  status: "active" | "pending";
};

/** The "Company — Title" line shown under a person's name. */
export function userSubtitle(user: User): string {
  return [user.company, user.title].filter(Boolean).join(" — ");
}

export const MOCK_USERS: User[] = [
  {
    id: "u-1",
    name: "Mountacir",
    email: "mountacirw@gmail.com",
    company: DEFAULT_COMPANY,
    title: "Admin",
    role: "admin",
    joinedAt: "2026-01-14",
    status: "active",
  },
  {
    id: "u-2",
    name: "Sara Idrissi",
    email: "sara@zersallc.com",
    company: DEFAULT_COMPANY,
    title: "CEO",
    role: "admin",
    joinedAt: "2026-02-02",
    status: "active",
  },
  {
    id: "u-3",
    name: "Tom Becker",
    email: "tom@zersallc.com",
    company: DEFAULT_COMPANY,
    title: "Developer",
    role: "member",
    joinedAt: "2026-03-19",
    status: "active",
  },
  {
    id: "u-4",
    name: "Priya Raman",
    email: "priya@zersallc.com",
    company: DEFAULT_COMPANY,
    title: "Data Analyst",
    role: "viewer",
    joinedAt: "2026-05-08",
    status: "active",
  },
];

/** Common job titles offered in the pickers. Free text is allowed too. */
export const TITLE_SUGGESTIONS = [
  "Admin",
  "CEO",
  "CTO",
  "Developer",
  "Data Analyst",
  "Product Manager",
];

export function canManageUsers(user: User): boolean {
  return user.role === "admin";
}

export type ConnectionStatus = "connected" | "degraded" | "offline" | "unknown";
