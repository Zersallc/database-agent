"use client";

import { useRef } from "react";
import { PaperclipIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCEPT_ATTRIBUTE } from "@/lib/attachments";

export function AttachmentPicker({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          // Allow re-picking the same file.
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled}
        aria-label="Attach an image"
        onClick={() => inputRef.current?.click()}
      >
        <PaperclipIcon />
      </Button>
    </>
  );
}
