"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * The model's reasoning, hidden by default — collapsed exactly like a fresh
 * message today, on the newest message or any other. Unlike
 * `ExecutedQueryBlock` this takes no `defaultOpen`: there is no case where
 * this should ever open itself, so the option doesn't exist to be misused.
 */
export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-2 not-prose">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs italic text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRightIcon className="size-3 shrink-0 transition-transform duration-150 data-[panel-open]:rotate-90" />
          <span>{open ? "Hide thinking" : "Show thinking"}</span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <p className="mt-1.5 border-l-2 border-border pl-3 text-xs whitespace-pre-wrap italic text-muted-foreground">
            {thinking}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
