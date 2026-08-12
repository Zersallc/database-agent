"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { buildAgentContext, usePlaybook } from "@/lib/playbook-store";
import { useSettings } from "@/lib/settings-store";
import { useWorkspace } from "@/lib/workspace-store";
import type { Attachment, Message } from "@/lib/workspace";
import { ChatComposer } from "./ChatComposer";
import { MessageBubble } from "./MessageBubble";
import {
  AgentStatusBlock,
  DEFAULT_AGENT_STEPS,
  type AgentStep,
} from "./blocks/AgentStatusBlock";

const SUGGESTIONS = [
  "Which regions grew fastest last quarter?",
  "Show me daily signups for the last 7 days",
  "What tables are available in this database?",
  "Find customers with no orders in 90 days",
];

/** Turns an index into the step list the AgentStatusBlock renders. */
function stepsAt(index: number): AgentStep[] {
  return DEFAULT_AGENT_STEPS.map((label, i) => ({
    label,
    status: i < index ? "done" : i === index ? "active" : "pending",
  }));
}

export function ChatWorkspace() {
  const { activeConversation, activeConnection, appendMessage } = useWorkspace();
  const playbook = usePlaybook();
  const settings = useSettings();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = activeConversation.messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading, stepIndex]);

  // Canned progress ticker. Replace with real agent events once the backend
  // streams them.
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, DEFAULT_AGENT_STEPS.length - 1));
    }, 450);
    return () => clearInterval(timer);
  }, [loading]);

  async function send(text: string, files: Attachment[] = []) {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || loading) return;

    const userMessage: Message = {
      role: "user",
      content: trimmed,
      ...(files.length > 0 ? { attachments: files } : {}),
    };
    const history = [...messages, userMessage];
    appendMessage(userMessage);
    setInput("");
    setAttachments([]);
    setStepIndex(0);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          connectionId: activeConnection.id,
          // Everything the Playbook page assembles travels with the question.
          playbookContext: buildAgentContext(playbook),
          enabledSkills: playbook.skills.filter((s) => s.enabled).map((s) => s.name),
          responseDetail: settings.responseDetail,
        }),
      });
      const data = await res.json();
      appendMessage({ role: "assistant", content: data.reply });
    } catch {
      appendMessage({
        role: "assistant",
        content: "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
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
          {messages.length === 0 && !loading ? (
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
                    onClick={() => send(suggestion)}
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
                {messages.map((message, i) => (
                  <MessageBubble key={i} message={message} />
                ))}
              </AnimatePresence>

              {loading && <AgentStatusBlock steps={stepsAt(stepIndex)} />}
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
            onSubmit={() => send(input, attachments)}
            disabled={loading}
            placeholder={`Ask ${activeConnection.name} anything…`}
          />
        </div>
      </div>
    </div>
  );
}
