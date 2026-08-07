# Agent boundaries — landing page

Two agents work on the marketing page concurrently. This file records the split
so we do not edit the same lines.

- **Logic agent** — structure, state, data, correctness, accessibility geometry.
- **Presentation agent (Grok)** — visual design and animation.

Written 2026-08-07 by the logic agent, after the React #418 / dead-state pass.

---

## 1. File ownership

### Logic-owned (do not restructure; restyle only via the seams in §3)

| File | What lives here |
| --- | --- |
| `src/app/page.tsx` | Section order and composition |
| `src/components/Hero.tsx` | Headline copy, coverage-strip figures, CTA routing |
| `src/components/interactive/AddressProbe.tsx` | Address input, submit state, the honesty contract |
| `src/components/interactive/CostExplorer.tsx` | Slider state, `computeTco()` wiring |
| `src/components/interactive/ParcelGlyph.tsx` | Seeded geometry for the no-photo state |
| `src/components/interactive/useCountUp.ts` | Count-up that never renders a resting `0` |
| `src/components/interactive/CountUpNumber.tsx` | Count-up wrapper |
| `src/components/marketing/EdgeSection.tsx` | Surface order, comparison-table data, sticky rail |
| `src/components/marketing/CostSection.tsx` | Section chrome for the calculator |
| `src/components/marketing/DealFlow.tsx` | Demo card data |
| `src/components/marketing/Marketplace.tsx` | Role copy |
| `src/components/marketing/ClosingCTA.tsx` | Final CTA routing |
| `src/components/ScoreCard.tsx` | `scoreSubject()` wiring, pinned `AS_OF` |
| `src/components/viz/ScoreDial.tsx` | Known / unknown branch |
| `src/components/viz/PermitTimeline.tsx` | Bar geometry, clock handling |
| `src/components/ui/PropertyCard.tsx` | Photo / no-photo branch, `min-w-0` |
| `src/components/tour/*.tsx` | Touch-target geometry, input handling, camera state |
| `src/lib/layout.ts` | The one vertical rhythm every section uses |
| `docs/AGENT-BOUNDARIES.md` | This file |

**`src/lib/layout.ts` is the only place section padding is written.** Every
`<section>` on the landing page renders `className={SECTION_SHELL}`. Retune the
rhythm there; do not put `py-*` back on an individual section.

### Presentation-owned

- `src/app/globals.css` — tokens, utilities, theme blocks.
- `src/lib/motion/variants.ts` and `src/lib/motion/scroll.ts` — the motion
  language. Retune freely; components import from here rather than inlining.
- Anything reachable through the `data-anim` hooks in §3.

### Owned by neither (a third agent)

`src/components/marketing/SiteHeader.tsx`, `src/components/marketing/Footer.tsx`,
`src/app/(marketing)/pricing`, `src/lib/pricing.ts`, `src/components/pricing/`.

---

## 2. Invariants — do not break these while restyling

1. **No purple or violet gradient, anywhere.** The design doc rejects it by name
   as reading like a generic AI product.
2. **`ember` / `--accent` (amber) is the only accent colour.** `signal` /
   `--measure` (teal) is reserved for data and measurement, never decoration.
   `--caution` is for flags that should change a decision. `--unknown` is
   deliberately colourless — an absent value must never borrow the visual
   weight of a real one.
3. **Every interactive target is ≥44×44px.** This page shipped with thirteen
   under that, including 6px tour dots. Where a control must look small, keep
   the visual small and enlarge the *button* around it — see the chapter dots in
   `tour/HouseTour.tsx`.
4. **No horizontal overflow at 375px.** Verify with
   `document.documentElement.scrollWidth <= clientWidth`. The cause last time
   was a grid item at its default `min-width: auto`; several `min-w-0`s in
   `PropertyCard.tsx` and `DealFlow.tsx` are load-bearing, not cosmetic.
5. **`prefers-reduced-motion` stays honoured.** Every animated component calls
   `useReducedMotion()` and skips its `initial` state. A variant cannot opt
   itself out, so the call site must. The reduced-motion path must remain fully
   usable, not merely static.
6. **Real values must be in the server-rendered HTML; JS only animates toward
   them.** Never `useState(0)` for a figure. This is the exact bug just fixed:
   the dial shipped `0/100` next to the caption `IMMEDIATE ALERT`, which reads
   as broken software. Use `useCountUp` from
   `src/components/interactive/useCountUp.ts`, which resolves to the true value
   until the ramp starts. Check any change with
   `curl -s <url> | grep '0/100'` — that must return nothing.
