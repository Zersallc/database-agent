"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { toast } from "sonner";
import { ExecutedQueryBlock } from "@/components/chat/blocks/ExecutedQueryBlock";
import { ThinkingBlock } from "@/components/chat/blocks/ThinkingBlock";
import type { ExecutedQuery } from "@/components/chat/blocks/sql/executed";
import { ReportLinkPicker } from "@/components/ai-feedback/ReportLinkPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Actor = { user_id: string; email: string | null };

type HistoryEntry = {
  id: string;
  at: string;
  actor: Actor;
  type: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  note?: string;
};

type AiFeedbackDetail = {
  id: string;
  description: string;
  category: string | null;
  additional_context: string | null;
  tenant_id: string;
  tenant_name: string | null;
  reported_by: Actor;
  snapshot: {
    request_content: string | null;
    response_content: string | null;
    response_thinking: string | null;
    model: string | null;
    usage: { input_tokens: number; output_tokens: number } | null;
    duration_ms: number | null;
    run_status: string;
    run_error: { code: string; message: string } | null;
    queries: {
      query_id: string;
      sql: string;
      status: string;
      row_count: number;
      truncated: boolean;
      duration_ms: number;
      error: { code: string; message: string } | null;
    }[];
  };
  status: string;
  priority: string | null;
  assigned_to: Actor | null;
  resolution: { summary: string; resolved_at: string; resolved_by: Actor } | null;
  linked_issue_url: string | null;
  duplicate_of: string | null;
  related_report_ids: string[];
  history: HistoryEntry[];
  created_at: string;
  queries_with_rows: {
    query_id: string;
    columns: { name: string; data_type: string | null }[];
    rows: unknown[][];
  }[];
};

type Assignee = { user_id: string; email: string; name: string | null };

const STATUS_ITEMS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  wont_fix: "Won't fix",
  duplicate: "Duplicate",
};
const PRIORITY_ITEMS: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const CATEGORY_ITEMS: Record<string, string> = {
  incorrect_data: "Incorrect data",
  wrong_sql: "Wrong SQL",
  slow_performance: "Slow performance",
  error_or_crash: "Error or crash",
  unclear_response: "Unclear response",
  other: "Other",
};

function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function historyLabel(entry: HistoryEntry): string {
  switch (entry.type) {
    case "created":
      return "Report submitted";
    case "status_changed":
      return "Status changed";
    case "priority_changed":
      return "Priority changed";
    case "category_changed":
      return "Category changed";
    case "assigned":
      return "Assigned";
    case "unassigned":
      return "Unassigned";
    case "note_added":
      return "Note added";
    case "resolved":
      return "Marked resolved";
    case "reopened":
      return "Reopened";
    case "issue_linked":
      return "Issue link updated";
    case "duplicate_linked":
      return "Duplicate link updated";
    case "related_linked":
      return "Related reports updated";
    default:
      return entry.type;
  }
}

