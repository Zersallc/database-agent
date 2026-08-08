"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2Icon, ExternalLinkIcon, PlusIcon, Trash2Icon, XCircleIcon } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createModelProvider,
  deleteModelProvider,
  fetchModelProviders,
  testModelProvider,
  updateModelProvider,
  type ModelProvider,
  type ModelProviderPreset,
} from "@/lib/model-providers-client";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function StatusBadge({ provider }: { provider: ModelProvider }) {
  if (provider.status === "ready") {
    return (
      <Badge variant="secondary">
        <CheckCircle2Icon data-icon="inline-start" />
        Working
      </Badge>
    );
  }
  if (provider.status === "error") {
    return (
      <Badge variant="destructive">
        <XCircleIcon data-icon="inline-start" />
        Failing
      </Badge>
    );
  }
  return <Badge variant="outline">Untested</Badge>;
}

/** One configured provider, with the actions that apply to it. */
function ProviderRow({
  provider,
  onChanged,
}: {
  provider: ModelProvider;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | "test" | "default" | "delete">(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "test" | "default" | "delete", work: () => Promise<unknown>) => {
    setBusy(action);
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{provider.name}</span>
            {provider.is_default && <Badge>Active</Badge>}
            <StatusBadge provider={provider} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {provider.model}
            {provider.key_hint ? ` · key ${provider.key_hint}` : " · no key"}
            {provider.base_url ? ` · ${provider.base_url}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!provider.is_default && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run("default", () => updateModelProvider(provider.id, { is_default: true }))
              }
            >
              {busy === "default" ? "Switching…" : "Use this"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => run("test", () => testModelProvider(provider.id))}
          >
            {busy === "test" ? "Testing…" : "Test"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button size="sm" variant="ghost" disabled={busy !== null} aria-label="Remove">
                  <Trash2Icon />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {provider.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  The stored API key is deleted with it. If this is the active provider, the
                  next one in the list takes over; if it is the only one, the agent stops
                  answering until you add another.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => run("delete", () => deleteModelProvider(provider.id))}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {(error || provider.status_detail) && (
        <p
          className={`mt-1.5 text-xs ${error || provider.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {error ?? provider.status_detail}
        </p>
      )}
    </div>
  );
}

function AddProviderForm({
  presets,
  isFirst,
  onAdded,
  onCancel,
}: {
  presets: ModelProviderPreset[];
  isFirst: boolean;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "anthropic");
  const preset = presets.find((entry) => entry.id === presetId) ?? presets[0];

  const [model, setModel] = useState(preset?.suggested_model ?? "");
  const [baseUrl, setBaseUrl] = useState(preset?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching provider re-seeds the fields, since a model name and base URL
  // from the previous one are never right for the next.
  const choosePreset = (id: string) => {
    const next = presets.find((entry) => entry.id === id);
    setPresetId(id);
    setModel(next?.suggested_model ?? "");
    setBaseUrl(next?.base_url ?? "");
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createModelProvider({
        provider: presetId,
        model: model.trim(),
        ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        is_default: isFirst,
      });
      setApiKey("");
      await onAdded();
      onCancel();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const keyRequired = preset ? !preset.key_optional : true;
  const canSubmit =
    model.trim().length > 0 &&
    (!keyRequired || apiKey.trim().length > 0) &&
    (!preset?.requires_base_url || baseUrl.trim().length > 0);

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="mp-provider">Provider</Label>
        <Select
          items={Object.fromEntries(presets.map((entry) => [entry.id, entry.label]))}
          value={presetId}
          onValueChange={(value) => choosePreset(value as string)}
        >
          <SelectTrigger id="mp-provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset?.note && <p className="text-xs text-muted-foreground">{preset.note}</p>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="mp-model">Model</Label>
        <Input
          id="mp-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={preset?.suggested_model || "model name"}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Must support tool calling, or the agent cannot run SQL.
          {preset?.docs_url && (
            <>
              {" "}
              <a
                href={preset.docs_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 underline underline-offset-2"
              >
                Model list
                <ExternalLinkIcon className="size-3" />
              </a>
            </>
          )}
        </p>
      </div>

      {(preset?.requires_base_url || preset?.kind === "openai_compatible") && (
        <div className="grid gap-1.5">
          <Label htmlFor="mp-base-url">
            Base URL{preset?.requires_base_url ? "" : " (optional)"}
          </Label>
          <Input
            id="mp-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="mp-api-key">API key{keyRequired ? "" : " (not needed)"}</Label>
        <Input
          id="mp-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={keyRequired ? "Paste the key" : "Leave blank"}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Stored on the server, encrypted at rest by the configured secret store. It is never
          sent back to the browser — to change it later you paste a new one.
        </p>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit || saving}>
          {saving ? "Saving…" : "Save provider"}
        </Button>
      </div>
    </form>
  );
}

export function ModelProviderSection() {
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [presets, setPresets] = useState<ModelProviderPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /** Refresh after an action. Called from event handlers, never from an effect. */
  const load = useCallback(async () => {
    try {
      const { providers: fetched, presets: catalogue } = await fetchModelProviders();
      setProviders(fetched);
      setPresets(catalogue);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  // The initial fetch. State is set from the promise callbacks rather than the
  // effect body, and `cancelled` drops a response that lands after unmount —
  // otherwise navigating away mid-request warns and, on a slow connection,
  // resurrects stale data.
  useEffect(() => {
    let cancelled = false;

    fetchModelProviders()
      .then(({ providers: fetched, presets: catalogue }) => {
        if (cancelled) return;
        setProviders(fetched);
        setPresets(catalogue);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model provider</CardTitle>
        <CardDescription>
          Which AI answers questions in this workspace. Claude, Qwen, or anything speaking the
          OpenAI API — add several and switch between them to compare.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            {error && <p className="text-sm text-destructive">{error}</p>}

            {providers.length > 0 && (
              <div className="divide-y divide-border">
                {providers.map((provider) => (
                  <ProviderRow key={provider.id} provider={provider} onChanged={load} />
                ))}
              </div>
            )}

            {providers.length === 0 && !adding && !error && (
              <p className="text-sm text-muted-foreground">
                No provider configured. The agent replies with a setup notice until you add one.
              </p>
            )}

            {adding ? (
              <AddProviderForm
                presets={presets}
                isFirst={providers.length === 0}
                onAdded={load}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                <PlusIcon />
                Add provider
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
