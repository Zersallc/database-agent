"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildAgentContext, type PlaybookState } from "@/lib/playbook-store";

export function ContextPreview({ playbook }: { playbook: PlaybookState }) {
  const [open, setOpen] = useState(false);
  const context = buildAgentContext(playbook);
  const enabled = playbook.skills.filter((s) => s.enabled);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What the agent reads</CardTitle>
        <CardDescription>
          The exact context sent with every question — system instructions
          followed by each enabled skill.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {enabled.length} of {playbook.skills.length} skills active
          </Badge>
          <Badge variant="outline">
            {context.length.toLocaleString()} characters
          </Badge>
          {/* Rough rule of thumb; the real count comes from the model's tokenizer. */}
          <Badge variant="outline">
            ~{Math.ceil(context.length / 4).toLocaleString()} tokens
          </Badge>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => navigator.clipboard.writeText(context)}
          >
            <CopyIcon />
            Copy
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          {open ? "Hide" : "Show"} full context
        </Button>

        {open && (
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
            {context}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
