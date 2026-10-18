import { Check } from "lucide-react";

/** Parse hostRulesMd bullets into Cue-branded House rules + optional Billing notes. */

const BILLING_HINTS = [/overtime/i, /damage/i, /billed/i, /card on file/i];

function parseBullets(md: string): string[] {
  return md
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
}

function splitRules(bullets: string[]): { house: string[]; billing: string[] } {
  const house: string[] = [];
  const billing: string[] = [];
  for (const b of bullets) {
    if (BILLING_HINTS.some((re) => re.test(b))) billing.push(b);
    else house.push(b);
  }
  // If everything matched billing, keep as house rules
  if (house.length === 0 && billing.length > 0) {
    return { house: billing, billing: [] };
  }
  return { house, billing };
}

function RuleList({ items, tone }: { items: string[]; tone: "navy" | "amber" }) {
  const iconClasses =
    tone === "navy"
      ? "bg-cue-copper-050 text-cue-copper-700"
      : "bg-cue-amber-100 text-cue-amber-600";
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-sm leading-relaxed text-cue-stone-700">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill ${iconClasses}`}
            aria-hidden
          >
            <Check className="h-3 w-3" strokeWidth={2.5} />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function HouseRules({ markdown }: { markdown: string }) {
  const { house, billing } = splitRules(parseBullets(markdown));
  if (house.length === 0 && billing.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="cue-card p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold tracking-wide text-cue-navy-600">House rules</h3>
        <RuleList items={house} tone="navy" />
      </div>
      {billing.length > 0 && (
        <div className="rounded-card border border-cue-amber-100 bg-cue-amber-100/40 p-4 sm:p-5">
          <h3 className="mb-3 text-sm font-semibold tracking-wide text-cue-navy-600">
            Billing notes
          </h3>
          <RuleList items={billing} tone="amber" />
        </div>
      )}
    </div>
  );
}
