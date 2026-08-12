"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenIcon,
  Building2Icon,
  LogOutIcon,
  MessageSquareIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { signOut, useCurrentUser } from "@/lib/users-store";
import { canManageUsers, userSubtitle } from "@/lib/workspace";
import { useWorkspace } from "@/lib/chat-store";
import { ConnectionSwitcher } from "./ConnectionSwitcher";

const NAV = [
  { href: "/", label: "Chat", icon: SparklesIcon },
  { href: "/playbook", label: "Playbook", icon: BookOpenIcon },
  { href: "/users", label: "Users", icon: UsersIcon, adminOnly: true },
  { href: "/companies", label: "Companies", icon: Building2Icon, adminOnly: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const {
    conversations,
    activeConversationId,
    newConversation,
    selectConversation,
    deleteConversation,
  } = useWorkspace();

  const onChat = pathname === "/";
  const nav = NAV.filter(
    (item) => !item.adminOnly || (user && canManageUsers(user))
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ConnectionSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname === item.href}
                    tooltip={item.label}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Conversation history is only relevant on the chat route. */}
        {onChat && (
          <SidebarGroup>
            <SidebarGroupLabel>Conversations</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => void newConversation()} tooltip="New chat">
                    <PlusIcon />
                    <span>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

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
                      onClick={() => void deleteConversation(conversation.id)}
                    >
                      <XIcon />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        {user && (
          <div className="flex items-center gap-2 p-1 group-data-[collapsible=icon]:hidden">
            <Avatar className="size-7">
              <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-accent-foreground">
                {user.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">{user.name}</span>
              <span className="truncate text-xs opacity-70">
                {userSubtitle(user)}
              </span>
            </div>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => {
                signOut();
                router.replace("/login");
              }}
            >
              <LogOutIcon />
            </Button>
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
