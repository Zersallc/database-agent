"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_COMPANY, MOCK_USERS, type User } from "./workspace";

const STORAGE_KEY = "database-agent:users";

export type UsersState = {
  users: User[];
  /** null means signed out. */
  currentUserId: string | null;
};

/**
 * Team roster plus who is signed in. This stands in for real auth and a
 * `/api/users` endpoint — there is no password and no server-side check, so it
 * is a demo gate, not security.
 */
const SERVER_STATE: UsersState = { users: MOCK_USERS, currentUserId: null };

let state: UsersState | null = null;
const listeners = new Set<() => void>();

function load(): UsersState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UsersState;
      if (Array.isArray(parsed.users) && parsed.users.length > 0) return parsed;
    }
  } catch {
    // Storage unavailable — fall through to the seeded roster.
  }
  return { users: MOCK_USERS, currentUserId: null };
}

function getSnapshot(): UsersState {
  state ??= load();
  return state;
}

function getServerSnapshot(): UsersState {
  return SERVER_STATE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(updater: (prev: UsersState) => UsersState) {
  state = updater(getSnapshot());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best-effort.
  }
  listeners.forEach((listener) => listener());
}

export function signIn(userId: string) {
  update((prev) => ({ ...prev, currentUserId: userId }));
}

export function signOut() {
  update((prev) => ({ ...prev, currentUserId: null }));
}

/** Creates an identity from the login screen and signs straight into it. */
export function signInAsNewUser(input: {
  name: string;
  email: string;
  company?: string;
  title: string;
  role?: User["role"];
}): User {
  const user: User = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    email: input.email.trim(),
    company: input.company?.trim() || DEFAULT_COMPANY,
    title: input.title.trim(),
    role: input.role ?? "member",
    joinedAt: new Date().toISOString().slice(0, 10),
    status: "active",
  };
  update((prev) => ({
    users: [...prev.users, user],
    currentUserId: user.id,
  }));
  return user;
}

export function addUser(user: User) {
  update((prev) => ({ ...prev, users: [...prev.users, user] }));
}

export function updateUser(id: string, patch: Partial<User>) {
  update((prev) => ({
    ...prev,
    users: prev.users.map((user) =>
      user.id === id ? { ...user, ...patch } : user
    ),
  }));
}

export function removeUser(id: string) {
  update((prev) => ({
    ...prev,
    users: prev.users.filter((user) => user.id !== id),
  }));
}

/** Renames the company for everyone — it is a tenant-level value. */
export function setCompany(company: string) {
  update((prev) => ({
    ...prev,
    users: prev.users.map((user) => ({ ...user, company })),
  }));
}

export function useUsers(): UsersState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useCurrentUser(): User | null {
  const { users, currentUserId } = useUsers();
  return users.find((user) => user.id === currentUserId) ?? null;
}

/** False during SSR and the hydration render, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}
