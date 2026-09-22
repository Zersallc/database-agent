# A3 Final Acceptance Review

Reviewed 2026-09-22. Evidence-only review — no model calls, no runs, no prompt/code/fixture/grader changes made
in the course of writing this. git HEAD `46ee7ff` (unchanged; this document is itself an uncommitted, eval-only
addition, same as everything else A3 has produced).

## 1. Purpose

A3 was scoped to answer eleven questions (`evals/results/a3-assessment.md` §8) about the media-connections
change, grouped here into the distinct dimensions the review brief asked to be kept separate. A3 was never a
single score; each of these is its own claim, with its own evidence, and a strength in one says nothing about
another:

| Dimension | What A3 was meant to establish |
|---|---|
| Semantic tool/source selection | Does the model call `run_sql`, `search_documents`, both, or ask, correctly, for each of nine planned question shapes plus vague requests? |
| Retrieval correctness | When `search_documents` is called, does the retrieval path (fixture or real syslab-server) return the right passages, and does a failure there ever masquerade as a routing failure? |
| Authorization / isolation | Can the model reach, or cause the application to reach, a library or database it was not given? |
| Provenance | Does the delivered answer cite only what the run actually retrieved or queried, and never anything else? |
| Rendering | Does the Sources block the application constructs actually display correctly to the reader? |
| Infrastructure reliability | Did the evaluation runs themselves complete (no gateway rate-limit loss, no dropped runs) so that a reported rate is a measurement and not an artifact of lost data? |
| Answer quality | Given the right tool was called, is the answer itself correct (the same class of check the original eleven cases already made)? |

## 2. Evidence reviewed

No new evidence was generated for this review. Everything below rests on:

- `evals/results/a3-assessment.md` — the hand-written engineering review of the nine A3 result files (its own
  header states every figure was independently recomputed from the raw result JSON and confirmed to agree; this
  review treats that recomputation as already validated and does not re-derive it a third time).
- `evals/results/a3-analysis.md` / `.json` — the generated per-question report the assessment is a review of.
- `evals/results/a3-diagnostic-report.md` / `.json` — the controlled routing diagnostic (86 runs, 6-condition
  ablation on `media-vague-show-contracts` plus 5 secondary cases).
- `evals/results/a3-intro-experiment-report.md` / `.json` — the intro-wording A/B follow-up (60 runs, 6 cases x 2
  variants).
- `docs/agent/media-connections-handoff.md` and this session's project memory — for phase status, commit hashes,
  and decisions already made (A1 deployed at `6a6641e`; A2 at `b551b60`; A2b at `46ee7ff`, current HEAD, not
  deployed; T1 credential rotation verified on the box; the user's 2026-09-22 decisions on ISS-03, ISS-06, ISS-07,
  material ambiguity, and the multi-library provenance format).
- `evals/results/tier-a.json` — the deterministic Tier A suite snapshot cited by the assessment (944 tests, 939
  pass, 0 fail, 5 skipped).

## 3. Established behavior

