/**
 * Draws an answer the way the chat does, for tests.
 *
 * This renders through `components/chat/Markdown.tsx`, the component every
 * answer goes through, with `react-dom/server`, so what a test asserts on is
 * the markup a reader's browser would be given rather than the text that
 * produced it. There is no DOM in the test environment and none is needed: the
 * answers under test are plain paragraphs.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "@/components/chat/Markdown";

export function renderAnswer(content: string): string {
  return renderToStaticMarkup(createElement(Markdown, { content }));
}

/** The text a reader would read, one entry per line: <br/> and paragraph ends both start a new one. */
export function visibleLines(html: string): string[] {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The element names in a piece of markup. A link, emphasis or a heading shows up here. */
export function tagsIn(html: string): Set<string> {
  return new Set([...html.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((match) => match[1].toLowerCase()));
}
