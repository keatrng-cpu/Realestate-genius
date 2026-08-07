import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Editorial long-form container (V8).
 *
 * No @tailwindcss/typography — that plugin's defaults fight the house style
 * (its own greys, its own scale). This is a small, opinionated set of
 * descendant rules built on the project's own semantic tokens and type scale.
 *
 * Measure is capped at ~68ch: past that, the eye loses the line return.
 */
export function Prose({
  children,
  className,
  size = "base",
}: {
  children: ReactNode;
  className?: string;
  size?: "base" | "lg";
}) {
  return (
    <div
      className={cn(
        "max-w-[68ch] text-fg-muted",
        size === "lg" ? "text-body-lg" : "text-body",

        // Headings — serif, tight, generous space above and little below so a
        // heading visually belongs to what follows it.
        "[&_h2]:mt-14 [&_h2]:mb-4 [&_h2]:font-display [&_h2]:text-display-sm [&_h2]:text-fg",
        "[&_h3]:mt-10 [&_h3]:mb-3 [&_h3]:font-display [&_h3]:text-display-xs [&_h3]:text-fg",
        "[&_h4]:mt-8 [&_h4]:mb-2 [&_h4]:text-title-md [&_h4]:font-medium [&_h4]:text-fg",
        "[&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0",

        // Body rhythm
        "[&_p]:mt-5 [&_p:first-child]:mt-0 [&_p]:text-pretty",

        // Lead paragraph — first para after a section opener gets more air.
        "[&>p:first-of-type]:text-body-lg [&>p:first-of-type]:text-fg",

        // Lists
        "[&_ul]:mt-5 [&_ul]:space-y-2 [&_ul]:pl-5",
        "[&_ol]:mt-5 [&_ol]:space-y-2 [&_ol]:pl-5 [&_ol]:list-decimal",
        "[&_li]:relative [&_li]:pl-1",
        "[&_ul>li]:list-none [&_ul>li]:before:absolute [&_ul>li]:before:-left-4",
        "[&_ul>li]:before:top-[0.7em] [&_ul>li]:before:h-1 [&_ul>li]:before:w-1",
        "[&_ul>li]:before:rounded-full [&_ul>li]:before:bg-accent",

        // Links — underline offset so descenders survive.
        "[&_a]:text-fg [&_a]:underline [&_a]:decoration-accent/50 [&_a]:underline-offset-[3px]",
        "[&_a:hover]:decoration-accent",

        // Emphasis
        "[&_strong]:font-medium [&_strong]:text-fg",
        "[&_em]:italic",

        // Code / figures
        "[&_code]:rounded [&_code]:border [&_code]:border-line [&_code]:bg-surface-3",
        "[&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-fg",

        // Pull quote
        "[&_blockquote]:my-8 [&_blockquote]:border-l-2 [&_blockquote]:border-accent",
        "[&_blockquote]:pl-5 [&_blockquote]:font-display [&_blockquote]:text-display-xs",
        "[&_blockquote]:leading-snug [&_blockquote]:text-fg",

        "[&_hr]:my-12 [&_hr]:border-line",

        // Figures & captions
        "[&_figure]:my-8",
        "[&_figcaption]:mt-3 [&_figcaption]:font-mono [&_figcaption]:text-micro",
        "[&_figcaption]:uppercase [&_figcaption]:text-fg-subtle",

        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Section opener: mono eyebrow + serif headline, with an optional muted
 * continuation clause. This pairing is the site's signature — codifying it
 * stops each new section from re-inventing the spacing.
 */
export function SectionHeading({
  eyebrow,
  eyebrowTone = "accent",
  children,
  trailing,
  className,
  id,
}: {
  eyebrow?: string;
  /** `measure` (teal) is permitted only when the section is about data. */
  eyebrowTone?: "accent" | "measure" | "muted";
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
  id?: string;
}) {
  const tone =
    eyebrowTone === "measure"
      ? "text-measure"
      : eyebrowTone === "muted"
        ? "text-fg-subtle"
        : "text-accent";

  return (
    <div className={className}>
      {eyebrow ? (
        <p className={cn("font-mono text-label uppercase", tone)}>{eyebrow}</p>
      ) : null}
      <h2
        id={id}
        className="mt-6 max-w-3xl text-balance font-display text-display-md"
      >
        {children}
        {trailing ? <span className="text-fg-subtle"> {trailing}</span> : null}
      </h2>
    </div>
  );
}

/** Mono eyebrow on its own, for cards and rails. */
export function Eyebrow({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "accent" | "measure" | "muted";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-micro uppercase",
        tone === "accent"
          ? "text-accent"
          : tone === "measure"
            ? "text-measure"
            : "text-fg-subtle",
        className,
      )}
    >
      {children}
    </p>
  );
}
