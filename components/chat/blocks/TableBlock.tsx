"use client";

import { useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

type CellValue = string | number | boolean | null;

export function TableBlock({
  columns,
  rows,
}: {
  columns: string[];
  rows: CellValue[][];
}) {
  const data = useMemo(
    () =>
      rows.map((row) =>
        Object.fromEntries(columns.map((c, i) => [c, row[i] ?? null]))
      ),
    [columns, rows]
  );

  const columnDefs = useMemo<ColumnDef<Record<string, CellValue>>[]>(
    () => columns.map((c) => ({ accessorKey: c, header: c })),
    [columns]
  );

  const table = useReactTable({
    data,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300"
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-t border-zinc-100 dark:border-zinc-800"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
