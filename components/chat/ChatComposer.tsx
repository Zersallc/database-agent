"use client";

import { ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="relative rounded-2xl border border-border bg-card shadow-sm focus-within:border-ring"
    >
      {/* `field-sizing-content` (from the shadcn base styles) grows the box as
          the user types; max-h caps it. */}
      <Textarea
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder ?? "Ask about your data…"}
        className="max-h-50 min-h-12 resize-none border-0 bg-transparent py-3 pr-12 pl-4 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <Button
        type="submit"
        size="icon-sm"
        aria-label="Send message"
        disabled={disabled || !value.trim()}
        className="absolute right-2 bottom-2"
      >
        <ArrowUpIcon />
      </Button>
    </form>
  );
}
