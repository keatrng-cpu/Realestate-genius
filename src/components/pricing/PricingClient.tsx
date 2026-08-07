"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { SegmentTabs } from "./SegmentTabs";
import { BillingToggle } from "./BillingToggle";
import { TierCard } from "./TierCard";
import { ComparisonTable } from "./ComparisonTable";
import {
  SEGMENTS,
  segmentHasBillingPeriods,
  tiersForSegment,
  type BillingPeriod,
  type SegmentId,
} from "@/lib/pricing";

/**
 * The interactive half of /pricing.
 *
 * All three panels are rendered into the markup and the inactive ones are
 * hidden, rather than mounted on click. Two reasons, both deliberate:
 *
 *  - Every price on this page exists in the server-rendered HTML. A figure
 *    that only appears after a click is invisible to crawlers, to assistants,
 *    and to Ctrl+F.
 *  - Switching segments is then a paint, not a mount, so there is no layout
 *    lurch and nothing to animate around.
 *
 * Segment choice is component state rather than a URL parameter: a shared
 * /pricing link should open on the default. The *plan* choice is the thing
 * worth carrying, and it travels as `?plan=` on the sign-up link instead.
 */
export function PricingClient() {
  const [segment, setSegment] = useState<SegmentId>("own");
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  const uid = useId();
  const tabId = `${uid}-tab`;
  const panelId = `${uid}-panel`;

  return (
    <>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <SegmentTabs
          value={segment}
          onChange={setSegment}
          tabId={tabId}
          panelId={panelId}
        />
        {segmentHasBillingPeriods(segment) ? (
          <BillingToggle value={period} onChange={setPeriod} />
        ) : (
          <p className="text-body-sm text-fg-subtle">
            Nothing on this side is a subscription.
          </p>
        )}
      </div>

      {SEGMENTS.map((s) => {
        const tiers = tiersForSegment(s.id);
        const active = s.id === segment;

        return (
          <div
            key={s.id}
            id={`${panelId}-${s.id}`}
            role="tabpanel"
            aria-labelledby={`${tabId}-${s.id}`}
            hidden={!active}
            tabIndex={active ? 0 : -1}
            className="mt-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <p className="max-w-2xl text-body-sm text-fg-subtle">
              {s.description}
            </p>

            <div
              className={cn(
                "mt-8 grid gap-5",
                tiers.length === 2
                  ? "md:grid-cols-2 lg:max-w-4xl"
                  : "md:grid-cols-2 lg:grid-cols-3",
              )}
            >
              {tiers.map((tier) => (
                <TierCard key={tier.slug} tier={tier} period={period} />
              ))}
            </div>

            <div className="mt-16">
              <h2 className="font-display text-display-xs text-fg">
                What is in each plan
              </h2>
              <p className="mt-2 max-w-2xl text-body-sm text-fg-muted">
                A dash means not included. Where a row says so, it means not
                built — including the things competitors ship today and we do
                not.
              </p>
              <div className="mt-6">
                <ComparisonTable segment={s.id} />
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
