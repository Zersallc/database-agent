"use client";

import { useState } from "react";
import { CheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createSkill,
  deleteSkill,
  updateSkill,
  type PlaybookSkill,
  type PlaybookState,
} from "@/lib/playbook-store";
import { cn } from "@/lib/utils";

function SkillForm({ skill }: { skill: PlaybookSkill }) {
  const [draft, setDraft] = useState(skill);
  const [lastSkill, setLastSkill] = useState(skill);
  const [saved, setSaved] = useState(false);

  // Adjust state during render when the stored skill changes underneath us —
  // React's documented alternative to syncing props into state from an effect.
  if (skill !== lastSkill) {
    setLastSkill(skill);
    setDraft(skill);
  }

  const dirty =
    draft.name !== skill.name ||
    draft.description !== skill.description ||
    draft.content !== skill.content;

  function save() {
    updateSkill(skill.id, {
      name: draft.name.trim() || "Untitled skill",
      description: draft.description.trim(),
      content: draft.content,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Card className="flex-1">
      <CardHeader>
        <CardTitle>Edit skill</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="skill-description">Description</Label>
          <Input
            id="skill-description"
            value={draft.description}
            placeholder="One line explaining when this applies"
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="skill-content">Instructions</Label>
          <Textarea
            id="skill-content"
            value={draft.content}
            rows={16}
            placeholder="What should the agent know or do?"
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            className="min-h-72 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            {draft.content.length.toLocaleString()} characters
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={!dirty}>
            {saved ? <CheckIcon /> : null}
            {saved ? "Saved" : "Save"}
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(skill)}>
              Discard
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto"
            onClick={() => deleteSkill(skill.id)}
          >
            <Trash2Icon />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PlaybookEditor({ playbook }: { playbook: PlaybookState }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    playbook.skills.find((s) => s.id === selectedId) ?? playbook.skills[0] ?? null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Card className="lg:w-80 lg:shrink-0">
        <CardHeader>
          <CardTitle>Skills</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setSelectedId(createSkill())}
          >
            <PlusIcon />
            New skill
          </Button>

          {playbook.skills.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No skills yet.
            </p>
          )}

          <ul className="space-y-1">
            {playbook.skills.map((skill) => (
              <li key={skill.id}>
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg border border-transparent p-2 transition-colors hover:bg-accent/60",
                    skill.id === selected?.id && "border-border bg-accent"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(skill.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span
                      className={cn(
                        "block truncate text-sm font-medium",
                        !skill.enabled && "text-muted-foreground line-through"
                      )}
                    >
                      {skill.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {skill.description || "No description"}
                    </span>
                  </button>
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={(enabled) =>
                      updateSkill(skill.id, { enabled })
                    }
                    aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
                    className="mt-1"
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {selected ? (
        <SkillForm key={selected.id} skill={selected} />
      ) : (
        <Card className="flex-1">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Create a skill to start adding context.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
