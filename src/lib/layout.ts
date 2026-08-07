/**
 * One vertical rhythm for the marketing page.
 *
 * Every landing section used to carry its own hand-written padding —
 * `py-24 md:py-36`, `py-28 md:py-40`, `py-28 md:py-44`, and two of them
 * `px-6` while the rest were `px-5`. The result at desktop was up to 352px of
 * stacked padding between two blocks of content, which reads on screen as a
 * dead zone rather than as breathing room.
 *
 * The scale below is deliberately small: one shell for content sections, one
 * for the terminal CTA, one for the footer. Change the rhythm here and the
 * whole page moves together. Do not reintroduce per-section padding.
 *
 * Numbers, for the record:
 *   SECTION_SHELL   64px  /  96px at md  -> 192px between adjacent sections
 *   FOOTER_SHELL    56px  /  64px at md
 */

/** Horizontal gutters. Identical on every full-bleed section. */
export const SECTION_X = "px-5 md:px-12";

/** Vertical rhythm for a standard content section. */
export const SECTION_Y = "py-16 md:py-24";

/** The full shell: rule, gutters, rhythm. Use this for every `<section>`. */
export const SECTION_SHELL =
  "relative border-t border-line px-5 py-16 md:px-12 md:py-24";

/** Footer sits tighter than a content section — it is not a chapter. */
export const FOOTER_SHELL = "border-t border-line px-5 py-14 md:px-12 md:py-16";

/**
 * Gap between a section heading block and the body that follows it.
 * Was a mix of mt-12 / mt-14 / mt-16 across the page.
 */
export const HEAD_GAP = "mt-10 md:mt-12";
