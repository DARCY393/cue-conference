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

function RuleList({ items, icon }: { items: string[]; icon: "check" | "dot" }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-sm font-light leading-relaxed text-cue-ink">
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cue-navy/8 text-cue-navy"
            aria-hidden
          >
            {icon === "check" ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6.2L4.8 8.5L9.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-cue-navy" />
            )}
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
      <div className="rounded-xl border border-cue-navy/10 bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold tracking-wide text-cue-navy">
          House rules
        </h2>
        <RuleList items={house} icon="check" />
      </div>
      {billing.length > 0 && (
        <div className="rounded-xl border border-cue-gold/40 bg-cue-gold/10 p-4 sm:p-5">
          <h3 className="mb-3 text-sm font-bold tracking-wide text-cue-navy">
            Billing notes
          </h3>
          <RuleList items={billing} icon="dot" />
        </div>
      )}
    </div>
  );
}
