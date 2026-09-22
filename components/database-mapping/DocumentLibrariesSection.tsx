"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LibraryIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ExportableColumnDef } from "@/components/shared/DataTable";
import { DataTable } from "@/components/shared/DataTable";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DESCRIPTION_MAX_CHARS,
  EMPTY_MEDIA_FORM,
  LIBRARY_REF_MAX_CHARS,
  NAME_MAX_CHARS,
  SERVER_REF_OPTIONS,
  classifyFailure,
  createRequestInit,
  deleteRequestInit,
  describeApiError,
  describeStatus,
  formFromConnection,
  newIdempotencyKey,
  nextIdempotencyKey,
  patchRequestInit,
  retryAfterMs,
  updateBody,
  validateMediaForm,
  type MediaConnectionWire,
  type MediaFormState,
} from "./media-connection-form";

type Company = { id: string; name: string };

function basePath(companyId: string) {
  return `/api/v1/companies/${encodeURIComponent(companyId)}/media-connections`;
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return describeApiError(res.status, body);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How many times to sit through a `Retry-After` before handing the wait back to
 * the Developer. The original create is the one holding the key; if it is still
 * running after this many rounds, something is wrong and a spinner is not the
 * place to find out.
 */
const MAX_IN_PROGRESS_WAITS = 3;

/**
 * The Developer-facing document library manager.
 *
 * Deliberately narrower than the databases tab next to it: a media connection
 * has no credentials to enter, no tables to browse and no connectivity test to
 * run, so none of those controls appear here. What it does have is a name, a
 * description the agent reads, an operator's note of which syslab library it
 * stands for, and a switch.
 *
 * Authorization is not done here. Every request below goes to a route guarded
 * by `requireDeveloperRole`, which re-reads the role from the database; the
 * role check in the parent that decides whether to render this tab only keeps
 * a control out of sight that the server would refuse anyway.
 */
export function DocumentLibrariesSection({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState<MediaConnectionWire[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<MediaFormState>(EMPTY_MEDIA_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Minted per opening of the Add dialog, like ReportResponseDialog does, and
  // then held across retries of that one submission. See `nextIdempotencyKey`
  // for why a refusal replaces it rather than keeping it.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const [editTarget, setEditTarget] = useState<MediaConnectionWire | null>(null);
  const [editForm, setEditForm] = useState<MediaFormState>(EMPTY_MEDIA_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaConnectionWire | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** Bumped after a mutation, and by Try again, to re-run the load effect. */
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  /**
   * "Which list is on screen" rather than a `loading` flag: the request is
   * identified by company and reload count, and whatever finishes last records
   * the key it answered for. `loading` is then a comparison made during
   * render, so the effect below sets no state synchronously — the thing
   * react-hooks/set-state-in-effect is about.
   */
  const requestKey = `${companyId}:${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = companyId !== "" && loadedKey !== requestKey;

  useEffect(() => {
    // Nothing to load until a company is picked, and nothing to clear either:
    // the list starts empty and the table is not rendered without a company.
    if (!companyId) return;
    let cancelled = false;
    fetch(basePath(companyId))
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setRows(body.data ?? []);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setRows([]);
        setLoadError(cause instanceof Error ? cause.message : "Couldn't load document libraries.");
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, requestKey]);

  function openAdd() {
    setAddForm({ ...EMPTY_MEDIA_FORM, companyId });
    setAddError(null);
    setIdempotencyKey(newIdempotencyKey());
    setAddOpen(true);
  }

  async function submitAdd() {
    const problem = validateMediaForm(addForm, { requireCompany: true });
    if (problem) return setAddError(problem);

    setAddError(null);
    setSaving(true);

    // The key is held across every attempt below and only replaced on an
    // outright refusal, so nothing here can start a second create that races
    // the first. See `nextIdempotencyKey`.
    const key = idempotencyKey;

    for (let waits = 0; ; waits += 1) {
      let res: Response;
      try {
        res = await fetch(basePath(addForm.companyId), createRequestInit(addForm, key));
      } catch {
        // No answer came back, so whether the library was created is unknown.
        // Keep the key: a retry then replays the original result rather than
        // creating a second one.
        setIdempotencyKey(nextIdempotencyKey(key, "no-response"));
        setAddError("Couldn't reach the server. Try again — this will not create it twice.");
        setSaving(false);
        return;
      }

      if (res.ok) {
        setSaving(false);
        toast.success("Document library added. Switch it on once the operator has linked it.");
        setAddOpen(false);
        // Creating for a company other than the one on screen moves the list to
        // it, so the new row is actually visible.
        setCompanyId(addForm.companyId);
        refresh();
        return;
      }

      const outcome = classifyFailure(res);

      if (outcome === "in-progress") {
        setIdempotencyKey(nextIdempotencyKey(key, "in-progress"));
        if (waits < MAX_IN_PROGRESS_WAITS) {
          await delay(retryAfterMs(res));
          continue;
        }
        // Still running. The key is kept, so pressing the button again picks
        // up the original request's answer rather than starting a rival one.
        setAddError(
          "The first attempt is still being processed. Wait a moment and try again — this will not create it twice."
        );
        setSaving(false);
        return;
      }

      setIdempotencyKey(nextIdempotencyKey(key, "refused"));
      setAddError(await readError(res));
      setSaving(false);
      return;
    }
  }

  function openEdit(connection: MediaConnectionWire) {
    setEditTarget(connection);
    setEditForm(formFromConnection(connection, companyId));
    setEditError(null);
  }

  async function submitEdit() {
    if (!editTarget) return;
    const problem = validateMediaForm(editForm);
    if (problem) return setEditError(problem);

    setEditError(null);
    setEditSaving(true);
    try {
      const res = await fetch(
        `${basePath(companyId)}/${encodeURIComponent(editTarget.id)}`,
        patchRequestInit(updateBody(editForm))
      );
      if (!res.ok) throw new Error(await readError(res));
      toast.success("Document library updated.");
      setEditTarget(null);
      refresh();
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "Couldn't save changes.");
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleEnabled(connection: MediaConnectionWire, enabled: boolean) {
    setTogglingId(connection.id);
    try {
      const res = await fetch(
        `${basePath(companyId)}/${encodeURIComponent(connection.id)}`,
        patchRequestInit({ enabled })
      );
      if (!res.ok) throw new Error(await readError(res));
      toast.success(enabled ? `${connection.name} switched on.` : `${connection.name} switched off.`);
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't change that setting.");
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `${basePath(companyId)}/${encodeURIComponent(deleteTarget.id)}`,
        deleteRequestInit()
      );
      if (!res.ok) throw new Error(await readError(res));
      toast.success(`${deleteTarget.name} removed.`);
      setDeleteTarget(null);
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't remove that document library.");
    } finally {
      setDeleting(false);
    }
  }

  const selectedCompanyName = companies.find((company) => company.id === companyId)?.name ?? "";

  const columns: ExportableColumnDef<MediaConnectionWire>[] = [
    {
      id: "name",
      accessorFn: (row) => row.name,
      header: "Library",
      cell: ({ row }) => (
        <div>
          <div className="flex items-center gap-2">
            <LibraryIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">{row.original.name}</span>
          </div>
          {row.original.description && (
            <div className="ml-5.5 text-xs text-muted-foreground">{row.original.description}</div>
          )}
        </div>
      ),
    },
    {
      id: "company",
      accessorFn: () => selectedCompanyName,
      header: "Company",
      cell: () => <span className="font-medium">{selectedCompanyName}</span>,
    },
    {
      id: "library_ref",
      accessorFn: (row) => row.media.library_ref ?? "",
      header: "Operator note",
      cell: ({ row }) =>
        row.original.media.library_ref ? (
          <span className="font-mono text-xs">{row.original.media.library_ref}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "Status",
      cell: ({ row }) => {
        const status = describeStatus(row.original);
        return <Badge variant={status.muted ? "outline" : "default"}>{status.label}</Badge>;
      },
    },
    {
      id: "enabled",
      accessorFn: (row) => (row.enabled ? "on" : "off"),
      header: "Offered to the agent",
      cell: ({ row }) => (
        <Switch
          checked={row.original.enabled}
          disabled={togglingId === row.original.id}
          aria-label={`Offer ${row.original.name} to the agent`}
          onCheckedChange={(enabled) => toggleEnabled(row.original, enabled)}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${row.original.name}`}
            onClick={() => openEdit(row.original)}
          >
            <PencilIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${row.original.name}`}
            onClick={() => setDeleteTarget(row.original)}
          >
            <Trash2Icon className="size-3.5 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="media-company">Company</Label>
          <Select
            items={Object.fromEntries(companies.map((company) => [company.id, company.name]))}
            value={companyId}
            onValueChange={(value) => setCompanyId(value as string)}
          >
            <SelectTrigger id="media-company" className="w-64">
              <SelectValue placeholder="Select a company" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((company) => (
                <SelectItem key={company.id} value={company.id}>
                  {company.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openAdd} disabled={!companyId}>
          <PlusIcon className="size-3.5" />
          Add document library
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Document libraries let this company&apos;s agent answer from uploaded documents instead of
        SQL. Adding one here registers it for the company; the documents themselves are uploaded and
        the library is linked on the document server by an operator, which is a separate step. Leave
        a library switched off until that step is done.
      </p>

      {loadError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={refresh}>
            Try again
          </Button>
        </div>
      )}

      {companyId ? (
        <DataTable
          data={rows}
          columns={columns}
          loading={loading}
          getRowId={(row) => row.id}
          emptyMessage="No document libraries for this company yet."
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          Select a company to see its document libraries.
        </p>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add document library</DialogTitle>
            <DialogDescription>
              Registers a library for this company. It is created switched off: an operator still
              has to create the matching library on the document server and link it before the agent
              can search it.
            </DialogDescription>
          </DialogHeader>

          {/* Capped and scrollable, like the Columns dialog above: this form has
              more fields and help text than fits a short viewport, and without
              a cap DialogContent (centered by translate, no max-height of its
              own) grows past both screen edges, taking the footer's Cancel
              button with it. */}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {addError && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {addError}
              </p>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="media-add-company">Company</Label>
              <Select
                items={Object.fromEntries(companies.map((company) => [company.id, company.name]))}
                value={addForm.companyId}
                onValueChange={(value) => setAddForm({ ...addForm, companyId: value as string })}
              >
                <SelectTrigger id="media-add-company">
                  <SelectValue placeholder="Select a company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="media-add-name">Name</Label>
              <Input
                id="media-add-name"
                value={addForm.name}
                maxLength={NAME_MAX_CHARS}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                placeholder="e.g. Sustainability reports"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="media-add-description">Description</Label>
              <Textarea
                id="media-add-description"
                value={addForm.description}
                maxLength={DESCRIPTION_MAX_CHARS}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                placeholder="What this library holds — the agent reads this when deciding whether to search it."
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="media-add-library-ref">Operator note (optional)</Label>
              <Input
                id="media-add-library-ref"
                value={addForm.libraryRef}
                maxLength={LIBRARY_REF_MAX_CHARS}
                onChange={(e) => setAddForm({ ...addForm, libraryRef: e.target.value })}
                placeholder="Which library on the document server this stands for"
              />
              <p className="text-xs text-muted-foreground">
                A reminder for people, not a setting. Nothing routes, authorizes or searches by this
                value. Letters, digits, spaces and . _ - : / only.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="media-add-server">Document server</Label>
              <Select
                items={SERVER_REF_OPTIONS}
                value={addForm.serverRef}
                onValueChange={(value) => setAddForm({ ...addForm, serverRef: value as string })}
              >
                <SelectTrigger id="media-add-server">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SERVER_REF_OPTIONS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Names a server this deployment is configured for. Its address and credentials stay
                in deployment configuration and are never entered or shown here.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div className="pr-3">
                <Label htmlFor="media-add-enabled" className="cursor-pointer">
                  Offer to the agent
                </Label>
                <p className="text-xs text-muted-foreground">
                  Leave off until the library exists on the document server and is linked. On its
                  own this does not mean search is running — the deployment also has to have
                  document libraries switched on.
                </p>
              </div>
              <Switch
                id="media-add-enabled"
                checked={addForm.enabled}
                onCheckedChange={(enabled) => setAddForm({ ...addForm, enabled })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={saving}>
              {saving ? "Saving…" : "Add library"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit — {editTarget?.name}</DialogTitle>
            <DialogDescription>
              The document server and this library&apos;s internal link are fixed when it is created
              and cannot be changed here.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {editError && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {editError}
              </p>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="media-edit-name">Name</Label>
              <Input
                id="media-edit-name"
                value={editForm.name}
                maxLength={NAME_MAX_CHARS}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="media-edit-description">Description</Label>
              <Textarea
                id="media-edit-description"
                value={editForm.description}
                maxLength={DESCRIPTION_MAX_CHARS}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="media-edit-library-ref">Operator note (optional)</Label>
              <Input
                id="media-edit-library-ref"
                value={editForm.libraryRef}
                maxLength={LIBRARY_REF_MAX_CHARS}
                onChange={(e) => setEditForm({ ...editForm, libraryRef: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Emptying this box or the description does not erase what is saved — the API cannot
                clear either field yet, so the previous value is kept. Replace the text instead.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div className="pr-3">
                <Label htmlFor="media-edit-enabled" className="cursor-pointer">
                  Offer to the agent
                </Label>
                <p className="text-xs text-muted-foreground">
                  Whether this company&apos;s agent is offered this library at all.
                </p>
              </div>
              <Switch
                id="media-edit-enabled"
                checked={editForm.enabled}
                onCheckedChange={(enabled) => setEditForm({ ...editForm, enabled })}
              />
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

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This company&apos;s agent stops being offered this library immediately. The documents
              themselves stay on the document server — retiring the library there is a separate
              operator step. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
