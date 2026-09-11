"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DatabaseIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  companyId: string;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DataAccessDialog({ companyId, companyName, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allTables, setAllTables] = useState<string[]>([]);
  const [granted, setGranted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/companies/${companyId}/data-access`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setAllTables(body.tables ?? []);
        setGranted(new Set(body.granted_tables ?? []));
      })
      .catch(() => {
        if (!cancelled) toast.error("Couldn't load table access.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, companyId]);

  function toggle(table: string, checked: boolean) {
    setGranted((prev) => {
      const next = new Set(prev);
      if (checked) next.add(table);
      else next.delete(table);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/data-access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables: [...granted] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't save table access.");
      }
      toast.success(`Table access updated for ${companyName}.`);
      onOpenChange(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't save table access.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DatabaseIcon className="size-4" />
            Data access — {companyName}
          </DialogTitle>
          <DialogDescription>
            Which tables this company's chat agent can query. Enforced by a dedicated,
            read-only database role — not just an app-level filter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : allTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data tables found.</p>
          ) : (
            allTables.map((table) => (
              <div
                key={table}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <Label htmlFor={`table-${table}`} className="cursor-pointer font-mono text-xs">
                  {table}
                </Label>
                <Switch
                  id={`table-${table}`}
                  checked={granted.has(table)}
                  onCheckedChange={(checked) => toggle(table, checked)}
                />
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? "Saving…" : "Save access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
