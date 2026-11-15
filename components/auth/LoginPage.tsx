"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getProviders, signIn as nextAuthSignIn } from "next-auth/react";
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

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // "Sign in with Sys.Lab": the one login shared by all Sys.Lab products. The
  // button shows only when the server has it switched on. A link ending in
  // /login?sso=1 (the Sys.Lab Platform site uses it) goes straight to that
  // login, so someone already signed in there is not asked again.
  const [sysLab, setSysLab] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [touched, setTouched] = useState(false);

  // What came back in the address after a Sys.Lab sign-in that did not work.
  const problem = searchParams.get("error");
  const straightToSysLab = searchParams.get("sso") === "1" && !problem;
  const returnedError =
    problem === "NoAccess"
      ? "Your Sys.Lab login has no Database Agent access yet. Ask your administrator to add you with the same email."
      : problem
        ? "Sign-in did not complete. Please try again."
        : null;
  const shownError = error ?? (touched ? null : returnedError);

  function signInWithSysLab() {
    setTouched(true);
    setHandingOver(true);
    setError(null);
    void nextAuthSignIn("cognito", { callbackUrl: "/" });
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (straightToSysLab) {
          // /sso decides on the server (already signed in here, or on to the Sys.Lab
          // login), so this page's form is never shown to someone arriving from the
          // Sys.Lab Platform.
          window.location.replace("/sso");
          return;
        }
        const providers = await getProviders();
        if (!alive || !providers?.cognito) return;
        setSysLab(true);
      } catch {
        // The page still works with the password form.
      }
    })();
    return () => {
      alive = false;
    };
  }, [straightToSysLab, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
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

    router.replace("/");
    router.refresh();
  }

  if (straightToSysLab) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-muted/40 px-4">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <DatabaseIcon className="size-5" />
        </div>
        <p className="text-sm text-muted-foreground" role="status">Signing you in…</p>
      </div>
    );
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
            <CardDescription>
              {sysLab
                ? "Use your Sys.Lab login, or your workspace email and password."
                : "Use your workspace email and password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sysLab && (
              <div className="mb-4 space-y-4">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={handingOver || loading}
                  onClick={signInWithSysLab}
                >
                  {handingOver ? "Opening the Sys.Lab login…" : "Sign in with Sys.Lab"}
                </Button>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              {shownError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {shownError}
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