| Area | Evidence | Status | What is established | What is NOT established |
|---|---|---|---|---|
| PostgreSQL-only routing | A0 110/110 (baseline, rerun, with-library); postgres-only family 20/20 both passes; 0 unnecessary searches in 60 SQL-only + efficiency runs per pass | Reliable | No unnecessary document search when the database answers alone; the original eleven cases are unaffected by a library being attached | `media-efficiency-revenue-by-region`'s 5/10, 6/10 no-tool-call runs depend on ISS-06 (ungraded pending decision on whether "zero search" alone should pass without a query having run) |
| Document retrieval (document-only) | Specific question + database 10/10 both passes; paraphrase 6/10, 3/10; library-only question (no database) `media-only-no-database` 0/10, 0/10; live specific questions 30/30 | Unreliable, question-specific | When a search *is* made, retrieval succeeds and the right file is cited (0 retrieval failures observed anywhere); a targeted question with a database attached is reliable | A pass rate for "document questions" generally — 1-3 questions per shape is not enough to generalize; the mechanism of the no-tool answers (a wording-echo resemblance to the prompt's own fallback sentence is a lead, not a demonstrated cause) |
| Cross-source routing | `media-cross-late-orders-and-penalty` 10/10 both; `media-cross-register-and-terms` 0/10 both (always SQL-only); intro experiment retested the latter and saw 1/5 -> 0/5 "used both", not significant | Unreliable on one of two tested questions | When both halves of a question are independently unambiguous, both sources are used; when the register can superficially answer part of the question with a count, the model settles for SQL alone | Whether this generalizes beyond two example questions |
| Multi-library routing | `leave-policy` 1/10, 2/10; `audit-findings` 5/10, 4/10; `two-relevant` 0/10 pass but 10/10 search (wrong subset: only Compliance, never Contracts too); 0 unnecessary library calls across 60 control runs; intro experiment moved leave-policy 3/5 -> 4/5, not significant | Unreliable for triggering search at all; reliable against over-searching | The model never calls a library the question does not need; when it does search among several, it is usually the right one | Why it frequently does not search at all in this family; whether more explicit source-choice wording helps more as source count grows (an open hypothesis, not confirmed at n=5) |
| Ambiguity — clear, low-risk | `payment-terms` 7/10, 8/10; `expiry-date` 0/10, 0/10 (both passes: 10/10 *searched*, but graded against a SQL-first expectation) | Partially reliable; `expiry-date`'s reading changed this session | Rule 1 (try the likely source, do not ask) holds for `payment-terms` most of the time | With ISS-03 resolved this session (a contract can be a valid source for an expiry-date question when the question asks what the contract states), `expiry-date`'s 0/10 is very likely not a real routing failure — but the case's own grader has not been updated to reflect that decision, so this is a **known, unapplied** re-read, not yet a re-measured number |
| Ambiguity — insufficient | `penalty-rate` 10/10, 9/10; `uncovered-customer` 10/10, 9/10 (one pass-2 run fails an unresolved answer check, ISS-07) | Reliable | Rule 2 (check or offer the other source, invent nothing) holds in the large majority of runs | The single ISS-07 failure — full answer text was never captured, so whether it is a real defect is unknown |
| Ambiguity — material | Both cases 0/20 (0 of 40 runs asked before acting) | Unreliable as written, but the read is open | The model did not ask a clarifying question first in any of the 40 tested runs | Per the user's decision this session: whether this is a genuine policy failure or the fixtures did not make the ambiguity explicit enough for the model to see it — explicitly deferred, and no new evidence was collected to settle it in this review |
| Unauthorized-source handling | Tier A: 944 tests, 939 pass, 0 fail, 5 skipped (live, need credentials); Tier B: `unauthorized-library-not-attached` 10/10 both passes (states nothing about it); `unauthorized-named-library` 10/10 both passes, though the model *attempted* a search in 6/10 runs each pass | Reliable at both layers | The application's authorization check is deterministic and tested (Tier A); even when the model attempts an unauthorized library, nothing false or leaked reaches the answer (Tier B) | The tool only ever offers attached libraries to begin with, so Tier B demonstrates manner, not an independent guarantee — the guarantee is Tier A's |
| Retrieval infrastructure | 0 retrieval failures across all fixture and live runs; live 30/40 pass, all 10 live failures are routing (the vague live case never searching), not retrieval; T1 verified new token works, old token and unauthorized requests 401 | Reliable | No retrieval-layer failure was observed anywhere in this evaluation, fixture or live | Behavior at production scale or against real corpora beyond the ~50-document test tenant and four live questions |
| Provenance | 291/291 runs that retrieved documents ended with a valid Sources block; 0 sanitization failures; 0 rendering failures; corrective retry 0/107, 0/103 on fixtures, 3/30 (all recovered) live | Reliable, demonstrated | The model writes a valid block essentially unprompted, and the application's ledger-based check never let an unbacked line through in any real run measured | The sanitizer's *protective* path — actually stripping a fabricated citation — was never exercised by real model behavior in these runs; that guarantee rests on Tier A unit/mutation tests, not on live-model evidence |
| Rendering | 0 rendering failures in the graded runs; A2b's own verification exercised the real `components/chat/Markdown.tsx` via `react-dom/server` | Demonstrated at the component level | The constructed Sources block renders as intended when run through the real rendering component in tests | Never independently verified in an actual browser (A2b's own stated limitation, unchanged since) |
| Database-only regression | Original eleven cases: 110/110 at A0, 110/110 rerun, 110/110 with a library attached; 0/110 unnecessary searches; +19-28% input tokens per request/run only when a library is actually attached | No regression | Adding the media-connections capability did not change database-only outcomes or the database-only prompt's byte content | Two minor, unexplained activity differences noted by the assessment (two SQL cases make one extra backstop-retry request with a library attached, of unknown cause; A0 made 19 more total requests than the rerun for the same pass counts) — neither changed a pass rate |
| Repeatability | 17 of 24 media cases have an identical pass count across the two passes; the rest differ by 1-3 of 10 runs | Established within-session; not established beyond it | The failure pattern is question-specific and largely stable within one day, one model endpoint, one commit | Whether it holds across days, model versions, or gateway load — never tested; the two passes are also not a fully controlled repeat (three evaluation-side tooling changes were made between them, shown not to move any pass count, but this was not a blind repeat) |
| Prompt / source-introduction sensitivity | Diagnostic: intro wording alone, p = 0.0022, the single strongest result across either A3 or its diagnostics; intro experiment: a specific improved wording produced no significant effect, mostly against a ceiling | Wording is a demonstrated variable; a specific fix is not validated | Prompt wording can move search-triggering by a large margin under adversarial (false-claim) conditions | That a *given* improved wording helps under normal conditions (the follow-up experiment could not test this on the case that mattered most, because that case was already at ceiling); that the "Choosing a source" section itself is a cause (three independent tests found no effect) |