/** First drill-down detail route in this app — Users/Companies are list+modal only. */
export function AiFeedbackDetailPage({ feedbackId }: { feedbackId: string }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<AiFeedbackDetail | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [issueUrlDraft, setIssueUrlDraft] = useState("");
  const [duplicatePickerOpen, setDuplicatePickerOpen] = useState(false);
  const [relatedPickerOpen, setRelatedPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/v1/ai-feedback/${feedbackId}`);
      if (cancelled) return;
      if (res.status === 404) {
        setMissing(true);
        setLoading(false);
        return;
      }
      if (res.ok) {
        const body = (await res.json()) as AiFeedbackDetail;
        setFeedback(body);
        setResolutionDraft(body.resolution?.summary ?? "");
        setIssueUrlDraft(body.linked_issue_url ?? "");
      }
      setLoading(false);
    }

    load();
    fetch("/api/v1/ai-feedback/assignees")
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => !cancelled && setAssignees(body.data ?? []))
      .catch(() => !cancelled && setAssignees([]));

    return () => {
      cancelled = true;
    };
  }, [feedbackId]);

  async function patch(input: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    const res = await fetch(`/api/v1/ai-feedback/${feedbackId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setSaving(false);
    if (res.ok) {
      const updated = (await res.json()) as AiFeedbackDetail;
      setFeedback((prev) => (prev ? { ...prev, ...updated, queries_with_rows: prev.queries_with_rows } : prev));
      toast.success("Updated.");
      return true;
    }
    const body = await res.json().catch(() => ({}));
    toast.error(body.message ?? "Couldn't save that change.");
    return false;
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (missing || !feedback) {
    return (
      <div className="space-y-3 p-6">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/ai-feedback")}>
          <ArrowLeftIcon className="size-3.5" />
          Back to AI Feedback
        </Button>
        <p className="text-sm text-muted-foreground">This report could not be found.</p>
      </div>
    );
  }

  const executedQueries: ExecutedQuery[] = feedback.snapshot.queries.map((q) => {
    const live = feedback.queries_with_rows.find((lq) => lq.query_id === q.query_id);
    return {
      id: q.query_id,
      sql: q.sql,
      columns: (live?.columns ?? []).map((c) => c.name),
      rows: (live?.rows ?? []).map((row) => row.map(cell)),
      rowCount: q.row_count,
      truncated: q.truncated,
      executionTimeMs: q.duration_ms,
      error: q.error?.message ?? null,
      label: null,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/ai-feedback")}>
          <ArrowLeftIcon className="size-3.5" />
          Back to AI Feedback
        </Button>
        <Badge variant="outline">{feedback.id}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="space-y-2 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Report</h2>
            <p className="text-sm whitespace-pre-wrap">{feedback.description}</p>
            {feedback.additional_context && (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{feedback.additional_context}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {feedback.reported_by.email ?? "Unknown user"} · {feedback.tenant_name ?? feedback.tenant_id} ·{" "}
              {new Date(feedback.created_at).toLocaleString()}
            </p>
          </section>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Conversation context</h2>
            {feedback.snapshot.request_content && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">User asked</p>
                <p className="text-sm whitespace-pre-wrap">{feedback.snapshot.request_content}</p>
              </div>
            )}
            {feedback.snapshot.response_content && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Assistant responded</p>
                <p className="text-sm whitespace-pre-wrap">{feedback.snapshot.response_content}</p>
              </div>
            )}
            {feedback.snapshot.response_thinking && <ThinkingBlock thinking={feedback.snapshot.response_thinking} />}
            {feedback.snapshot.run_error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {feedback.snapshot.run_error.code}: {feedback.snapshot.run_error.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {feedback.snapshot.model ?? "unknown model"} · run {feedback.snapshot.run_status}
              {feedback.snapshot.duration_ms != null && ` · ${(feedback.snapshot.duration_ms / 1000).toFixed(1)}s`}
              {feedback.snapshot.usage &&
                ` · ${(
                  feedback.snapshot.usage.input_tokens + feedback.snapshot.usage.output_tokens
                ).toLocaleString()} tokens`}
            </p>
          </section>

          {executedQueries.length > 0 && (
            <section className="space-y-2 rounded-lg border border-border p-4">
              <h2 className="text-sm font-semibold">Queries</h2>
              {executedQueries.map((query) => (
                <ExecutedQueryBlock key={query.id} query={query} showResults />
              ))}
            </section>
          )}

          <section className="space-y-2 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">History</h2>
            <ul className="space-y-2">
              {feedback.history.map((entry) => (
                <li key={entry.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{historyLabel(entry)}</span> by{" "}
                  {entry.actor.email ?? "unknown"} · {new Date(entry.at).toLocaleString()}
                  {entry.note && <p className="mt-0.5 text-foreground">{entry.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <section className="space-y-3 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Triage</h2>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                items={STATUS_ITEMS}
                value={feedback.status}
                onValueChange={(value) => {
                  // Resolving requires a summary — handled by the box below.
                  if (value !== "resolved") void patch({ status: value as string });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                items={PRIORITY_ITEMS}
                value={feedback.priority ?? undefined}
                onValueChange={(value) => void patch({ priority: value as string })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                items={CATEGORY_ITEMS}
                value={feedback.category ?? undefined}
                onValueChange={(value) => void patch({ category: value as string })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Assigned to</Label>
              <Select
                items={{
                  unassigned: "Unassigned",
                  ...Object.fromEntries(assignees.map((a) => [a.user_id, a.name || a.email])),
                }}
                value={feedback.assigned_to?.user_id ?? "unassigned"}
                onValueChange={(value) => {
                  if (value === "unassigned") void patch({ unassign: true });
                  else void patch({ assigned_to_user_id: value as string });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {assignees.map((a) => (
                    <SelectItem key={a.user_id} value={a.user_id}>
                      {a.name || a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 border-t border-border pt-3">
              <Label>Resolution summary</Label>
              <Textarea
                value={resolutionDraft}
                onChange={(e) => setResolutionDraft(e.target.value)}
                rows={3}
                placeholder="What was the root cause / fix?"
              />
              <div className="flex flex-wrap gap-2">
                {feedback.status !== "resolved" && (
                  <Button
                    size="sm"
                    disabled={saving || !resolutionDraft.trim()}
                    onClick={() => void patch({ status: "resolved", resolution_summary: resolutionDraft.trim() })}
                  >
                    Mark resolved
                  </Button>
                )}
                {feedback.resolution && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      saving || !resolutionDraft.trim() || resolutionDraft.trim() === feedback.resolution.summary
                    }
                    onClick={() => void patch({ resolution_summary: resolutionDraft.trim() })}
                  >
                    Save summary
                  </Button>
                )}
              </div>
              {feedback.resolution && (
                <p className="text-xs text-muted-foreground">
                  Resolved by {feedback.resolution.resolved_by.email ?? "—"} on{" "}
                  {new Date(feedback.resolution.resolved_at).toLocaleString()}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Links</h2>

            <div className="space-y-1.5">
              <Label>Issue tracker URL</Label>
              <div className="flex gap-2">
                <Input
                  value={issueUrlDraft}
                  onChange={(e) => setIssueUrlDraft(e.target.value)}
                  placeholder="https://github.com/…/issues/123"
                />
                {feedback.linked_issue_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={feedback.linked_issue_url} target="_blank" rel="noreferrer" />}
                  >
                    Open
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={
                    saving || !issueUrlDraft.trim() || issueUrlDraft.trim() === (feedback.linked_issue_url ?? "")
                  }
                  onClick={() => void patch({ linked_issue_url: issueUrlDraft.trim() })}
                >
                  Save
                </Button>
                {feedback.linked_issue_url && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={async () => {
                      if (await patch({ unlink_issue: true })) setIssueUrlDraft("");
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5 border-t border-border pt-3">
              <Label>Duplicate of</Label>
              {feedback.duplicate_of ? (
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => router.push(`/ai-feedback/${feedback.duplicate_of}`)}
                  >
                    {feedback.duplicate_of}
                  </Button>
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => void patch({ unmark_duplicate: true })}>
                    Clear
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setDuplicatePickerOpen(true)}>
                  Mark as duplicate…
                </Button>
              )}
            </div>

            <div className="space-y-1.5 border-t border-border pt-3">
              <Label>Related reports</Label>
              {feedback.related_report_ids.length > 0 && (
                <ul className="space-y-1">
                  {feedback.related_report_ids.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => router.push(`/ai-feedback/${id}`)}
                      >
                        {id}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => void patch({ remove_related_report_id: id })}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button size="sm" variant="outline" onClick={() => setRelatedPickerOpen(true)}>
                Add related report…
              </Button>
            </div>
          </section>

          <section className="space-y-2 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">Add a note</h2>
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={2}
              placeholder="Internal note for other developers"
            />
            <Button
              size="sm"
              disabled={saving || !noteDraft.trim()}
              onClick={async () => {
                if (await patch({ note: noteDraft.trim() })) setNoteDraft("");
              }}
            >
              Add note
            </Button>
          </section>
        </div>
      </div>

      <ReportLinkPicker
        open={duplicatePickerOpen}
        onOpenChange={setDuplicatePickerOpen}
        excludeId={feedback.id}
        title="Mark as duplicate of…"
        onSelect={(r) => void patch({ duplicate_of: r.id })}
      />
      <ReportLinkPicker
        open={relatedPickerOpen}
        onOpenChange={setRelatedPickerOpen}
        excludeId={feedback.id}
        title="Add a related report…"
        onSelect={(r) => void patch({ add_related_report_id: r.id })}
      />
    </div>
  );
}
