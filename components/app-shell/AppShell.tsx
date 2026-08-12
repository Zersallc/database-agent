"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const LOGIN_PATH = "/login";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();

  const onLogin = pathname === LOGIN_PATH;

  // Signed-out visitors go to the login screen. "loading" is the real
  // session resolving (cookie check in flight) — waiting for it avoids
  // bouncing a signed-in user before their session comes back.
  useEffect(() => {
    if (status === "unauthenticated" && !onLogin) router.replace(LOGIN_PATH);
  }, [status, onLogin, router]);

  // The login screen is deliberately outside the workspace chrome.
  if (onLogin) return <>{children}</>;

  if (status !== "authenticated") {
    return <div className="min-h-svh bg-background" aria-busy="true" />;
  }

  return (
    <SidebarProvider>
      <WorkspaceSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
