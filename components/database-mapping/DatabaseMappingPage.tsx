"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DatabaseIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { DataAccessDialog } from "@/components/companies/DataAccessDialog";
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
import { Skeleton } from "@/components/ui/skeleton";

type MappingConnection = {
  id: string;
  name: string;
  engine: string;
  status: string;
};

type MappingCompany = {
  company_id: string;
  company_name: string;
  connections: MappingConnection[];
  granted_tables: string[];
};

const ENGINES = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "bigquery", label: "BigQuery" },
];

const ADD_FORM_EMPTY = {
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

export function DatabaseMappingPage() {
  const [companies, setCompanies] = useState<MappingCompany[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [dataAccessTarget, setDataAccessTarget] = useState<MappingCompany | null>(null);
  const [addTarget, setAddTarget] = useState<MappingCompany | null>(null);
  const [addForm, setAddForm] = useState(ADD_FORM_EMPTY);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ companyId: string; connection: MappingConnection } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/database-mapping");
      const body = await res.json();
      setCompanies(body.companies ?? []);
      setTables(body.tables ?? []);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd(company: MappingCompany) {
    setAddTarget(company);
    setAddForm(ADD_FORM_EMPTY);
    setAddError(null);
  }

  async function submitAdd() {
    if (!addTarget) return;
    setAddError(null);
    if (!addForm.name.trim()) return setAddError("Name is required.");

    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${addTarget.company_id}/connections`, {
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
      toast.success(`Database registered for ${addTarget.company_name}.`);
      setAddTarget(null);
      load();
    } catch (cause) {
      setAddError(describeError(cause));
    } finally {
      setSaving(false);
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
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
          <div>
            <h1 className="text-xl font-semibold">Database Mapping</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Which databases each company owns, and which tables their chat agent can see.
              Table access is enforced by a dedicated Postgres role per company, not an
              app-level filter.
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            companies.map((company) => (
              <Card key={company.company_id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{company.company_name}</CardTitle>
                      <CardDescription>
                        {company.granted_tables.length > 0
                          ? `${company.granted_tables.length} of ${tables.length} table(s) accessible`
                          : "No table access granted yet"}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDataAccessTarget(company)}>
                        <DatabaseIcon className="size-3.5" />
                        Manage tables
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openAdd(company)}>
                        <PlusIcon className="size-3.5" />
                        Add database
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {company.connections.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No databases registered for this company yet.
                    </p>
                  ) : (
                    company.connections.map((connection) => (
                      <div
                        key={connection.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{connection.name}</span>
                          <Badge variant="outline">{connection.engine}</Badge>
                          <Badge variant={connection.status === "connected" ? "default" : "outline"}>
                            {connection.status}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove"
                          onClick={() => setDeleteTarget({ companyId: company.company_id, connection })}
                        >
                          <Trash2Icon className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {dataAccessTarget && (
        <DataAccessDialog
          companyId={dataAccessTarget.company_id}
          companyName={dataAccessTarget.company_name}
          open={dataAccessTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDataAccessTarget(null);
              load();
            }
          }}
        />
      )}

      <Dialog open={addTarget !== null} onOpenChange={(open) => !open && setAddTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add database — {addTarget?.company_name}</DialogTitle>
            <DialogDescription>
              Register a database this company owns. Credentials are encrypted at rest and
              never shown again after saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {addError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{addError}</p>}

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
            <Button variant="outline" onClick={() => setAddTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={saving}>
              {saving ? "Saving…" : "Register database"}
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
