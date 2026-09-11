"use client";

import { useSession } from "next-auth/react";
import { SettingsIcon } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isAdminRole } from "@/lib/roles";
import { useSettings } from "@/lib/settings-store";
import { AuditLogSection } from "./AuditLogSection";
import { ModelProviderSection } from "./ModelProviderSection";
import { ReportBrandingSection } from "./ReportBrandingSection";
import {
  AppearanceSection,
  ChatSection,
  ConnectionsSection,
  LocalDataSection,
} from "./SettingsSections";

export function SettingsPage() {
  const settings = useSettings();
  const { data: session } = useSession();
  const isAdmin = isAdminRole(session?.user?.role);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <SettingsIcon className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        Preferences for this workspace. Team management lives under Users.
      </p>

      <Tabs defaultValue="model-provider">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="model-provider">Model provider</TabsTrigger>
            {isAdmin && <TabsTrigger value="report-branding">Report branding</TabsTrigger>}
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="connections">Connections</TabsTrigger>
            <TabsTrigger value="local-data">Local data</TabsTrigger>
            {isAdmin && <TabsTrigger value="audit-log">Audit log</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="model-provider" className="mt-4">
          {/* Without a provider nothing else in the workspace answers.
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
        </TabsContent>

        {isAdmin && (
          <TabsContent value="report-branding" className="mt-4">
            <ReportBrandingSection />
          </TabsContent>
        )}

        <TabsContent value="appearance" className="mt-4">
          <AppearanceSection settings={settings} />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <ChatSection settings={settings} />
        </TabsContent>

        <TabsContent value="connections" className="mt-4">
          <ConnectionsSection settings={settings} />
        </TabsContent>

        <TabsContent value="local-data" className="mt-4">
          <LocalDataSection />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="audit-log" className="mt-4">
            <AuditLogSection />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
