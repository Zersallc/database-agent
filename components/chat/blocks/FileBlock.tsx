"use client";

/**
 * DRAFT handler — a starting point, not the finished File handler.
 *
 * Today it renders an attachment card and, for images with a URL, an inline
 * preview. Still to build: CSV/Excel parsing into a TableBlock, PDF preview,
 * and downloads served from the backend.
 */

import {
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type FileKind = "csv" | "excel" | "pdf" | "image";

export type FilePayload = {
  name: string;
  type: FileKind;
  size?: string;
  url?: string;
};

const ICONS: Record<FileKind, typeof FileIcon> = {
  csv: FileSpreadsheetIcon,
  excel: FileSpreadsheetIcon,
  pdf: FileTextIcon,
  image: ImageIcon,
};

export function FileBlock({ file }: { file: FilePayload }) {
  const Icon = ICONS[file.type] ?? FileIcon;
  const canPreview = file.type === "image" && Boolean(file.url);

  return (
    <Card className="my-3 not-prose">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">
            {file.size ? `${file.size} · ` : ""}
            {file.type.toUpperCase()}
          </p>
        </div>
        <Badge variant="outline">{file.type}</Badge>
        <Button variant="outline" size="sm" disabled={!canPreview}>
          Preview
        </Button>
      </CardContent>
      {canPreview && (
        <CardContent>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.url}
            alt={file.name}
            className="max-h-80 w-full rounded-md object-contain"
          />
        </CardContent>
      )}
    </Card>
  );
}
