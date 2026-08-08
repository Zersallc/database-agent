/**
 * The playbook: the system prompt and the skills that shape every answer.
 *
 * This is where an organization writes down what it means by "revenue" and
 * which tables lie. It is a singleton per tenant — one workspace, one set of
 * definitions — so it has no ID in the path.
 */

import { notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { buildPage, type ListParams, type Page } from "@/lib/api/pagination";
import { stores } from "@/lib/providers";
import { DEFAULT_SYSTEM_PROMPT } from "./tenancy";

const PLAYBOOK_ID = "playbook";

export type PlaybookDoc = {
  id: string;
  object: "playbook";
  system_prompt: string;
  updated_at: string;
};

export type SkillDoc = {
  id: string;
  object: "skill";
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export function serializeSkill(doc: SkillDoc) {
  return {
    id: doc.id,
    object: doc.object,
    name: doc.name,
    description: doc.description,
    content: doc.content,
    enabled: doc.enabled,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

export async function getPlaybook(tenantId: string): Promise<PlaybookDoc> {
  const existing = await stores().documents.get<PlaybookDoc>("playbooks", tenantId, PLAYBOOK_ID);
  if (existing) return existing;

  // A tenant provisioned outside the bootstrap path has no playbook yet.
  // Materializing the default on read beats 404-ing a resource the contract
  // says always exists.
  const doc: PlaybookDoc = {
    id: PLAYBOOK_ID,
    object: "playbook",
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    updated_at: new Date().toISOString(),
  };
  return stores().documents.put("playbooks", tenantId, doc);
}

export async function serializePlaybook(tenantId: string, doc: PlaybookDoc) {
  const skills = await allSkills(tenantId);
  return {
    object: doc.object,
    system_prompt: doc.system_prompt,
    skill_count: skills.length,
    enabled_skill_count: skills.filter((skill) => skill.enabled).length,
    updated_at: doc.updated_at,
  };
}

export async function replacePlaybook(
  tenantId: string,
  systemPrompt: string
): Promise<PlaybookDoc> {
  await getPlaybook(tenantId);
  const doc: PlaybookDoc = {
    id: PLAYBOOK_ID,
    object: "playbook",
    system_prompt: systemPrompt,
    updated_at: new Date().toISOString(),
  };
  return stores().documents.put("playbooks", tenantId, doc);
}

async function allSkills(tenantId: string): Promise<SkillDoc[]> {
  return stores().documents.list<SkillDoc>("skills", tenantId, {
    orderBy: "created_at",
    order: "asc",
  });
}

export async function listSkills(tenantId: string, params: ListParams): Promise<Page<SkillDoc>> {
  const docs = await stores().documents.list<SkillDoc>("skills", tenantId, {
    orderBy: "created_at",
    order: params.order,
    startAfter: params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined,
    limit: params.limit + 1,
  });
  return buildPage(docs, params, (doc) => ({ sort: doc.created_at, id: doc.id }));
}

export async function requireSkill(tenantId: string, skillId: string): Promise<SkillDoc> {
  const doc = await stores().documents.get<SkillDoc>("skills", tenantId, skillId);
  if (!doc) throw notFound("skill", skillId);
  return doc;
}

export async function createSkill(
  tenantId: string,
  input: { name: string; description?: string; content: string; enabled: boolean }
): Promise<SkillDoc> {
  const now = new Date().toISOString();
  const doc: SkillDoc = {
    id: newId("skill"),
    object: "skill",
    name: input.name,
    description: input.description ?? "",
    content: input.content,
    enabled: input.enabled,
    created_at: now,
    updated_at: now,
  };
  return stores().documents.put("skills", tenantId, doc);
}

export async function updateSkill(
  tenantId: string,
  skillId: string,
  input: { name?: string; description?: string; content?: string; enabled?: boolean }
): Promise<SkillDoc> {
  const existing = await requireSkill(tenantId, skillId);
  const changes: Partial<SkillDoc> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) changes.name = input.name;
  if (input.description !== undefined) changes.description = input.description;
  if (input.content !== undefined) changes.content = input.content;
  if (input.enabled !== undefined) changes.enabled = input.enabled;

  const updated = await stores().documents.patch<SkillDoc>("skills", tenantId, skillId, changes);
  return updated ?? existing;
}

export async function deleteSkill(tenantId: string, skillId: string): Promise<void> {
  await stores().documents.delete("skills", tenantId, skillId);
}

/**
 * Everything the agent reads before answering: the system prompt followed by
 * each enabled skill.
 *
 * This is the server-side counterpart of the Playbook page's context preview.
 * Both must produce the same text, or the preview is a lie about what the agent
 * actually sees.
 */
export async function buildAgentContext(tenantId: string): Promise<string> {
  const [playbook, skills] = await Promise.all([getPlaybook(tenantId), allSkills(tenantId)]);
  const sections = skills
    .filter((skill) => skill.enabled)
    .map((skill) => `## ${skill.name}\n${skill.content.trim()}`);
  return [playbook.system_prompt.trim(), ...sections].filter(Boolean).join("\n\n");
}
