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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adjust state during render when the stored value changes underneath us
  // (a save here, or a reset from settings) — React's documented alternative
  // to syncing props into state from an effect.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const dirty = draft !== value;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setSystemPrompt(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
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
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saved ? <CheckIcon /> : null}
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </Button>
          {dirty && !saving && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(value)}>
              Discard
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {draft.length.toLocaleString()} characters
          </span>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
