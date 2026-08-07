"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { setSystemPrompt } from "@/lib/playbook-store";

export function SystemPromptCard({ value }: { value: string }) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const [saved, setSaved] = useState(false);

  // Adjust state during render when the stored value changes underneath us
  // (a save here, or a reset from settings) — React's documented alternative
  // to syncing props into state from an effect.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const dirty = draft !== value;

  function save() {
    setSystemPrompt(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>System instructions</CardTitle>
        <CardDescription>
          Always sent, ahead of everything else. Describe how the agent should
          behave in general.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          className="min-h-40 font-mono text-xs"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={!dirty}>
            {saved ? <CheckIcon /> : null}
            {saved ? "Saved" : "Save"}
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(value)}>
              Discard
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {draft.length.toLocaleString()} characters
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
