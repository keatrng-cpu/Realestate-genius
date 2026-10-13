# Graph Report - Realestate-genius  (2026-10-13)

## Corpus Check
- 195 files · ~653,673 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .toml 1, .ico 1)

## Summary
- 1621 nodes · 3850 edges · 79 communities (75 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3ba1ee4a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- next
- motion
- discover-arcgis.mjs
- pricing.ts
- ai/analyze/route.ts
- money.ts
- opportunity.ts
- ai/types.ts
- search/page.tsx
- EdgeSection.tsx
- HouseTour.tsx
- ThemeProvider.tsx
- mapping.ts
- factors.ts
- providers.ts
- guardrail.ts
- applications.ts
- property.ts
- mem.py
- Hero.tsx
- [addressId]/page.tsx
- primitives.tsx
- Realestate Genius — Competitive Gaps
- enums.ts
- AssistantChat.tsx
- createClient
- deals/_data.ts
- arcgis.ts
- engine.ts
- deals.ts
- Nationwide parcel & zoning data sources — what we verified
- ingest.mjs
- utils.ts
- compilerOptions
- package.json
- variants.ts
- formatCents
- lucide-react
- tour.ts
- documents.ts
- permits.ts
- property/analyze/route.ts
- pros.ts
- tour-mapper.ts
- dependencies
- provenance.ts
- comps.ts
- migrate.mjs
- RoleBadge.tsx
- ScoreCard.tsx
- normalize.ts
- DealRoomCard.tsx
- PermitTimeline.tsx
- cn
- prompts.ts
- registry/types.ts
- devDependencies
- proxy.ts
- ArcGisClient
- assessment-ratio.ts
- Realestate Genius — Reuse Audit
- demo-data.ts
- TaskChecklist.tsx
- deals/route.ts
- 1. `realestate-genius-design\SCHEMA.sql` — the main event
- 4. `vitaforge-property-alerts`
- NOW — Realestate-genius current truth
- CLAUDE.md
- 2. `profx-trading`
- SECURITY FINDINGS
- frustum-check.mjs
- scripts
- test-normalize.mjs
- eslint.config.mjs
- README.md
- callback/route.ts
- This is NOT the Next.js you know
- GROK.md
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `cn()` - 130 edges
2. `createClient()` - 51 edges
3. `next` - 49 edges
4. `react` - 48 edges
5. `motion` - 44 edges
6. `UnknownChip()` - 35 edges
7. `EASE_OUT_EXPO` - 27 edges
8. `PropertyPage()` - 24 edges
9. `phaseEmit()` - 23 edges
10. `formatCents()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `Adapt with fixes` --references--> `normalizeAddress()`  [INFERRED]
  docs/REUSE-AUDIT.md → src/lib/ingest/normalize.ts
- `Suggested next steps (either agent)` --references--> `getListing()`  [INFERRED]
  docs/AGENT-HANDOFF.md → src/lib/listings/demo-data.ts
- `Recommended sequence` --references--> `totalBaths()`  [INFERRED]
  docs/REUSE-AUDIT.md → src/lib/scoring/math.ts
- `Map (from the Forge Atlas Graphify build, 2026-10-13)` --references--> `cn()`  [INFERRED]
  CLAUDE.md → src/lib/utils.ts
- `Quick verify` --references--> `main()`  [INFERRED]
  docs/AGENT-HANDOFF.md → scripts/discover/discover-arcgis.mjs

## Import Cycles
- None detected.

## Communities (79 total, 4 thin omitted)

### Community 0 - "next"
Cohesion: 0.06
Nodes (76): nextConfig, next, react, DashboardPage(), metadata, NEXT_STEP, CheckEmailPage(), metadata (+68 more)

### Community 1 - "motion"
Cohesion: 0.06
Nodes (61): Motion / ambient, motion, Home(), AnalysisDepth(), LAYERS, ClosingCTA(), CostSection(), DealFlow() (+53 more)

### Community 2 - "discover-arcgis.mjs"
Cohesion: 0.06
Nodes (72): Agent handoff — Realestate Genius, Ownership (avoid collisions), Quick verify, Suggested next steps (either agent), Tour tiers (product truth), What Claude owns that Grok consumes (do not rewrite), What Grok shipped on `main` (read these first), CANONICAL_CONCEPTS (+64 more)

### Community 3 - "pricing.ts"
Cohesion: 0.06
Nodes (59): metadata, PricingPage(), Footer(), FooterGroup, FooterItem(), FooterLink, GROUPS, BillingToggle() (+51 more)

### Community 4 - "ai/analyze/route.ts"
Cohesion: 0.10
Nodes (38): Netlify functions, ALLOWED_TASKS, AllowedTask, dynamic, isAllowedTask(), JSON_TASKS, parseJsonReply(), POST() (+30 more)

### Community 5 - "money.ts"
Cohesion: 0.09
Nodes (34): 1. File ownership, Logic-owned (do not restructure; restyle only via the seams in §3), Owned by neither (a third agent), Presentation-owned, rollupScheduleE(), amortizeMonth(), computeTco(), DEFAULT_ESCALATION (+26 more)

### Community 6 - "opportunity.ts"
Cohesion: 0.08
Nodes (33): AssumptionList(), BLOCKER_LABEL, BLOCKER_TONE, HeadroomMetric, ADU_RULE_ID, ADU_RULE_VERSION, AduDetail, AduInputs (+25 more)

### Community 7 - "ai/types.ts"
Cohesion: 0.07
Nodes (33): assembleContext(), brainBlock(), contextBlock(), EMPTY_BRAIN, fmtFact(), AI_EVENT_DOMAINS, AI_EVENT_KINDS, AI_MEMORY_KINDS (+25 more)

### Community 8 - "search/page.tsx"
Cohesion: 0.12
Nodes (27): POST(), CHANNELS, CreateBody, FREQUENCIES, GET(), isSchemaError(), POST(), describeCriteria() (+19 more)

### Community 9 - "EdgeSection.tsx"
Cohesion: 0.08
Nodes (28): COMPARE, CompareRow, CompareTable(), EdgeSection(), PARCELS, PERMITS, Surface(), SurfaceKey (+20 more)

### Community 10 - "HouseTour.tsx"
Cohesion: 0.12
Nodes (29): ARROW_KEYS, displacementFromMap(), DisposeOnUnmount(), Engagement, FlatGallery(), FloorAndDoorways(), HouseTour(), HouseTourProps (+21 more)

### Community 11 - "ThemeProvider.tsx"
Cohesion: 0.11
Nodes (26): geistMono, geistSans, instrument, metadata, RootLayout(), viewport, readStoredPreference(), ResolvedTheme (+18 more)

### Community 12 - "mapping.ts"
Cohesion: 0.07
Nodes (28): BLANK_SENTINELS, cleanRaw(), DataSourceAccessMethod, DataSourceCategory, detectFieldMapping(), FactMapping, FactValueType, FARGO_ND (+20 more)

### Community 13 - "factors.ts"
Cohesion: 0.16
Nodes (27): ALLOWED_MEDIAN_GEOGRAPHIES, AnyFactorFn, BathBedParams, DomParams, GarageParams, MultiUnitParams, neutral(), PricePerSqftParams (+19 more)

### Community 14 - "providers.ts"
Cohesion: 0.18
Nodes (27): ANTHROPIC_BASE, anthropicBody(), anthropicComplete(), anthropicFailure(), anthropicHeaders(), anthropicStream(), anthropicSystem(), Attempt (+19 more)

### Community 15 - "guardrail.ts"
Cohesion: 0.08
Nodes (27): Duplicated code worth standardizing, shadowNumericGuard(), CapProfile, evictStale(), extractNumerals(), FAIR_HOUSING_PROTECTED_CLASS, FAIR_HOUSING_STEERING, findUnsourcedNumerals() (+19 more)

### Community 16 - "applications.ts"
Cohesion: 0.08
Nodes (22): APPLICATION_STATUSES, APPLICATION_TRANSITIONS, ApplicationStatus, CriteriaEvaluation, CriterionCheck, DecisionReasonRow, evaluateAgainstCriteria(), PublishedCriteria (+14 more)

### Community 17 - "property.ts"
Cohesion: 0.09
Nodes (24): Dossier, SourceRef, UNKNOWN_SOURCE, AnalysisFactorRow, AnalysisRow, AssessmentRow, FactTypeRow, FactValueType (+16 more)

### Community 18 - "mem.py"
Cohesion: 0.18
Nodes (17): 2026-10-13 — auto-memory protocol adopted, DECISIONS — Realestate-genius (append-only), build(), changed(), context(), gbin(), graph(), install_hook() (+9 more)

### Community 19 - "Hero.tsx"
Cohesion: 0.11
Nodes (21): 2. Invariants — do not break these while restyling, 3. `data-anim` hooks, 4. Known gaps, Agent boundaries — landing page, COVERAGE, HEADLINE, Hero(), MAX_FACTOR_WEIGHT (+13 more)

### Community 20 - "[addressId]/page.tsx"
Cohesion: 0.16
Nodes (22): dynamic, isSchemaError(), metadata, PortfolioPage(), PropertyJoined, RollupRow, dynamic, metadata (+14 more)

### Community 21 - "primitives.tsx"
Cohesion: 0.17
Nodes (20): FactorBar(), FactorBarProps, FactorStack(), clamp(), describeArc(), fmt(), isKnown(), Maybe (+12 more)

### Community 22 - "Realestate Genius — Competitive Gaps"
Cohesion: 0.08
Nodes (23): 0. The four findings that change the plan, 1.1 Software pricing, 1.2 Payment economics — the part that decides the business, 1.3 Why tenants care more than landlords think, 1. Competitive teardown — landlord/tenant, 2. Competitive teardown — buyer/investor, 3. Where the incumbents are genuinely weak, 4.1 What the operator actually has (+15 more)

### Community 23 - "enums.ts"
Cohesion: 0.08
Nodes (23): AI_DISPOSITIONS, ANALYSIS_AUDIENCES, CHARGE_KINDS, ChargeKind, CONFIDENCE_LEVELS, INVOICE_STATUSES, InvoiceStatus, LEASE_STATUSES (+15 more)

### Community 24 - "AssistantChat.tsx"
Cohesion: 0.14
Nodes (19): AssistantChat(), AssistantChatProps, nextId(), SUGGESTIONS, ChatTurn, DECLINED, DISPOSITION_NOTE, MessageBubble() (+11 more)

### Community 25 - "createClient"
Cohesion: 0.19
Nodes (17): DATE_FIELDS, GET(), MONEY_FIELDS, PATCH(), STATUSES, GET(), POST(), getDealRoom() (+9 more)

### Community 26 - "deals/_data.ts"
Cohesion: 0.16
Nodes (19): DealDataState, DealListItem, DealRoomDetail, getThread(), getViewerId(), RoomListRow, dynamic, metadata (+11 more)

### Community 27 - "arcgis.ts"
Cohesion: 0.10
Nodes (17): ArcGisClientOptions, ArcGisField, ArcGisLayerMetadata, ArcGisPage, ArcGisQueryParams, ArcGisServiceLayerSummary, ArcGisServiceMetadata, DEFAULTS (+9 more)

### Community 28 - "engine.ts"
Cohesion: 0.12
Nodes (18): AnalysisAudience, ScoringProfileConfig, CONSUMER_FTHB_V1, ScoreOptions, CONSUMER_SAFE_FACTORS, FACTOR_KEY_TO_IMPL, FACTOR_REGISTRY, FactorParams (+10 more)

### Community 29 - "deals.ts"
Cohesion: 0.12
Nodes (17): DocRequestView, STATUS_META, addDays(), DEAL_ROLES, DEAL_SIDES, DEAL_STATUS_ORDER, DEAL_STATUSES, DEAL_TASK_STATUSES (+9 more)

### Community 30 - "Nationwide parcel & zoning data sources — what we verified"
Cohesion: 0.11
Nodes (18): Access and licence — what "free" actually means here, Coverage by state, Fargo is an outlier, not a template, Field naming varies wildly — the observed alias table, Headline numbers, Honest coverage against the national universe, How jurisdiction names were established, How the three kinds split (+10 more)

### Community 31 - "ingest.mjs"
Cohesion: 0.12
Nodes (15): arc, argv, __dirname, dryRun, elapsed(), envPath, inspectOnly, log() (+7 more)

### Community 32 - "utils.ts"
Cohesion: 0.20
Nodes (14): ParcelGlyph(), ParcelGlyphProps, variate(), Media(), MediaProps, PropertyCard(), PropertyCardCompact(), PropertyCardData (+6 more)

### Community 33 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 34 - "package.json"
Cohesion: 0.11
Nodes (17): name, private, version, clsx, @netlify/plugin-nextjs, @react-three/drei, @react-three/fiber, stripe (+9 more)

### Community 35 - "variants.ts"
Cohesion: 0.12
Nodes (16): react-dom, Lightbox(), LightboxItem, LightboxProps, NavButton(), EASE_IN_OUT_QUART, EASE_OUT_QUINT, easeBase (+8 more)

### Community 36 - "formatCents"
Cohesion: 0.20
Nodes (15): CONTROLS, CostExplorer(), Ctl, Slider(), STATUS_TONE, Band(), CompsRange(), LineRow() (+7 more)

### Community 37 - "lucide-react"
Cohesion: 0.17
Nodes (14): lucide-react, buildLayers(), DepthStill(), DepthStillProps, Layer, loadImage(), PremiumSplat(), PremiumSplatProps (+6 more)

### Community 38 - "tour.ts"
Cohesion: 0.12
Nodes (15): StickVec, TourControls(), TourControlsProps, CONTROLS_HINT_KEY, CORRIDOR_HALF_W, EYE_HEIGHT, GLIDE_DURATION, ListingTour (+7 more)

### Community 39 - "documents.ts"
Cohesion: 0.12
Nodes (12): DOCUMENT_KINDS, DocumentKind, DocumentRow, DocumentVersionRow, SIGNATURE_REQUEST_STATUSES, SignatureProgress, SignatureRequestRow, SignatureRequestStatus (+4 more)

### Community 40 - "permits.ts"
Cohesion: 0.15
Nodes (16): PermitRow, PermitTypeNorm, assessAllPermitSignals(), assessPermitAbsence(), coverageSupportsAbsence(), KNOWN_WORK_CODES, KnownWorkCode, matchPermits() (+8 more)

### Community 41 - "property/analyze/route.ts"
Cohesion: 0.21
Nodes (13): GET(), AnalyzeBody, normalizeSubject(), POST(), getDossier(), isSchemaError(), toScoringSubject(), valueFromComps() (+5 more)

### Community 42 - "pros.ts"
Cohesion: 0.12
Nodes (13): MaintenancePriority, LEAD_STATUSES, LeadAssignmentRow, LeadRow, LeadStatus, PRO_KINDS, ProCandidate, ProKind (+5 more)

### Community 43 - "tour-mapper.ts"
Cohesion: 0.23
Nodes (12): Listing media / tour (Zillow-better path), GET(), buildTourPayload(), resolveTourTier(), roomsFromListingPhotos(), ListingCapture, ListingPhoto, TourPayload (+4 more)

### Community 44 - "dependencies"
Cohesion: 0.13
Nodes (15): dependencies, clsx, lucide-react, motion, next, react, react-dom, @react-three/drei (+7 more)

### Community 45 - "provenance.ts"
Cohesion: 0.15
Nodes (9): CONFIDENCE_RANK, weakestConfidence(), DataSourceRef, degrade(), deriveProvenance(), MaybeSourced, MISSING_REASONS, MissingReason (+1 more)

### Community 46 - "comps.ts"
Cohesion: 0.18
Nodes (13): CompSale, CompSelectionOptions, CompsResult, CompSubject, daysBetween(), decay(), DEFAULTS, ExcludedComp (+5 more)

### Community 47 - "migrate.mjs"
Cohesion: 0.14
Nodes (10): pg, applied, baselineIdx, client, dir, __dirname, dryRun, envPath (+2 more)

### Community 48 - "RoleBadge.tsx"
Cohesion: 0.24
Nodes (12): expectedMissingRoles(), ParticipantRoster(), ParticipantRow(), ParticipantView, SIDE_HEADING, RoleBadge(), SIDE_STYLE, SideDot() (+4 more)

### Community 49 - "ScoreCard.tsx"
Cohesion: 0.23
Nodes (8): ScorePanel(), AS_OF, ScoreCard(), SUBJECT, TIER_COPY, CautionChip(), ScoreDial(), scoreIntegrity()

### Community 50 - "normalize.ts"
Cohesion: 0.21
Nodes (13): AddressInput, canonicalizePrimary(), DIRECTIONALS, looksLikeSuffix(), NOISE_TOKENS, normalizeAddress(), normalizeCity(), NormalizedAddress (+5 more)

### Community 51 - "DealRoomCard.tsx"
Cohesion: 0.21
Nodes (11): isSchemaError(), listDealRooms(), DealsPage(), dynamic, metadata, DealRoomCard(), DealRoomSummary, STATUS_TONE (+3 more)

### Community 52 - "PermitTimeline.tsx"
Cohesion: 0.24
Nodes (11): PermitAbsencePanel(), PermitFindingCard(), STATUS_META, toVizPermit(), pct(), Permit, PermitTimeline(), PermitTimelineProps (+3 more)

### Community 53 - "cn"
Cohesion: 0.29
Nodes (12): CONFIDENCE_STYLE, ConfidenceChip(), ConfidenceLegend(), ProvenanceLine(), SourcedFact(), PropertyCardCompactSkeleton(), PropertyCardSkeleton(), Skeleton() (+4 more)

### Community 54 - "prompts.ts"
Cohesion: 0.15
Nodes (12): ANALYSIS_PROMPTS, BUYER_INTEL, CONTEXT_CONTRACT, DEAL_DESK, LANDLORD_OPS, NO_NUMBERS, PERSONA_BODIES, PERSONA_TASK (+4 more)

### Community 55 - "registry/types.ts"
Cohesion: 0.15
Nodes (12): CANONICAL_CONCEPTS, CanonicalConcept, ConceptMapping, EsriServiceType, FieldAliasObservation, FieldAliasTable, JurisdictionType, RegistrySource (+4 more)

### Community 56 - "devDependencies"
Cohesion: 0.17
Nodes (12): devDependencies, eslint, eslint-config-next, @netlify/plugin-nextjs, pg, tailwindcss, @tailwindcss/postcss, @types/node (+4 more)

### Community 57 - "proxy.ts"
Cohesion: 0.24
Nodes (9): AUTH_ONLY_PREFIXES, config, matches(), PROTECTED_PREFIXES, proxy(), @supabase/ssr, @supabase/supabase-js, carryAuthCookies() (+1 more)

### Community 58 - "ArcGisClient"
Cohesion: 0.39
Nodes (3): ArcGisClient, ArcGisError, trimUrl()

### Community 59 - "assessment-ratio.ts"
Cohesion: 0.22
Nodes (9): Confidence, Cents, impliedMarketValueCents(), JURISDICTION_RATIOS, JurisdictionRatio, RatioInputs, resolveAssessmentRatio(), ResolvedRatio (+1 more)

### Community 60 - "Realestate Genius — Reuse Audit"
Cohesion: 0.22
Nodes (8): 3. `helixscales-audit`, 5. `pantheon-site`, Client-side, Dominant stack & conventions across the family, Realestate Genius — Reuse Audit, Recommended sequence, SQL migrations, Top 10 highest-value lifts, ranked by impact

### Community 61 - "demo-data.ts"
Cohesion: 0.33
Nodes (6): POST(), GET(), DEFAULT_LISTING_ID, DEMO_LISTINGS, getListing(), ListingRecord

### Community 62 - "TaskChecklist.tsx"
Cohesion: 0.33
Nodes (8): DueChip(), STATUS_META, TaskChecklist(), TaskView, daysBetween(), DealTaskRow, DealTaskStatus, summarizeTasks()

### Community 63 - "deals/route.ts"
Cohesion: 0.38
Nodes (6): CreateBody, GET(), isSchemaError(), POST(), DEAL_KINDS, DealKind

### Community 64 - "1. `realestate-genius-design\SCHEMA.sql` — the main event"
Cohesion: 0.33
Nodes (6): 1. `realestate-genius-design\SCHEMA.sql` — the main event, Section 12 — payments, and why the ledger is not over-engineering, Section 7 — the generalization that matters, Section-by-section, The five design rules it encodes (header, lines 14-38), What is missing from the schema

### Community 65 - "4. `vitaforge-property-alerts`"
Cohesion: 0.33
Nodes (6): 4. `vitaforge-property-alerts`, Adapt with fixes, Known bugs — do not carry forward, Liftable, Nothing to lift — build fresh, Skip

### Community 66 - "NOW — Realestate-genius current truth"
Cohesion: 0.40
Nodes (4): Goal, In flight, Known facts / constraints, NOW — Realestate-genius current truth

### Community 67 - "CLAUDE.md"
Cohesion: 0.40
Nodes (4): Map (from the Forge Atlas Graphify build, 2026-10-13), Memory protocol (auto, every task — do not wait to be asked), Read order (Claude and Grok), Working rules

### Community 68 - "2. `profx-trading`"
Cohesion: 0.40
Nodes (5): 2. `profx-trading`, Auth flow (`app.html:7415-7808`), Client-side math — `app.html:1437-2260`, Netlify functions — the best server code in the account, Other

### Community 69 - "SECURITY FINDINGS"
Cohesion: 0.40
Nodes (5): Findings requiring action, SECURITY FINDINGS, Verified clean, Verified safe (no action), key()

### Community 70 - "frustum-check.mjs"
Cohesion: 0.40
Nodes (3): aspects, drags, three

### Community 71 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, start

### Community 73 - "eslint.config.mjs"
Cohesion: 0.50
Nodes (3): eslintConfig, eslint, eslint-config-next

### Community 74 - "README.md"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 75 - "callback/route.ts"
Cohesion: 0.83
Nodes (3): GET(), isEmailOtpType(), resolveOrigin()

## Knowledge Gaps
- **10 isolated node(s):** `@stripe/stripe-js`, `stripe`, `@netlify/plugin-nextjs`, `@tailwindcss/postcss`, `@types/node` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 684 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `motion`, `package.json`, `pricing.ts`, `ai/analyze/route.ts`, `lucide-react`, `search/page.tsx`, `property/analyze/route.ts`, `tour-mapper.ts`, `callback/route.ts`, `ThemeProvider.tsx`, `DealRoomCard.tsx`, `[addressId]/page.tsx`, `proxy.ts`, `deals/_data.ts`, `demo-data.ts`, `createClient`, `deals/route.ts`?**
  _High betweenness centrality (0.209) - this node is a cross-community bridge._
- **What connects `@stripe/stripe-js`, `stripe`, `@netlify/plugin-nextjs` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `next` be split into smaller, more focused modules?**
  _Cohesion score 0.0578790141896938 - nodes in this community are weakly interconnected._
- **Why does `pg` connect `migrate.mjs` to `package.json`, `ingest.mjs`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **Should `motion` be split into smaller, more focused modules?**
  _Cohesion score 0.061419753086419754 - nodes in this community are weakly interconnected._
- **Why does `cn()` connect `cn` to `next`, `motion`, `pricing.ts`, `opportunity.ts`, `EdgeSection.tsx`, `Hero.tsx`, `[addressId]/page.tsx`, `primitives.tsx`, `AssistantChat.tsx`, `createClient`, `deals/_data.ts`, `deals.ts`, `utils.ts`, `variants.ts`, `formatCents`, `RoleBadge.tsx`, `ScoreCard.tsx`, `DealRoomCard.tsx`, `PermitTimeline.tsx`, `TaskChecklist.tsx`, `CLAUDE.md`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Should `discover-arcgis.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05964912280701754 - nodes in this community are weakly interconnected._