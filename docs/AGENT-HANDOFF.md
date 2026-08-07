# Agent handoff — Realestate Genius

**Branch of truth: `main`**  
**HEAD at handoff:** `477af2e` (Visuals: align Hero + ambient with Claude motion/theme system)

No open PRs. Grok visual work is already merged to `main` (direct commits).  
Claude’s `feat/platform-foundation` is merged. Stale branch `claude/full-picture-code-netlify-nfegxe` is **superseded** by later tour work on `main` — do not merge it forward without a diff review.

---

## Ownership (avoid collisions)

| Owner | Owns | Does not touch |
|-------|------|----------------|
| **Claude** | Auth, AI brain, deals, scoring, schema/migrations, `(app)` product routes, APIs under `src/app/api` (except listing tour demo routes), `src/lib/motion/*` system, marketing *content* | Tour media stack, pure ambient scroll, Hero motion tokens |
| **Grok** | Landing scroll ambient, Hero motion, tour media UX, depth/splat presentation, listing_photos → tour wiring | Auth, scoring engine, deal rooms, AI routes, migrations |

Both may edit `src/app/page.tsx` **only** to compose sections — keep Claude’s narrative order unless product asks otherwise.

---

## What Grok shipped on `main` (read these first)

### Motion / ambient
- `src/components/ScrollBackground.tsx` — theme-aware ambient orbs (`bg-surface`, `accent`, `measure`). **No progress rail** (SiteHeader owns that via `usePageProgress`).
- `src/components/Hero.tsx` — scroll-exit parallax; semantic tokens; uses `DUR` + `EASE_OUT_EXPO` from Claude’s `src/lib/motion/variants.ts`.
- `src/components/Reveal.tsx` — scroll reveals + optional `ParallaxBlock`.

### Listing media / tour (Zillow-better path)
- `src/lib/tour.ts` — `TourRoom` (+ optional `depthSrc`).
- `src/lib/listings/types.ts` — `ListingPhoto`, `ListingCapture`, `TourTier`.
- `src/lib/listings/demo-data.ts` — demo listings until Supabase is live.
- `src/lib/listings/tour-mapper.ts` — `listing_photos` → tour payload + tier resolution.
- `src/app/api/listings/[id]/route.ts`
- `src/app/api/listings/[id]/tour/route.ts`
- `src/app/api/listings/[id]/capture/route.ts` — guided capture request (demo).
- `src/components/tour/HouseTour.tsx` — walkthrough + gallery; rooms from API.
- `src/components/tour/DepthStill.tsx` — multi-layer 3D-photo parallax.
- `src/components/tour/PremiumSplat.tsx` — premium guided-capture → splat lane only.
- `src/components/tour/TourExperience.tsx` — orchestrates photo / depth / splat tiers.
- `src/components/tour/TourSection.tsx` — marketing section wiring.

### Tour tiers (product truth)
1. **photos** — any `listing_photos` set → walkthrough + gallery  
2. **depth** — parallax from `depth_map_url` or luminance proxy  
3. **splat** — only when guided capture is ready / `splat_url` exists  

Never claim photogrammetry from sparse MLS JPEGs.

---

## What Claude owns that Grok consumes (do not rewrite)

- `src/lib/motion/scroll.ts` — `usePageProgress`, `useSectionProgress`, parallax helpers  
- `src/lib/motion/variants.ts` — shared easing / durations  
- `src/components/marketing/SiteHeader.tsx` — condensed header + reading progress rail  
- Theme tokens in `src/app/globals.css` (`--surface`, `--accent`, `--measure`, …)  
- Platform under `src/app/(app)/`, `src/app/(auth)/`, AI + deals APIs  

---

## Suggested next steps (either agent)

1. Point `getListing()` at Supabase once `listing_photos` is populated.  
2. Batch depth job writing `depth_map_url`.  
3. Host splat assets and set `listing_captures.splat_url` for premium demos.  
4. Keep marketing section *copy* with Claude; motion wrappers with Grok.  

---

## Quick verify

```bash
git checkout main && git pull
git log --oneline -12
# Expect recent: Visuals: align Hero…, Visuals only: theme-aware…, Merge feat/platform-foundation…
```

Live: Netlify deploys from `main`.
