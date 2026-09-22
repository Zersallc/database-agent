import { betweenBoundary } from "./between-boundary.eval";
import { relativeDateRecall } from "./relative-date-recall.eval";
import { connectionLabelAsSchema } from "./connection-label-as-schema.eval";
import { silentFixNoRenarration } from "./silent-fix-no-renarration.eval";
import { namingAbbreviatedTable } from "./naming-abbreviated-table.eval";
import { namingMultiConnectionAmbiguous } from "./naming-multi-connection-ambiguous.eval";
import { namingDecoyTable } from "./naming-decoy-table.eval";
import { answerShape } from "./answer-shape.eval";
import { noInventedAttribution } from "./no-invented-attribution.eval";
import { followUpRowOnScreen } from "./follow-up-row-on-screen.eval";
import { mostCommonOverFreeText } from "./most-common-over-free-text.eval";
import { mediaPostgresOnlyCases } from "./media-postgres-only.eval";
import { mediaOnlyCases } from "./media-only.eval";
import { mediaCrossSourceCases } from "./media-cross-source.eval";
import { mediaMultiLibraryCases } from "./media-multi-library.eval";
import { mediaAmbiguityCases } from "./media-ambiguity.eval";
import { mediaUnauthorizedCases } from "./media-unauthorized.eval";
import { mediaEfficiencyCases } from "./media-efficiency.eval";
import { mediaVagueCases } from "./media-vague.eval";
import { mediaLiveCases } from "./media-live.eval";
import { mediaKnownAnswerCases } from "./media-known-answer.eval";
import type { EvalCase } from "../types";

/**
 * The eleven cases the suite had before media connections. They run in a
 * workspace with databases only, which is what the A0 baseline measured, and
 * they can also be run with a library attached (`--with-library`) to see whether
 * merely having one changes how SQL questions are handled.
 */
export const LEGACY_CASES: EvalCase[] = [
  betweenBoundary,
  relativeDateRecall,
  connectionLabelAsSchema,
  silentFixNoRenarration,
  namingAbbreviatedTable,
  namingMultiConnectionAmbiguous,
  namingDecoyTable,
  answerShape,
  noInventedAttribution,
  followUpRowOnScreen,
  mostCommonOverFreeText,
];

/**
 * The media-connection cases, against fixture libraries and a stubbed database,
 * so what comes back is the same every time and only the model varies. The nine
 * families the plan named, plus vague requests for documents.
 */
export const MEDIA_CASES: EvalCase[] = [
  ...mediaPostgresOnlyCases,
  ...mediaOnlyCases,
  ...mediaCrossSourceCases,
  ...mediaMultiLibraryCases,
  ...mediaAmbiguityCases,
  ...mediaUnauthorizedCases,
  ...mediaEfficiencyCases,
  ...mediaVagueCases,
];

/** Cases against a real syslab-server tenant. Need RETRIEVAL_* in the environment. */
export const LIVE_CASES: EvalCase[] = mediaLiveCases;

/**
 * The known-answer set: a small, repeatable subset of LIVE_CASES with real,
 * checkable ground truth (golden.json plus one human-verified document-scoped
 * fact), rather than only "did it search". Needs the same RETRIEVAL_* as
 * every other live case, run separately from it so a full `--family=live`
 * run is unaffected by this addition.
 */
export const KNOWN_ANSWER_CASES: EvalCase[] = mediaKnownAnswerCases;

/** Everything that runs without a syslab-server. What `npm run eval` runs. */
export const ALL_CASES: EvalCase[] = [...LEGACY_CASES, ...MEDIA_CASES];
