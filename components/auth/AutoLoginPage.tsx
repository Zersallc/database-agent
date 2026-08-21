"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn as nextAuthSignIn } from "next-auth/react";
import { DatabaseIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Status = "signing-in" | "error";

export function AutoLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email")?.trim() ?? "";
  const company = searchParams.get("company")?.trim() ?? "";
  const [status, setStatus] = useState<Status>(email && company ? "signing-in" : "error");

  useEffect(() => {
    if (!email || !company) return;

    let cancelled = false;
    void nextAuthSignIn("auto-link", { email, company, redirect: false }).then((result) => {
      if (cancelled) return;
      if (result?.error) {
        setStatus("error");
        return;
      }
      router.replace("/");
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
    // Only the first render's params matter — this page's whole job is one attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <DatabaseIcon className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">Database Agent</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{status === "signing-in" ? "Signing you in…" : "Link not valid"}</CardTitle>
            <CardDescription>
              {status === "signing-in"
                ? "Just a moment."
                : "This link is missing an email or company, or the company name doesn't match a workspace."}
            </CardDescription>
          </CardHeader>
          {status === "error" && (
            <CardContent>
              <Link href="/login" className="text-sm text-primary underline underline-offset-4">
                Go to sign in
              </Link>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
