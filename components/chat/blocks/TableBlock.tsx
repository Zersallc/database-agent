"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CellValue = string | number | boolean | null;

const PAGE_SIZES = [10, 25, 50];

function toCSV(columns: string[], rows: CellValue[][]): string {
  const escape = (value: CellValue) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join(
    "\n"
  );
}

function downloadCSV(columns: string[], rows: CellValue[][]) {
  const blob = new Blob([toCSV(columns, rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "results.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function TableBlock({
  columns,
  rows,
}: {
  columns: string[];
  rows: CellValue[][];
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const data = useMemo(
    () =>
      rows.map((row) =>
        Object.fromEntries(columns.map((c, i) => [c, row[i] ?? null]))
      ),
    [columns, rows]
  );

  const columnDefs = useMemo<ColumnDef<Record<string, CellValue>>[]>(
    () =>
      columns.map((c) => ({
        accessorKey: c,
        header: c,
        cell: (info) => {
          const value = info.getValue() as CellValue;
          if (typeof value === "boolean") return value ? "true" : "false";
          return value ?? "";
        },
      })),
    [columns]
  );

  const table = useReactTable({
    data,
    columns: columnDefs,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZES[0] } },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();

  return (
    <div className="my-3 not-prose">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search rows…"
          className="h-8 max-w-56"
        />
        <span className="text-xs text-muted-foreground">
          {filteredCount} {filteredCount === 1 ? "row" : "rows"}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => downloadCSV(columns, rows)}
        >
          <DownloadIcon />
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full text-sm"
          style={{ width: table.getCenterTotalSize() }}
        >
          <thead className="bg-muted/60">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      style={{ width: h.getSize() }}
                      className="relative px-3 py-2 text-left font-medium text-muted-foreground"
                    >
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUpIcon className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDownIcon className="size-3" />
                        ) : (
                          <ArrowUpDownIcon className="size-3 opacity-40" />
                        )}
                      </button>
                      <span
                        onMouseDown={h.getResizeHandler()}
                        onTouchStart={h.getResizeHandler()}
                        className={cn(
                          "absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none select-none hover:bg-primary/50",
                          h.column.getIsResizing() && "bg-primary"
                        )}
                      />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                    className="truncate px-3 py-2"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRightIcon />
          </Button>
          <select
            value={table.getState().pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="ml-auto h-7 rounded-md border border-border bg-background px-2 text-xs"
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
