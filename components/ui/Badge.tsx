import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "navy" | "copper" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-cue-stone-100 text-cue-stone-700",
  navy: "bg-cue-navy-050 text-cue-navy-600",
  copper: "bg-cue-copper-050 text-cue-copper-700",
  success: "bg-cue-green-100 text-cue-green-600",
  warning: "bg-cue-amber-100 text-cue-amber-600",
  danger: "bg-cue-red-100 text-cue-red-600",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-xs font-semibold uppercase leading-tight tracking-[0.04em] ${TONE_CLASSES[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
