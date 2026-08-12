/**
 * Conversations and their messages.
 *
 * Messages live in their own collection rather than as an array on the
 * conversation. A conversation with two thousand turns would otherwise be a
 * single document that has to be read and rewritten in full on every reply,
 * which is both slow and, in Firestore, eventually over the 1 MiB document
 * limit.
 */

import { notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { buildPage, type ListParams, type Page } from "@/lib/api/pagination";
import { stores } from "@/lib/providers";

export const NEW_CONVERSATION_TITLE = "New chat";

export type Attachment = {
  file_id: string;
  name: string;
  mime_type: string;
  size_bytes: number | null;
};

export type ConversationDoc = {
  id: string;
  object: "conversation";
  title: string;
  connection_id: string | null;
  created_by: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export type MessageDoc = {
  id: string;
  object: "message";
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  attachments: Attachment[];
  run_id: string | null;
  /** Set on an assistant message — the run's token usage and wall-clock time, so they survive a reload. */
  usage: { input_tokens: number; output_tokens: number } | null;
  duration_ms: number | null;
  created_at: string;
};

export function serializeConversation(doc: ConversationDoc) {
  return {
    id: doc.id,
    object: doc.object,
    title: doc.title,
    connection_id: doc.connection_id,
    created_by: doc.created_by,
    message_count: doc.message_count,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

export function serializeMessage(doc: MessageDoc) {
  return {
    id: doc.id,
    object: doc.object,
    conversation_id: doc.conversation_id,
    role: doc.role,
    content: doc.content,
    attachments: doc.attachments,
    run_id: doc.run_id,
    usage: doc.usage,
    duration_ms: doc.duration_ms,
    created_at: doc.created_at,
  };
}

/** Derives a sidebar label from the first thing the user asked. */
export function titleFromMessage(content: string): string {
  const flattened = content.replace(/\s+/g, " ").trim();
  if (!flattened) return NEW_CONVERSATION_TITLE;
  return flattened.length > 48 ? `${flattened.slice(0, 48)}…` : flattened;
}

export async function listConversations(
  tenantId: string,
  params: ListParams
): Promise<Page<ConversationDoc>> {
  const docs = await stores().documents.list<ConversationDoc>("conversations", tenantId, {
    orderBy: "updated_at",
    order: params.order,
    startAfter: params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined,
    limit: params.limit + 1,
  });
  return buildPage(docs, params, (doc) => ({ sort: doc.updated_at, id: doc.id }));
}

export async function findConversation(
  tenantId: string,
  conversationId: string
): Promise<ConversationDoc | null> {
  return stores().documents.get<ConversationDoc>("conversations", tenantId, conversationId);
}

export async function requireConversation(
  tenantId: string,
  conversationId: string
): Promise<ConversationDoc> {
  const doc = await findConversation(tenantId, conversationId);
  if (!doc) throw notFound("conversation", conversationId);
  return doc;
}

export async function createConversation(
  tenantId: string,
  input: { title?: string; connectionId?: string | null; userId: string }
): Promise<ConversationDoc> {
  const now = new Date().toISOString();
  const doc: ConversationDoc = {
    id: newId("conversation"),
    object: "conversation",
    title: input.title?.trim() || NEW_CONVERSATION_TITLE,
    connection_id: input.connectionId ?? null,
    created_by: input.userId,
    message_count: 0,
    created_at: now,
    updated_at: now,
  };
  return stores().documents.put("conversations", tenantId, doc);
}

export async function updateConversation(
  tenantId: string,
  conversationId: string,
  input: { title?: string; connectionId?: string }
): Promise<ConversationDoc> {
  const existing = await requireConversation(tenantId, conversationId);
  const changes: Partial<ConversationDoc> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) changes.title = input.title;
  if (input.connectionId !== undefined) changes.connection_id = input.connectionId;

  const updated = await stores().documents.patch<ConversationDoc>(
    "conversations",
    tenantId,
    conversationId,
    changes
  );
  return updated ?? existing;
}

/** Deletes the conversation and every message in it. */
export async function deleteConversation(tenantId: string, conversationId: string): Promise<void> {
  const { documents } = stores();
  await documents.deleteWhere("messages", tenantId, [
    { field: "conversation_id", equals: conversationId },
  ]);
  await documents.delete("conversations", tenantId, conversationId);
}

export async function listMessages(
  tenantId: string,
  conversationId: string,
  params: ListParams
): Promise<Page<MessageDoc>> {
  const docs = await stores().documents.list<MessageDoc>("messages", tenantId, {
    where: [{ field: "conversation_id", equals: conversationId }],
    orderBy: "created_at",
    order: params.order,
    startAfter: params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined,
    limit: params.limit + 1,
  });
  return buildPage(docs, params, (doc) => ({ sort: doc.created_at, id: doc.id }));
}

/** Full history, oldest first. What the agent reads before answering. */
export async function conversationHistory(
  tenantId: string,
  conversationId: string,
  limit = 200
): Promise<MessageDoc[]> {
  return stores().documents.list<MessageDoc>("messages", tenantId, {
    where: [{ field: "conversation_id", equals: conversationId }],
    orderBy: "created_at",
    order: "asc",
    limit,
  });
}

export async function appendMessage(
  tenantId: string,
  conversation: ConversationDoc,
  input: {
    role: "user" | "assistant";
    content: string;
    attachments?: Attachment[];
    runId?: string | null;
    usage?: { input_tokens: number; output_tokens: number } | null;
    durationMs?: number | null;
  }
): Promise<MessageDoc> {
  const now = new Date().toISOString();
  const doc: MessageDoc = {
    id: newId("message"),
    object: "message",
    conversation_id: conversation.id,
    role: input.role,
    content: input.content,
    attachments: input.attachments ?? [],
    run_id: input.runId ?? null,
    usage: input.usage ?? null,
    duration_ms: input.durationMs ?? null,
    created_at: now,
  };

  await stores().documents.put("messages", tenantId, doc);

  // A conversation still called "New chat" takes its name from the first thing
  // asked — the sidebar is unusable otherwise.
  const shouldTitle =
    input.role === "user" &&
    conversation.title === NEW_CONVERSATION_TITLE &&
    input.content.trim().length > 0;

  await stores().documents.patch<ConversationDoc>("conversations", tenantId, conversation.id, {
    message_count: conversation.message_count + 1,
    updated_at: now,
    ...(shouldTitle ? { title: titleFromMessage(input.content) } : {}),
  });

  return doc;
}
