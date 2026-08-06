# Realestate Genius — Reuse Audit

Audit date: 2026-08-06
Target: `C:\Users\Luxef\realestate-genius` (Next.js 16.3.0 / React 19.2.8 / Tailwind 4)

Sources audited:

| Path | What it is | Verdict |
|---|---|---|
| `C:\Users\Luxef\realestate-genius-design\SCHEMA.sql` | 2,656-line / 51-table Postgres schema written **for this exact product** | **Highest-value asset in the account** |
| `C:\Users\Luxef\profx-trading` | Zero-build single-page trading app + 5 Netlify functions | Server functions + math engine are gold |
| `C:\Users\Luxef\helixscales-audit` | Zero-build single-page SMB suite + 10 Netlify functions + 4 SQL migrations | Proxy/relay + LLM-hardening patterns |
| `C:\Users\Luxef\vitaforge-property-alerts` | Node ESM property pipeline | `lib/` deterministic core is directly liftable |
| `C:\Users\Luxef\OneDrive\Desktop\pantheon-site` | Static site + Basic-auth edge gate | Effectively nothing to lift |

Also checked and empty/irrelevant: `C:\Users\Luxef\helixscales` (0 files), `C:\Users\Luxef\Claude\Artifacts\pantheon-news-desk` (rendered artifact HTML only), `C:\Users\Luxef\OneDrive\Desktop\pantheon\pantheon-site_1.zip` (archive of pantheon-site).

**"Pantheon" is not a larger existing system.** It is a single 84KB static `index.html` behind an HTTP Basic-auth edge function. Whatever it is referenced as elsewhere, there is no codebase here to build on.

---

## Top 10 highest-value lifts, ranked by impact

| # | Asset | Source | Verdict | Why it ranks here |
|---|---|---|---|---|
| 1 | **The entire schema** | `realestate-genius-design\SCHEMA.sql` | **LIFT AS-IS**, split into migrations | 51 tables covering identity, orgs, parcels, provenance, scoring, leases, maintenance, chat, Stripe Connect, double-entry ledger, escrow — plus 51 `enable row level security` statements and ~115 policy lines. Purpose-built for this product. Weeks of work. |
| 2 | **Stripe webhook signature verification** | `profx-trading\netlify\functions\stripe-webhook.js:38-58` | **LIFT AS-IS** | SDK-free HMAC-SHA256 over `t.rawBody`, 300s replay tolerance, `crypto.timingSafeEqual`. Correct on every detail people get wrong. Fails closed on missing config. |
| 3 | **Deterministic scoring engine** | `vitaforge-property-alerts\lib\scoring.js` (259 lines) | **LIFT AS-IS**, parameterize constants | 8 weighted factors → 100 pts. Every factor returns `{points, max, note, caution}`, never a bare number. Missing data → explicit neutral half-credit. This *is* the "no LLM numbers" rule, already implemented. |
| 4 | **Token-verified checkout + portal** | `profx-trading\netlify\functions\checkout.js`, `portal.js` | **ADAPT** to Route Handlers | Verifies the Supabase token against `/auth/v1/user` rather than decoding the JWT locally. Reuses an existing `stripe_customer_id` so resubscribes don't fragment Stripe customers. |
| 5 | **`private.*` RLS helper functions** | `SCHEMA.sql:1572-1710` | **LIFT AS-IS** | `SECURITY DEFINER` + `stable` + `set search_path = ''`, role-ranked property/org/lease/unit resolvers. Solves the RLS-recursion and search-path-hijack traps correctly. Directly powers landlord/tenant/maintenance isolation. |
| 6 | **LLM hardening: guardrail + input hygiene** | `helixscales-audit\netlify\functions\claude.mts:45-140`, `profx-trading\netlify\functions\professor.js:1-31` | **ADAPT** | Prepended guardrail treating conversation as untrusted; per-block revalidation of `text`/`tool_use`/`tool_result`; control-char stripping; caps on system/message/tool sizes; model chosen server-side, never by caller. Plus the explicit "every number you cite comes verbatim from the context" prompt line. |
| 7 | **Statistics core (`EdgeEngine`)** | `profx-trading\app.html:1437-1945` | **ADAPT** (port to TS module) | `mulberry32` seeded PRNG, `bootstrapCI`, `stdev`, `permutationP`, `benjaminiHochberg`, `round`→`null` on non-finite. Seeded determinism means every report is byte-reproducible. |
| 8 | **Monte Carlo + drawdown engine** | `profx-trading\app.html:1982-2090` | **ADAPT** | `monteCarlo`, `equityCurve`, `recoveryRequired`. Rename variables and this is a property-portfolio cash-flow / vacancy-risk simulator. |
| 9 | **Free, keyless enrichment** | `vitaforge-property-alerts\lib\femaFloodCheck.js`, `lib\geocode.js` | **LIFT AS-IS** | FEMA NFHL flood zone + US Census geocoder. No API key, no account. FEMA client correctly does **not** treat a missing feature as a positive flood match. |
| 10 | **DST-safe scheduling** | `vitaforge-property-alerts\lib\timeWindow.js` + `netlify\functions\poll-trigger.mts` | **LIFT AS-IS** | Cron fires in UTC; the business window is enforced by an IANA wall-clock check. **Non-negotiable for rent due dates, grace periods and late fees.** Plus the thin-trigger/fat-worker split for long jobs. |

---

## SECURITY FINDINGS

No secret values are reproduced below — file path and secret type only.

### Verified clean

