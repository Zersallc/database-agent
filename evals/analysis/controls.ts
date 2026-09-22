/**
 * Pairing each control case with the case it was made from.
 *
 * A control is a case run with one thing taken away: the database, all but the
 * relevant libraries, or every library. Its id is the original's id and an
 * "@variant" suffix, so the comparison is exact: the same question, the same
 * grading, one difference. Each control row sets the control beside the original
 * in both media passes, because a difference smaller than the gap between the two
 * passes is not a difference the control can claim.
 *
 * A control whose result does not exist yet has no rows. The report says TBD for
 * it and does not show an empty table.
 */

import type { NormalCase } from "../report";

import { baseId, variantOf } from "./metrics";
import { summarizeCase, type CaseSummary } from "./repeat";

export type ControlRow = {
  controlId: string;
  baseId: string;
  variant: string;
  control: CaseSummary;
  firstPass: CaseSummary | null;
  secondPass: CaseSummary | null;
};

export function pairControls(control: NormalCase[], firstPass: NormalCase[], secondPass: NormalCase[]): ControlRow[] {
  const first = new Map(firstPass.map((kase) => [kase.id, kase]));
  const second = new Map(secondPass.map((kase) => [kase.id, kase]));
  return control.map((kase) => {
    const base = baseId(kase.id);
    return {
      controlId: kase.id,
      baseId: base,
      variant: variantOf(kase.id) ?? "",
      control: summarizeCase(kase),
      firstPass: first.has(base) ? summarizeCase(first.get(base)!) : null,
      secondPass: second.has(base) ? summarizeCase(second.get(base)!) : null,
    };
  });
}
