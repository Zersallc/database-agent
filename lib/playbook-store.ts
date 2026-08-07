"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "database-agent:playbook";

export type PlaybookSkill = {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  updatedAt: number;
};

export type PlaybookState = {
  systemPrompt: string;
  skills: PlaybookSkill[];
};

const DEFAULT_SYSTEM_PROMPT = `You are a database analyst for this workspace.

Answer with the smallest thing that fully answers the question. Show the SQL you
ran. When a result is easier to read as a chart, render one. Say plainly when
the data cannot answer what was asked — do not guess.`;

const SEED_SKILLS: Omit<PlaybookSkill, "id" | "updatedAt">[] = [
  {
    name: "Revenue definitions",
    description: "How revenue, MRR and churn are calculated here",
    enabled: true,
    content: `Revenue means recognized revenue, not bookings.

- MRR: sum of active subscription amounts, normalized to a month.
- Churn: subscriptions that moved to "cancelled" during the period, over
  subscriptions active at the start of it.
- Exclude internal accounts (customers.is_internal = true) from every revenue
  figure unless explicitly asked to include them.`,
  },
  {
    name: "SQL style guide",
    description: "Conventions every generated query should follow",
    enabled: true,
    content: `- Uppercase keywords, snake_case identifiers.
- Always qualify columns when more than one table is in play.
- Prefer CTEs over nested subqueries.
- Add an explicit LIMIT when the question does not imply a full scan.
- Never SELECT *; name the columns.`,
  },
  {
    name: "Schema notes",
    description: "Gotchas in the warehouse the schema does not convey",
    enabled: false,
    content: `- orders.amount is in cents, not dollars.
- customers.region uses ISO codes, but legacy rows before 2024 use free text.
- The events table is partitioned by day; always filter on event_date first.
- users.deleted_at is a soft delete — filter it out unless asked.`,
  },
];

function seed(): PlaybookState {
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    skills: SEED_SKILLS.map((skill) => ({
      ...skill,
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
    })),
  };
}

const SERVER_STATE: PlaybookState = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  skills: [],
};

let state: PlaybookState | null = null;
const listeners = new Set<() => void>();

function load(): PlaybookState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlaybookState;
      if (typeof parsed.systemPrompt === "string" && Array.isArray(parsed.skills)) {
        return parsed;
      }
    }
  } catch {
    // Storage unavailable — fall through to the seeded playbook.
  }
  return seed();
}

function getSnapshot(): PlaybookState {
  state ??= load();
  return state;
}

function getServerSnapshot(): PlaybookState {
  return SERVER_STATE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(updater: (prev: PlaybookState) => PlaybookState) {
  state = updater(getSnapshot());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best-effort.
  }
  listeners.forEach((listener) => listener());
}

export function setSystemPrompt(systemPrompt: string) {
  update((prev) => ({ ...prev, systemPrompt }));
}

export function createSkill(): string {
  const id = crypto.randomUUID();
  update((prev) => ({
    ...prev,
    skills: [
      {
        id,
        name: "Untitled skill",
        description: "",
        content: "",
        enabled: true,
        updatedAt: Date.now(),
      },
      ...prev.skills,
    ],
  }));
  return id;
}

export function updateSkill(id: string, patch: Partial<PlaybookSkill>) {
  update((prev) => ({
    ...prev,
    skills: prev.skills.map((skill) =>
      skill.id === id ? { ...skill, ...patch, updatedAt: Date.now() } : skill
    ),
  }));
}

export function deleteSkill(id: string) {
  update((prev) => ({
    ...prev,
    skills: prev.skills.filter((skill) => skill.id !== id),
  }));
}

export function resetPlaybook() {
  update(() => seed());
}

/**
 * Assembles everything the agent reads before answering: the always-on system
 * prompt followed by each enabled skill. This is exactly what gets sent with a
 * question, and exactly what the Playbook's context preview renders.
 */
export function buildAgentContext(playbook: PlaybookState = getSnapshot()): string {
  const enabled = playbook.skills.filter((skill) => skill.enabled);
  const sections = enabled.map(
    (skill) => `## ${skill.name}\n${skill.content.trim()}`
  );
  return [playbook.systemPrompt.trim(), ...sections].filter(Boolean).join("\n\n");
}

export function enabledSkillNames(
  playbook: PlaybookState = getSnapshot()
): string[] {
  return playbook.skills.filter((s) => s.enabled).map((s) => s.name);
}

export function usePlaybook(): PlaybookState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
