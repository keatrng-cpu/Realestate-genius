"use client";

import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/ui/Prose";
import { StaggerItem, StaggerList } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { SECTION_SHELL } from "@/lib/layout";

/**
 * Provenance ledger.
 *
 * Deliberately conservative about what is claimed. Sources are listed with
 * their actual legal basis, and anything we cannot retain a copy of is named
 * as a link-out rather than as a data source. A property-intelligence product
 * whose own source list is aspirational has nothing to sell.
 */

type Row = {
  source: string;
  gives: string;
  basis: "Public record" | "Licensed feed" | "Owner-supplied" | "Our own analysis";
  status: "live" | "build" | "planned";
};

const ROWS: Row[] = [
  {
    source: "County assessor & recorder",
    gives: "Parcel ID, assessed value, ownership history, tax history, lot dimensions",
    basis: "Public record",
    status: "live",
  },
  {
    source: "FEMA National Flood Hazard Layer",
    gives: "Flood zone resolved from the authoritative layer, not a third-party guess",
    basis: "Public record",
    status: "live",
  },
  {
    source: "Census TIGER / geocoder",
    gives: "Parcel geometry, coordinates, tract-level context",
    basis: "Public record",
    status: "live",
  },
  {
    source: "Municipal permit portals",
    gives: "Permit filings, status, declared value — and the gaps between them",
    basis: "Public record",
    status: "build",
  },
  {
    source: "Municipal zoning code & GIS",
    gives: "District, use table, height, FAR, setback and subdivision minimums",
    basis: "Public record",
    status: "build",
  },
  {
    source: "MLS / IDX",
    gives: "Active listing record under the local board's IDX agreement",
    basis: "Licensed feed",
    status: "build",
  },
  {
    source: "RentCast",
    gives: "Rent comparables and rent estimates",
    basis: "Licensed feed",
    status: "live",
  },
  {
    source: "Owner and agent direct",
    gives: "FSBO and pocket listings posted to us, plus guided phone capture for 3D",
    basis: "Owner-supplied",
    status: "live",
  },
  {
    source: "Vision pass over listing photos",
    gives: "Roofline staining, panel type, foundation cracking, renovation tier",
    basis: "Our own analysis",
    status: "live",
  },
];

const BASIS_TONE: Record<Row["basis"], string> = {
  "Public record": "border-measure/40 bg-measure-soft text-measure",
  "Licensed feed": "border-accent/40 bg-accent-soft text-accent",
  "Owner-supplied": "border-line-strong bg-surface-3 text-fg-muted",
  "Our own analysis": "border-line-strong bg-surface-3 text-fg-muted",
};

const STATUS_LABEL: Record<Row["status"], string> = {
  live: "Live",
  build: "In build",
  planned: "Planned",
};

export function SourceLedger() {
  return (
    <section
      id="sources"
      className={SECTION_SHELL}
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading eyebrow="Provenance" eyebrowTone="measure">
            Every number carries its source.
            <span className="text-fg-subtle">
              {" "}
              If we cannot name where it came from, we do not print it.
            </span>
          </SectionHeading>
          <p className="mt-7 max-w-2xl text-body-lg text-fg-muted">
            Public records are the spine of this product because they are the
            only layer we can legally retain, re-check, and stand behind. Where
            we use a licensed feed, we say so and we honour its terms — including
            the ones that forbid keeping a copy.
          </p>
        </Reveal>

        <StaggerList className="mt-14 overflow-hidden rounded-2xl border border-line" stagger={0.045}>
          <div className="hidden grid-cols-[1.1fr_1.6fr_auto_auto] gap-4 border-b border-line bg-surface-3 px-5 py-3 font-mono text-micro uppercase text-fg-subtle md:grid">
            <span>Source</span>
            <span>What it gives us</span>
            <span>Basis</span>
            <span className="text-right">Status</span>
          </div>

          {ROWS.map((r) => (
            <StaggerItem key={r.source}>
              <div className="grid gap-2 border-b border-line bg-surface-2/70 px-5 py-4 last:border-b-0 md:grid-cols-[1.1fr_1.6fr_auto_auto] md:items-center md:gap-4">
                <p className="text-body font-medium text-fg">{r.source}</p>
                <p className="text-body-sm text-fg-muted">{r.gives}</p>
                <span
                  className={cn(
                    "w-fit rounded-md border px-2 py-1 font-mono text-micro uppercase",
                    BASIS_TONE[r.basis],
                  )}
                >
                  {r.basis}
                </span>
                <span
                  className={cn(
                    "w-fit font-mono text-micro uppercase md:justify-self-end",
                    r.status === "live" ? "text-measure" : "text-fg-subtle",
                  )}
                >
                  {r.status === "live" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-1 w-1 rounded-full bg-measure" />
                      {STATUS_LABEL[r.status]}
                    </span>
                  ) : (
                    STATUS_LABEL[r.status]
                  )}
                </span>
              </div>
            </StaggerItem>
          ))}
        </StaggerList>

        <Reveal delay={0.1}>
          <p className="mt-6 max-w-2xl text-body-sm text-fg-muted">
            Consumer portals are not in this list. Their terms of service
            prohibit retaining copies of their listing data, and building on a
            source we would have to delete on request is not a foundation — it
            is a liability with a countdown on it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
