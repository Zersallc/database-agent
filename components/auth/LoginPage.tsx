"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DatabaseIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { signIn, signInAsNewUser, useUsers } from "@/lib/users-store";
import { DEFAULT_COMPANY, userSubtitle } from "@/lib/workspace";

export function LoginPage() {
  const router = useRouter();
  const { users } = useUsers();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [title, setTitle] = useState("");

  function enter(userId: string) {
    signIn(userId);
    router.replace("/");
  }

  function createAndEnter() {
    if (!name.trim() || !email.trim()) return;
    signInAsNewUser({ name, email, company, title: title.trim() || "Member" });
    router.replace("/");
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <DatabaseIcon className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">Database Agent</h1>
          <p className="text-sm text-muted-foreground">
            Choose who you&apos;re signing in as.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Workspace members</CardTitle>
            <CardDescription>
              No password — this is a demo gate, not authentication.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => enter(user.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-accent"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-accent text-xs text-accent-foreground">
                    {user.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {userSubtitle(user)}
                  </p>
                </div>
                <Badge variant="outline">{user.role}</Badge>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Continue as someone new</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="login-name">Name</Label>
                <Input
                  id="login-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Moreau"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-title">Title</Label>
                <Input
                  id="login-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="CEO, Developer…"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-company">Company</Label>
              <Input
                id="login-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Placeholder until a real database supplies the tenant name.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={createAndEnter}
              disabled={!name.trim() || !email.trim()}
            >
              Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
