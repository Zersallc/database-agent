"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2Icon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchReportSettings,
  readLogoFile,
  updateReportSettings,
  type ReportSettings,
} from "@/lib/report-settings-client";

const ACCEPTED_TYPES = ["image/png", "image/jpeg"];
const MAX_BYTES = 1024 * 1024;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function ReportBrandingSection() {
  const [settings, setSettings] = useState<ReportSettings | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<null | "name" | "logo" | "remove">(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReportSettings()
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setCompanyName(data.company_name);
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

  const saveName = async () => {
    if (!settings || companyName.trim() === settings.company_name) return;
    setSaving("name");
    setError(null);
    try {
      const updated = await updateReportSettings({ company_name: companyName.trim() });
      setSettings(updated);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(null);
    }
  };

  const uploadLogo = async (file: File) => {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Only PNG or JPG images are supported.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1024).toFixed(0)} KB; the limit is 1024 KB.`);
      return;
    }
    setSaving("logo");
    try {
      const { base64, mimeType } = await readLogoFile(file);
      const updated = await updateReportSettings({ logo_base64: base64, logo_mime_type: mimeType });
      setSettings(updated);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    setSaving("remove");
    setError(null);
    try {
      const updated = await updateReportSettings({ remove_logo: true });
      setSettings(updated);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report branding</CardTitle>
        <CardDescription>
          The company name and logo shown on generated ESG, Waste and GHG reports (PDF and
          Excel). Defaults to Medi Merchant's own mark until you upload a different one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-40" />
          </div>
        ) : (
          <>
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="grid gap-1.5">
              <Label htmlFor="report-company-name">Company name</Label>
              <div className="flex gap-2">
                <Input
                  id="report-company-name"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  onBlur={saveName}
                  maxLength={200}
                />
                {saving === "name" && (
                  <span className="self-center text-xs text-muted-foreground">Saving…</span>
                )}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Logo</Label>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-40 items-center justify-center rounded-md border border-border bg-muted/30 p-2">
                  {settings?.logo_data_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small user-uploaded logo preview, not a page asset
                    <img
                      src={settings.logo_data_url}
                      alt="Custom logo"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Default Medi Merchant mark</span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES.join(",")}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadLogo(file);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving !== null}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UploadIcon />
                    {saving === "logo" ? "Uploading…" : "Upload logo"}
                  </Button>
                  {settings?.has_custom_logo && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={saving !== null}
                      onClick={removeLogo}
                    >
                      <Trash2Icon />
                      {saving === "remove" ? "Removing…" : "Use default mark"}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">PNG or JPG, up to 1 MB.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