Scanned all five codebases (working trees, plus vitaforge's full git history) for `sk_live_`/`sk_test_`/`rk_live_`, `whsec_`, `sk-ant-`, `AKIA`, `ghp_`, `xox[baprs]-`, Airtable `pat`/`key`, and bare JWTs. **No committed live secrets found anywhere.** The one `eyJ...` hit is an npm integrity hash in `vitaforge-property-alerts\package-lock.json`, not a token.

### Findings requiring action

**1. HIGH — Unauthenticated, cost-amplifying background endpoints (vitaforge)**
`vitaforge-property-alerts\netlify\functions\poll-worker-background.mts`, `daily-digest-background.mts`, `poll-trigger.mts` have **no auth check, no shared secret, no signature verification**. Netlify background functions are publicly reachable at `/.netlify/functions/<name>`. Anyone who guesses the URL triggers unlimited full pipeline passes, each burning Anthropic vision spend, RentCast/ATTOM quota, and Browserbase bandwidth.
*Do not repeat this.* Every cron/background route in the new app needs `CRON_SECRET` bearer verification before doing any work.

**2. HIGH — `helixscales-audit\.gitignore` contains only `.claude/`**
It does **not** ignore `.env`, `.env.local`, `node_modules/`, or `.netlify/`. No `.env` exists today, so nothing has leaked — but the next person to create one commits it. Compare `profx-trading\.gitignore` and `vitaforge-property-alerts\.gitignore`, which both correctly ignore `.env` and `.env.local`. Fix at the source; do not copy this file.

**3. MEDIUM — Formula/OData injection via string interpolation (vitaforge)**
- `lib\airtableSync.js:62` — `filterByFormula` built as `` `{Zip} = "${zip}"` ``. `zip` originates from scraped third-party data; a value containing `"` rewrites the filter.
- `lib\airtableSync.js:86` — same style (static string today).
- `sources\tier1\mlsIdx.js:26` — OData `$filter` as `` `PostalCode eq '${z}'` ``.
Not SQL, same bug class. Search/filter is core to the new product — use the Supabase query builder, never template literals.

**4. MEDIUM — Untrusted content reaching an LLM that gates business logic (vitaforge)**
`lib\photoAnalysis.js`: scraped `address` interpolated directly into the prompt (line 92); remote image URLs harvested from scraped pages passed straight to the API with no host allowlist or size cap (line 76); `JSON.parse` at line 112 with **no post-parse schema validation**; and the resulting booleans feed hard disqualifiers in `disqualifiers.js:52,60`. So page content can influence whether a property is suppressed.
For the new app: allowlist image hosts, keep untrusted text out of the instruction channel, **Zod-validate every LLM response before it touches business logic.**

**5. MEDIUM — Third-party API keys in `localStorage` (helixscales)**
`helixscales-audit\app.html:3535, 3543-3563` persists user-supplied integration keys and the license key unencrypted under `helix-demo-db`. Any XSS on that origin exfiltrates every connected credential. Mitigated by CSP `frame-ancestors 'none'` and by export paths blanking both fields (`5073-5082`), but **do not carry this storage model forward** — the new app has real accounts and a server.

**6. LOW — Non-secret identifiers committed (vitaforge)**
Airtable base/table IDs in `.env.example:28-29`, `lib\airtableSync.js:14-15`, `docs\ACTIVATION_CHECKLIST.md:12,83,98`, plus a Netlify site UUID. Not credentials, but they narrow an attacker's search.

**7. LOW — Third-party PII committed (vitaforge)**
`docs\julie-vorachek-idx-outreach-draft.md` contains a named real-estate agent, her brokerage, and a real property address tied to a personal transaction. Should not be in a repo that might go public.

**8. LOW — Pantheon Basic-auth gate**
`OneDrive\Desktop\pantheon-site\netlify\edge-functions\gate.js:4` hardcodes a **default username** as a fallback, and compares credentials with `===` (non-constant-time). Correctly refuses to serve when `PANTHEON_PASS` is unset. Low impact, but don't reuse it as an auth pattern.

### Verified safe (no action)

- **Supabase publishable key hardcoded in the client** — `profx-trading\app.html:7428` and `index.html:665`. This is the `sb_publishable_...` key, designed to be public. **I verified via the Supabase API that RLS is enabled on all 17 tables in the live project `pvhfgvfpgbdovgknonqd`**, including `profx_profiles` and `profx_trades` (2,008 rows). The pattern is genuinely safe and reusable. `profx-trading\netlify.toml:16` documents the corresponding `SECRETS_SCAN_OMIT_KEYS` narrowly, keeping scanning on for every real secret.
- **Hardcoded Stripe *price* IDs** — `helixscales-audit\netlify\functions\checkout.js:15-19`. Price IDs are not secrets; pinning them is a deliberate, well-reasoned choice (documented at lines 11-14).
- **`service_role` occurrences in `SCHEMA.sql`** — SQL role references in grant/policy statements, not credentials.
- **RLS coverage in `SCHEMA.sql`** — 51 tables, 51 `enable row level security` statements, deny-by-default with policies added explicitly. No unsafe RLS found.

---

## 1. `realestate-genius-design\SCHEMA.sql` — the main event

2,656 lines, 51 tables, 17 sections. Targets Postgres 17 / Supabase with `pgcrypto`, `postgis`, `pg_trgm`, `btree_gist`.

**Critical ground truth: the Supabase project it names does not exist.** The header targets ref `xgqhqwxlpwncfcvmywtb` ("Realestate Genius", AWS ca-central-1). The account contains only `lamdouidiiuqtplqhsdz` (us-west-2) and `pvhfgvfpgbdovgknonqd` (`american-penny-power`, us-east-2 — the profx/apg project). **This schema has never been applied.** It is a design artifact, not a live database. Treat it as unvalidated SQL: it has not been run, so expect ordering and syntax fixes on first apply.

### The five design rules it encodes (header, lines 14-38)

These should become the new app's ground rules verbatim:

1. **Money is integer cents.** Every monetary column is `bigint` named `*_cents` with a paired currency code. No float, no implicit-rounding numeric.
2. **The AI never computes a number.** `photo_analyses` / `ai_runs` hold only classifications, booleans, enums, prose. `analyses` / `analysis_factors` / `ledger_postings` are written exclusively by deterministic code — enforced by CHECK constraint and trigger, not convention.
3. **Every fact carries provenance.** `property_facts` cannot be inserted without `source_id` and `observed_at`.
4. **Fair-housing attributes are segregated and flagged.** No column anywhere for race, color, religion, sex, familial status, national origin, or disability.
5. **RLS is deny-by-default.**

### Section-by-section

| Section | Lines | Contents | Verdict |
|---|---|---|---|
| 0 Extensions/schemas | 43 | `private` (SECURITY DEFINER helpers) and `app` (job state, webhook dedup) schemas, both revoked from `anon`/`authenticated` so PostgREST never exposes them | **LIFT AS-IS** |
| 1 Identity/orgs | 145 | `profiles`, `organizations`, `organization_members` | **LIFT AS-IS** |
| 2 Address/parcel spine | 226 | `addresses`, `parcels`, `address_parcels` — the canonical join spine | **LIFT AS-IS**; fixes vitaforge's address-only dedupe collision |
| 3 Source registry | 305 | `data_sources`, `app.ingest_runs` | **LIFT AS-IS** |
| 4 Property facts | 359 | `fact_types`, `property_facts` — typed, provenanced fact store | **LIFT AS-IS**; this is the multi-source analysis backbone |
| 5 Zoning/permits/hazards | 435 | `zoning_districts`, `permits`, `hazards`, `opportunity_signals` | **LIFT AS-IS** |
| 6 Listings + dedup | 570 | `listings`, `listing_observations`, `listing_price_history`, `listing_photos`, `assessments` | **LIFT AS-IS** |
| 7 Scoring/analysis | 686 | `scoring_factors`, `scoring_profiles`, `analyses`, `analysis_factors`, `photo_analyses` | **LIFT AS-IS** — see below |
| 8 Managed portfolio | 854 | `properties`, `property_members`, `units`, `leases`, `lease_tenants` | **LIFT AS-IS** |
| 9 Fair-housing | 986 | `schools`, `school_assignments`, `consent_records`, `audit_log` | **LIFT AS-IS** |
| 10 Maintenance | 1075 | `maintenance_requests`, `maintenance_events`, `maintenance_attachments` | **LIFT AS-IS** |
| 11 Messaging + AI | 1144 | `conversations`, `conversation_participants`, `messages`, `message_attachments`, `ai_runs` | **LIFT AS-IS** — covers the portal chat requirement |
| 12 Payments/ledger/escrow | 1266 | `stripe_connected_accounts`, `payment_methods`, `rent_invoices`, `invoice_line_items`, `payments`, `payouts`, `ledger_accounts`, `ledger_transactions`, `ledger_postings`, `security_deposits`, `app.stripe_webhook_events` | **LIFT AS-IS** — see below |
| 13 RLS helpers | 1572 | `private.property_ids_for_role`, `org_ids_for_role`, `tenant_lease_ids`, `tenant_unit_ids` | **LIFT AS-IS** |
| 14 RLS policies | 1710 | ~115 policy lines across all 51 tables | **LIFT AS-IS**, re-review per table on apply |
| 15 Grants | 2533 | | **LIFT AS-IS** |
| 16 Seed | 2555 | The 8 vitaforge scoring factors, ported as data | **LIFT AS-IS** |
| 17 Post-deploy assertions | 2621 | Self-checks | **LIFT AS-IS** |

### Section 7 — the generalization that matters

The design decision worth preserving above all others (`SCHEMA.sql:686-730`):

> **Weights and curves become data (`scoring_profiles.config` jsonb); the math stays deterministic code.**

`scoring_factors.impl_id` names a versioned function in the repo (`'scoring/priceVsAssessed'`, `impl_version`). `scoring_profiles.config` holds **parameters only** — `{"factors":[{"key":"price_vs_assessed","weight":20,"params":{"full_points_at":0.85,"zero_points_at":1.15}}],"thresholds":{"immediate":65,"digest":50}}`. The column comment is explicit that putting an expression string there and eval'ing it is forbidden because it makes the score unauditable.

This cleanly solves vitaforge's "8 hardcoded Grand Forks factors" limitation, giving `investor.gf.v1`, `consumer.fthb.v1`, `consumer.rent.v1` from one code path.

Two further guardrails in this section:
- `scoring_factors.consumer_safe` + required `safety_rationale` — a trigger blocks any `audience='consumer'` analysis from containing a non-consumer-safe factor. **This is a structural fair-housing guardrail**, not a code review checklist.
- `analyses.narrative` is AI-authored and numbers-free (trigger-enforced); `analysis_factors.note` is deterministic and code-generated. `analysis_factors.inputs` jsonb stores the inputs that produced `points`, so every number is reproducible. `analyses.engine_version` stores the git SHA of the scoring code.

### Section 12 — payments, and why the ledger is not over-engineering

- `payments` has `idempotency_key text unique`, `stripe_payment_intent_id text unique`, `transfer_group`, `application_fee_cents`, and — importantly — `stripe_transfer_id` documented as *set only AFTER `charge.succeeded`* (correct for ACH, where the charge is not final at creation).
- `payment_methods` stores **only** Stripe identifiers plus display-safe remnants (`last4 char(4)`, `brand_or_bank`). Never a PAN, account, or routing number. It also persists `mandate_id`, `mandate_accepted_at`, `mandate_text_hash` — **NACHA requires the originator retain ACH authorization proof.** That is a real compliance requirement most implementations miss.
- `rent_invoices.amount_due_cents` is a `generated always as (subtotal_cents - amount_paid_cents) stored` column — the derived number cannot drift.
- Double-entry ledger (`ledger_accounts` / `ledger_transactions` / `ledger_postings`), justified in-comment: without it, *a partial refund on a disputed ACH payment that was already transferred out silently corrupts the landlord's balance with no way to prove what happened.* Correct call — keep it.
- `app.stripe_webhook_events` gives webhook dedup/idempotency, which neither profx nor helixscales has.

### What is missing from the schema

No `updated_at` trigger definitions are visible for every table (`public.set_updated_at()` is referenced by triggers — confirm it is defined before first apply). No migration ordering; it ships as one file with section markers and a note that it can run top-to-bottom in one transaction on an empty DB. No seed data beyond the 8 scoring factors. No indexes review has been done against real query patterns because it has never run.

---

## 2. `profx-trading`

Stack: zero-build single-file vanilla JS (no React, no Tailwind, no bundler), Supabase UMD + `lightweight-charts@4.2.0` via CDN, 5 Netlify functions in CommonJS.

### Netlify functions — the best server code in the account

| File | What it does | Verdict |
|---|---|---|
| `netlify\functions\stripe-webhook.js` | Full subscription lifecycle → Supabase via service role. `verifyStripeSignature` (lines 38-58) is SDK-free HMAC-SHA256 over `t.rawBody`, 300s replay window, `timingSafeEqual`, handles `isBase64Encoded`. `mapStatus`/`tierFor` (75-84) narrow Stripe's status vocabulary. Fails closed on missing config; returns non-200 on real failures so Stripe retries. | **LIFT AS-IS** — the verification function is the single most reusable file here |
| `netlify\functions\checkout.js` | `verifySupabaseUser` (29-37) validates the token against Supabase's own `/auth/v1/user` instead of decoding the JWT locally. `getExistingStripeCustomerId` (47-59) reuses an existing customer so resubscribes don't fragment payment history. Carries `client_reference_id` + `metadata[supabase_user_id]` + `subscription_data[metadata][...]`. | **ADAPT** to a Route Handler; keep the token-verification and customer-reuse logic verbatim |
| `netlify\functions\portal.js` | Billing portal session; same verify-then-lookup shape. Comment at 34-35 correctly notes service role is safe *because the user id came from a verified token, not client input*. | **ADAPT** |
| `netlify\functions\professor.js` (27KB) | LLM coaching over deterministic evidence. Header (lines 1-31) states the hard line: the model "never calculates, never estimates, never invents a figure." Mode prompts repeat *"every concrete number you cite comes verbatim from the context given"*. Model discovery via `/v1/models` with dated-snapshot fallback. Always HTTP 200 with a deterministic `FALLBACK` string per mode, each reasserting that on-screen numbers are still exact. Free-tier metering (`FREE_MONTHLY_LIMIT = 15`). | **ADAPT** — lift the prompt discipline and graceful-degradation shape, not the trading modes |
| `netlify\functions\bars.js` (26KB) | Market data fetch/normalize. Trading-specific. | **SKIP** |

Shared house pattern across all of them, worth standardizing: a `HANDLER_BUDGET_MS` deadline threaded through every call, `fetchWithTimeout(url, options, ms)` via `AbortController`, `ok(status, body)` JSON helper, `Cache-Control: no-store`, and user-facing `reason` strings that are actually readable ("Your session has expired — sign in again.").

### Client-side math — `app.html:1437-2260`

Worth porting to `src/lib/` as typed modules. Highlights:

- `mulberry32(seed)` (1443) — seeded PRNG. Everything stochastic routes through it, so reports are byte-reproducible. **LIFT AS-IS.**
- `round(n,d)` (1476) returns `null`, not `NaN`, for non-finite; comment at 1434 notes `JSON.stringify(Infinity)` silently becomes `null`. **LIFT AS-IS.**
- `num(v)` (1482) / `numv(v)` (4213) — blank field must return `null`, never `0`. The comment at 4209-4212 documents the exact bug this prevents: a blank stop-loss silently became `$0`, fabricating a near-zero-risk result. **LIFT AS-IS** — the same class of bug ruins a cap-rate calculation.
- `bootstrapCI(xs, {samples, alpha, rng})` (1629) — distribution-free percentile bootstrap, `Float64Array`-backed. **ADAPT** — use for confidence intervals on any property estimate.
- `benjaminiHochberg(items, q, pField, outField)` (1724) — FDR correction, fully generic over any array with a p-value field. **ADAPT.**
- `monteCarlo(rs, opts)` (1982) — resampling sim returning ruin/loss/blowup probabilities plus p05/p25/median/p75/p95 equity and drawdown quantiles. **ADAPT** → portfolio cash-flow / vacancy simulation.
- `equityCurve(...)` (2074) — running equity, peak, max drawdown, longest underwater streak. Generic cumulative-series drawdown. **ADAPT.**
- `recoveryRequired(lossFraction)` (2093) — `loss / (1 - loss)`. Four lines, universal. **LIFT AS-IS.**
- `scoreConfluence(checked, rubric)` (2409) — weighted rubric → points → banded grade, with `bands[{min, grade, action}]`. **ADAPT** — cleanest template for a secondary property rubric.
- `verdictFor(s, cfg)` (1772) — maps stats to a status string whose human-readable reason embeds the actual computed numbers. **ADAPT** — this is how you ship explanations without an LLM.
- `parseCSV(text)` (1557) RFC4180 + `resolveMap`/`ALIASES` (1580-1604) fuzzy header resolution. **ADAPT** → MLS/CSV export ingestion.
- Formatters (4198-4218): `pct`, `usd`, `sign`, all returning `'—'` for null rather than `$0`/`NaN`. **Adopt the convention**, but the new app's `src\lib\utils.ts` already uses `Intl.NumberFormat`, which is better — extend that instead of copying `toLocaleString` by hand.
- `svgLine(points,w,h,opts)` (4845) — dependency-free inline-SVG sparkline. **ADAPT** if you want sparklines without a chart library.

### Auth flow (`app.html:7415-7808`)

Email+password Supabase v2. Non-dismissable paywall overlay while signed out (`authClose()` returns early if `!authUser`, backdrop click ignored). `authInit()` (7776) uses `onAuthStateChange` + `getSession()`. `authClaimLocalState(userId)` (7595) reassigns anonymous localStorage work to the user **before** any sync, so pre-signup work is neither lost nor leaked across accounts. **ADAPT the local-claim idea** — useful if anonymous users can run a property analysis before signing up. The rest is superseded by `@supabase/ssr`, which is already a dependency.

### Other

- `sw.js` — network-first PWA service worker. Correctness is in what it *refuses* to cache (lines 36-38): non-GET, cross-origin, and `/.netlify/functions/*`. **ADAPT** if the new app needs offline; the path exclusions must be rewritten for Next.js route handlers.
- `netlify.toml` — the `SECRETS_SCAN_OMIT_KEYS` comment (7-16) is the clearest explanation of the publishable-key/secret-scanner conflict in the account. **Keep the reasoning**; the new app's own `netlify.toml` already handles the Next.js plugin correctly.
- `index.html`, `app.html` CSS/layout — **SKIP.** Dark-only, hand-written CSS, no Tailwind. See "design tokens" below.

---

## 3. `helixscales-audit`

Stack: zero-build single-file vanilla JS (ES2020+, hash router), **zero external scripts**, 10 Netlify functions (ESM `.js`/`.mts` with `export const config = { path }`), 4 SQL migrations.

### Netlify functions

| File | Verdict | Note |
|---|---|---|
| `netlify\functions\integration-proxy.js` | **LIFT AS-IS** (near-verbatim) | Server-side relay for third-party APIs. `isSafeUrl` SSRF guard blocking loopback/RFC1918/link-local (35-44), `ALLOWED_HEADER_RE` allowlist that never forwards Host/Origin/Cookie (24), `ALLOWED_METHODS` set, 200KB request / 20KB response caps, 15s `AbortSignal.timeout`, in-memory IP rate limiter with stale eviction. **Directly applicable to multi-source property API aggregation.** Honest in-comment about not catching DNS rebinding. |
| `netlify\functions\claude.mts` | **ADAPT** | The LLM-hardening reference. `GUARDRAIL` prepended to caller's prompt treating conversation as untrusted (45-51); `clean()` strips control chars and truncates (75-88); `cleanBlock`/`cleanContent` revalidate every `text`/`tool_use`/`tool_result` block *even though they nominally originate from the API*, because they round-trip through the browser (96-127); `cleanTools` shape-checks tool defs; model chosen server-side ("the key is ours to spend", 239). Note the documented rate-limiter fix at 142-164 — the previous `hits.clear()` reset every IP's window; the replacement evicts only aged-out entries. Returns 502 rather than a fake answer so the client falls back. |
| `netlify\functions\verify-license.js` | **ADAPT** | Replaces client-side honor-system gating with a real server lookup. Regex-validates key format before querying; **degrades to `free` on lookup failure rather than erroring**, so a Supabase outage never blocks the app. Good shape for entitlement checks generally. |
| `netlify\functions\stripe-webhook.js` | **ADAPT** | Same signature verification as profx but Web-standard (`Request`/`Response`) rather than Lambda-style — **closer to a Next.js Route Handler, so port from this one.** `generateLicenseKey()` (39-43) uses an unambiguous alphabet (no `0/O/1/I`) — reusable for tenant invite codes. Reuses an existing license key for returning customers. |
| `netlify\functions\checkout.js` | **SKIP** (mostly) | No auth at all — it's a public pre-account checkout. Price IDs hardcoded (deliberate, documented). The new app has real accounts; use profx's token-verified version instead. |
| `site-serve.js`, `site-publish.js`, `site-analytics.js`, `get-license.js`, `pmf-survey.js` | **SKIP** | Site-hosting and survey features with no analogue here. |

### SQL migrations

- `supabase-migrations\003_helix_pageviews.sql` — **ADAPT.** `helix_record_pageview()` is an atomic upsert-increment (`on conflict ... do update set count = count + 1`) so concurrent visits never lose a count to a read-modify-write race. Bounded row growth: one row per `(slug, day, path, ref_host, device)` instead of one per visit. Privacy notes are exemplary — no cookies, no visitor id, `ref_host` is a bare domain, `device` is a coarse class, and the comment states the dashboard **must not** claim "unique visitors". Good template for property-view analytics.
- `001_helix_profiles.sql`, `002_helix_sites.sql`, `004_helix_pmf.sql` — **SKIP the tables**, but note the house pattern: `enable row level security` with **no policies**, explicitly commented as "only the service-role key can read/write". That is a valid deny-all posture for function-only tables, and `SCHEMA.sql` uses the same idea for its `app.*` schema. The `set_updated_at` trigger with `security invoker` + `set search_path = ''` (033-048) is the correct hardened form — **LIFT that trigger pattern.**

### Client-side

- `api(method, path, body)` (`app.html:5537-5546`) — 10-line fetch wrapper; `.catch(() => ({}))` on the JSON parse prevents a parse error masking the real HTTP error. **ADAPT** as the base for a typed client.
- `auditHTML(html, target)` (1915-1987) — weighted checklist → score/grade where **every check carries its own remediation `advice` string**, so "what to fix" is data, not LLM prose. **ADAPT** — good secondary pattern alongside the vitaforge factor engine.
- `computeUnitEcon(u)` (6736-6752) — CAC/LTV/ratio/payback, returns `null` if any input is missing rather than emitting partial numbers. **ADAPT** → cap rate, cash-on-cash, DSCR follow the same null-guard shape.
- `pctChange(cur, prev)` (7240) — `if (!prev) return cur ? null : 0;` with the comment "no prior period to compare — don't imply a real 0%". **LIFT AS-IS.**
- `toast()` (5548), `modal()` (5661), `timeAgo()` (5562), `downloadCSV()` (7250, RFC-correct quote escaping), `makeZip()`+`crc32` (3210-3277, dependency-free ZIP writer). **ADAPT `downloadCSV` and `makeZip`** if you export report bundles; the rest are trivially replaced by React equivalents.
- Auth model, `handle()` client-side API router, `localStorage` credential store — **SKIP entirely.**

---

## 4. `vitaforge-property-alerts`

Plain JavaScript (not TS), pure ESM with explicit `.js` extensions, JSDoc typedefs, named exports only. `lib/` is split into pure-computation modules with no I/O and thin I/O adapters.

**The convention worth adopting wholesale:** every network-touching function takes `{ fetchImpl = fetch }` as an injectable option. Consistently applied — and it makes everything trivially testable.

### Liftable

| File | Verdict | Note |
|---|---|---|
| `lib\scoring.js` (259 lines) | **LIFT AS-IS**, parameterize | 8 factors → 100 pts, each independently exported and testable. Shared primitives `clamp` and `lerp(value,x0,x1,y0,y1)` (clamped linear interpolation). Factors: price-vs-assessed (20), multi-unit (15), DOM+price-cuts (15), bath/bed ratio (10), $/sqft vs area median (15), garage (5, can bonus to 7), year built (10), disclosure completeness (10). `rawTotal` intentionally uncapped (max 102); `displayScore = round(min(100, rawTotal))`. Thresholds 65 / 50. **Three patterns to keep: every factor returns an object not a number; missing data → explicit neutral half-credit with the reason in `note`; every curve gap marked `INTERPRETATION:` in-comment so weights are retunable without archaeology.** Constants are Grand-Forks-specific — Section 7 of `SCHEMA.sql` already specifies how to move them into `scoring_profiles.config`. |
| `lib\disqualifiers.js` (104 lines) | **LIFT AS-IS** | `checkHardDisqualifiers`, `countPriceCutsWithinDays(priceHistory, days, now)`, `checkSoftFlags`. Hard/soft two-tier concept. **Key idea: a hard disqualifier suppresses the recommendation but the record is still persisted with a Disqualified status**, so a bad rule shows up in data instead of vanishing. Build that in from day one. |
| `lib\femaFloodCheck.js` | **LIFT AS-IS** | FEMA NFHL ArcGIS layer 28, no key. 4-state discriminated union `{status:'OK'\|'UNMAPPED_OR_ZONE_X'\|'ERROR'\|'UNKNOWN', zone, subType, error}`. **A missing feature is explicitly NOT a positive flood match** — exactly the distinction that gets fumbled. |
| `lib\geocode.js` (39 lines) | **LIFT AS-IS** | US Census one-line geocoder. Free, no key, no attribution requirement. Returns `{lat,lon}\|null`. |
| `lib\timeWindow.js` (28 lines) | **LIFT AS-IS** | luxon `America/Chicago` wall-clock check. Cron fires in UTC; a fixed UTC cron drifts an hour across DST, an IANA check never does. **Mandatory for rent due dates / grace periods / late fees.** |
| `totalBaths(listing)` in `lib\filters.js` | **LIFT AS-IS** | `baths_full + 0.5 * baths_partial`. Trivial, and it bites everyone. |
| `test\*` + `scripts\run-local-test.js` | **LIFT THE APPROACH** | 264 lines, 30 cases, **zero test dependencies** — Node built-in `node:test` + `node:assert/strict`, `"test": "node --test"`. Each factor tested at its named spec anchor points (0.85, 1.15, 0.25, 0.5) plus missing-data paths. Local `assertClose(actual, expected, tolerance=0.5)` because scoring is fractional. Fixtures carry an explicit `_notice: "SYNTHETIC TEST DATA ONLY"`. `run-local-test.js` is a non-assertion harness printing the full per-factor breakdown so you can eyeball the curve when tuning — **lift that idea**, it's distinct from pass/fail tests. |
| `netlify\functions\poll-trigger.mts` | **ADAPT** | Thin-trigger/fat-worker split: scheduled functions get 30s, so the trigger only checks the window and fires the background worker (15 min), returning 202. Maps to Vercel Cron + `waitUntil()`, or Netlify scheduled function + background function. **Add the `CRON_SECRET` check the original lacks.** |

### Adapt with fixes

- `lib\dedup.js` — `normalizeAddress` (uppercase → strip `[.,#]` → collapse whitespace → map street suffixes and directionals) deliberately does **not** strip unit/apt numbers, with a documented rationale: better to over-split than merge two units of a duplex. Correct. `mergeListingRecords` resolves field conflicts by **source priority** (structured feeds beat scrapes), unions `photo_urls`, merges `price_history` on a `${date}|${price}` key, tracks `sources_confirmed[]` / `first_seen_at` / `first_seen_source`. **The source-priority conflict resolution is the highest-value idea in the file** and maps straight onto multi-source analysis.
  🐛 **Bug — must fix if lifted:** `dedupeAndMerge` keys the group map on `normalizeAddress(address)` **alone**, no zip or city. Two "123 MAIN ST" in different cities silently merge. Harmless in a 5-zip pilot, catastrophic multi-market. `SCHEMA.sql`'s `addresses`/`parcels` spine is the structural fix.
- `lib\marketStats.js` — correct even/odd median, 90-day trailing window, `MIN_SAMPLE_SIZE = 5` floor returning `null` rather than a noisy median (pairs correctly with the $/sqft factor's half-credit path). **Lift the median math, replace the source:** it currently self-bootstraps from the pipeline's own already-price-filtered rows, so the "area median" is a biased sample. Also called per-listing inside the loop (N+1).
- `lib\alertFormat.js` — the Slack strings are throwaway, but the signal thresholds are worth porting to React: positive when `points >= max * 0.85`, caution when `points < max * 0.5 || caution || flagForManualReview`. **It derives the entire human-readable explanation mechanically from the numeric breakdown** — the "no LLM numbers" architecture in UI form.
- `lib\photoAnalysis.js` — **study the LLM boundary, rewrite the mechanics.** The model emits only booleans/enums/prose (`water_intrusion_pattern_suspected`, `panel_appears_knob_and_tube`, `renovation_tier`); scoring reads those booleans; the model never sees or produces a number. Strict `json_schema` output with `additionalProperties: false`, handles `stop_reason === 'refusal'`, degrades to "review manually" rather than a wrong flag. See security finding #4 for what to fix.
- `lib\geo.js` — two-tier primary/secondary market classification with an out-of-radius flag. Useful *shape*; zips must become DB-backed markets.
- `mapListing()` in `sources\tier1\mlsIdx.js` — maps 20 **RESO Data Dictionary** standard fields (`ListPrice`, `AboveGradeFinishedArea`, `BathroomsHalf`, `StandardStatus`, `PublicRemarks`…) to the internal shape. **The single most portable thing in `sources/`**, since RESO is a real cross-MLS standard. The fetch around it is a stub.
- `toAirtableFields()` in `lib\airtableSync.js` — **lift the pattern, not the transport.** One function is the sole boundary between the internal record shape and the persistence schema; everything else speaks the internal shape. Keep exactly that discipline for Supabase.

### Skip

`sources\tier2\sites\*` (all 8: zillow, redfin, realtorCom, homesCom, fsbo, oxfordRealty, berkshireGF, coldwellGF) — every file opens with `⚠️ UNVERIFIED`; the last three have literal `PLACEHOLDER` URLs for domains never confirmed to exist; the generic ones are `[class*="listing"]` guesses. **Keep only the adapter interface** (`{name, searchUrl(zip), scrapeSearchResults(page)}`), discard every selector. Also skip `sources\tier1\attom.js` (36-line stub), `sources\tier1\realtorRapidapi.js` (no mapper), `lib\slackSender.js`, the `airtableSync` transport, and `netlify.toml`.

`sources\tier1\rentcast.js` is the only client with a complete `mapListing()` — **ADAPT**, but verify against a live response first; its own header admits param names and casing were never confirmed.

### Nothing to lift — build fresh

**No retry, backoff, rate limiting, caching, or circuit breakers exist anywhere in the repo** (confirmed by grep). The only resilience primitives are two 10s `AbortController` timeouts and a randomized scrape delay. Logging is bare `console.*` with a `[module]` prefix — no levels, no structured logs, no correlation IDs, no Sentry, no metrics. **For a product handling rent payments this is nowhere near sufficient.** Keep only the error-handling *doctrine*: layered isolation (a `safely(label, fn)` wrapper returning `[]`, then per-zip and per-listing try/catch, so one bad listing can't kill a pass), degrade-don't-crash on missing API keys, structured error returns over exceptions, and `body.slice(0, 500)` on failed HTTP responses so a giant HTML error page can't blow up the log.

Also absent entirely: auth, RBAC, tenant isolation, RLS, input validation (no Zod/Joi/Yup), email/SMS/push, TypeScript, migrations, CI, linting, and any hashing/fingerprinting (the address string *is* the fingerprint).

### Known bugs — do not carry forward

1. **Field-name mismatch** — `daily-digest-background.mts:37` reads `f['Baths Full']` / `f['Property Type']` (spaces) but `airtableSync.js:121,124` writes `Baths_Full` / `Property_Type` (underscores). Every digest line renders `undefined`.
2. **Infinite duplicate alerts** — `poll-worker-background.mts:143` alerts on every poll for any `immediate_alert` listing. There's a `Digest_Sent` flag but **no `Alert_Sent` equivalent**, so a ≥65 listing re-alerts every 15 minutes forever.
3. **Full re-enrichment every cycle** — geocode + FEMA + paid ATTOM call + Claude vision re-run for every listing on ~64 daily passes. No unchanged-record short-circuit, no cache. Pure recurring cost.
4. Cross-city address collision (above). 5. N+1 market-stats query. 6. Biased median. 7. Dead `airtable` dependency (declared, never imported). 8. Three broken doc references, including `scripts\create-airtable-schema.mjs`, which is cited as the authority for the persistence schema and does not exist.

---

## 5. `pantheon-site`

`OneDrive\Desktop\pantheon-site` — 84KB static `index.html`, `manifest.json`, a 248-byte `sw.js`, and `netlify\edge-functions\gate.js` (18 lines, HTTP Basic auth). `OneDrive\Desktop\pantheon\pantheon-site_1.zip` is an archive of the same. `Claude\Artifacts\pantheon-news-desk` is a published artifact with three prior versions.

**Verdict: SKIP everything.** There is no application code, no build, no data layer, no shared library. See security finding #8 for the gate.

---

## Dominant stack & conventions across the family

**Where the family agrees (adopt these):**

- **Netlify** for hosting, functions in `netlify/functions/`. All four active projects. The new app already has `netlify.toml` with `@netlify/plugin-nextjs` and `publish = ".next"`, with a comment documenting both failure modes.
- **Supabase** for auth + Postgres. Publishable/anon key in the client, service-role key only in server functions. RLS is the security boundary — and it is genuinely enabled (verified on the live project).
- **Stripe** with **zero SDK on the server** — raw `fetch` against `api.stripe.com/v1` with `URLSearchParams`, hand-rolled webhook signature verification. Deliberate and consistently applied. *(Note: the new app already has `stripe@^22.4.0` and `@stripe/stripe-js@^9.13.0` as dependencies, so it is diverging here — that's fine and probably right for Stripe Connect, but it's a conscious break from house style.)*
- **Zero-to-minimal dependencies.** vitaforge has 4 runtime deps; helixscales' client has zero external scripts. Tests use Node's built-in runner.
- **Env vars read via `process.env.X`**, documented in `.env.example` with signup URL, setup time, and cost. Missing key → degrade, never crash.
- **Heavy explanatory comments.** Every non-obvious decision carries its rationale in-file. This is the strongest shared trait in the account and is genuinely worth preserving.
- **Graceful degradation as a rule**, not an afterthought: LLM down → deterministic fallback that reasserts the computed numbers; license lookup down → free tier; missing API key → empty array.
- **`prefers-reduced-motion` guards** in every UI. Already present in the new app's `globals.css`.

**Where the family disagrees / the new app deliberately breaks:**

- **Module system:** profx functions are CommonJS (`exports.handler`, Lambda-style `event`), helixscales are ESM with Web-standard `Request`/`Response` and `export const config = { path }`, vitaforge is pure ESM. **Port from helixscales** — its Web-standard handlers are closest to Next.js Route Handlers.
- **TypeScript:** essentially absent. Only `.mts` files exist, lightly typed with heavy `any`. The new app is `"strict": true` with `@/*` path aliases — **a genuine step up, with no legacy types to inherit.** Everything lifted must be typed on the way in.
- **Styling:** the old apps are hand-written CSS with `:root` custom properties, dark-only, on a violet/cyan palette (`--accent:#6366f1`, `--accent2:#22d3ee`). **The new app has already rejected this** — `src\app\globals.css` uses a Tailwind 4 `@theme` block with a warm `ink`/`bone`/`ember`/`signal` palette and an explicit comment: *"Real estate should feel like architecture and daylight, not a crypto dashboard"* and *"Chosen specifically to avoid the purple/violet gradient that reads as generic AI product."* **Do not lift the old design tokens.** The only styling conventions worth carrying over are `font-variant-numeric: tabular-nums` on every numeric cell, uppercase letter-spaced mono section labels, and the reduced-motion guard — all three are already in the new app.
- **State management:** old apps use a global mutable object + `localStorage`. New app should not. Nothing to lift.
- **Naming:** `camelCase` functions, `SCREAMING_SNAKE` constants, `snake_case` DB columns. `SCHEMA.sql` follows this and adds `*_cents` for money and `*_at` for timestamps. Table prefixes per app (`profx_`, `helix_`, `apg_`) exist because multiple products share one Supabase project — **the new app should get its own project instead** (see below).

---

## Duplicated code worth standardizing

Five things are copy-pasted across projects and should become shared modules in the new app rather than a sixth copy:

1. **`fetchWithTimeout(url, options, ms)`** — appears in `profx-trading\netlify\functions\checkout.js:22`, `portal.js:16`, `stripe-webhook.js:25`, and `helixscales-audit\netlify\functions\claude.mts:60`. helixscales' `integration-proxy.js` and `verify-license.js` instead use the cleaner `AbortSignal.timeout(ms)`. **Standardize on `AbortSignal.timeout`.**
2. **`json(status, data)` / `ok(status, body)` response helper** — in all 10+ functions, in two dialects (Lambda object vs `Response`). **Standardize on one typed helper** returning `Response` with `Cache-Control: no-store`.
3. **`verifyStripeSignature`** — implemented twice (`profx-trading\netlify\functions\stripe-webhook.js:38`, `helixscales-audit\netlify\functions\stripe-webhook.js:18`) with the same logic and one real difference: profx compares `Buffer.from(hex,'hex')`, helixscales compares `Buffer.from(hex,'utf8')`. Both work with `timingSafeEqual` since lengths match, but **the hex form is more correct.** Write once, test once.
4. **`verifySupabaseUser(token)`** — duplicated verbatim in `checkout.js:29` and `portal.js:23`. With `@supabase/ssr` this becomes one server helper.
5. **In-memory IP rate limiter** — in `claude.mts:150-173` and `integration-proxy.js:48-64`, with the eviction bug fixed in only one of them (`claude.mts:142-164` documents the fix; `integration-proxy.js` uses a simpler filter-based `evictStale` that is fine). **Note the limitation both share:** per-instance memory, so it blunts casual abuse but not a distributed attacker. For rent payments, use a durable store.

Two more patterns worth formalizing:

6. **`set_updated_at` trigger** — reimplemented per-table in every helixscales migration (`helix_set_updated_at`, `helix_sites_set_updated_at`). `SCHEMA.sql` already correctly uses one shared `public.set_updated_at()`. **Confirm that function is defined before first apply** — the triggers reference it.
7. **The `{ fetchImpl = fetch }` DI convention** from vitaforge — the single best testability decision in the account, and unused by the other three projects. **Adopt it globally.**

---

## Recommended sequence

1. **Create a dedicated Supabase project.** `SCHEMA.sql` targets a ref that does not exist; the only alternative is `pvhfgvfpgbdovgknonqd`, which already hosts profx + apg tables. A rent-payment product should not share a database with two other apps.
2. **Split `SCHEMA.sql` into ordered migrations** along its 17 section markers and apply. It has never run — budget for syntax/ordering fixes and verify `public.set_updated_at()` exists before the triggers.
3. **Port `lib/scoring.js`, `disqualifiers.js`, `femaFloodCheck.js`, `geocode.js`, `timeWindow.js`, `totalBaths` into `src/lib/` as typed TS**, driven by `scoring_profiles.config` per Section 7. Bring the `node:test` suite with them — it already tests every spec anchor point.
4. **Port the Stripe webhook verification** from helixscales' Web-standard handler, add `app.stripe_webhook_events` dedup, then build Connect on top (nothing existing covers Connect — `stripe_connected_accounts` is schema-only).
5. **Build fresh, with nothing to lift:** Stripe Connect flows, retry/backoff/rate limiting, caching, structured logging, Zod validation, notifications, and address fuzzy-matching.

**Two hard rules to carry from the old code:** every cron/background route verifies `CRON_SECRET` before doing work (vitaforge's worst finding), and every LLM response is Zod-validated before touching business logic (vitaforge's second-worst).
