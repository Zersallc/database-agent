"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LinkIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon, UsersIcon } from "lucide-react";
import type { ExportableColumnDef } from "@/components/shared/DataTable";
import { DataTable } from "@/components/shared/DataTable";
import { FilterBar, useFilteredData, type FilterConfig } from "@/components/shared/FilterBar";
import { ImportDialog, type ImportResult } from "@/components/shared/ImportDialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Company = {
  id: string;
  name: string;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  companyId: string | null;
  companyName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  name: string;
  email: string;
  password: string;
  role: string;
  companyId: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  password: "",
  role: "User",
  companyId: "",
  isActive: true,
};

const FILTER_CONFIG: FilterConfig<UserRow>[] = [
  { column: "status", label: "Status", type: "enum", getValue: (row) => (row.isActive ? "Active" : "Inactive") },
  { column: "role", label: "Role", type: "enum", getValue: (row) => row.role },
  { column: "company", label: "Company", type: "enum", getValue: (row) => row.companyName },
];

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filters = useFilteredData(users, FILTER_CONFIG);

  async function load() {
    setLoading(true);
    try {
      const [usersRes, companiesRes] = await Promise.all([fetch("/api/users"), fetch("/api/companies")]);
      if (usersRes.ok) setUsers((await usersRes.json()).users);
      if (companiesRes.ok) setCompanies((await companiesRes.json()).companies);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(user: UserRow) {
    setEditing(user);
    setForm({
      name: user.name ?? "",
      email: user.email,
      password: "",
      role: user.role,
      companyId: user.companyId ?? "",
      isActive: user.isActive,
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    setFormError(null);
    if (!form.email.trim()) return setFormError("Email is required.");
    if (!editing && form.password.length < 8) return setFormError("Password must be at least 8 characters.");

    setSaving(true);
    const payload: Record<string, unknown> = {
      name: form.name,
      email: form.email,
      role: form.role,
      companyId: form.companyId || null,
      isActive: form.isActive,
    };
    if (form.password) payload.password = form.password;

    const url = editing ? `/api/users/${editing.id}` : "/api/users";
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);

    if (res.ok) {
      toast.success(editing ? "User updated." : "User created.");
      setDialogOpen(false);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setFormError(body.error ?? "Something went wrong.");
    }
  }

  async function handleDelete(user: UserRow) {
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("User deleted.");
      setDeleteTarget(null);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't delete that user.");
    }
  }

  function copySignInLink(user: UserRow) {
    if (!user.companyName) {
      toast.error("Assign this user to a company first — the link needs one.");
      return;
    }
    const url = new URL("/user-secret-signing-link-auto-login", window.location.origin);
    url.searchParams.set("email", user.email);
    url.searchParams.set("company", user.companyName);
    navigator.clipboard.writeText(url.toString());
    toast.success("Sign-in link copied.");
  }

  async function handleDeleteSelected(rows: UserRow[]) {
    const results = await Promise.allSettled(rows.map((row) => fetch(`/api/users/${row.id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)).length;
    if (failed > 0) toast.error(`${failed} user(s) couldn't be deleted.`);
    else toast.success(`${rows.length} user(s) deleted.`);
    load();
  }

  async function handleImport(rows: Record<string, string>[]): Promise<ImportResult> {
    let created = 0;
    let updated = 0;
    const errors: ImportResult["errors"] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const email = row["Email"]?.trim().toLowerCase();
      const name = row["Name"]?.trim();
      if (!email || !name) {
        errors.push({ row: i + 1, message: "Missing Name or Email." });
        continue;
      }
      const company = row["Company"]?.trim();
      const companyId = company ? companies.find((c) => c.name.toLowerCase() === company.toLowerCase())?.id ?? null : null;
      const rawRole = row["Role"]?.trim();
      const role = rawRole === "Admin" ? "Admin" : rawRole === "Viewer" ? "Viewer" : "User";
      const existing = users.find((u) => u.email.toLowerCase() === email);

      const payload = {
        name,
        email,
        role,
        companyId,
        isActive: true,
        ...(row["Password"] ? { password: row["Password"] } : {}),
      };

      const res = existing
        ? await fetch(`/api/users/${existing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, password: row["Password"] || crypto.randomUUID() }),
          });

      if (res.ok) existing ? updated++ : created++;
      else {
        const body = await res.json().catch(() => ({}));
        errors.push({ row: i + 1, message: body.error ?? "Failed." });
      }
    }

    await load();
    return { created, updated, errors };
  }

  const columns: ExportableColumnDef<UserRow>[] = [
    {
      accessorKey: "name",
      header: "Name",
      meta: { exportHeader: "Name", exportValue: (row) => row.name ?? "" },
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center gap-2">
            <Avatar className="size-7">
              <AvatarFallback className="bg-accent text-xs text-accent-foreground">
                {(user.name || user.email).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name || "—"}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      meta: { exportHeader: "Role", exportValue: (row) => row.role },
      cell: ({ row }) => <Badge variant={row.original.role === "Admin" ? "default" : "outline"}>{row.original.role}</Badge>,
    },
    {
      accessorKey: "companyName",
      header: "Company",
      meta: { exportHeader: "Company", exportValue: (row) => row.companyName ?? "" },
      cell: ({ row }) => row.original.companyName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "isActive",
      header: "Status",
      meta: { exportHeader: "Status", exportValue: (row) => (row.isActive ? "Active" : "Inactive") },
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "default" : "outline"}>{row.original.isActive ? "Active" : "Inactive"}</Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      meta: { exportHeader: "Created At", exportValue: (row) => row.createdAt },
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{new Date(row.original.createdAt).toLocaleDateString()}</span>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy sign-in link"
            onClick={() => copySignInLink(row.original)}
          >
            <LinkIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => openEdit(row.original)}>
            <PencilIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => setDeleteTarget(row.original)}>
            <Trash2Icon className="size-3.5 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UsersIcon className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Users</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
            <UploadIcon className="size-3.5" />
            Import
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openAdd}>
            <PlusIcon className="size-3.5" />
            Add User
          </Button>
        </div>
      </div>

      <FilterBar
        data={users}
        filterConfig={FILTER_CONFIG}
        search={filters.search}
        onSearchChange={filters.setSearch}
        activeFilters={filters.activeFilters}
        onFilterChange={filters.setFilterValues}
        onClearFilter={filters.clearFilter}
        searchPlaceholder="Search users…"
      />

      <DataTable
        data={filters.filtered}
        columns={columns}
        loading={loading}
        getRowId={(row) => row.id}
        exportFileName="users"
        onDeleteSelected={handleDeleteSelected}
        emptyMessage="No users found."
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit User" : "Add User"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update this user's details." : "Create a new login for this workspace."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {formError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}

            <div className="space-y-1.5">
              <Label htmlFor="user-name">Name</Label>
              <Input id="user-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-password">Password</Label>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editing ? "Leave blank to keep current" : "At least 8 characters"}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(value) => setForm({ ...form, role: value as string })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="User">User</SelectItem>
                    <SelectItem value="Admin">Admin</SelectItem>
                    <SelectItem value="Viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Company</Label>
                <Select
                  value={form.companyId || "none"}
                  onValueChange={(value) => setForm({ ...form, companyId: value === "none" ? "" : (value as string) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No company</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <Label htmlFor="user-active" className="cursor-pointer">
                Active
              </Label>
              <Switch id="user-active" checked={form.isActive} onCheckedChange={(checked) => setForm({ ...form, isActive: checked })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name || deleteTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes their login. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && handleDelete(deleteTarget)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Users"
        templateHeaders={["Name", "Email", "Password", "Role", "Company"]}
        templateExampleRow={["Alex Moreau", "alex@company.com", "", "User", ""]}
        requiredColumns={["Name", "Email"]}
        notes={[
          "Existing users are matched by Email and updated; new emails create a new user.",
          "Role must be exactly 'Admin', 'User', or 'Viewer' (default: User).",
          "Company must match an existing company name exactly, or leave blank.",
          "Leave Password blank on new rows to generate a random one — reset it manually after import.",
        ]}
        onImport={handleImport}
      />
    </div>
  );
}
