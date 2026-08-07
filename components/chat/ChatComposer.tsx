"use client";

import { useState } from "react";
import { ArrowUpIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_ATTACHMENTS,
  readImageFiles,
} from "@/lib/attachments";
import type { Attachment } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { AttachmentPicker } from "./AttachmentPicker";

export function ChatComposer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    const next = await readImageFiles(files.slice(0, Math.max(room, 0)));

    const tooMany =
      files.length > room
        ? [`Only ${MAX_ATTACHMENTS} images can be attached to one message`]
        : [];

    setErrors([...next.errors, ...tooMany]);
    if (next.attachments.length > 0) {
      onAttachmentsChange([...attachments, ...next.attachments]);
    }
  }

  const canSend = Boolean(value.trim() || attachments.length > 0);

  return (
    <div className="space-y-1.5">
      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSubmit();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "relative rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring",
          dragging && "border-primary bg-accent/40"
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative size-16 overflow-hidden rounded-lg border border-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  className="size-full object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    onAttachmentsChange(
                      attachments.filter((a) => a.id !== attachment.id)
                    )
                  }
                  className="absolute top-0.5 right-0.5 rounded-full bg-background/90 p-0.5 text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* `field-sizing-content` (from the shadcn base styles) grows the box as
            the user types; max-h caps it. */}
        <Textarea
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length > 0) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          placeholder={placeholder ?? "Ask about your data…"}
          className="max-h-50 min-h-12 resize-none border-0 bg-transparent py-3 pr-20 pl-4 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
        />

        <div className="absolute right-2 bottom-2 flex items-center gap-1">
          <AttachmentPicker
            onFiles={(files) => void addFiles(files)}
            disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
          />
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Send message"
            disabled={disabled || !canSend}
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </form>
    </div>
  );
}
