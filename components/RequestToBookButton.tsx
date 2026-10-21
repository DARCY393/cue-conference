"use client";

import type { MouseEvent } from "react";
import { buttonClasses } from "@/components/ui/Button";

/** Id of the reservation form section on each room page (its scroll-margin-top clears the sticky header). */
export const RESERVE_ANCHOR = "reserve";
/** Marks the first form field to focus once the guest lands on the form. */
export const RESERVE_FIRST_FIELD_ATTR = "data-reserve-first-field";

/**
 * Smooth-scroll to #reserve (respecting its scroll-margin-top) and focus the first field.
 * Honors prefers-reduced-motion. Returns false if the section isn't on the page.
 */
export function scrollToReserve(opts: { smooth?: boolean } = {}): boolean {
  const target = document.getElementById(RESERVE_ANCHOR);
  if (!target) return false;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: opts.smooth === false || reduce ? "auto" : "smooth", block: "start" });
  const field = target.querySelector<HTMLElement>(`[${RESERVE_FIRST_FIELD_ATTR}]`);
  // preventScroll keeps the focus from cutting the smooth scroll short.
  field?.focus({ preventScroll: true });
  if (window.location.hash !== `#${RESERVE_ANCHOR}`) {
    window.history.replaceState(null, "", `#${RESERVE_ANCHOR}`);
  }
  return true;
}

/**
 * "Request to book" — a copper primary button. A real link to #reserve so it still jumps to the
 * form without JS; with JS it scrolls smoothly and focuses the first field. Pass `href` to point
 * at another page's form (e.g. home cards → /spaces/m1#reserve); then it's a plain link.
 */
export function RequestToBookButton({
  href = `#${RESERVE_ANCHOR}`,
  className = "",
  label = "Request to book",
  ariaLabel,
  testId = "request-to-book",
}: {
  href?: string;
  className?: string;
  label?: string;
  ariaLabel?: string;
  testId?: string;
}) {
  const samePage = href.startsWith("#");
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!samePage || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (scrollToReserve()) e.preventDefault();
  }
  return (
    <a
      href={href}
      onClick={onClick}
      role="button"
      aria-label={ariaLabel}
      data-testid={testId}
      className={buttonClasses("accent", `inline-flex shrink-0 justify-center ${className}`)}
    >
      {label}
    </a>
  );
}
