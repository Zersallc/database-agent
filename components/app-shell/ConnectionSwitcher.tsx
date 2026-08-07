"use client";

import { CheckIcon, ChevronsUpDownIcon, DatabaseIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/lib/workspace";
import { useWorkspace } from "@/lib/workspace-store";

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-400",
  degraded: "bg-amber-400",
  offline: "bg-zinc-500",
};

function StatusDot({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status])}
      aria-hidden
    />
  );
}

export function ConnectionSwitcher() {
  const { connections, activeConnection, setActiveConnectionId } = useWorkspace();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <DatabaseIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">
                    {activeConnection.name}
                  </span>
                  <span className="flex items-center gap-1.5 truncate text-xs opacity-70">
                    <StatusDot status={activeConnection.status} />
                    {activeConnection.engine}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent align="start" side="bottom" className="w-64">
            <DropdownMenuGroup>
              {/* Base UI requires GroupLabel to live inside a Group. */}
              <DropdownMenuLabel>Connected databases</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {connections.map((connection) => (
                <DropdownMenuItem
                  key={connection.id}
                  onClick={() => setActiveConnectionId(connection.id)}
                >
                  <StatusDot status={connection.status} />
                  <span className="flex-1 truncate">{connection.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {connection.engine}
                  </span>
                  {connection.id === activeConnection.id && (
                    <CheckIcon className="size-3.5" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
