"use client";

import { useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  downloadCSV,
  downloadElementAsPdf,
  downloadElementAsPng,
  EXPORT_IGNORE_ATTRIBUTE,
  safeFilename,
  type CellValue,
} from "@/lib/export";
import { cn } from "@/lib/utils";
import { BlockToolbar } from "./BlockToolbar";

const PAGE_SIZES = [10, 25, 50];

export function TableBlock({
  columns,
  rows,
  name = "table",
}: {
  columns: string[];
  rows: CellValue[][];
  /** Used to name exported files. */
  name?: string;
}) {
  // Exports target the content only, so the toolbar never lands in the file.
  const contentRef = useRef<HTMLDivElement>(null);
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

  const base = safeFilename(name, "table");

  return (
    <div className="my-3 not-prose">
      <BlockToolbar
        className="rounded-t-lg"
        exports={[
          { label: "CSV", onSelect: () => downloadCSV(columns, rows, `${base}.csv`) },
          {
            label: "PNG image",
            onSelect: () =>
              contentRef.current &&
              downloadElementAsPng(contentRef.current, `${base}.png`),
          },
          {
            label: "PDF",
            onSelect: () =>
              contentRef.current &&
              downloadElementAsPdf(contentRef.current, `${base}.pdf`),
          },
        ]}
      >
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search rows…"
          className="h-7 max-w-48"
        />
        <span className="text-xs text-muted-foreground">
          {filteredCount} {filteredCount === 1 ? "row" : "rows"}
        </span>
      </BlockToolbar>

      <div
        ref={contentRef}
        className="overflow-x-auto rounded-b-lg border border-border"
      >
        <table
          className="w-full text-sm"
          // A minimum, not a fixed width. TanStack's column sizes total 150px
          // per column, so a two-column result rendered at that width sits in a
          // third of the card with dead space beside it. As a floor the columns
          // stretch to fill a wide card and still scroll horizontally once
          // there are more of them than fit.
          style={{ minWidth: table.getCenterTotalSize() }}
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
        <div
          {...{ [EXPORT_IGNORE_ATTRIBUTE]: "" }}
          className="mt-2 flex items-center gap-2"
        >
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
