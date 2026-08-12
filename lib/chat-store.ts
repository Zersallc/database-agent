"use client";

/**
 * Real conversations, connections, and messages — backed by the v1 API
 * (`/api/v1/connections`, `/api/v1/conversations`, `.../messages`) instead of
 * the browser-only mock store this replaces. Sending a question and streaming
 * the answer lives in `ChatWorkspace`, not here: this store's job is just the
 * data, not one interaction's lifecycle.
 */

import { useSyncExternalStore } from "react";
import { getDefaultConnectionId } from "./settings-store";
import type { Attachment, ConnectionStatus } from "./workspace";

export type StoreConnection = {
  id: string;
  name: string;
  engine: string;
  status: ConnectionStatus;
};

export type StoreConversation = {
  id: string;
  title: string;
  connectionId: string | null;
  updatedAt: string;
};

export type StoreMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  /** True while a `run.content_delta` stream is still filling this in. */
  streaming?: boolean;
};

type ChatState = {
  loading: boolean;
  error: string | null;
  connections: StoreConnection[];
  conversations: StoreConversation[];
  activeConversationId: string | null;
  activeConnectionId: string | null;
  messagesByConversation: Record<string, StoreMessage[]>;
  messagesLoading: Record<string, boolean>;
};

const EMPTY_STATE: ChatState = {
  loading: true,
  error: null,
  connections: [],
  conversations: [],
  activeConversationId: null,
  activeConnectionId: null,
  messagesByConversation: {},
  messagesLoading: {},
};

let state: ChatState = EMPTY_STATE;
let started = false;
const listeners = new Set<() => void>();
// Tracks the in-flight history fetch per conversation, so a message sent the
// instant a conversation is selected waits for that fetch instead of racing
// it — the optimistic local append and the server history would otherwise
// clobber whichever one lands second.
const messageLoads = new Map<string, Promise<void>>();

function notify() {
  listeners.forEach((listener) => listener());
}

function setState(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  notify();
}

function getSnapshot(): ChatState {
  return state;
}

function getServerSnapshot(): ChatState {
  return EMPTY_STATE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    void bootstrap();
  }
  return () => listeners.delete(listener);
}

async function readJsonOrThrow(res: Response, message: string) {
  if (!res.ok) throw new Error(message);
  return res.json();
}

function fromConnectionDoc(doc: {
  id: string;
  name: string;
  engine: string;
  status: ConnectionStatus;
}): StoreConnection {
  return { id: doc.id, name: doc.name, engine: doc.engine, status: doc.status };
}

function fromConversationDoc(doc: {
  id: string;
  title: string;
  connection_id: string | null;
  updated_at: string;
}): StoreConversation {
  return { id: doc.id, title: doc.title, connectionId: doc.connection_id, updatedAt: doc.updated_at };
}

function fromMessageDoc(doc: {
  id: string;
  role: "user" | "assistant";
  content: string;
}): StoreMessage {
  return { id: doc.id, role: doc.role, content: doc.content };
}

async function bootstrap(): Promise<void> {
  try {
    const [connectionsRes, conversationsRes] = await Promise.all([
      fetch("/api/v1/connections?limit=50"),
      fetch("/api/v1/conversations?limit=50"),
    ]);
    const connectionsBody = await readJsonOrThrow(connectionsRes, "Failed to load connections.");
    const conversationsBody = await readJsonOrThrow(conversationsRes, "Failed to load conversations.");

    const connections = (connectionsBody.data as Parameters<typeof fromConnectionDoc>[0][]).map(
      fromConnectionDoc
    );
    const conversations = (conversationsBody.data as Parameters<typeof fromConversationDoc>[0][]).map(
      fromConversationDoc
    );

    const activeConversationId = conversations[0]?.id ?? null;
    setState({
      loading: false,
      error: null,
      connections,
      conversations,
      activeConversationId,
      activeConnectionId: conversations[0]?.connectionId ?? connections[0]?.id ?? null,
    });

    // A brand-new workspace (or one where every chat was deleted) has zero
    // conversations — there must always be one to send the first message into.
    if (activeConversationId) void ensureMessagesLoaded(activeConversationId);
    else if (connections.length > 0) await newConversation();
  } catch (error) {
    setState({
      loading: false,
      error: error instanceof Error ? error.message : "Failed to load the workspace.",
    });
  }
}

function ensureMessagesLoaded(conversationId: string): Promise<void> {
  if (state.messagesByConversation[conversationId]) return Promise.resolve();
  const inFlight = messageLoads.get(conversationId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    setState({ messagesLoading: { ...state.messagesLoading, [conversationId]: true } });
    try {
      // 100 is the API's enforced ceiling (MAX_LIMIT in lib/api/pagination.ts).
      const res = await fetch(`/api/v1/conversations/${conversationId}/messages?limit=100`);
      const body = await readJsonOrThrow(res, "Failed to load messages.");
      const messages = (body.data as Parameters<typeof fromMessageDoc>[0][]).map(fromMessageDoc);
      setState({
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: messages },
        messagesLoading: { ...state.messagesLoading, [conversationId]: false },
      });
    } catch {
      setState({ messagesLoading: { ...state.messagesLoading, [conversationId]: false } });
    } finally {
      messageLoads.delete(conversationId);
    }
  })();

  messageLoads.set(conversationId, promise);
  return promise;
}

