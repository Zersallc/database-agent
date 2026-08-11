"use client";

import { useMemo, useState } from "react";
import { FilterIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type FilterConfig<T> = {
  column: string;
  label: string;
  /** Enum: multi-select checklist over distinct values found in the loaded data. */
  type: "enum" | "text";
  getValue: (row: T) => string | string[] | null | undefined;
};

/** Search + column filters over `data`, exposing the filtered result. */
export function useFilteredData<T>(data: T[], filterConfig: FilterConfig<T>[]) {
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});

  const setFilterValues = (column: string, values: string[]) => {
    setActiveFilters((prev) => {
      const next = { ...prev };
      if (values.length === 0) delete next[column];
      else next[column] = values;
      return next;
    });
  };

  const clearFilter = (column: string) => setFilterValues(column, []);
  const clearAll = () => {
    setActiveFilters({});
    setSearch("");
  };

  const filtered = useMemo(() => {
    let rows = data;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
    }

    for (const [column, values] of Object.entries(activeFilters)) {
      if (values.length === 0) continue;
      const config = filterConfig.find((f) => f.column === column);
      if (!config) continue;
      rows = rows.filter((row) => {
        const value = config.getValue(row);
        if (Array.isArray(value)) return value.some((v) => values.includes(v));
        return value != null && values.includes(String(value));
      });
    }

    return rows;
  }, [data, search, activeFilters, filterConfig]);

  return { filtered, search, setSearch, activeFilters, setFilterValues, clearFilter, clearAll };
}

export function FilterBar<T>({
  data,
  filterConfig,
  search,
  onSearchChange,
  activeFilters,
  onFilterChange,
  onClearFilter,
  searchPlaceholder = "Search…",
}: {
  data: T[];
  filterConfig: FilterConfig<T>[];
  search: string;
  onSearchChange: (value: string) => void;
  activeFilters: Record<string, string[]>;
  onFilterChange: (column: string, values: string[]) => void;
  onClearFilter: (column: string) => void;
  searchPlaceholder?: string;
}) {
  const activeCount = Object.values(activeFilters).filter((v) => v.length > 0).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>

        {filterConfig.map((config) => (
          <FilterDropdown
            key={config.column}
            data={data}
            config={config}
            selected={activeFilters[config.column] ?? []}
            onChange={(values) => onFilterChange(config.column, values)}
          />
        ))}

        {activeCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {activeCount} filter{activeCount === 1 ? "" : "s"} active
          </span>
        )}
      </div>

      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(activeFilters)
            .filter(([, values]) => values.length > 0)
            .map(([column, values]) => {
              const config = filterConfig.find((f) => f.column === column);
              return (
                <button
                  key={column}
                  type="button"
                  onClick={() => onClearFilter(column)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs hover:bg-muted"
                >
                  {config?.label ?? column}: {values.join(", ")}
                  <XIcon className="size-3" />
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

function FilterDropdown<T>({
  data,
  config,
  selected,
  onChange,
}: {
  data: T[];
  config: FilterConfig<T>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const set = new Set<string>();
    for (const row of data) {
      const value = config.getValue(row);
      if (Array.isArray(value)) value.forEach((v) => v && set.add(v));
      else if (value) set.add(String(value));
    }
    return Array.from(set).sort();
  }, [data, config]);

  const visibleOptions = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  function toggle(option: string) {
    onChange(selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <FilterIcon className="size-3.5" />
            {config.label}
            {selected.length > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                {selected.length}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-56 p-2">
        {options.length > 6 && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${config.label.toLowerCase()}…`}
            className="mb-2 h-7 text-xs"
          />
        )}
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {visibleOptions.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">No options.</p>
          )}
          {visibleOptions.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => toggle(option)}
                className="size-3.5 accent-primary"
              />
              {option}
            </label>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
