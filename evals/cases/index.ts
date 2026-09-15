import { betweenBoundary } from "./between-boundary.eval";
import { relativeDateRecall } from "./relative-date-recall.eval";
import { connectionLabelAsSchema } from "./connection-label-as-schema.eval";
import { silentFixNoRenarration } from "./silent-fix-no-renarration.eval";
import { namingAbbreviatedTable } from "./naming-abbreviated-table.eval";
import { namingMultiConnectionAmbiguous } from "./naming-multi-connection-ambiguous.eval";
import { namingDecoyTable } from "./naming-decoy-table.eval";
import { answerShape } from "./answer-shape.eval";
import { noInventedAttribution } from "./no-invented-attribution.eval";
import type { EvalCase } from "../types";

export const ALL_CASES: EvalCase[] = [
  betweenBoundary,
  relativeDateRecall,
  connectionLabelAsSchema,
  silentFixNoRenarration,
  namingAbbreviatedTable,
  namingMultiConnectionAmbiguous,
  namingDecoyTable,
  answerShape,
  noInventedAttribution,
];