/** Resolves once any in-flight history fetch for this conversation has landed. */
export function waitForMessages(conversationId: string): Promise<void> {
  return ensureMessagesLoaded(conversationId);
}

export async function newConversation(): Promise<void> {
  const preferred = getDefaultConnectionId();
  const connectionId =
    (preferred && state.connections.some((c) => c.id === preferred) ? preferred : null) ??
    state.activeConnectionId ??
    state.connections[0]?.id ??
    null;
  const res = await fetch("/api/v1/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(connectionId ? { connection_id: connectionId } : {}),
  });
  const doc = await readJsonOrThrow(res, "Failed to create a new chat.");
  const conversation = fromConversationDoc(doc);
  setState({
    conversations: [conversation, ...state.conversations],
    activeConversationId: conversation.id,
    activeConnectionId: conversation.connectionId ?? state.activeConnectionId,
    messagesByConversation: { ...state.messagesByConversation, [conversation.id]: [] },
  });
}

export function selectConversation(id: string): void {
  const conversation = state.conversations.find((c) => c.id === id);
  setState({
    activeConversationId: id,
    activeConnectionId: conversation?.connectionId ?? state.activeConnectionId,
  });
  void ensureMessagesLoaded(id);
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`/api/v1/conversations/${id}`, { method: "DELETE" });
  const remaining = state.conversations.filter((c) => c.id !== id);
  const restMessages = { ...state.messagesByConversation };
  delete restMessages[id];
  setState({
    conversations: remaining,
    messagesByConversation: restMessages,
    activeConversationId:
      state.activeConversationId === id ? (remaining[0]?.id ?? null) : state.activeConversationId,
  });
  if (remaining.length === 0) await newConversation();
  else if (state.activeConversationId) void ensureMessagesLoaded(state.activeConversationId);
}

export async function setActiveConnectionId(id: string): Promise<void> {
  setState({ activeConnectionId: id });
  const conversationId = state.activeConversationId;
  if (!conversationId) return;
  const res = await fetch(`/api/v1/conversations/${conversationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connection_id: id }),
  });
  if (!res.ok) return;
  const doc = await res.json();
  const conversation = fromConversationDoc(doc);
  setState({
    conversations: state.conversations.map((c) => (c.id === conversation.id ? conversation : c)),
  });
}

/** Local-only append — used to show a message immediately, before/without a round trip. */
export function appendLocalMessage(conversationId: string, message: StoreMessage): void {
  const existing = state.messagesByConversation[conversationId] ?? [];
  setState({
    messagesByConversation: { ...state.messagesByConversation, [conversationId]: [...existing, message] },
  });
}

/** Patches the most recent message matching `id` — how streamed deltas and the final answer land. */
export function updateLocalMessage(
  conversationId: string,
  id: string,
  patch: Partial<StoreMessage>
): void {
  const existing = state.messagesByConversation[conversationId] ?? [];
  setState({
    messagesByConversation: {
      ...state.messagesByConversation,
      [conversationId]: existing.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    },
  });
}

/** Refreshes a conversation's summary (title, updated_at) after a run titles it. */
export function touchConversation(conversation: StoreConversation): void {
  setState({
    conversations: state.conversations.map((c) => (c.id === conversation.id ? conversation : c)),
  });
}

export function useChatState(): ChatState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useWorkspace() {
  const chat = useChatState();

  const activeConversation: StoreConversation & { messages: StoreMessage[]; messagesLoaded: boolean } = chat.activeConversationId
    ? {
        ...(chat.conversations.find((c) => c.id === chat.activeConversationId) ?? {
          id: chat.activeConversationId,
          title: "New chat",
          connectionId: chat.activeConnectionId,
          updatedAt: new Date().toISOString(),
        }),
        messages: chat.messagesByConversation[chat.activeConversationId] ?? [],
        // Distinguishes "not loaded yet" from "genuinely empty" — without
        // this, a conversation whose history is still in flight looks
        // identical to a brand-new one and briefly shows the wrong empty state.
        messagesLoaded: chat.activeConversationId in chat.messagesByConversation,
      }
    : { id: "", title: "New chat", connectionId: null, updatedAt: "", messages: [], messagesLoaded: false };

  const activeConnection: StoreConnection =
    chat.connections.find((c) => c.id === chat.activeConnectionId) ??
    chat.connections[0] ?? { id: "", name: "No connection", engine: "none", status: "unknown" };

  return {
    loading: chat.loading,
    error: chat.error,
    conversations: chat.conversations,
    connections: chat.connections,
    activeConversationId: chat.activeConversationId,
    activeConversation,
    activeConnection,
    newConversation,
    selectConversation,
    deleteConversation,
    setActiveConnectionId,
  };
}
