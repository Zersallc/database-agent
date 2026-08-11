"use client";

import { useState } from "react";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { downloadCsv, parseCsvToObjects } from "@/lib/csv";

export type ImportResult = {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
};

type Phase = "idle" | "preview" | "importing" | "done";

export function ImportDialog({
  open,
  onClose,
  title,
  templateHeaders,
  templateExampleRow,
  requiredColumns,
  notes,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  templateHeaders: string[];
  templateExampleRow: (string | number)[];
  requiredColumns: string[];
  notes: string[];
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhase("idle");
    setRows([]);
    setResult(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseCsvToObjects(text);
      if (parsed.length === 0) {
        setError("That file has no data rows.");
        return;
      }
      setRows(parsed);
      setPhase("preview");
    } catch {
      setError("Couldn't read that file as CSV.");
    }
  }

  function rowIssues(row: Record<string, string>): string[] {
    return requiredColumns.filter((col) => !row[col]?.trim()).map((col) => `Missing: ${col}`);
  }

  async function runImport() {
    setPhase("importing");
    try {
      const res = await onImport(rows);
      setResult(res);
    } catch (err) {
      setResult({ created: 0, updated: 0, errors: [{ row: 0, message: err instanceof Error ? err.message : "Import failed." }] });
    }
    setPhase("done");
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {phase === "idle" && "Upload a CSV file to bulk-add or update records."}
            {phase === "preview" && `${rows.length} row(s) found — review before importing.`}
            {phase === "importing" && "Importing…"}
            {phase === "done" && "Import finished."}
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="mb-1 font-medium">Required columns: {requiredColumns.join(", ")}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadCsv("import-template.csv", templateHeaders, [templateExampleRow])}
            >
              Download template (.csv)
            </Button>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground hover:bg-muted/40">
              <UploadIcon className="size-6" />
              Click to choose a CSV file, or drag one here
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {phase === "preview" && (
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  {Object.keys(rows[0] ?? {}).map((key) => (
                    <th key={key} className="px-2 py-1.5 text-left">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, i) => {
                  const issues = rowIssues(row);
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1.5">
                        {issues.length ? (
                          <span className="text-destructive">{issues.join(", ")}</span>
                        ) : (
                          <span className="text-green-600 dark:text-green-400">Ready</span>
                        )}
                      </td>
                      {Object.values(row).map((value, j) => (
                        <td key={j} className="px-2 py-1.5">{value}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {phase === "importing" && (
          <p className="py-8 text-center text-sm text-muted-foreground">Importing {rows.length} row(s)…</p>
        )}

        {phase === "done" && result && (
          <div className="space-y-2">
            <p className="text-sm">
              Created <strong>{result.created}</strong>, updated <strong>{result.updated}</strong>.
              {result.errors.length > 0 && ` ${result.errors.length} error(s).`}
            </p>
            {result.errors.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-xs">
                {result.errors.map((e, i) => (
                  <p key={i} className="text-destructive">
                    Row {e.row}: {e.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === "idle" && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {phase === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button
                onClick={runImport}
                disabled={rows.every((row) => rowIssues(row).length > 0)}
              >
                Import {rows.length} row(s)
              </Button>
            </>
          )}
          {phase === "done" && <Button onClick={handleClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
