"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const LOGIN_PATH = "/login";
const AUTO_LOGIN_PATH = "/user-secret-signing-link-auto-login";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();

  const onLogin = pathname === LOGIN_PATH;
  // A visitor lands here signed out by definition — it does its own sign-in
  // and must not get bounced to /login before that finishes.
  const onAutoLogin = pathname === AUTO_LOGIN_PATH;

  // Signed-out visitors go to the login screen. "loading" is the real
  // session resolving (cookie check in flight) — waiting for it avoids
  // bouncing a signed-in user before their session comes back.
  useEffect(() => {
    if (status === "unauthenticated" && !onLogin && !onAutoLogin) router.replace(LOGIN_PATH);
  }, [status, onLogin, onAutoLogin, router]);

  // The login screen (and the auto-login landing page) are deliberately
  // outside the workspace chrome.
  if (onLogin || onAutoLogin) return <>{children}</>;

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
