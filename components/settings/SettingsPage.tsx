"use client";

import { useSession } from "next-auth/react";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettings } from "@/lib/settings-store";
import { ModelProviderSection } from "./ModelProviderSection";
import {
  AppearanceSection,
  ChatSection,
  ConnectionsSection,
  LocalDataSection,
} from "./SettingsSections";

export function SettingsPage() {
  const settings = useSettings();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "Admin";

  return (
    <div className="flex h-svh flex-col">
      <PageHeader title="Settings" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
          <div>
            <h1 className="text-xl font-semibold">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Preferences for this workspace. Team management lives under Users.
            </p>
          </div>

          {/* First: without a provider nothing else in the workspace answers.
              It's shared by the whole company, so only an admin changes it. */}
          {isAdmin ? (
            <ModelProviderSection />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Model provider</CardTitle>
                <CardDescription>
                  Which AI answers questions in this workspace — shared by everyone at your
                  company. Ask an admin to change it.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          <AppearanceSection settings={settings} />
          <ChatSection settings={settings} />
          <ConnectionsSection settings={settings} />
          <LocalDataSection />
        </div>
      </div>
    </div>
  );
}
