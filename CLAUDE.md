@AGENTS.md

## Read order (Claude and Grok)
1. `ai/NOW.md` if present, else this file.
2. `graphify-out/GRAPH_REPORT.md` if present (`graphify update .` builds it locally; see `.graphifyignore`).
3. Then search files.

## Working rules
- Git is the bus: commit and push your branch before handing off; uncommitted work is invisible to the other model.
- One task in flight per repo.
- Work on a branch; merge path is Accuracy Review -> Release Watch -> Design Atelier.
- Never invent prices, figures or phone numbers.
- Never commit `.env*` files or keys.

## Map (from the Forge Atlas Graphify build, 2026-10-13)
- Hubs: `cn()` (`src/lib/utils.ts`), `scripts/discover/discover-arcgis.mjs`, `src/lib/domain/deals.ts`.
- Busiest pages: `src/app/(app)/property/[addressId]/page.tsx`, `src/app/api/ai/chat/route.ts`.
- Checks: `npm run lint` (no test script yet).

<!-- auto-memory:begin v1 -->
## Memory protocol (auto, every task — do not wait to be asked)
**Start:** read `ai/.context.md` (NOW summary + graph slice, refreshed by git hooks; Claude Code gets it via hook; if missing: `python3 ai/memory/mem.py context`). For more: `mem.py slice "<topic>"` (graph query, ~450 tokens). Never load all of `GRAPH_REPORT.md`. Pick the model: `mem.py route "<task>"`.
**End:** overwrite `ai/NOW.md` with current truth (≤150 lines, no history); append one dated entry to `ai/DECISIONS.md` (`## YYYY-MM-DD — title` + why; never edit old entries). Never write `ai/HANDOFF.md` (Dual Desk owns it). Graph + context refresh are automatic (git hooks: `python3 ai/memory/mem.py install-hook` once per clone).
<!-- auto-memory:end -->
