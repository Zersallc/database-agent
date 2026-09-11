"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
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

type Company = { id: string; name: string };

/**
 * Developer-only. Everyone else belongs to exactly one company and sees no
 * switcher at all — this is the one role that isn't scoped to a single
 * tenant, so it needs a way to choose which one it's currently looking at.
 *
 * "Switching" here means what it says: it changes this account's own
 * companyId (the same field an admin edits from the Users page), so every
 * tenant-scoped view in the app — chat, connections, playbook — reflects
 * the selected company for free, with no separate "view as" plumbing.
 */
export function CompanySwitcher({ currentCompanyId }: { currentCompanyId: string | null }) {
  const { data: session, update } = useSession();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((body) => setCompanies(body.companies ?? []))
      .catch(() => {});
  }, []);

  const current = companies.find((c) => c.id === currentCompanyId);

  async function switchTo(companyId: string) {
    if (companyId === currentCompanyId || !session?.user?.id) return;
    setSwitching(true);
    try {
      const res = await fetch(`/api/users/${session.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't switch company.");
      }
      await update();
      window.location.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't switch company.");
      setSwitching(false);
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                disabled={switching}
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Building2Icon className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">
                    {switching ? "Switching…" : (current?.name ?? "No company")}
                  </span>
                  <span className="truncate text-xs opacity-70">Developer — all companies</span>
                </div>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent align="start" side="bottom" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Switch company</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {companies.map((company) => (
                <DropdownMenuItem key={company.id} onClick={() => void switchTo(company.id)}>
                  <span className="flex-1 truncate">{company.name}</span>
                  {company.id === currentCompanyId && <CheckIcon className="size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
