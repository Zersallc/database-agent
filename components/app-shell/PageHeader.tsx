"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

/** Shared top bar for every route in the workspace. */
export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <span className="truncate text-sm font-medium">{title}</span>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  );
}
