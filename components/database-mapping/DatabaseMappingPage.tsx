"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRightIcon, DatabaseIcon, PlusIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { DataAccessDialog } from "@/components/companies/DataAccessDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const MANAGED_CONNECTION_NAME = "Company data access (managed)";

type MappingConnection = {
  id: string;
  name: string;
  engine: string;
  status: string;
  host: string | null;
  database: string | null;
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

type GroupEntry = {
  companyId: string;
  companyName: string;
  connection: MappingConnection;
  isManaged: boolean;
  grantedTables: string[] | null;
};

type DatabaseGroup = {
  key: string;
  label: string;
  engine: string;
  host: string | null;
  entries: GroupEntry[];
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

function buildGroups(companies: MappingCompany[]): DatabaseGroup[] {
  const map = new Map<string, DatabaseGroup>();
  for (const company of companies) {
    for (const connection of company.connections) {
      const key = `${connection.engine}::${connection.host ?? ""}::${connection.database ?? connection.id}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          label: connection.database || connection.name,
          engine: connection.engine,
          host: connection.host,
          entries: [],
        };
        map.set(key, group);
      }
      const isManaged = connection.name === MANAGED_CONNECTION_NAME;
      group.entries.push({
        companyId: company.company_id,
        companyName: company.company_name,
        connection,
        isManaged,
        grantedTables: isManaged ? company.granted_tables : null,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
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
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [testingId, setTestingId] = useState<string | null>(null);

  const [dataAccessTarget, setDataAccessTarget] = useState<{ companyId: string; companyName: string } | null>(
    null
  );
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(ADD_FORM_EMPTY);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [assignGroup, setAssignGroup] = useState<DatabaseGroup | null>(null);
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

  const groups = useMemo(() => buildGroups(companies), [companies]);
  const companyNameById = useMemo(
    () => new Map(companies.map((c) => [c.company_id, c.company_name])),
    [companies]
  );

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  function openAssign(group: DatabaseGroup) {
    setAssignGroup(group);
    setAssignCompanyId("");
  }

  const assignCandidates = assignGroup
    ? companies.filter((c) => !assignGroup.entries.some((e) => e.companyId === c.company_id))
    : [];

  async function submitAssign() {
    if (!assignGroup || !assignCompanyId) return;
    const source = assignGroup.entries[0];
    setAssigning(true);
    try {
      const res = await fetch(
        `/api/companies/${source.companyId}/connections/${source.connection.id}/assign`,
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
      setAssignGroup(null);
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

  return (
    <div className="flex h-svh flex-col">
      <PageHeader title="Database Mapping" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">Database Mapping</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every registered database, folded together, and which companies have access to
                each. Table access is enforced by a dedicated Postgres role per company, not an
                app-level filter.
              </p>
            </div>
            <Button size="sm" onClick={openAdd} className="shrink-0">
              <PlusIcon className="size-3.5" />
              Add database
            </Button>
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : groups.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No databases registered yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => {
                const isOpen = openGroups.has(group.key);
                return (
                  <Card key={group.key} className="overflow-hidden py-0">
                    <Collapsible open={isOpen} onOpenChange={() => toggleGroup(group.key)}>
                      <div className="flex items-center gap-2 px-4 py-3">
                        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left">
                          <ChevronRightIcon
                            className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                          />
                          <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="font-medium">{group.label}</span>
                          <Badge variant="outline">{group.engine}</Badge>
                          {group.host && (
                            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                              {group.host}
                            </span>
                          )}
                        </CollapsibleTrigger>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {group.entries.length} compan{group.entries.length === 1 ? "y" : "ies"}
                        </span>
                        <Button variant="outline" size="sm" onClick={() => openAssign(group)}>
                          <PlusIcon className="size-3.5" />
                          Assign company
                        </Button>
                      </div>

                      <CollapsibleContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Company</TableHead>
                              <TableHead>Access</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="w-0" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.entries.map((entry) => (
                              <TableRow key={entry.connection.id}>
                                <TableCell className="font-medium">{entry.companyName}</TableCell>
                                <TableCell>
                                  {entry.isManaged ? (
                                    <span className="text-xs text-muted-foreground">
                                      {entry.grantedTables?.length ?? 0} table(s)
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">Full access</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={entry.connection.status === "connected" ? "default" : "outline"}
                                  >
                                    {entry.connection.status}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end gap-1">
                                    {entry.isManaged && (
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Manage tables"
                                        onClick={() =>
                                          setDataAccessTarget({
                                            companyId: entry.companyId,
                                            companyName: entry.companyName,
                                          })
                                        }
                                      >
                                        <DatabaseIcon className="size-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label="Test connection"
                                      disabled={testingId === entry.connection.id}
                                      onClick={() => testConnection(entry.companyId, entry.connection.id)}
                                    >
                                      <ZapIcon className="size-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label="Remove"
                                      onClick={() =>
                                        setDeleteTarget({ companyId: entry.companyId, connection: entry.connection })
                                      }
                                    >
                                      <Trash2Icon className="size-3.5 text-destructive" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}
            </div>
          )}

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
              shown again after saving. Any engine — if it later matches another company&rsquo;s
              database by host and name, they&rsquo;ll fold together automatically.
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

      <Dialog open={assignGroup !== null} onOpenChange={(open) => !open && setAssignGroup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign company — {assignGroup?.label}</DialogTitle>
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
            <Button variant="outline" onClick={() => setAssignGroup(null)} disabled={assigning}>
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
