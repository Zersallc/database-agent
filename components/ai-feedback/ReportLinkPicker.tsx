"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type PickableReport = {
  id: string;
  description: string;
  tenant_name: string | null;
  status: string;
};

/**
 * Search-and-select dialog for linking one AI Feedback report to another.
 * Reuses the same list/search endpoint the list page already calls
 * (GET /v1/ai-feedback?q=...) rather than a dedicated lookup — per the plan,
 * Phase 2's linking picker is meant to reuse Phase 1's list/search machinery,
 * not introduce a second search path.
 */
export function ReportLinkPicker({
  open,
  onOpenChange,
  excludeId,
  title,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeId: string;
  title: string;
  onSelect: (report: PickableReport) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<PickableReport[]>([]);
  const [loading, setLoading] = useState(false);

  // Reset search state whenever the dialog transitions to open, adjusted
  // during render (React's documented pattern) rather than in a follow-up
  // effect — same approach AiFeedbackListPage.tsx uses for its filter reset.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setDebounced("");
      setResults([]);
    }
  }

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (debounced) params.set("q", debounced);
    fetch(`/api/v1/ai-feedback?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body: { data?: PickableReport[] }) => {
        if (cancelled) return;
        setResults((body.data ?? []).filter((r) => r.id !== excludeId));
      })
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, debounced, excludeId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Search by description, company, or reporter.</DialogDescription>
        </DialogHeader>

        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reports…" autoFocus />

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loading && <p className="p-2 text-sm text-muted-foreground">Searching…</p>}
          {!loading && results.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">No reports found.</p>
          )}
          {!loading &&
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full rounded-md border border-border p-2 text-left text-sm hover:bg-muted/50"
                onClick={() => {
                  onSelect(r);
                  onOpenChange(false);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1">{r.description}</span>
                  <Badge variant="outline" className="shrink-0">
                    {r.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.tenant_name ?? "—"} · {r.id}
                </p>
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
