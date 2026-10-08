"use client";

import * as React from "react";

/** Phones: below Tailwind's `sm` (640px). */
export const PHONE = "(max-width: 639.98px)";

/**
 * Whether a CSS media query matches, kept in sync as the window changes. The server and the first
 * render assume it doesn't, so lists that load after the page shows can pick their phone layout
 * without rendering both.
 */
export function useMedia(query: string) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
