"use client";

import { CheckIcon, CircleIcon, LoaderIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentStepStatus = "pending" | "active" | "done" | "failed";

export type AgentStep = {
  label: string;
  status: AgentStepStatus;
  detail?: string | null;
  query_id?: string | null;
};

function StepIcon({ status }: { status: AgentStepStatus }) {
  if (status === "done") {
    return <CheckIcon className="size-3.5 text-primary" />;
  }
  if (status === "failed") {
    return <XIcon className="size-3.5 text-destructive" />;
  }
  if (status === "active") {
    return <LoaderIcon className="size-3.5 animate-spin text-primary" />;
  }
  return <CircleIcon className="size-3.5 text-muted-foreground/50" />;
}

export function AgentStatusBlock({
  title = "Analyzing database",
  steps,
}: {
  title?: string;
  steps: AgentStep[];
}) {
  return (
    <div className="my-3 rounded-lg border border-border bg-muted/40 p-3 not-prose">
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <ul className="space-y-1.5">
        {steps.map((step, index) => (
          <li
            // Labels repeat (e.g. multiple "Ran query" steps in one run), so
            // position is the only stable key for this append-only list.
            key={index}
            className={cn(
              "flex items-center gap-2 text-sm transition-colors",
              step.status === "pending" && "text-muted-foreground",
              (step.status === "active" || step.status === "done") && "text-foreground",
              step.status === "failed" && "text-destructive"
            )}
          >
            <StepIcon status={step.status} />
            <span>{step.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