## 4. Routing assessment

**Does the current semantic routing approach reliably select the correct tool/source for every important routing
class tested? No.** It is reliable for some classes and not others, and this is read directly from the A3 result
files, not from intuition:

- **Reliable, in both passes:** SQL-only questions (20/20), unauthorized requests (20/20 Tier B; Tier A fully
  green), a specific document question with a database attached (10/10), the "checked the other source first"
  ambiguity rule (18-20/20 across the two insufficient-source cases), cross-source when both halves are
  unambiguous (10/10).
- **Unreliable, in both passes:** whether `search_documents` is called at all for many document questions (74 of
  195 failed runs across both passes answered with no tool call, or asked instead of acting), questions needing
  two sources when one half can be superficially satisfied by a count (0/10 on `register-and-terms`), multi-library
  selection (6/30, 6/30 — the model usually does not search at all rather than searching the wrong library), and
  the rule to ask first under material ambiguity (0/40).

**Deterministic, stochastic, or mixed?** Mixed, and the evidence distinguishes the two: 17 of 24 media cases
produced an identical pass count on both passes (same commit, same model, same day), which argues the underlying
tendency is a stable, question-specific property of the current prompt and model rather than pure noise. The
remaining cases moved by 1-3 of 10 runs between passes (`paraphrase` 6->3 is the largest, p = 0.37), which A3's
own statistics correctly read as inside what ten draws of a real stochastic process produce — not distinguishable
from sampling noise at this size. Neither "the routing behavior is deterministic" nor "the routing behavior is
pure noise" is established; "stable and question-specific, with a handful of cases too close to call" is what the
repeated measurement actually shows.

**Is first-pass perfection an A3 requirement? No — and this review is careful to keep two different questions
apart:**

- *The A3 acceptance question* — can the current routing behavior be characterized well enough to make an
  informed architectural decision? **Yes.** 980 scheduled runs, 0 lost to infrastructure, a failure taxonomy with
  one primary cause charged per failed run (not inflated by counting the same run under three categories),
  controls that tested specific alternative explanations and ruled several out, and a follow-up diagnostic that
  isolated one of three previously-confounded variables to p = 0.0022. That is characterization, not perfection,
  and it is sufficient to know *what* is unreliable and, for the strongest case, *part of why*.
- *The future production requirement* — does the agent eventually need bounded recovery or corrective retrieval
  for an imperfect first-pass decision? **Not established by current evidence, and not decided here.** This is
  explicitly a later architectural question (§12), not something A3's evidence resolves and not something this
  review implements or recommends implementing now.

