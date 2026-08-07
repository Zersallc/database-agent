"use client";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

export function AppShell() {
  return (
    <SidebarProvider>
      <WorkspaceSidebar />
      <SidebarInset>
        <ChatWorkspace />
      </SidebarInset>
    </SidebarProvider>
  );
}
