"use client";

import { useEffect, useState } from "react";

export type Profile = { name: string; email: string; company_name: string | null };

/** The real name/email/company for the signed-in user — /api/v1/me's `profile`. */
export function useProfile(): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.profile) setProfile(body.profile);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return profile;
}
