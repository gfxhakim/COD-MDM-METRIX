"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const ACTIVE = '.slide-item:is([aria-current="page"], [aria-pressed="true"], [data-state="active"], [data-active="true"])';

/**
 * A red pill that slides to the active item of a pill menu. Put `boxRef` on the menu (it gets
 * `data-slide`), render `pill` inside it, and give each item the `slide-item` class. The active item is
 * the first visible one with aria-current="page", aria-pressed="true", data-state="active" or
 * data-active="true". Until the pill is in
 * place (and without JavaScript), the active item keeps its own red fill.
 */
export function useSlidingPill<T extends HTMLElement>(className?: string) {
  const boxRef = React.useRef<T>(null);
  const pillRef = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    const box = boxRef.current;
    const pill = pillRef.current;
    if (!box || !pill) return;
    let placed = false;
    const place = () => {
      const el = Array.from(box.querySelectorAll<HTMLElement>(ACTIVE)).find((e) => e.offsetWidth > 0);
      if (!el) {
        pill.style.opacity = "0";
        delete box.dataset.slideReady;
        return;
      }
      // The first placement jumps straight there; later ones slide.
      if (!placed) pill.style.transition = "none";
      // Offsets add up to the menu itself, even when the item sits in a wrapper of its own (like "More").
      let x = 0;
      let y = 0;
      for (let n: HTMLElement | null = el; n && n !== box; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      pill.style.width = `${el.offsetWidth}px`;
      pill.style.height = `${el.offsetHeight}px`;
      pill.style.transform = `translate(${x}px, ${y}px)`;
      pill.style.opacity = "1";
      box.dataset.slideReady = "";
      if (!placed) {
        placed = true;
        void pill.offsetWidth;
        pill.style.transition = "";
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(box);
    for (const child of Array.from(box.children)) ro.observe(child);
    const mo = new MutationObserver(place);
    mo.observe(box, { subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-pressed", "data-state", "data-active"] });
    let live = true;
    document.fonts?.ready.then(() => live && place());
    return () => {
      live = false;
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const pill = <span ref={pillRef} aria-hidden="true" className={cn("slide-pill bg-brand glow", className)} />;
  return { boxRef, pill };
}
