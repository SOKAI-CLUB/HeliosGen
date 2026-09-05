"use client";

import { Coins } from "lucide-react";
import { CREDIT_PRICING_DATE, CREDIT_PRICING_URL, formatCreditEstimate, type CreditEstimate as Estimate } from "@/lib/creditEstimate";

export default function CreditEstimate({ estimate }: { estimate: Estimate }) {
  const label = formatCreditEstimate(estimate);
  const description = `${label}. ${estimate.detail} Kie.ai estimate, prices checked ${CREDIT_PRICING_DATE}. Final usage may vary. View pricing.`;

  return (
    <a
      href={CREDIT_PRICING_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={description}
      aria-label={description}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="nodrag nopan inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 py-1 text-[11px] font-medium text-teal-200/80 transition-colors hover:text-teal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
      style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
    >
      <Coins size={12} aria-hidden="true" />
      <span aria-live="polite" aria-atomic="true">{label}</span>
    </a>
  );
}
