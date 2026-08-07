"use client";

import { MessageSquareIcon, PlusIcon, XIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ConnectionSwitcher } from "./ConnectionSwitcher";
import { useWorkspace } from "@/lib/workspace-store";

// Placeholder identity until real auth exists.
const MOCK_USER = { name: "Mountacir", email: "mountacirw@gmail.com" };

export function WorkspaceSidebar() {
  const {
    conversations,
    activeConversationId,
    newConversation,
    selectConversation,
    deleteConversation,
  } = useWorkspace();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ConnectionSwitcher />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={newConversation} tooltip="New chat">
              <PlusIcon />
              <span>New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {conversations.map((conversation) => (
                <SidebarMenuItem key={conversation.id}>
                  <SidebarMenuButton
                    isActive={conversation.id === activeConversationId}
                    onClick={() => selectConversation(conversation.id)}
                    tooltip={conversation.title}
                  >
                    <MessageSquareIcon />
                    <span>{conversation.title}</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    showOnHover
                    aria-label={`Delete ${conversation.title}`}
                    onClick={() => deleteConversation(conversation.id)}
                  >
                    <XIcon />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <div className="flex items-center gap-2 p-1 group-data-[collapsible=icon]:hidden">
          <Avatar className="size-7">
            <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-accent-foreground">
              {MOCK_USER.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 leading-tight">
            <span className="truncate text-sm font-medium">{MOCK_USER.name}</span>
            <span className="truncate text-xs opacity-70">{MOCK_USER.email}</span>
          </div>
          <ThemeToggle />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
