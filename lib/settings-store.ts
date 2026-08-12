"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/components/theme/ThemeScript";

const STORAGE_KEY = "database-agent:settings";

export type ThemePreference = "light" | "dark" | "system";
export type ResponseDetail = "concise" | "balanced" | "detailed";

export type Settings = {
  theme: ThemePreference;
  defaultConnectionId: string;
  responseDetail: ResponseDetail;
  autoRunSql: boolean;
};

const DEFAULTS: Settings = {
  theme: "system",
  // Empty means "no preference" — the chat store falls back to whichever
  // connection is active, then the workspace's first one.
  defaultConnectionId: "",
  responseDetail: "balanced",
  autoRunSql: false,
};

let state: Settings | null = null;
const listeners = new Set<() => void>();

/**
 * The theme lives in its own key because ThemeScript reads it before React
 * boots. Its contract: a missing value means "follow the system", so "system"
 * removes the key rather than storing a third value.
 */
function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyTheme(theme: ThemePreference) {
  const dark =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
      : theme === "dark";

  if (theme === "system") {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
  document.documentElement.classList.toggle("dark", dark);
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return { ...DEFAULTS, ...parsed, theme: readThemePreference() };
  } catch {
    return { ...DEFAULTS };
  }
}

function getSnapshot(): Settings {
  state ??= load();
  return state;
}

function getServerSnapshot(): Settings {
  return DEFAULTS;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...getSnapshot(), ...patch };
  state = next;

  if (patch.theme) applyTheme(patch.theme);

  try {
    // The theme is owned by THEME_STORAGE_KEY; don't duplicate it here.
    const persisted: Omit<Settings, "theme"> = {
      defaultConnectionId: next.defaultConnectionId,
      responseDetail: next.responseDetail,
      autoRunSql: next.autoRunSql,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Persistence is best-effort.
  }
  listeners.forEach((listener) => listener());
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Read outside React — used when a new conversation picks its connection. */
export function getDefaultConnectionId(): string {
  return getSnapshot().defaultConnectionId;
}

/** Wipes every `database-agent:` key. Used by the danger zone in settings. */
export function clearLocalData(keys: string[]) {
  keys.forEach((key) => localStorage.removeItem(key));
  location.reload();
}
