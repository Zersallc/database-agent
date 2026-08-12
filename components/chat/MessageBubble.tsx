"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { SparklesIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "./Markdown";
import type { StoreMessage } from "@/lib/chat-store";
import type { Attachment } from "@/lib/workspace";

function AttachmentGrid({ attachments }: { attachments: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);

  return (
    <>
      <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
        {attachments.map((attachment) => (
          <button
            key={attachment.id}
            type="button"
            onClick={() => setOpen(attachment)}
            className="overflow-hidden rounded-lg border border-border transition-opacity hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="max-h-40 max-w-56 object-cover"
            />
          </button>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={() => setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="truncate text-sm">{open?.name}</DialogTitle>
          {open && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={open.dataUrl}
              alt={open.name}
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function UsageLine({ message }: { message: StoreMessage }) {
  if (message.streaming || !message.usage) return null;
  const { input_tokens, output_tokens } = message.usage;
  const total = input_tokens + output_tokens;
  const seconds = message.durationMs ? (message.durationMs / 1000).toFixed(1) : null;

  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      {total.toLocaleString()} tokens ({input_tokens.toLocaleString()} in ·{" "}
      {output_tokens.toLocaleString()} out)
      {seconds && ` · ${seconds}s`}
    </p>
  );
}

export function MessageBubble({ message }: { message: StoreMessage }) {
  const isUser = message.role === "user";
  const attachments = message.attachments ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={isUser ? "flex flex-col items-end" : "flex gap-3"}
    >
      {!isUser && (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <SparklesIcon className="size-3.5" />
        </div>
      )}

      {isUser ? (
        <>
          {attachments.length > 0 && <AttachmentGrid attachments={attachments} />}
          {message.content && (
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
              {message.content}
            </div>
          )}
        </>
      ) : (
        <div className="min-w-0 flex-1 text-sm">
          <Markdown content={message.content} />
          <UsageLine message={message} />
        </div>
      )}
    </motion.div>
  );
}
