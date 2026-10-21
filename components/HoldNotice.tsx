import { ShieldCheck } from "lucide-react";
import { FREE_CANCELLATION_TEXT, HOLD_HEADING, holdBodyText } from "@/lib/hold-copy";

/** "Your card won't be charged yet" — shown right above the card form on the room page. */
export function HoldNotice({ totalCents, className = "" }: { totalCents: number | null | undefined; className?: string }) {
  return (
    <div
      data-testid="hold-notice"
      className={`rounded-tile border border-cue-copper-300 bg-cue-copper-050 p-4 ${className}`.trim()}
    >
      <h3 className="flex items-center gap-2 text-base text-cue-navy-600">
        <ShieldCheck aria-hidden className="h-[18px] w-[18px] shrink-0 text-cue-copper-600" />
        {HOLD_HEADING}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-cue-stone-700">{holdBodyText(totalCents)}</p>
      <p className="mt-2 text-sm font-medium text-cue-navy-600">{FREE_CANCELLATION_TEXT}</p>
    </div>
  );
}
