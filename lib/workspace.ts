export type Message = {
  role: "user" | "assistant";
  content: string;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
};

export type ConnectionStatus = "connected" | "degraded" | "offline";

export type Connection = {
  id: string;
  name: string;
  engine: string;
  status: ConnectionStatus;
};

/**
 * Mock connections. The real list will come from the Google Cloud backend once
 * database connection management exists.
 */
export const MOCK_CONNECTIONS: Connection[] = [
  {
    id: "prod-postgres",
    name: "Production",
    engine: "PostgreSQL",
    status: "connected",
  },
  {
    id: "analytics-bigquery",
    name: "Analytics Warehouse",
    engine: "BigQuery",
    status: "connected",
  },
  {
    id: "staging-mysql",
    name: "Staging",
    engine: "MySQL",
    status: "degraded",
  },
  {
    id: "archive-postgres",
    name: "Archive",
    engine: "PostgreSQL",
    status: "offline",
  },
];

export const NEW_CONVERSATION_TITLE = "New chat";

export function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: NEW_CONVERSATION_TITLE,
    createdAt: Date.now(),
    messages: [],
  };
}

/** Derives a sidebar label from the first thing the user asked. */
export function titleFromMessage(content: string): string {
  const flattened = content.replace(/\s+/g, " ").trim();
  if (!flattened) return NEW_CONVERSATION_TITLE;
  return flattened.length > 48 ? `${flattened.slice(0, 48)}…` : flattened;
}