**The controlled diagnostic, read correctly.** It isolated database presence, the "## Choosing a source" section,
and the "## Connection" intro wording from each other for one case (`media-vague-show-contracts`) by editing the
real, unmodified `buildSystemPrompt()` output at the client layer — not by changing production code. The p = 0.0022
result (intro wording alone, 6/6 -> 0/6) is real and clears a conventional significance threshold, but it describes
one case's response to one adversarial substitution (a false "no database" claim), at n=6. It does not establish
that intro wording is *the* mechanism behind A3's broader routing unreliability, does not generalize to the other
routing classes without further testing, and is explicitly contradicted in direction by one secondary case
(`media-multi-leave-policy`, which moved 3/5 -> 0/5 when the *section* — not the intro — was removed, p = 0.17,
not significant). The diagnostic itself documents this as "evidence toward resolving [A3's] smallest open
question," not a universal causal mechanism, and this review does not overstate it further.

**The intro-wording experiment, read correctly.** It was properly controlled (Variant B built by appending to the
real control text, never retyping it, so the preserved wording could not drift) and produced no evidence of
regression anywhere. It also produced no evidence of improvement: four of six test cases were already at ceiling
under the real control prompt, including the one case (`media-vague-show-contracts`) the diagnostic had flagged,
so the experiment had no headroom to show an effect where it mattered most. The two cases with real headroom
split in opposite directions, both at p = 1.00. The experimental wording is not validated, not rejected, and
remains eval-only — nothing here justifies adopting it, and nothing here justifies abandoning the underlying
hypothesis either. Per your own instruction, this review does not recommend another wording experiment; if one is
wanted later it would need cases chosen for headroom, which neither this evaluation nor the diagnostic's matrix
was built to provide in adequate number.

## 5. Retrieval / infrastructure assessment

Zero retrieval-layer failures were observed across every fixture run, every live run, and T1's manual verification
on the box. All ten live-case failures are routing (the model did not call `search_documents`), not retrieval —
when the tool *was* called, it always succeeded. T1 independently confirmed the live path end to end: the new
token retrieves successfully (keyword + vector, real coverage numbers), the old token and unauthorized requests
both 401, and production's own health and configuration were unaffected by the rotation. Every scheduled A3 run
completed (0 lost to rate limits, 0 lost to infrastructure failures) — the reported pass rates are real
measurements, not artifacts of dropped data. Not established: behavior against a real production corpus (the test
tenant holds roughly 50 documents; live evidence is four questions against one tenant), or retrieval latency/
volume behavior under production load.

## 6. Security / authorization assessment

This is not folded into the routing score, per your instruction. Two independent layers of evidence:

- **Tier A (deterministic).** 944 tests, 939 pass, 0 fail, 5 skipped (the skips are the live tests, which need
  credentials — not failures). This covers the isolation guarantees built in A1 (media records invisible in every
  database listing until A5 deliberately changes that; `assertDatabaseConnection` enforced at every SQL entry
  point; `isDatabaseConnection` fails closed) and the authorization resolution built in A2 (the model supplies
  only a query and, when relevant, a library name; the application resolves the authorized connection and
  backend at call time, every call, not just at session start).
- **Tier B (the model at the boundary).** `unauthorized-library-not-attached`: 10/10 both passes, the model states
  nothing about a library it was not given. `unauthorized-named-library`: 10/10 both passes on the outcome that
  matters (nothing false reaches the answer), though the model did *attempt* a search naming an unauthorized
  library in 6 of 10 runs each pass — the application's authorization check is what stops it, which is exactly the
  design (the model is not trusted to self-police; the application is the enforcement point). This is evidence of
  manner, not an independent guarantee — the guarantee is Tier A's, and it is unconditional on model behavior.

T1 additionally demonstrated the retrieval-token rotation itself is safe in practice: the new token works, the
old one is fully revoked (401 from the LAN), and production's own `.env` and running commit were verified
unchanged by the rotation.

No unauthorized access was observed in any run reviewed for this report.

## 7. Provenance / rendering assessment

Also kept separate from routing, per your instruction. Across every run in A3 that retrieved at least one
document (107 pass 1, 103 pass 2, 30 live, 31 and 20 in two controls — 291 total), the delivered answer ended
with a valid Sources block in every case. Zero sanitization failures: the application's ledger-based check, which
keeps only lines backed by what the run actually retrieved or queried, never let an unbacked line through in any
of these 291 runs. Zero rendering failures: the constructed block, run through the real `Markdown.tsx` component
in tests, rendered as intended (line breaks, autolink escaping, and the library-name-in-parentheses format all
verified). The corrective retry — asked for only when documents were retrieved and no valid block survived — fired
in 0 of 107 and 0 of 103 fixture runs, and 3 of 30 live runs (all three recovered on the retry).

