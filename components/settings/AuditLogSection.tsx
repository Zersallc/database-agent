"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AuditEvent = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  company_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type Company = { id: string; name: string };

function describeEvent(event: AuditEvent, companyNameById: Map<string, string>): string {
  const who = event.actor_email ?? "Someone";
  const company = event.company_id ? companyNameById.get(event.company_id) : undefined;
  const meta = event.metadata ?? {};
  const suffix = company ? ` — ${company}` : "";

  switch (event.action) {
    case "connection.created":
      return `${who} registered database "${meta.name}"${suffix}`;
    case "connection.deleted":
      return `${who} removed database "${meta.name}"${suffix}`;
    case "data_access.updated": {
      const granted = (meta.granted as string[] | undefined) ?? [];
      const revoked = (meta.revoked as string[] | undefined) ?? [];
      const parts: string[] = [];
      if (granted.length) parts.push(`granted ${granted.join(", ")}`);
      if (revoked.length) parts.push(`revoked ${revoked.join(", ")}`);
      return `${who} ${parts.join("; ")}${suffix}`;
    }
    case "company.created":
      return `${who} created company "${meta.name}"`;
    case "company.updated":
      return `${who} updated ${company ?? "a company"}`;
    case "company.deleted":
      return `${who} deleted company "${meta.name}"`;
    case "user.created":
      return `${who} added user ${meta.email}${suffix}`;
    case "user.updated":
      return `${who} updated user${suffix}`;
    case "user.deleted":
      return `${who} removed user ${meta.email}`;
    default:
      return `${who} ${event.action}`;
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AuditLogSection() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [eventsRes, companiesRes] = await Promise.all([
          fetch("/api/audit-events?limit=30"),
          fetch("/api/companies"),
        ]);
        const eventsBody = await eventsRes.json().catch(() => ({}));
        const companiesBody = await companiesRes.json().catch(() => ({}));
        if (cancelled) return;
        setEvents(eventsBody.events ?? []);
        setCompanies(companiesBody.companies ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>
          Who changed what, and when — connections, table access, and company/user changes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-start justify-between gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0"
              >
                <span>{describeEvent(event, companyNameById)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatTimestamp(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
