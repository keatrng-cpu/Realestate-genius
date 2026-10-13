<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- auto-memory:begin v1 -->
## Memory protocol (auto, every task — do not wait to be asked)
**Start:** `python3 ai/memory/mem.py start "<task>"` (Claude Code runs it via hook) → read the `ai/NOW.md` summary it prints; for more, `mem.py slice "<topic>"` (graph query, ~450 tokens). Never load all of `GRAPH_REPORT.md`. Pick the model: `mem.py route "<task>"`.
**End:** overwrite `ai/NOW.md` with current truth (≤150 lines, no history); append one dated entry to `ai/DECISIONS.md` (`## YYYY-MM-DD — title` + why; never edit old entries). Never write `ai/HANDOFF.md` (Dual Desk owns it). Graph refresh is automatic (post-commit hook: `python3 ai/memory/mem.py install-hook` once per clone).
<!-- auto-memory:end -->
