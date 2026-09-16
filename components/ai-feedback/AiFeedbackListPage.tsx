"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlagIcon } from "lucide-react";
import { DataTable, type ExportableColumnDef } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AiFeedbackRow = {
  id: string;
  status: string;
  priority: string | null;
  category: string | null;
  description: string;
  tenant_id: string;
  tenant_name: string | null;
  reported_by: { user_id: string; email: string | null };
  assigned_to: { user_id: string; email: string | null } | null;
  created_at: string;
  updated_at: string;
};

type Company = { id: string; name: string };

const STATUS_OPTIONS: Record<string, string> = {
  all: "All statuses",
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  wont_fix: "Won't fix",
  duplicate: "Duplicate",
};
const PRIORITY_OPTIONS: Record<string, string> = {
  all: "All priorities",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
const CATEGORY_OPTIONS: Record<string, string> = {
  all: "All categories",
  incorrect_data: "Incorrect data",
  wrong_sql: "Wrong SQL",
  slow_performance: "Slow performance",
  error_or_crash: "Error or crash",
  unclear_response: "Unclear response",
  other: "Other",
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  in_progress: "secondary",
};

function FilterSelect({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: Record<string, string>;
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(next as string)}>
      <SelectTrigger className="w-auto min-w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([itemValue, itemLabel]) => (
          <SelectItem key={itemValue} value={itemValue}>
            {itemLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The developer-facing AI Feedback list — real server-side pagination and
 * filtering, unlike the client-side fetch-all DataTable/FilterBar pattern
 * the Users/Companies pages use. This is a cross-tenant, potentially
 * growing collection; loading every report up front does not scale the way
 * loading every user in one company does.
 */
export function AiFeedbackListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AiFeedbackRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [tenantId, setTenantId] = useState("all");

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => (res.ok ? res.json() : { companies: [] }))
      .then((body) => setCompanies(body.companies ?? []))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Any filter/search change starts back at the first page. Reset during
  // render (React's documented pattern for "adjusting state when a prop
  // changes") rather than in a follow-up effect, so there is no extra
  // render showing a stale page for the new filters.
  const filterKey = JSON.stringify([debouncedSearch, status, priority, category, tenantId]);
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setCursor(null);
    setCursorStack([]);
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (status !== "all") params.set("status", status);
    if (priority !== "all") params.set("priority", priority);
    if (category !== "all") params.set("category", category);
    if (tenantId !== "all") params.set("tenant_id", tenantId);

    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/ai-feedback?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { data: [], has_more: false, next_cursor: null }))
      .then((body) => {
        if (cancelled) return;
        setRows(body.data ?? []);
        setHasMore(body.has_more ?? false);
        setNextCursor(body.next_cursor ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, debouncedSearch, status, priority, category, tenantId]);

  function goNext() {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, cursor]);
    setCursor(nextCursor);
  }
  function goPrev() {
    setCursorStack((prev) => {
      const next = [...prev];
      const previous = next.pop() ?? null;
      setCursor(previous);
      return next;
    });
  }

  const columns: ExportableColumnDef<AiFeedbackRow>[] = [
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGE_VARIANT[row.original.status] ?? "outline"}>
          {STATUS_OPTIONS[row.original.status] ?? row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) =>
        row.original.priority ? (
          <Badge variant="outline">{PRIORITY_OPTIONS[row.original.priority] ?? row.original.priority}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category ? (
          (CATEGORY_OPTIONS[row.original.category] ?? row.original.category)
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "tenant_name",
      header: "Company",
      cell: ({ row }) => row.original.tenant_name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => <span className="line-clamp-1 block max-w-xs text-sm">{row.original.description}</span>,
    },
    {
      accessorKey: "reported_by",
      header: "Reported by",
      cell: ({ row }) => row.original.reported_by.email ?? "—",
    },
    {
      id: "assigned_to",
      header: "Assigned to",
      cell: ({ row }) =>
        row.original.assigned_to?.email ?? <span className="text-muted-foreground">Unassigned</span>,
    },
    {
      accessorKey: "created_at",
      header: "Reported",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{new Date(row.original.created_at).toLocaleString()}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <FlagIcon className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">AI Feedback</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, context, company, reporter…"
          className="max-w-sm"
        />
        <FilterSelect label="Status" value={status} onChange={setStatus} items={STATUS_OPTIONS} />
        <FilterSelect label="Priority" value={priority} onChange={setPriority} items={PRIORITY_OPTIONS} />
        <FilterSelect label="Category" value={category} onChange={setCategory} items={CATEGORY_OPTIONS} />
        <FilterSelect
          label="Company"
          value={tenantId}
          onChange={setTenantId}
          items={{ all: "All companies", ...Object.fromEntries(companies.map((c) => [c.id, c.name])) }}
        />
      </div>

      <DataTable
        data={rows}
        columns={columns}
        loading={loading}
        getRowId={(row) => row.id}
        emptyMessage="No reports found."
        onRowClick={(row) => router.push(`/ai-feedback/${row.id}`)}
      />

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={cursorStack.length === 0} onClick={goPrev}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={!hasMore} onClick={goNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