What this evidence does not cover: the sanitizer's *protective* path (actually stripping a genuinely fabricated
citation) was never triggered by real model behavior in any of these 291 runs, because the model never fabricated
one here. That path is exercised only by Tier A's deterministic and mutation tests, not by live-model evidence —
a true statement about what has and has not been demonstrated, not a weakness that changes the provenance
finding itself.

## 8. A0 regression assessment

**Did SQL-only behavior regress? No.** The postgres-only family is 20/20 in both A3 passes, and 0 unnecessary
document searches occurred across the 60 SQL-only and efficiency runs measured per pass (one open item, ISS-06,
concerns *how the efficiency family's own pass condition is worded*, not whether an unwanted search happened —
none did).

**Did unnecessary document searching appear in SQL-only cases? No.** 0 of 110 runs with a library attached, in
either the original-eleven rerun or the new SQL-only family, searched a library the question did not need.

**Did the database-only prompt behavior change? No.** The original eleven cases are 110/110 at A0 (before any
media change), 110/110 in the post-A2/A2b rerun, and 110/110 with a library attached (Fisher p = 1.00 against A0
in every case; Wilson intervals 97-100%). `naming-multi-connection-ambiguous`, the one case the plan specifically
required to keep passing, is 10/10 in all three results.

**Did existing baseline outcomes remain stable? Yes, with two minor, unexplained, pass-rate-neutral activity
differences the assessment flagged rather than hid:** two SQL cases (`naming-abbreviated-table`,
`naming-decoy-table`) make one additional backstop-retry request in every run once a library is attached, of a
kind the result format does not record the specific cause of; and A0 made 19 more total agent requests than the
post-A2/A2b rerun for the identical eleven cases and identical pass counts, which the retained data cannot
explain. Neither changed which cases passed. The library sections themselves add a measured 612-632 input tokens
per request (+19% over database-only) whenever a library is actually attached to a workspace — a real, quantified
cost of the capability, not a defect.

**Conclusion: no regression in previously existing PostgreSQL behavior.** The new capability's cost is additive
context tokens when a library is attached, not altered SQL behavior.

## 9. Unresolved issues

| Issue | Current evidence | Severity | Can A4 proceed without resolving it? |
|---|---|---|---|
| Mechanism of no-tool document failures (74 of 195 failed runs) | A wording-echo resemblance to the prompt's own fallback sentence is a lead, not a demonstrated cause; the diagnostic established wording *can* move this for one case (p = 0.0022) but not that it explains the broader pattern | High (largest single failure mode by run count) | Yes — A4 is service/routes for connection management; it does not touch or depend on this |
| Multi-library under-triggering (6/30, 6/30) | Never over-searches; frequently does not search at all; one directional, non-significant hint (intro experiment, leave-policy, p = 1.00) that clearer wording might help | Medium | Yes |
| Cross-source SQL-only default on `register-and-terms` (0/10 both passes, and the intro-experiment retest) | Stable across three separate measurements now | Medium | Yes |
| Material ambiguity: 0/40 asked first | Established as written; whether the fixtures make the ambiguity discoverable to the model is explicitly open per your decision this session, and was not tested further in this review | Medium (policy-relevant if rule 3 is depended on) | Yes |
| Expectation-dependent cases: ISS-03 (resolved this session, not yet applied to the `expiry-date` grader), ISS-06 (resolved this session, no query requirement to add) | Policy decided; implementation not yet done | Low (bookkeeping, not a behavior defect) | Yes |
| ISS-07: one unresolved answer-check failure, full text never captured | n = 1, cannot be read either way from the stored record | Low | Yes |
| Whether the "Choosing a source" section causes anything | Diagnostic found no effect in three independent tests on the primary case; not tested elsewhere | Low | Yes |
| Repeatability beyond one day / one model endpoint / one commit | Never measured | Low for A3 closure; relevant to future governance of prompt changes | Yes |
| Production-scale / real-corpus generalization | Test corpus ~50 documents, one company shape; live evidence is 4 questions, 1 tenant | Medium for eventual go-live confidence | Yes — A4 does not deploy to real users |
| Whether bounded corrective retrieval is eventually needed | Not established by current evidence either way; explicitly a later architectural question, not resolved by A3's evidence and not decided in this review | N/A — deferred by design | Yes |

