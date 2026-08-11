"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ExportableColumnDef } from "@/components/shared/DataTable";
import { DataTable } from "@/components/shared/DataTable";
import { FilterBar, useFilteredData, type FilterConfig } from "@/components/shared/FilterBar";
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
import { Switch } from "@/components/ui/switch";

type CompanyRow = {
  id: string;
  name: string;
  country: string | null;
  isActive: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  name: string;
  country: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = { name: "", country: "", isActive: true };

const FILTER_CONFIG: FilterConfig<CompanyRow>[] = [
  { column: "status", label: "Status", type: "enum", getValue: (row) => (row.isActive ? "Active" : "Inactive") },
  { column: "country", label: "Country", type: "enum", getValue: (row) => row.country },
];

export function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<CompanyRow | null>(null);

  const filters = useFilteredData(companies, FILTER_CONFIG);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/companies");
      if (res.ok) setCompanies((await res.json()).companies);
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

  function openEdit(company: CompanyRow) {
    setEditing(company);
    setForm({ name: company.name, country: company.country ?? "", isActive: company.isActive });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    setFormError(null);
    if (!form.name.trim()) return setFormError("Company name is required.");

    setSaving(true);
    const url = editing ? `/api/companies/${editing.id}` : "/api/companies";
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, country: form.country || null, isActive: form.isActive }),
    });
    setSaving(false);

    if (res.ok) {
      toast.success(editing ? "Company updated." : "Company created.");
      setDialogOpen(false);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setFormError(body.error ?? "Something went wrong.");
    }
  }

  async function handleDelete(company: CompanyRow) {
    const res = await fetch(`/api/companies/${company.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Company deleted.");
      setDeleteTarget(null);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't delete that company.");
    }
  }

  async function handleDeleteSelected(rows: CompanyRow[]) {
    const results = await Promise.allSettled(rows.map((row) => fetch(`/api/companies/${row.id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)).length;
    if (failed > 0) toast.error(`${failed} compan${failed === 1 ? "y" : "ies"} couldn't be deleted (still has users).`);
    else toast.success(`${rows.length} compan${rows.length === 1 ? "y" : "ies"} deleted.`);
    load();
  }

  const columns: ExportableColumnDef<CompanyRow>[] = [
    {
      accessorKey: "name",
      header: "Name",
      meta: { exportHeader: "Name", exportValue: (row) => row.name },
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "country",
      header: "Country",
      meta: { exportHeader: "Country", exportValue: (row) => row.country ?? "" },
      cell: ({ row }) => row.original.country ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "userCount",
      header: "Users",
      meta: { exportHeader: "Users", exportValue: (row) => row.userCount },
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
          <Building2Icon className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Companies</h1>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openAdd}>
          <PlusIcon className="size-3.5" />
          Add Company
        </Button>
      </div>

      <FilterBar
        data={companies}
        filterConfig={FILTER_CONFIG}
        search={filters.search}
        onSearchChange={filters.setSearch}
        activeFilters={filters.activeFilters}
        onFilterChange={filters.setFilterValues}
        onClearFilter={filters.clearFilter}
        searchPlaceholder="Search companies…"
      />

      <DataTable
        data={filters.filtered}
        columns={columns}
        loading={loading}
        getRowId={(row) => row.id}
        exportFileName="companies"
        onDeleteSelected={handleDeleteSelected}
        emptyMessage="No companies found."
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Company" : "Add Company"}</DialogTitle>
            <DialogDescription>{editing ? "Update this company's details." : "Add a new company to the workspace."}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {formError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}

            <div className="space-y-1.5">
              <Label htmlFor="company-name">Name</Label>
              <Input id="company-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company-country">Country</Label>
              <Input id="company-country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Optional" />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <Label htmlFor="company-active" className="cursor-pointer">
                Active
              </Label>
              <Switch id="company-active" checked={form.isActive} onCheckedChange={(checked) => setForm({ ...form, isActive: checked })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.userCount > 0
                ? `This company has ${deleteTarget.userCount} user(s) — reassign or remove them first.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={Boolean(deleteTarget && deleteTarget.userCount > 0)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