7. **Never render an unknown as a zero.** `null` is a first-class value across
   `src/components/viz/*`; it produces a dashed track and an em-dash. Do not
   substitute a placeholder digit.
8. **Nothing in `AddressProbe` may state a fact about the address the visitor
   typed.** We have no data for an arbitrary address. The panel shows the work
   that *would* run, every row labelled "Queued". Do not add a sample price,
   score, flood zone, or square footage to it.
9. **Do not derive layout geometry from a live clock.** `/` is statically
   prerendered, so the build's clock and the visitor's clock are different
   numbers and any position computed from them mismatches on hydration. See
   `ILLUSTRATIVE_AS_OF` in `EdgeSection.tsx` and the `rangeEnd` doc comment on
   `PermitTimeline`.

---

## 3. `data-anim` hooks

Stable attributes for targeting from CSS or a variants file without editing
component internals.

| Hook | Element | Intent |
| --- | --- | --- |
| `data-anim="hero-headline"` | `<h1>` in `Hero.tsx` | Two masked lines; currently a per-line rise. Keep the `overflow-hidden` masks, and keep `text-balance` on each inner span — without it both sentences strand their last word on a line of their own. |
| `data-anim="hero-panel"` | Right column of the hero, `lg` and up | The scoring-profile surface that fills what used to be empty black. Factor rows are read from `INVESTOR_GF_V1`; the dial is deliberately in its unknown state. |
| `data-anim="hero-probe"` | Address-field wrapper | Entrance for the search affordance. |
| `data-anim="hero-coverage"` | `<dl>` coverage strip | Three product figures + source lines. |
| `data-anim="countup"` | `CountUpNumber` root | Figure animating to a value already present in the markup. |
| `data-anim="surface"` | Each of the five `EdgeSection` proof blocks | Entrance for one step of the pinned progression; drives the `surfaceRise` variant. |
| `data-anim="rail-item"` | `<li>` in the sticky index rail | Carries `data-key` and `data-active`; style the active row off `data-[active=true]`. |
| `data-anim="compare-row"` | Row of the portals-vs-us table | Drives the `compareRow` variant. |
| `data-anim="parcel-glyph"` | `ParcelGlyph` root | The no-photo plan drawing. See the `VISUAL:` note in that file. |
| `data-anim="score-dial"` | `ScoreDial` root | Also carries `data-known` (`true`/`false`) so the two states can be styled apart. |
| `data-anim="score-empty"` | Em-dash block inside `ScoreDial` | The honest "not measured" state. Must never read as a low score. |
| `data-anim="property-card"` | `PropertyCard` root | Pointer-tilt card. |
| `data-anim="cost-figure"` | The two large numbers in `CostExplorer` | Re-keyed on every recompute, so they can flash on change. |

Shared variants already extracted to `src/lib/motion/variants.ts`:
`surfaceRise`, `compareRow`, plus the pre-existing `fadeUp`, `staggerList`,
`staggerItem`, `lineMask`, `viewportOnce`.

`// VISUAL:` comments in `ParcelGlyph.tsx` and `ScoreDial.tsx` state what those
placeholders must continue to communicate. Restyle them; do not change what
they mean.

---

## 4. Known gaps

- The sticky rail's active highlight is driven by an `IntersectionObserver` in
  `EdgeSection.tsx`. It could not be verified in the agent browser, which does
  not composite frames and therefore never delivers IO callbacks. The code is
  standard and degrades safely (the first row stays marked active and every row
  remains a working anchor link), but it needs one look in a real browser.
- ~~Two footer text links measure 44×41px.~~ Fixed: `min-w-11` on the footer
  link. A full sweep at 375px and 1440px now finds no interactive target under
  44px on `/`.
- `/sign-in` still has three: the wordmark (130×36) and the two inline text
  links "Forgot your password?" (136×17) and "Create one" (65×17). Not on the
  landing page, and in files neither agent owns.
- The tour's camera motion could not be watched in the agent browser:
  `requestAnimationFrame` never fires there (measured: 0 frames/second), so
  `useFrame` never runs. The keyboard guards were verified through
  `defaultPrevented` and observable DOM state instead, and the opening yaw was
  verified numerically against the real `CylinderGeometry`.
- `AnalysisDepth.tsx` and `Portal.tsx` still use raw `ink-*` / `bone-*` /
  `ember-*` palette classes instead of the semantic tokens, so they do not
  respond to the light theme. Out of scope for this pass; worth a sweep.
