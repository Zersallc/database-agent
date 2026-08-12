"use client";

import { useSyncExternalStore } from "react";

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
  loading: boolean;
  error: string | null;
};

const EMPTY_STATE: PlaybookState = {
  systemPrompt: "",
  skills: [],
  loading: true,
  error: null,
};

let state: PlaybookState = EMPTY_STATE;
let started = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function setState(patch: Partial<PlaybookState>) {
  state = { ...state, ...patch };
  notify();
}

function getSnapshot(): PlaybookState {
  return state;
}

function getServerSnapshot(): PlaybookState {
  return EMPTY_STATE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    void load();
  }
  return () => listeners.delete(listener);
}

type SkillDoc = {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  updated_at: string;
};

function fromSkillDoc(doc: SkillDoc): PlaybookSkill {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    content: doc.content,
    enabled: doc.enabled,
    updatedAt: new Date(doc.updated_at).getTime(),
  };
}

async function readJsonOrThrow(res: Response, message: string) {
  if (!res.ok) throw new Error(message);
  return res.json();
}

async function load(): Promise<void> {
  try {
    const [playbookRes, skillsRes] = await Promise.all([
      fetch("/api/v1/playbook"),
      fetch("/api/v1/playbook/skills?limit=100"),
    ]);
    const playbook = await readJsonOrThrow(playbookRes, "Failed to load system instructions.");
    const skillsBody = await readJsonOrThrow(skillsRes, "Failed to load skills.");
    setState({
      systemPrompt: playbook.system_prompt,
      skills: (skillsBody.data as SkillDoc[]).map(fromSkillDoc),
      loading: false,
      error: null,
    });
  } catch (error) {
    setState({
      loading: false,
      error: error instanceof Error ? error.message : "Failed to load the playbook.",
    });
  }
}

/** Re-fetches after a failed load, e.g. from a "Retry" button. */
export function reloadPlaybook(): void {
  setState({ loading: true, error: null });
  void load();
}

export async function setSystemPrompt(systemPrompt: string): Promise<void> {
  const res = await fetch("/api/v1/playbook", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_prompt: systemPrompt }),
  });
  const doc = await readJsonOrThrow(res, "Failed to save system instructions.");
  setState({ systemPrompt: doc.system_prompt });
}

export async function createSkill(): Promise<string> {
  const res = await fetch("/api/v1/playbook/skills", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ name: "Untitled skill", description: "", content: "", enabled: true }),
  });
  const doc = await readJsonOrThrow(res, "Failed to create the skill.");
  const skill = fromSkillDoc(doc);
  setState({ skills: [skill, ...state.skills] });
  return skill.id;
}

export async function updateSkill(
  id: string,
  patch: Partial<Pick<PlaybookSkill, "name" | "description" | "content" | "enabled">>
): Promise<void> {
  const res = await fetch(`/api/v1/playbook/skills/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const doc = await readJsonOrThrow(res, "Failed to save the skill.");
  const skill = fromSkillDoc(doc);
  setState({ skills: state.skills.map((s) => (s.id === id ? skill : s)) });
}

export async function deleteSkill(id: string): Promise<void> {
  const res = await fetch(`/api/v1/playbook/skills/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error("Failed to delete the skill.");
  setState({ skills: state.skills.filter((s) => s.id !== id) });
}

/**
 * Assembles everything the agent reads before answering: the always-on system
 * prompt followed by each enabled skill. This is a client-side preview only —
 * `lib/services/playbook.ts`'s `buildAgentContext` is what the agent actually
 * uses, and the two must stay in lockstep or the preview lies about what the
 * agent sees.
 */
export function buildAgentContext(playbook: PlaybookState = getSnapshot()): string {
  const enabled = playbook.skills.filter((skill) => skill.enabled);
  const sections = enabled.map((skill) => `## ${skill.name}\n${skill.content.trim()}`);
  return [playbook.systemPrompt.trim(), ...sections].filter(Boolean).join("\n\n");
}

export function usePlaybook(): PlaybookState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
