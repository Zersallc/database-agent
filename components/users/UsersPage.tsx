"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlusIcon, XIcon } from "lucide-react";
import { PageHeader } from "@/components/app-shell/PageHeader";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addUser,
  removeUser,
  setCompany,
  updateUser,
  useCurrentUser,
  useUsers,
} from "@/lib/users-store";
import {
  canManageUsers,
  DEFAULT_COMPANY,
  TITLE_SUGGESTIONS,
  type Role,
  type User,
} from "@/lib/workspace";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin — full access, can manage users",
  member: "Member — can query and edit the playbook",
  viewer: "Viewer — read-only",
};

const ROLE_SHORT: Record<Role, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

function InviteDialog({ company }: { company: string }) {
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<Role>("member");

  function invite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    addUser({
      id: crypto.randomUUID(),
      name: trimmed.split("@")[0],
      email: trimmed,
      company,
      title: title.trim() || "Member",
      role,
      joinedAt: new Date().toISOString().slice(0, 10),
      status: "pending",
    });
    setEmail("");
    setTitle("");
    setRole("member");
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button size="sm">
            <UserPlusIcon />
            Invite
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They&apos;ll join {company} with access to its connections.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-title">Title</Label>
            <Input
              id="invite-title"
              list="title-suggestions"
              placeholder="CEO, Developer…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <datalist id="title-suggestions">
              {TITLE_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select
              items={ROLE_LABELS}
              value={role}
              onValueChange={(value) => setRole(value as Role)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as Role[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <DialogClose
            render={
              <Button onClick={invite} disabled={!email.trim()}>
                Send invite
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompanyCard({ company }: { company: string }) {
  const [draft, setDraft] = useState(company);
  const [lastCompany, setLastCompany] = useState(company);

  if (company !== lastCompany) {
    setLastCompany(company);
    setDraft(company);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company</CardTitle>
        <CardDescription>
          Shown under every member&apos;s name. Placeholder until a connected
          database supplies the real tenant name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              value={draft}
              placeholder={DEFAULT_COMPANY}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <Button
            onClick={() => setCompany(draft.trim() || DEFAULT_COMPANY)}
            disabled={draft.trim() === company}
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function UserRow({ user, isSelf }: { user: User; isSelf: boolean }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar className="size-7">
            <AvatarFallback className="bg-accent text-xs text-accent-foreground">
              {user.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium">
              {user.name}
              {isSelf && (
                <Badge variant="outline" className="text-[10px]">
                  you
                </Badge>
              )}
              {user.status === "pending" && (
                <Badge variant="secondary" className="text-[10px]">
                  pending
                </Badge>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {user.company}
      </TableCell>
      <TableCell>
        <Input
          value={user.title}
          list="title-suggestions"
          aria-label={`Title for ${user.name}`}
          onChange={(e) => updateUser(user.id, { title: e.target.value })}
          className="h-7 w-36"
        />
      </TableCell>
      <TableCell>
        <Select
          items={ROLE_SHORT}
          value={user.role}
          disabled={isSelf}
          onValueChange={(value) => updateUser(user.id, { role: value as Role })}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROLE_SHORT) as Role[]).map((value) => (
              <SelectItem key={value} value={value}>
                {ROLE_SHORT[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {user.joinedAt}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isSelf}
          aria-label={`Remove ${user.name}`}
          onClick={() => removeUser(user.id)}
        >
          <XIcon />
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * Admin-only team management. Every mutation is local — the real version needs
 * GET/POST/PATCH/DELETE on a `/api/users` endpoint behind a server-side role
 * check, since hiding the UI is not authorization.
 */
export function UsersPage() {
  const router = useRouter();
  const { users } = useUsers();
  const currentUser = useCurrentUser();

  // Belt and braces: the nav entry is already hidden for non-admins.
  if (currentUser && !canManageUsers(currentUser)) {
    router.replace("/");
    return null;
  }

  const company = currentUser?.company ?? DEFAULT_COMPANY;

  return (
    <div className="flex h-svh flex-col">
      <PageHeader title="Users" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
          <div>
            <h1 className="text-xl font-semibold">Users</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Who has access to this workspace, what they do, and what they can
              change.
            </p>
          </div>

          <CompanyCard company={company} />

          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                Title is their job; role is what the workspace lets them do.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-end">
                <InviteDialog company={company} />
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        isSelf={user.id === currentUser?.id}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
              <datalist id="title-suggestions">
                {TITLE_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
