"use client";

import { CheckIcon, CircleIcon, LoaderIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentStepStatus = "pending" | "active" | "done";

export type AgentStep = {
  label: string;
  status: AgentStepStatus;
};

/** The canned progress the mock backend "runs through" on every question. */
export const DEFAULT_AGENT_STEPS: string[] = [
  "Connecting to database",
  "Finding relevant tables",
  "Generating SQL",
  "Running query",
  "Creating visualization",
];

function StepIcon({ status }: { status: AgentStepStatus }) {
  if (status === "done") {
    return <CheckIcon className="size-3.5 text-primary" />;
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
        {steps.map((step) => (
          <li
            key={step.label}
            className={cn(
              "flex items-center gap-2 text-sm transition-colors",
              step.status === "pending" && "text-muted-foreground",
              step.status === "active" && "text-foreground",
              step.status === "done" && "text-foreground"
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