## 10. A3 acceptance decision

### `A3 ACCEPTED WITH FOLLOW-UP`

The evidence is sufficient to close the validation phase. 980 A3 runs plus 86 diagnostic runs plus 60 experiment
runs, all valid, all classified by a consistent one-primary-cause taxonomy, with controls that tested and in
several cases ruled out specific alternative explanations, and a genuine causal isolation (p = 0.0022) on the
strongest single failure. The deterministic guarantees this project depends on for safety and correctness —
authorization/isolation (Tier A, 944/939/0/5), no database-only regression (110/110 unchanged across three
results), provenance (291/291 valid blocks, 0 sanitization failures), and rendering (0 failures) — all hold
cleanly and are not in question.

What is not clean, and is carried forward explicitly rather than closed out: semantic routing for document
questions, multi-library selection, cross-source defaulting to SQL, and material-ambiguity clarification are all
demonstrated to be unreliable, in ways that are stable and question-specific (not attributable to infrastructure,
grading, or fixture bugs — the controls checked this) but whose underlying mechanism is not established. No
threshold exists in the plan to call this pattern a formal regression, and it is not one: it is the first honest
measurement of a new capability's routing behavior, and the measurement itself is sound even though the behavior
it measured is imperfect.

This is not `A3 ACCEPTED` outright, because material routing limitations exist and are not waved away. It is not
`A3 NOT ACCEPTED`, because nothing found is fundamental enough to block the next engineering phase — A4 does not
change or depend on semantic routing (§11) — and because the standing rule this project has followed throughout
(clean -> proceed; regression -> fix and re-test with approval; nothing here is a regression from any prior
accepted state) has no formal basis to keep A3 open indefinitely waiting for routing perfection that was never
its bar.

## 11. A4 readiness assessment

**Does A4 itself change semantic routing behavior?** No. A4, per the approved phase plan, is the service and
routes layer for creating, editing, removing and enabling media connections (Developer-only, per the plan's own
A4 scope). It does not touch `lib/agent/prompt.ts`, `lib/agent/index.ts`, or any of the routing-policy sections
this review's evidence concerns.

**Does A4 depend on unresolved A3 behavior?** No. Provisioning a media connection (the admin CRUD surface) is
independent of whether the model reliably chooses to search it once provisioned. A4 does not require routing
reliability to be implemented correctly.

**Would proceeding with A4 create irreversible architectural commitments?** Not identified in the evidence
reviewed. A4's route/service contracts are a separate layer from the prompt and routing logic A2/A2b already
built; nothing in the open routing issues constrains what an admin CRUD API needs to look like.

**Can A4 preserve current routing behavior and keep routing improvements isolated?** Yes, by construction — A4 is
scoped to a different part of the codebase than the routing prompt, and every open issue in §9 is answerable
"yes" for "can A4 proceed without resolving it."

**A4 may proceed as the next engineering/implementation phase.** This is a distinct decision from deploying
anything: A2/A2b deployment remains its own, separately gated decision (per your own standing instruction — "keep
A2/A2b deployment gated until A3 is resolved" — and A3 acceptance for the purpose of *planning and building the
next phase* is not the same act as authorizing a production rollout). This review recommends only that A4
implementation may begin; it does not authorize deploying A2, A2b, or A4's own output, which stay behind A6's
rollout gate as already established.

## 12. Recommended next phase

Per the approved plan, the immediate next phase is **A4 (service and routes)**, unaffected by this review's
routing findings for the reasons in §11.

Separately, and not scoped, sequenced, or implemented by this review, the routing limitations in §9 point toward
a later phase whose shape is architectural rather than another round of prompt tuning. The evidence supports
naming candidate directions without selecting or committing to any of them:

- **Bounded evidence/sufficiency assessment** at the application layer — an observable, structural check
  (comparable to the existing "answered without running a query — retrying" backstop `lib/agent/index.ts` already
  has for the SQL case) for the specific failure signature this evidence repeatedly found: an answer about
  documents, or a pointer to a library, delivered with no search having been made in the run.
