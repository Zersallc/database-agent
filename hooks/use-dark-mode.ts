"use client";

import { useSyncExternalStore } from "react";

/**
 * The `dark` class on <html> is the single source of truth for the color
 * scheme — ThemeScript sets it before paint and ThemeToggle flips it. Reading
 * it through an external store keeps client components (Monaco, ECharts,
 * Mermaid) in sync without duplicating the state in React.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const getSnapshot = () => document.documentElement.classList.contains("dark");
const getServerSnapshot = () => false;

export function useDarkMode() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
