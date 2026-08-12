"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app-shell/PageHeader";
import {
  appendLocalMessage,
  touchConversation,
  updateLocalMessage,
  useWorkspace,
  waitForMessages,
  type StoreConversation,
} from "@/lib/chat-store";
import { useSettings } from "@/lib/settings-store";
import type { Attachment } from "@/lib/workspace";
import { ChatComposer } from "./ChatComposer";
import { MessageBubble } from "./MessageBubble";
import { AgentStatusBlock, type AgentStep } from "./blocks/AgentStatusBlock";

const SUGGESTIONS = [
  "Which regions grew fastest last quarter?",
  "Show me daily signups for the last 7 days",
  "What tables are available in this database?",
  "Find customers with no orders in 90 days",
];

/** One line per `event:`/`data:` block in a text/event-stream body. */
async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) yield { event, data: dataLines.join("\n") };
    }
  }
}

export function ChatWorkspace() {
  const {
    activeConversation,
    activeConnection,
    connections,
    loading: workspaceLoading,
    error: workspaceError,
  } = useWorkspace();
  const settings = useSettings();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [running, setRunning] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = activeConversation.messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, running, liveSteps.length]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || running || !activeConversation.id) return;

    const conversationId = activeConversation.id;
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();

    setInput("");
    setAttachments([]);
    setLiveSteps([]);
    setRunning(true);

    try {
      // Otherwise a message sent the instant a conversation is opened can
      // append before that conversation's history finishes loading, and the
      // history fetch then overwrites it when it lands.
      await waitForMessages(conversationId);

      appendLocalMessage(conversationId, { id: userMessageId, role: "user", content: trimmed });
      appendLocalMessage(conversationId, {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        streaming: true,
      });

      const res = await fetch(`/api/v1/conversations/${conversationId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          content: trimmed,
          connection_id: activeConnection.id || undefined,
          response_detail: settings.responseDetail,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`The agent could not be reached (${res.status}).`);
      }

      let finalContent = "";
      for await (const { event, data } of parseSse(res.body)) {
        const payload = JSON.parse(data);
        if (event === "run.step") {
          setLiveSteps((prev) => [...prev, payload.step]);
        } else if (event === "run.content_delta") {
          finalContent += payload.delta;
          updateLocalMessage(conversationId, assistantMessageId, { content: finalContent, streaming: true });
        } else if (event === "run.completed") {
          updateLocalMessage(conversationId, assistantMessageId, {
            content: payload.run.content ?? finalContent,
            streaming: false,
          });
        } else if (event === "run.failed") {
          updateLocalMessage(conversationId, assistantMessageId, {
            content: `**Something went wrong.**\n\n${payload.error?.message ?? payload.run?.error?.message ?? "The agent could not answer."}`,
            streaming: false,
          });
        }
      }

      // The first question titles the conversation server-side — refresh the
      // sidebar's copy so it stops saying "New chat".
      const convRes = await fetch(`/api/v1/conversations/${conversationId}`);
      if (convRes.ok) {
        const doc = await convRes.json();
        touchConversation({
          id: doc.id,
          title: doc.title,
          connectionId: doc.connection_id,
          updatedAt: doc.updated_at,
        } satisfies StoreConversation);
      }
    } catch (error) {
      updateLocalMessage(conversationId, assistantMessageId, {
        content: `**Something went wrong.**\n\n${error instanceof Error ? error.message : "Please try again."}`,
        streaming: false,
      });
    } finally {
      setRunning(false);
      setLiveSteps([]);
    }
  }

  if (workspaceLoading) {
    return (
      <div className="flex h-svh flex-col">
        <PageHeader title="Chat" />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading workspace…
        </div>
      </div>
    );
  }

  if (workspaceError || connections.length === 0) {
    return (
      <div className="flex h-svh flex-col">
        <PageHeader title="Chat" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <p>{workspaceError ?? "No database connection is set up for this workspace yet."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-svh flex-col">
      <PageHeader
        title={activeConversation.title}
        actions={
          <Badge variant="secondary">
            {activeConnection.name} · {activeConnection.engine}
          </Badge>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {!activeConversation.messagesLoaded ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Loading conversation…
            </div>
          ) : messages.length === 0 && !running ? (
            <div className="flex flex-col items-center gap-6 py-16 text-center">
              <div>
                <h1 className="text-2xl font-semibold">
                  Ask anything about your data
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connected to {activeConnection.name} ({activeConnection.engine})
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <AnimatePresence initial={false}>
                {messages
                  // An empty streaming placeholder has nothing to show yet —
                  // the status block below is what tells the user something
                  // is happening. Once text starts arriving it renders normally.
                  .filter((message) => message.content || !message.streaming)
                  .map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
              </AnimatePresence>

              {running && (
                <AgentStatusBlock
                  steps={
                    liveSteps.length > 0
                      ? liveSteps
                      : [{ label: "Thinking…", status: "active" }]
                  }
                />
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer
            value={input}
            onChange={setInput}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onSubmit={() => void send(input)}
            disabled={running}
            placeholder={`Ask ${activeConnection.name} anything…`}
          />
        </div>
      </div>
    </div>
  );
}
