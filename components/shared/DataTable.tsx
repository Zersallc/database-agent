"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
  DownloadIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";

export type ExportableColumnDef<T> = ColumnDef<T> & {
  meta?: {
    exportHeader?: string;
    exportValue?: (row: T) => string | number | boolean | null | undefined;
  };
};

export function DataTable<T>({
  data,
  columns,
  loading,
  getRowId,
  exportFileName,
  onDeleteSelected,
  emptyMessage = "No results found.",
}: {
  data: T[];
  columns: ExportableColumnDef<T>[];
  loading?: boolean;
  getRowId?: (row: T) => string;
  exportFileName?: string;
  onDeleteSelected?: (rows: T[]) => void;
  emptyMessage?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

  const withSelection = Boolean(onDeleteSelected || exportFileName);

  const tableColumns = useMemo<ExportableColumnDef<T>[]>(() => {
    if (!withSelection) return columns;
    const selectColumn: ExportableColumnDef<T> = {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={table.getIsAllPageRowsSelected()}
          ref={(el) => {
            if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected();
          }}
          onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={row.getIsSelected()}
          onChange={(e) => row.toggleSelected(e.target.checked)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
    };
    return [selectColumn, ...columns];
  }, [columns, withSelection]);

  const table = useReactTable({
    data,
    columns: tableColumns as ColumnDef<T>[],
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: getRowId as ((row: T) => string) | undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const pageCount = table.getPageCount();

  function runExport(rows: T[], suffix = "") {
    const exportCols = columns.filter((c) => c.meta?.exportValue);
    const headers = exportCols.map((c) => c.meta?.exportHeader ?? (typeof c.header === "string" ? c.header : c.id ?? ""));
    const body = rows.map((row) => exportCols.map((c) => c.meta!.exportValue!(row) ?? ""));
    downloadCsv(`${exportFileName ?? "export"}${suffix}.csv`, headers, body);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {onDeleteSelected && selectedRows.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (!confirm(`Delete ${selectedRows.length} selected item${selectedRows.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
                onDeleteSelected(selectedRows);
                setRowSelection({});
              }}
            >
              <Trash2Icon className="size-3.5" />
              Delete Selected ({selectedRows.length})
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {exportFileName && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => runExport(data)}>
                <DownloadIcon className="size-3.5" />
                Export
              </Button>
              {selectedRows.length > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => runExport(selectedRows, "-selected")}>
                  <DownloadIcon className="size-3.5" />
                  Export Selected
                </Button>
              )}
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Columns3Icon className="size-3.5" />
                  Columns
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {table
                .getAllLeafColumns()
                .filter((col) => col.id !== "select" && col.id !== "actions")
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={col.getIsVisible()}
                    onCheckedChange={(checked) => col.toggleVisibility(Boolean(checked))}
                  >
                    {typeof col.columnDef.header === "string" ? col.columnDef.header : col.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUpIcon className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon className="size-3" />
                          ) : (
                            <ArrowUpDownIcon className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {tableColumns.map((_, j) => (
                    <TableCell key={j}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={tableColumns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
            <ChevronLeftIcon />
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {pageCount}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            <ChevronRightIcon />
          </Button>
        </div>
      )}
    </div>
  );
}
