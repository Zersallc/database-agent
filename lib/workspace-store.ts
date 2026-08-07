"use client";

import { useSyncExternalStore } from "react";
import {
  createConversation,
  MOCK_CONNECTIONS,
  NEW_CONVERSATION_TITLE,
  titleFromMessage,
  type Connection,
  type Conversation,
  type Message,
} from "./workspace";

const STORAGE_KEY = "database-agent:workspace";

export type WorkspaceState = {
  conversations: Conversation[];
  activeConversationId: string;
  activeConnectionId: string;
};

/**
 * Mock workspace state kept in an external store so components can read it with
 * useSyncExternalStore: the server always renders SERVER_STATE, and the client
 * swaps in whatever was persisted without a setState-in-effect round trip.
 *
 * All of this is a stand-in for real conversation/connection APIs.
 */
const SERVER_STATE: WorkspaceState = {
  conversations: [
    {
      id: "initial",
      title: NEW_CONVERSATION_TITLE,
      createdAt: 0,
      messages: [],
    },
  ],
  activeConversationId: "initial",
  activeConnectionId: MOCK_CONNECTIONS[0].id,
};

let state: WorkspaceState | null = null;
const listeners = new Set<() => void>();

function load(): WorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WorkspaceState;
      if (Array.isArray(parsed.conversations) && parsed.conversations.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Storage unavailable (private mode, quota) — fall through to a fresh state.
  }
  const conversation = createConversation();
  return {
    conversations: [conversation],
    activeConversationId: conversation.id,
    activeConnectionId: MOCK_CONNECTIONS[0].id,
  };
}

function getSnapshot(): WorkspaceState {
  state ??= load();
  return state;
}

function getServerSnapshot(): WorkspaceState {
  return SERVER_STATE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(updater: (prev: WorkspaceState) => WorkspaceState) {
  state = updater(getSnapshot());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best-effort; the demo still works in memory.
  }
  listeners.forEach((listener) => listener());
}

export function newConversation() {
  update((prev) => {
    // Reuse an untouched conversation instead of piling up empty ones.
    const existingEmpty = prev.conversations.find((c) => c.messages.length === 0);
    if (existingEmpty) {
      return { ...prev, activeConversationId: existingEmpty.id };
    }
    const conversation = createConversation();
    return {
      ...prev,
      conversations: [conversation, ...prev.conversations],
      activeConversationId: conversation.id,
    };
  });
}

export function selectConversation(id: string) {
  update((prev) => ({ ...prev, activeConversationId: id }));
}

export function deleteConversation(id: string) {
  update((prev) => {
    const remaining = prev.conversations.filter((c) => c.id !== id);
    if (remaining.length === 0) {
      const conversation = createConversation();
      return {
        ...prev,
        conversations: [conversation],
        activeConversationId: conversation.id,
      };
    }
    return {
      ...prev,
      conversations: remaining,
      activeConversationId:
        prev.activeConversationId === id
          ? remaining[0].id
          : prev.activeConversationId,
    };
  });
}

export function setActiveConnectionId(id: string) {
  update((prev) => ({ ...prev, activeConnectionId: id }));
}

export function appendMessage(message: Message) {
  update((prev) => ({
    ...prev,
    conversations: prev.conversations.map((conversation) => {
      if (conversation.id !== prev.activeConversationId) return conversation;
      const isFirstUserMessage =
        message.role === "user" && conversation.messages.length === 0;
      return {
        ...conversation,
        title: isFirstUserMessage
          ? titleFromMessage(message.content)
          : conversation.title,
        messages: [...conversation.messages, message],
      };
    }),
  }));
}

export function useWorkspaceState(): WorkspaceState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useWorkspace() {
  const workspace = useWorkspaceState();

  const activeConversation: Conversation =
    workspace.conversations.find((c) => c.id === workspace.activeConversationId) ??
    workspace.conversations[0];

  const activeConnection: Connection =
    MOCK_CONNECTIONS.find((c) => c.id === workspace.activeConnectionId) ??
    MOCK_CONNECTIONS[0];

  return {
    ...workspace,
    connections: MOCK_CONNECTIONS,
    activeConversation,
    activeConnection,
    // Module-level, so already stable across renders.
    newConversation,
    selectConversation,
    deleteConversation,
    setActiveConnectionId,
    appendMessage,
  };
}
