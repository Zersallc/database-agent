"use client";

import { PageHeader } from "@/components/app-shell/PageHeader";
import { usePlaybook } from "@/lib/playbook-store";
import { ContextPreview } from "./ContextPreview";
import { PlaybookEditor } from "./PlaybookEditor";
import { SystemPromptCard } from "./SystemPromptCard";

export function PlaybookPage() {
  const playbook = usePlaybook();

  return (
    <div className="flex h-svh flex-col">
      <PageHeader title="Playbook" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
          <div>
            <h1 className="text-xl font-semibold">Playbook</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything here is read by the agent before it answers. Edit the
              standing instructions, and switch individual skills on or off.
            </p>
          </div>

          <SystemPromptCard value={playbook.systemPrompt} />
          <PlaybookEditor playbook={playbook} />
          <ContextPreview playbook={playbook} />
        </div>
      </div>
    </div>
  );
}
