import { ChevronDown } from "lucide-react";
import { PRICING_FAQ } from "@/lib/pricing";

/**
 * Native `<details>` rather than a hand-rolled accordion: it is keyboard
 * accessible, announces its own expanded state, and — importantly for a
 * pricing page — the answers are in the DOM for search engines and for
 * Ctrl+F even while collapsed.
 */
export function PricingFaq() {
  return (
    <ul className="mt-10 divide-y divide-[var(--line)] border-y border-line">
      {PRICING_FAQ.map((item) => (
        <li key={item.q}>
          <details className="group">
            <summary
              className={[
                "flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-6 py-5",
                "text-left text-title-md text-fg [&::-webkit-details-marker]:hidden",
                "transition-colors hover:text-accent",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              ].join(" ")}
            >
              <span className="text-pretty">{item.q}</span>
              <ChevronDown
                aria-hidden
                className="h-5 w-5 shrink-0 text-fg-subtle transition-transform duration-300 ease-[var(--ease-out-expo)] group-open:-rotate-180"
              />
            </summary>
            <p className="max-w-3xl pb-6 text-body text-fg-muted text-pretty">
              {item.a}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}
