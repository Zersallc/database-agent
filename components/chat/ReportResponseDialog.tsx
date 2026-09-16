"use client";

import { useState } from "react";
import { FlagIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES: Record<string, string> = {
  incorrect_data: "Incorrect data",
  wrong_sql: "Wrong SQL",
  slow_performance: "Slow performance",
  error_or_crash: "Error or crash",
  unclear_response: "Unclear response",
  other: "Other",
};

function truncate(text: string, max = 140): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened.length > max ? `${flattened.slice(0, max)}…` : flattened;
}

/** The Report button next to a completed assistant response. Owns its own dialog state. */
export function ReportResponseButton({ runId, preview }: { runId: string; preview: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="icon-xs" aria-label="Report this response" onClick={() => setOpen(true)}>
        <FlagIcon />
      </Button>
      <ReportResponseDialog open={open} onOpenChange={setOpen} runId={runId} preview={preview} />
    </>
  );
}

function ReportResponseDialog({
  open,
  onOpenChange,
  runId,
  preview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  preview: string;
}) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("none");
  const [additionalContext, setAdditionalContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Re-minted only when the dialog is freshly opened — a double click or a
  // browser retry within one open reuses this key, so the server either
  // replays the same result or rejects a genuine concurrent duplicate.
  // Closing and reopening to file a second report mints a fresh one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  function handleOpenChange(next: boolean) {
    if (next) {
      setDescription("");
      setCategory("none");
      setAdditionalContext("");
      setFormError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
    onOpenChange(next);
  }

  async function handleSubmit() {
    setFormError(null);
    if (!description.trim()) {
      setFormError("Describe what went wrong.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/v1/ai-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        run_id: runId,
        description: description.trim(),
        category: category === "none" ? undefined : category,
        additional_context: additionalContext.trim() || undefined,
      }),
    });
    setSaving(false);

    if (res.ok) {
      toast.success("Report submitted. Thanks for flagging it.");
      onOpenChange(false);
    } else {
      const body = await res.json().catch(() => ({}));
      const message = body.message ?? "Couldn't submit the report.";
      setFormError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report this response</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. A developer will review the full context behind this answer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {formError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>
          )}

          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Reporting: &ldquo;{truncate(preview)}&rdquo;
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-description">What went wrong?</Label>
            <Textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. the total doesn't match what I see elsewhere"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Category (optional)</Label>
            <Select
              items={{ none: "No category", ...CATEGORIES }}
              value={category}
              onValueChange={(value) => setCategory(value as string)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {Object.entries(CATEGORIES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-context">Additional context (optional)</Label>
            <Textarea
              id="report-context"
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value)}
              placeholder="Anything else that would help a developer investigate"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Submitting…" : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
