"use client";

import { MonitorIcon, MoonIcon, SunIcon, Trash2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MOCK_CONNECTIONS } from "@/lib/workspace";
import {
  clearLocalData,
  updateSettings,
  type ResponseDetail,
  type Settings,
  type ThemePreference,
} from "@/lib/settings-store";
import { cn } from "@/lib/utils";

/** A labelled row: description on the left, control on the right. */
function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-2">
      <div className="min-w-0">
        <Label htmlFor={htmlFor}>{label}</Label>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const THEMES: { value: ThemePreference; label: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

export function AppearanceSection({ settings }: { settings: Settings }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>How the workspace looks on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <Row label="Theme" description="System follows your operating system.">
          <div className="flex gap-1 rounded-lg border border-border p-1">
            {THEMES.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={settings.theme === option.value ? "secondary" : "ghost"}
                onClick={() => updateSettings({ theme: option.value })}
                className={cn(
                  settings.theme === option.value && "text-foreground"
                )}
              >
                <option.icon />
                {option.label}
              </Button>
            ))}
          </div>
        </Row>
      </CardContent>
    </Card>
  );
}

const DETAIL_LABELS: Record<ResponseDetail, string> = {
  concise: "Concise — answer first, minimal explanation",
  balanced: "Balanced — answer with brief reasoning",
  detailed: "Detailed — full walkthrough and caveats",
};

export function ChatSection({ settings }: { settings: Settings }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat</CardTitle>
        <CardDescription>
          How the agent responds and what it does automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        <Row
          label="Response detail"
          description="Sent with each question as a hint about length."
        >
          <Select
            items={DETAIL_LABELS}
            value={settings.responseDetail}
            onValueChange={(value) =>
              updateSettings({ responseDetail: value as ResponseDetail })
            }
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DETAIL_LABELS) as ResponseDetail[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {DETAIL_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          label="Auto-run generated SQL"
          description="Execute queries as soon as they appear, without pressing Execute."
          htmlFor="auto-run-sql"
        >
          <Switch
            id="auto-run-sql"
            checked={settings.autoRunSql}
            onCheckedChange={(autoRunSql) => updateSettings({ autoRunSql })}
          />
        </Row>
      </CardContent>
    </Card>
  );
}

export function ConnectionsSection({ settings }: { settings: Settings }) {
  const items = Object.fromEntries(
    MOCK_CONNECTIONS.map((c) => [c.id, `${c.name} · ${c.engine}`])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <CardDescription>
          Which database new conversations start against.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Row label="Default connection">
          <Select
            items={items}
            value={settings.defaultConnectionId}
            onValueChange={(value) =>
              updateSettings({ defaultConnectionId: value as string })
            }
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOCK_CONNECTIONS.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.name} · {connection.engine}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </CardContent>
    </Card>
  );
}

function DangerAction({
  label,
  description,
  confirmTitle,
  confirmBody,
  onConfirm,
}: {
  label: string;
  description: string;
  confirmTitle: string;
  confirmBody: string;
  onConfirm: () => void;
}) {
  return (
    <Row label={label} description={description}>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="destructive" size="sm">
              <Trash2Icon />
              {label}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Row>
  );
}

export function LocalDataSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Local data</CardTitle>
        <CardDescription>
          Conversations, playbook and settings all live in this browser. Nothing
          is stored on a server yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        <DangerAction
          label="Clear conversations"
          description="Deletes every chat and its messages."
          confirmTitle="Clear all conversations?"
          confirmBody="Every conversation and attached image in this browser will be deleted. Your playbook and settings are kept. This cannot be undone."
          onConfirm={() => clearLocalData(["database-agent:workspace"])}
        />
        <DangerAction
          label="Reset everything"
          description="Deletes conversations, playbook and settings."
          confirmTitle="Reset the whole workspace?"
          confirmBody="Conversations, your playbook, settings and the team roster will be deleted, and you will be signed out. This cannot be undone."
          onConfirm={() =>
            clearLocalData([
              "database-agent:workspace",
              "database-agent:playbook",
              "database-agent:settings",
              "database-agent:theme",
              "database-agent:users",
            ])
          }
        />
      </CardContent>
    </Card>
  );
}
