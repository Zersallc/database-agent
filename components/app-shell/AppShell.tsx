"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useCurrentUser, useHydrated } from "@/lib/users-store";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const LOGIN_PATH = "/login";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const hydrated = useHydrated();

  const onLogin = pathname === LOGIN_PATH;

  // Signed-out visitors go to the login screen. Waiting for hydration avoids
  // bouncing a signed-in user, since the server always renders "signed out".
  useEffect(() => {
    if (hydrated && !user && !onLogin) router.replace(LOGIN_PATH);
  }, [hydrated, user, onLogin, router]);

  // The login screen is deliberately outside the workspace chrome.
  if (onLogin) return <>{children}</>;

  if (!hydrated || !user) {
    return <div className="min-h-svh bg-background" aria-busy="true" />;
  }

  return (
    <SidebarProvider>
      <WorkspaceSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
