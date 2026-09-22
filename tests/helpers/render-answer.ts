/**
 * Draws an answer the way the chat does, for tests. The implementation lives
 * with the eval graders (evals/render.ts), which need the same thing; tests use
 * that one so the two cannot disagree about what "rendered" means.
 */

export { renderAnswer, tagsIn, visibleLines } from "../../evals/render";
