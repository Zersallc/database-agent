"use client";

import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPORT_IGNORE_ATTRIBUTE } from "@/lib/export";
import { cn } from "@/lib/utils";

export type ExportAction = {
  label: string;
  onSelect: () => void | Promise<void>;
};

/**
 * Shared header strip for rendered blocks: a label on the left, block-specific
 * actions in the middle, and an export menu on the right.
 */
export function BlockToolbar({
  children,
  exports,
  className,
}: {
  children?: React.ReactNode;
  exports?: ExportAction[];
  className?: string;
}) {
  return (
    <div
      // Chrome, not content — kept out of exported images and PDFs.
      {...{ [EXPORT_IGNORE_ATTRIBUTE]: "" }}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-t-lg border border-b-0 border-border bg-muted/60 px-2 py-1.5",
        className
      )}
    >
      {children}
      {exports && exports.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="xs" variant="ghost" className="ml-auto">
                <DownloadIcon />
                Export
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Download as</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {exports.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  onClick={() => {
                    // Never let an export failure disappear silently.
                    Promise.resolve(action.onSelect()).catch((error) => {
                      console.error(`Export "${action.label}" failed:`, error);
                    });
                  }}
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
