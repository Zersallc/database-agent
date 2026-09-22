/**
 * Draws an answer the way the chat does, for graders.
 *
 * This is `components/chat/Markdown.tsx`, the component every answer goes
 * through, rendered with `react-dom/server`, so a grade about how an answer
 * reads on screen is a grade about the markup a browser would be given rather
 * than about the text that produced it. No DOM is needed: the answers being
 * checked are plain paragraphs.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "@/components/chat/Markdown";

export function renderAnswer(content: string): string {
  return renderToStaticMarkup(createElement(Markdown, { content }));
}

/**
 * The text a reader would read, one entry per line. Only <br/> and the end of a
 * paragraph start a new one: a newline inside a paragraph is whitespace to a
 * browser, which is exactly why a block of lines with no hard breaks reads as
 * one line, so it is treated as one here too.
 */
export function visibleLines(html: string): string[] {
  return html
    .replace(/\s*\n\s*/g, " ")
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
