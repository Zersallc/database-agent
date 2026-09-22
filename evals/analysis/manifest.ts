/**
 * Which result files the A3 analysis reads, and what state each is in.
 *
 * The analysis is a function of a set of completed eval reports, each with a
 * role: the A0 baseline, the database-only rerun, the run with a library
 * attached, the two media passes, the live arm, and the three controls. A role
 * whose file does not exist yet, or cannot be read yet, is `pending`, and every
 * section that depends on it says so instead of showing an empty table that
 * could be mistaken for a result.
 *
 * This module only reads. It never writes a result file, and the A0 baseline is
 * opened for reading like any other.
 */

import { normalize, type NormalCase, type Report } from "../report";

export type Role =
  | "baseline_a0"
  | "legacy_database_only"
  | "legacy_with_library"
  | "media_pass_1"
  | "media_pass_2"
  | "live"
  | "control_no_database"
  | "control_relevant_library"
  | "control_no_library";

export type ManifestEntry = {
  role: Role;
  /** Relative to the repository root. */
  path: string;
  title: string;
  /** Anything a reader needs to know about how this result was produced. Stated, never inferred. */
  note?: string;
};

export const DEFAULT_MANIFEST: ManifestEntry[] = [
  {
    role: "baseline_a0",
    path: "evals/results/baseline-pre-media.json",
    title: "A0 baseline: the original eleven cases on main before any media change",
  },
  {
    role: "legacy_database_only",
    path: "evals/results/a3-legacy-dbonly.json",
    title: "A2/A2b database-only: the original eleven cases, no library attached",
  },
  {
    role: "legacy_with_library",
    path: "evals/results/a3-legacy-with-library.json",
    title: "Database plus library: the original eleven cases with a document library attached",
  },
  {
    role: "media_pass_1",
    path: "evals/results/a3-media.json",
    title: "Media families, first pass",
    note: "Graded before the provenance grader stopped demanding citations of files the run never retrieved; see the register.",
  },
  {
    role: "media_pass_2",
    path: "evals/results/a3-media-run2.json",
    title: "Media families, second pass",
  },
  { role: "live", path: "evals/results/a3-live.json", title: "Live retrieval against a real syslab-server tenant" },
  {
    role: "control_no_database",
    path: "evals/results/a3-control-no-database.json",
    title: "Control: no database attached",
  },
  {
    role: "control_relevant_library",
    path: "evals/results/a3-control-relevant-library.json",
    title: "Control: only the relevant libraries attached",
  },
  {
    role: "control_no_library",
    path: "evals/results/a3-control-no-library.json",
    title: "Control: no library attached",
  },
];

export type ResultMeta = {
  label: string | null;
  commit: string | null;
  branch: string | null;
  ranAt: string;
  model: string;
  endpoint: string | null;
  suite: string[] | null;
  options: Record<string, unknown> | null;
  repeat: number;
  scheduled: number;
  valid: number;
};

export type Loaded = {
  entry: ManifestEntry;
  /** `pending`: no file yet. `unreadable`: a file that is not a complete report (for instance one still being written). */
  state: "loaded" | "pending" | "unreadable";
  meta: ResultMeta | null;
  cases: NormalCase[];
};

type RawReport = Report & { suite?: string[]; options?: Record<string, unknown> };

/**
 * `read` returns a file's text, or null if there is no such file. It is injected
 * so the loader can be tested without files and so nothing here touches disk by
 * itself.
 */
export function loadResults(manifest: ManifestEntry[], read: (path: string) => string | null): Map<Role, Loaded> {
  const loaded = new Map<Role, Loaded>();
  for (const entry of manifest) {
    const text = read(entry.path);
    if (text === null) {
      loaded.set(entry.role, { entry, state: "pending", meta: null, cases: [] });
      continue;
    }
    try {
      const report = JSON.parse(text) as RawReport;
      if (!Array.isArray(report.cases)) throw new Error("no cases");
      const cases = normalize(report);
      const runs = cases.flatMap((kase) => kase.runs);
      loaded.set(entry.role, {
        entry,
        state: "loaded",
        cases,
        meta: {
          label: report.label ?? null,
          commit: report.env?.commit ?? null,
          branch: report.env?.branch ?? null,
          ranAt: report.ranAt,
          model: report.model,
          endpoint: report.env?.model_endpoint ?? null,
          suite: report.suite ?? null,
          options: report.options ?? null,
          repeat: report.repeat,
          scheduled: cases.reduce((total, kase) => total + kase.scheduled, 0),
          valid: runs.filter((run) => run.status === "valid").length,
        },
      });
    } catch {
      loaded.set(entry.role, { entry, state: "unreadable", meta: null, cases: [] });
    }
  }
  return loaded;
}

export const isLoaded = (result: Loaded | undefined): result is Loaded => result?.state === "loaded";