- **Corrective retrieval or clarification-first behavior** for the material-ambiguity and no-tool cases —
  contingent on first resolving whether the fixtures make the ambiguity discoverable (§9), which is a decision,
  not a run.
- **Alternate-source retrieval** for cross-source under-triggering.
- **Observability** in production once A4/A5 exist — logging no-tool document answers as a real signal, since the
  current evidence's biggest limitation is that it is bench evidence (one small fixture corpus, four live
  questions) rather than production traffic.
- **Hard tool-call/time/cost budgets** were not evaluated by A3 at all and are out of this review's evidence base
  entirely — noted only because the brief asked this option be distinguished from the others, not because
  anything found here motivates it.

None of these is a requirement established by A3's evidence; they are the shape a later phase would have to take
*if* the routing limitations are judged worth addressing before further rollout. That judgment is yours to make,
and this review does not make it for you.

## 13. Evidence limitations

- **Single day, single model endpoint, single commit.** Every number in this review comes from `46ee7ff` against
  `syslab-default` on 2026-09-21/22. Nothing establishes stability across days, gateway load, or a model version
  change.
- **The two A3 passes are not a blind controlled repeat.** Three evaluation-side tooling changes were made between
  them (grader correction, primary-cause classification, `--variant` support); the assessment demonstrates none of
  the three moved a pass count, but this was verified after the fact, not designed as a blind repeat from the
  start.
- **Small samples throughout.** 10 runs per case in A3 itself; 5-6 runs per condition in the diagnostic and the
  intro experiment. Every interval reported anywhere in this evidence base is wide; only one comparison in the
  entire body of work (the diagnostic's intro-wording result, p = 0.0022) clears a conventional significance
  threshold.
- **Small, homogeneous fixture corpus.** One company shape, one Sales database, three document libraries, roughly
  50 fixture documents. Live evidence is four questions against one real syslab-server test tenant.
- **Thresholds mostly undecided.** Of twenty defined threshold IDs, only the plan's original four (T03, T04, T13,
  T15) have a stated pass condition; the rest are recorded as observed values with no acceptance bar, by design —
  this review makes an acceptance decision on the totality of the evidence, not against numeric targets that were
  never set.
- **Three items decided by you this session, not yet reflected in the tooling:** ISS-03 and ISS-06 have resolved
  interpretations but the graders that produced the numbers in this report have not been re-run against them; the
  `expiry-date` and `revenue-by-region` figures in §3-4 should be read as "very likely not real failures under the
  now-resolved policy" rather than as re-measured numbers.
- **The rendering guarantee is component-level, not browser-verified.** Both A2b originally and this review note
  the same limitation: verified through the real rendering component in tests, never independently confirmed in
  an actual browser session.
- **This report itself synthesizes rather than re-derives.** Every figure is taken from `a3-assessment.md`,
  `a3-diagnostic-report.md`, and `a3-intro-experiment-report.md`, each of which states its own basis; this review
  did not re-open the raw per-run JSON files a further time to check them independently.

---

## Summary

1. **A3 status:** `A3 ACCEPTED WITH FOLLOW-UP`.
2. **Is semantic routing sufficiently characterized?** Yes — not sufficiently *reliable*, but sufficiently
   *measured and understood in shape* (stable, question-specific, taxonomized by primary cause, partially
   isolated causally) to make an informed decision without further runs.
3. **Did PostgreSQL behavior regress?** No — 110/110 unchanged across A0, the rerun, and with a library attached.
4. **Are retrieval, provenance, and security accepted?** Yes, on the evidence reviewed — 0 retrieval failures, 0
   provenance sanitization/rendering failures, Tier A authorization fully green (939/939 of the tests that ran).
5. **Should A4 proceed?** Yes, as the next implementation phase — it does not touch or depend on the unresolved
   routing behavior. This does not authorize deploying A2, A2b, or A4's output; that stays behind the existing,
   separately-held A6 rollout gate.
6. **The single most important unresolved engineering issue:** why the model frequently answers a document
   question with no tool call at all (74 of 195 failed media runs) — a real, repeatable pattern whose mechanism is
   not established, only its strongest single-case lever (intro wording, on one case, under an adversarial prompt
   substitution) is.

STOP.
