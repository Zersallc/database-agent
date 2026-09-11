"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DatabaseIcon, PencilIcon, PlusIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { DataAccessDialog } from "@/components/companies/DataAccessDialog";
import type { ExportableColumnDef } from "@/components/shared/DataTable";
import { DataTable } from "@/components/shared/DataTable";
import { FilterBar, useFilteredData, type FilterConfig } from "@/components/shared/FilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MANAGED_CONNECTION_NAME = "Company data access (managed)";

type MappingConnection = {
  id: string;
  name: string;
  engine: string;
  status: string;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
};

type MappingCompany = {
  company_id: string;
  company_name: string;
  connections: MappingConnection[];
  granted_tables: string[];
};

type AuditEvent = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  company_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type Row = {
  companyId: string;
  companyName: string;
  connection: MappingConnection;
  isManaged: boolean;
  grantedTables: string[] | null;
  groupKey: string;
  groupLabel: string;
};

const ENGINES = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "bigquery", label: "BigQuery" },
];

const ADD_FORM_EMPTY = {
  companyId: "",
  name: "",
  engine: "postgres",
  host: "",
  port: "",
  database: "",
  username: "",
  password: "",
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function groupKeyFor(connection: MappingConnection): string {
  return `${connection.engine}::${connection.host ?? ""}::${connection.database ?? connection.id}`;
}

function buildRows(companies: MappingCompany[]): Row[] {
  const rows: Row[] = [];
  for (const company of companies) {
    for (const connection of company.connections) {
      const isManaged = connection.name === MANAGED_CONNECTION_NAME;
      rows.push({
        companyId: company.company_id,
        companyName: company.company_name,
        connection,
        isManaged,
        grantedTables: isManaged ? company.granted_tables : null,
        groupKey: groupKeyFor(connection),
        groupLabel: connection.database || connection.name,
      });
    }
  }
  return rows.sort(
    (a, b) => a.groupLabel.localeCompare(b.groupLabel) || a.companyName.localeCompare(b.companyName)
  );
}

function describeEvent(event: AuditEvent, companyNameById: Map<string, string>): string {
  const who = event.actor_email ?? "Someone";
  const company = event.company_id ? companyNameById.get(event.company_id) : undefined;
  const meta = event.metadata ?? {};
  const suffix = company ? ` — ${company}` : "";

  switch (event.action) {
    case "connection.created":
      return `${who} registered database "${meta.name}"${suffix}`;
    case "connection.deleted":
      return `${who} removed database "${meta.name}"${suffix}`;
    case "data_access.updated": {
      const granted = (meta.granted as string[] | undefined) ?? [];
      const revoked = (meta.revoked as string[] | undefined) ?? [];
      const parts: string[] = [];
      if (granted.length) parts.push(`granted ${granted.join(", ")}`);
      if (revoked.length) parts.push(`revoked ${revoked.join(", ")}`);
      return `${who} ${parts.join("; ")}${suffix}`;
    }
    case "company.created":
      return `${who} created company "${meta.name}"`;
    case "company.updated":
      return `${who} updated ${company ?? "a company"}`;
    case "company.deleted":
      return `${who} deleted company "${meta.name}"`;
    case "user.created":
      return `${who} added user ${meta.email}${suffix}`;
    case "user.updated":
      return `${who} updated user${suffix}`;
    case "user.deleted":
      return `${who} removed user ${meta.email}`;
    default:
      return `${who} ${event.action}`;
  }
}

const FILTER_CONFIG: FilterConfig<Row>[] = [
  { column: "database", label: "Database", type: "enum", getValue: (row) => row.groupLabel },
  { column: "engine", label: "Engine", type: "enum", getValue: (row) => row.connection.engine },
  { column: "company", label: "Company", type: "enum", getValue: (row) => row.companyName },
  { column: "status", label: "Status", type: "enum", getValue: (row) => row.connection.status },
];

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DatabaseMappingPage() {
  const [companies, setCompanies] = useState<MappingCompany[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [dataAccessTarget, setDataAccessTarget] = useState<{ companyId: string; companyName: string } | null>(
    null
  );

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(ADD_FORM_EMPTY);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState(ADD_FORM_EMPTY);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [assignTarget, setAssignTarget] = useState<Row | null>(null);
  const [assignCompanyId, setAssignCompanyId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ companyId: string; connection: MappingConnection } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mappingRes, eventsRes] = await Promise.all([
        fetch("/api/database-mapping"),
        fetch("/api/audit-events?limit=30"),
      ]);
      const mappingBody = await mappingRes.json();
      setCompanies(mappingBody.companies ?? []);
      const eventsBody = await eventsRes.json().catch(() => ({}));
      setEvents(eventsBody.events ?? []);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => buildRows(companies), [companies]);
  const filters = useFilteredData(rows, FILTER_CONFIG);
  const companyNameById = useMemo(
    () => new Map(companies.map((c) => [c.company_id, c.company_name])),
    [companies]
  );

  function openAdd() {
    setAddForm(ADD_FORM_EMPTY);
    setAddError(null);
    setAddOpen(true);
  }

  async function submitAdd() {
    setAddError(null);
    if (!addForm.companyId) return setAddError("Pick a company.");
    if (!addForm.name.trim()) return setAddError("Name is required.");

    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${addForm.companyId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          engine: addForm.engine,
          credentials: {
            host: addForm.host || undefined,
            port: addForm.port ? Number(addForm.port) : undefined,
            database: addForm.database || undefined,
            username: addForm.username || undefined,
            password: addForm.password || undefined,
            ssl: true,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't register this database.");
      }
      toast.success(`Database registered.`);
      setAddOpen(false);
      load();
    } catch (cause) {
      setAddError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row: Row) {
    setEditTarget(row);
    setEditForm({
      companyId: row.companyId,
      name: row.connection.name,
      engine: row.connection.engine,
      host: row.connection.host ?? "",
      port: row.connection.port ? String(row.connection.port) : "",
      database: row.connection.database ?? "",
      username: row.connection.username ?? "",
      password: "",
    });
    setEditError(null);
  }

  async function submitEdit() {
    if (!editTarget) return;
    setEditError(null);
    if (!editForm.name.trim()) return setEditError("Name is required.");

    setEditSaving(true);
    try {
      const res = await fetch(
        `/api/companies/${editTarget.companyId}/connections/${editTarget.connection.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editForm.name.trim(),
            host: editForm.host || undefined,
            port: editForm.port ? Number(editForm.port) : undefined,
            database: editForm.database || undefined,
            username: editForm.username || undefined,
            password: editForm.password || undefined,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't save changes.");
      }
      toast.success("Connection updated.");
      setEditTarget(null);
      load();
    } catch (cause) {
      setEditError(describeError(cause));
    } finally {
      setEditSaving(false);
    }
  }

  function openAssign(row: Row) {
    setAssignTarget(row);
    setAssignCompanyId("");
  }

  const assignCandidates = assignTarget
    ? companies.filter(
        (c) => !rows.some((r) => r.groupKey === assignTarget.groupKey && r.companyId === c.company_id)
      )
    : [];

  async function submitAssign() {
    if (!assignTarget || !assignCompanyId) return;
    setAssigning(true);
    try {
      const res = await fetch(
        `/api/companies/${assignTarget.companyId}/connections/${assignTarget.connection.id}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_company_id: assignCompanyId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't assign this company.");
      }
      toast.success(`${companyNameById.get(assignCompanyId)} assigned.`);
      setAssignTarget(null);
      load();
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setAssigning(false);
    }
  }

  async function testConnection(companyId: string, connectionId: string) {
    setTestingId(connectionId);
    try {
      const res = await fetch(`/api/companies/${companyId}/connections/${connectionId}/test`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Test failed.");
      if (body.status === "connected") {
        toast.success(`Connected (${body.latency_ms ?? "?"}ms).`);
      } else {
        toast.error(`${body.status}${body.detail ? `: ${body.detail}` : ""}`);
      }
      load();
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setTestingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const res = await fetch(
      `/api/companies/${deleteTarget.companyId}/connections/${deleteTarget.connection.id}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      toast.success(`${deleteTarget.connection.name} removed.`);
      setDeleteTarget(null);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't remove that database.");
    }
  }

  const columns: ExportableColumnDef<Row>[] = [
    {
      id: "database",
      accessorFn: (row) => row.groupLabel,
      header: "Database",
      meta: { exportHeader: "Database", exportValue: (row) => row.groupLabel },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div>
            <div className="flex items-center gap-2">
              <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{r.groupLabel}</span>
              <Badge variant="outline">{r.connection.engine}</Badge>
            </div>
            {r.connection.host && (
              <div className="ml-5.5 font-mono text-xs text-muted-foreground">
                {r.connection.host}
                {r.connection.port ? `:${r.connection.port}` : ""}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "companyName",
      header: "Company",
      meta: { exportHeader: "Company", exportValue: (row) => row.companyName },
      cell: ({ row }) => <span className="font-medium">{row.original.companyName}</span>,
    },
    {
      id: "tables",
      accessorFn: (row) => (row.isManaged ? (row.grantedTables ?? []).join(", ") : "Full access"),
      header: "Tables",
      enableSorting: false,
      meta: {
        exportHeader: "Tables",
        exportValue: (row) => (row.isManaged ? (row.grantedTables ?? []).join(", ") : "Full access"),
      },
      cell: ({ row }) => {
        const r = row.original;
        if (!r.isManaged) {
          return <span className="text-xs text-muted-foreground">Full access</span>;
        }
        const tables = r.grantedTables ?? [];
        if (tables.length === 0) {
          return <span className="text-xs text-muted-foreground">No tables granted</span>;
        }
        return (
          <div className="flex max-w-xs flex-wrap gap-1">
            {tables.map((t) => (
              <Badge key={t} variant="outline" className="font-mono text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      accessorFn: (row) => row.connection.status,
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.connection.status === "connected" ? "default" : "outline"}>
          {row.original.connection.status}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex justify-end gap-1">
            {r.isManaged && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Manage tables"
                onClick={() => setDataAccessTarget({ companyId: r.companyId, companyName: r.companyName })}
              >
                <DatabaseIcon className="size-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => openEdit(r)}>
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Assign to another company"
              onClick={() => openAssign(r)}
            >
              <PlusIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Test connection"
              disabled={testingId === r.connection.id}
              onClick={() => testConnection(r.companyId, r.connection.id)}
            >
              <ZapIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove"
              onClick={() => setDeleteTarget({ companyId: r.companyId, connection: r.connection })}
            >
              <Trash2Icon className="size-3.5 text-destructive" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex h-svh flex-col">
      <PageHeader title="Database Mapping" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">Database Mapping</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every registered database and which companies have access to each. Table access
                is enforced by a dedicated Postgres role per company, not an app-level filter.
              </p>
            </div>
            <Button size="sm" onClick={openAdd} className="shrink-0">
              <PlusIcon className="size-3.5" />
              Add database
            </Button>
          </div>

          <FilterBar
            data={rows}
            filterConfig={FILTER_CONFIG}
            search={filters.search}
            onSearchChange={filters.setSearch}
            activeFilters={filters.activeFilters}
            onFilterChange={filters.setFilterValues}
            onClearFilter={filters.clearFilter}
            searchPlaceholder="Search databases…"
          />

          <DataTable
            data={filters.filtered}
            columns={columns}
            loading={loading}
            getRowId={(row) => row.connection.id}
            exportFileName="database-mapping"
            emptyMessage="No databases registered yet."
          />

          {!loading && (
            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>
                  Who changed what, and when — connections, table access, and company/user
                  changes across every company.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {events.map((event) => (
                      <li
                        key={event.id}
                        className="flex items-start justify-between gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0"
                      >
                        <span>{describeEvent(event, companyNameById)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatTimestamp(event.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {dataAccessTarget && (
        <DataAccessDialog
          companyId={dataAccessTarget.companyId}
          companyName={dataAccessTarget.companyName}
          open={dataAccessTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDataAccessTarget(null);
              load();
            }
          }}
        />
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add database</DialogTitle>
            <DialogDescription>
              Register a database for a company. Credentials are encrypted at rest and never
              shown again after saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {addError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{addError}</p>}

            <div className="grid gap-1.5">
              <Label htmlFor="db-company">Company</Label>
              <Select
                items={Object.fromEntries(companies.map((c) => [c.company_id, c.company_name]))}
                value={addForm.companyId}
                onValueChange={(value) => setAddForm({ ...addForm, companyId: value as string })}
              >
                <SelectTrigger id="db-company">
                  <SelectValue placeholder="Select a company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.company_id} value={c.company_id}>
                      {c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="db-name">Name</Label>
              <Input
                id="db-name"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                placeholder="e.g. Production warehouse"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="db-engine">Engine</Label>
              <Select
                items={Object.fromEntries(ENGINES.map((e) => [e.value, e.label]))}
                value={addForm.engine}
                onValueChange={(value) => setAddForm({ ...addForm, engine: value as string })}
              >
                <SelectTrigger id="db-engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENGINES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="db-host">Host</Label>
                <Input id="db-host" value={addForm.host} onChange={(e) => setAddForm({ ...addForm, host: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="db-port">Port</Label>
                <Input id="db-port" value={addForm.port} onChange={(e) => setAddForm({ ...addForm, port: e.target.value })} placeholder="5432" />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="db-database">Database</Label>
              <Input id="db-database" value={addForm.database} onChange={(e) => setAddForm({ ...addForm, database: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="db-username">Username</Label>
                <Input id="db-username" value={addForm.username} onChange={(e) => setAddForm({ ...addForm, username: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="db-password">Password</Label>
                <Input
                  id="db-password"
                  type="password"
                  value={addForm.password}
                  onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={saving}>
              {saving ? "Saving…" : "Register database"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit — {editTarget?.connection.name}</DialogTitle>
            <DialogDescription>
              The password already saved is never shown again — leave it blank to keep it, or
              enter a new one to rotate it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {editError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{editError}</p>}

            <div className="grid gap-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="edit-host">Host</Label>
                <Input id="edit-host" value={editForm.host} onChange={(e) => setEditForm({ ...editForm, host: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-port">Port</Label>
                <Input id="edit-port" value={editForm.port} onChange={(e) => setEditForm({ ...editForm, port: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="edit-database">Database</Label>
              <Input id="edit-database" value={editForm.database} onChange={(e) => setEditForm({ ...editForm, database: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="edit-username">Username</Label>
                <Input id="edit-username" value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-password">New password</Label>
                <Input
                  id="edit-password"
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="Leave blank to keep current"
                  autoComplete="off"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignTarget !== null} onOpenChange={(open) => !open && setAssignTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign company — {assignTarget?.groupLabel}</DialogTitle>
            <DialogDescription>
              Gives another company its own connection to this same database, reusing the
              credentials already on file. You can restrict which tables it sees afterward.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="assign-company">Company</Label>
            {assignCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every company already has access.</p>
            ) : (
              <Select
                items={Object.fromEntries(assignCandidates.map((c) => [c.company_id, c.company_name]))}
                value={assignCompanyId}
                onValueChange={(value) => setAssignCompanyId(value as string)}
              >
                <SelectTrigger id="assign-company">
                  <SelectValue placeholder="Select a company" />
                </SelectTrigger>
                <SelectContent>
                  {assignCandidates.map((c) => (
                    <SelectItem key={c.company_id} value={c.company_id}>
                      {c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)} disabled={assigning}>
              Cancel
            </Button>
            <Button onClick={submitAssign} disabled={assigning || !assignCompanyId}>
              {assigning ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.connection.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The chat agent for this company loses access to it immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
