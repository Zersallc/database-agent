"use client";

export const THEME_STORAGE_KEY = "database-agent:theme";

/**
 * Applies the saved (or system) color scheme by toggling the `dark` class on
 * <html> while the browser parses the document, so there's no flash of the
 * wrong theme before hydration.
 *
 * `type="text/plain"` on the client keeps React from re-running the script and
 * from warning about rendered <script> tags.
 */
export function ThemeScript() {
  const html = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY
  )});var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
