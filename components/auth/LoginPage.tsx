"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSession, signIn as nextAuthSignIn } from "next-auth/react";
import { DatabaseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  signIn as setDisplayUser,
  signInAsNewUser,
  updateUser,
  useUsers,
} from "@/lib/users-store";
import { DEFAULT_COMPANY, type Role } from "@/lib/workspace";

export function LoginPage() {
  const router = useRouter();
  const { users } = useUsers();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await nextAuthSignIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }

    // Real auth is the actual gate (checked server-side on every request).
    // This just mirrors the signed-in identity into the display-only store
    // the workspace chrome (sidebar, avatar, "Company — Title" line, and the
    // admin-only nav items) reads from, so it isn't a blank/hung screen — and
    // isn't stuck showing the wrong role — after a real login.
    const session = await getSession();
    const role: Role = session?.user?.role === "Admin" ? "admin" : "member";

    const existing = users.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase()
    );
    if (existing) {
      setDisplayUser(existing.id);
      if (existing.role !== role) updateUser(existing.id, { role });
    } else {
      signInAsNewUser({
        name: email.split("@")[0],
        email,
        company: DEFAULT_COMPANY,
        title: "Member",
        role,
      });
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <DatabaseIcon className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">Database Agent</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your workspace email and password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
