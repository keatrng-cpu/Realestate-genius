# Realestate Genius — Competitive Gaps

**Written:** 2026-08-06
**Companion to:** `../../realestate-genius-design/{ARCHITECTURE,FEATURES,SCHEMA.sql,DATA_SOURCES,OPEN_QUESTIONS}.md`, `REUSE-AUDIT.md`

This is not a flattering report. Every price and claim below is either fetched from a primary source with the URL attached, or marked **UNVERIFIED**. Nothing is recalled from memory.

---

## 0. The four findings that change the plan

1. **Stripe's ACH pricing is disqualifying for rent.** Stripe charges 0.8% capped at $5.00 per ACH debit. Median gross rent is $980 in Grand Forks and $946 in Fargo, so *every* rent payment hits the $5.00 cap. Competitors charge tenants **$1.00–$2.50** for the same transaction, and three of them charge **$0**. The architecture commits to Stripe Connect and never costs an ACH debit. On these rails the payments feature loses money at any competitive price point. §5.

2. **The addressable market is ~12,400 units, and the price ceiling is set by flat-rate competitors at $144–199 per *year*, unlimited units.** Grand Forks + Fargo have 47,786 renter-occupied units, but 73.5% of them sit in 10+ unit buildings that already run AppFolio/Buildium/Entrata. The SMB-reachable segment (1–9 unit structures) is 12,443 units. A perfectly executed local landlord SaaS is a $60K–150K/yr business. It cannot fund the buyer-side build. §3, §5.

3. **The schema is missing the entire top of the landlord funnel and the entire bottom of the accounting stack.** No `applications`, no `documents`/e-sign, no `expenses`, no `vendors`, no `inspections`, no rental-vacancy listing model. TurboTenant's whole wedge is the free listing→application→lease funnel; Stessa's and Baselane's whole wedge is Schedule E. Both are absent from a 51-table schema that has a double-entry ledger. §4.

4. **The live landing page markets the blocked half of the product and cites two data sources the design explicitly excluded.** `realestate-genius.netlify.app` leads with *"Know everything before you offer"* and claims aggregation across "MLS, Zillow, Redfin." `OPEN_QUESTIONS.md` #10 excludes Zillow entirely (their terms forbid retaining copies) and recommends against scraping Redfin. It also advertises a "3D Walkthrough" feature that appears nowhere in `FEATURES.md`. Fix this before anyone from a portal's legal team reads it. §7.

---

## 1. Competitive teardown — landlord/tenant

All figures fetched 2026-08-06 from vendor pricing pages. **Every vendor listed publishes a free tier except AppFolio, Buildium, and DoorLoop.**

### 1.1 Software pricing

| Vendor | Structure | Price | Minimum / cap | Source |
|---|---|---|---|---|
| **TurboTenant** | Flat, unlimited units | Free · Essentials **$149/yr** ($12.42/mo) · Pro **$199/yr** ($16.58/mo) | None. "Same price no matter your door count" | [turbotenant.com/pricing](https://www.turbotenant.com/pricing/) |
| **Innago** | Free | **$0** — "No Setup Fee, No Monthly Fee, No Contract" | None | [innago.com/pricing](https://innago.com/pricing/) |
| **RentRedi** | Flat, unlimited units | **$29.95/mo** monthly · **$20/mo** semi-annual · **$12/mo** annual ($144/yr) | None | [rentredi.com/pricing](https://rentredi.com/pricing/) |
| **Avail** | Per unit | Unlimited **$0/unit** · Unlimited Plus **$9/unit/mo** | None stated | [avail.co/pricing](https://www.avail.co/pricing) |
| **Stessa** | Flat | Essentials free · Manage **$12/mo** annual ($15 monthly) · Pro **$28/mo** annual ($35 monthly) | Unlimited properties all plans | [stessa.com/pricing](https://www.stessa.com/pricing/) |
| **Baselane** | Flat | Core **$0** · Smart **$20/mo** | $0 minimum balance | [baselane.com/pricing](https://www.baselane.com/pricing/) |
| **Hemlane** | **Platform fee + per unit** | Starter free · Basic **$28 + $2/unit** ($30/mo min) · Essential **$28 + $20/unit** · Complete **$28 + $58/unit** | **$28/mo effective floor** on any paid tier | [hemlane.com/pricing](https://www.hemlane.com/pricing) |
| **DoorLoop** | Flat with unit caps | Starter **$69–99/mo** (**max 10 units**) · Pro **$149–189/mo** · Premium **$209–239/mo** | **Onboarding fee based on portfolio size** — amount NOT PUBLISHED | [doorloop.com/pricing](https://www.doorloop.com/pricing) |
| **Buildium** | Flat, "starting at" | Essential **from $62/mo** · Growth **from $192/mo** · Premium **from $400/mo** | Enterprise (5,000+ units) NOT PUBLISHED | [buildium.com/pricing](https://www.buildium.com/pricing/) |
| **AppFolio** | NOT PUBLISHED | No price anywhere on the page | **"Minimum spend and 50 unit minimum apply"** (verbatim) | [appfolio.com/pricing](https://www.appfolio.com/pricing) |

**The binding constraint is not per-unit pricing — it is flat pricing.** A landlord with 8 units pays TurboTenant **$2.07/unit/month** or RentRedi **$1.50/unit/month**, both unlimited, or Innago **$0**. Any per-unit price above ~$2 has to justify itself against those three on the first sales call.

Per-unit *is* the norm at the top (AppFolio, Hemlane, Avail Plus, Buildium's effective economics), but Realestate Genius's target — the 1–9 unit local landlord — is served by the flat-rate tier. **Verify which segment you are actually selling to before choosing the unit.**

### 1.2 Payment economics — the part that decides the business

| Vendor | Tenant ACH fee | Tenant card fee | Who eats it |
|---|---|---|---|
| Hemlane | **$0** (all paid tiers) | 3% | Landlord/platform |
| TurboTenant | $2 free tier → **$0** premium | 3.49% | Renter |
| Avail | $2.50 free → **$0** on Plus ($9/unit) | 3.5% always | Renter |
| DoorLoop | $2.49 Starter → $0.99 Pro → $0 Premium | 3.25% | **"directly charged to tenants"** |
| Buildium | $2.35 → $1.35 → $0.60 by tier (outgoing EFT $0.99) | 2.99% | **NOT STATED on the pricing page — UNVERIFIED** |
| Stessa | $2 → **$0 if paid into a Stessa Cash Management account** | 3% | Tenant |
| Innago | $2 | 2.99% | Tenant by default; landlord may absorb |
| Baselane | $2 | 3.49% | Landlord's choice on ACH; tenant always on card |
| RentRedi | **$1.00** | 3.1% + $0.30 | Tenant by default; landlord may absorb |
| AppFolio | NOT PUBLISHED | NOT PUBLISHED | — |

Sources: vendor pricing pages above, plus [RentRedi convenience fees](https://help.rentredi.com/en/articles/4474091-convenience-fees-for-rent-payments), [Stessa fee FAQ](https://support.stessa.com/en/articles/12092570-stessa-rent-payment-convenience-fee-faqs), [Innago FAQ](https://innago.com/faq/), [DoorLoop additional fees](https://support.doorloop.com/en/articles/8065530-additional-fees-associated-with-doorloop).

**Three structural reads:**

- **ACH is simultaneously the loss-leader and the paywall.** Waiving the tenant's ACH fee is the single most common upsell mechanic in the category (TurboTenant, Avail, DoorLoop, Buildium all sell it that way).
- **Card pricing is a dead zone: 2.99%–3.5%, universally tenant-paid, at every vendor.** There is no differentiation available on cards. Don't try.
- **Stessa's and Baselane's "$0 ACH" is a deposit-gathering play, not a pricing concession** — Stessa's is conditional on rent landing in a Stessa Cash Management account paying up to 3.24% APY. That is a different business (net interest margin) wearing a software costume. Worth knowing you are not competing on the same P&L.

### 1.3 Why tenants care more than landlords think

Verified from [Multifamily Dive, 2024-04-03](https://www.multifamilydive.com/news/rent-payments-digital-check-processing-fees/712186/), citing Zego and SatisFacts data:

- Operators who **absorbed** ACH fees: **84.71%** digital payment utilization. Operators who **passed fees to residents**: **47%**.
- **84.2%** of renters ranked "pay rent online without incurring a service fee" as the most useful tech feature — and online payment *with* a fee as the **least** useful.
- **40%** of renters still pay by check or money order.
- ACH is **64.8%** of electronic rent transactions; debit/credit **22.4%**.

Caveat: this is April 2024 data drawn from multifamily portfolios of 1,000–5,000 units, not 1–9 unit landlords. Directionally strong, not a perfect analogue. **Marked as SECONDARY but from a trade publication citing named vendors, not SEO content.**

---

## 2. Competitive teardown — buyer/investor

*(pending — see §2 continued below)*

---

## 3. Where the incumbents are genuinely weak

*(pending)*

---

## 4. The wedge

### 4.1 What the operator actually has

Stripping the flattery: four assets, and only three of them are real advantages.

| Asset | Real? | Why |
|---|---|---|
| Owns rental property in Grand Forks; is user #1 | **Yes, and it is the strongest one** | Same-day feedback, no acquisition problem before the product is worth using, credibility with peer landlords |
| Free statewide ND parcel + tax-roll data with an API | **Yes** | [ND GIS Hub](https://gishubdata-ndgov.hub.arcgis.com/datasets/parcels-taxroll) publishes it free; Regrid's equivalent national product is sales-gated with **no published price** ([regrid.com/parcels](https://regrid.com/parcels)) |
| Deterministic scoring engine already built | **Partly** | It works and it is well-built, but it scores *listings*, and listings are the gated input. Its value is realized as analysis-by-address, not as search |
| A designed 51-table schema | **Yes, but** | It is the highest-value asset in the account per `REUSE-AUDIT.md`, and it is missing the top of the funnel and the accounting stack — §5 |

**The advantage that nobody names, and the one that matters:** free parcel + assessment data means you can **pre-build a landlord's entire portfolio from an address**. Units, year built, lot size, assessed value, parcel geometry, flood zone, permit history — no typing. Every competitor makes the landlord hand-enter it. This is the only structural advantage that produces a visible, immediate, first-90-seconds difference.

### 4.2 Candidates, ranked

| # | Wedge | Defensibility | Speed to first paying user | Incumbent copy difficulty |
|---|---|---|---|---|
| **W1** | **Zero-setup landlord OS: paste addresses, portfolio builds itself; every property carries a sourced intelligence panel and a city-specific compliance calendar** | **High** — requires per-county parcel ingestion and per-city ordinance reading. Cannot be bought off a shelf | **Fast** — founder is user #1; no gatekeepers; data already proven live | **Hard at 2-city scale, easy in aggregate.** Uneconomic for TurboTenant to model Grand Forks. But Deckard and iWorQ already sell rental-registry data products *to cities*, so the underlying layer is being aggregated by someone |
| W5 | By-the-room student-rental operations for the UND market (per-room rent rolls, roommate splits, semester cycles, occupancy-cap math) | Medium-high — the data model genuinely differs and incumbents avoid per-room complexity | Fast, *if* the founder's portfolio is student rentals | Hard — national tools assume one lease per unit and have chosen not to change that |
| W6 | Don't sell software — **use it.** Run property management as a service in Grand Forks; the software is an invisible margin advantage | Medium — the moat is operational, not technical | **Fastest, and by a wide margin** | Irrelevant — you are not competing with software companies |
| W3 | Buyer/investor intelligence: zoning headroom, ADU math, permit absence | High if it ever ships | Slow | Hard |
| W4 | AI landlord back office | Low | Medium | Trivial |
| W2 | Free ACH rent payments | None | Fast | Already done |

**Kill lines:**

- **W2 — dead on arrival.** Hemlane already offers $0 tenant ACH on every paid tier, and on Stripe's rails it costs *you* $5/unit/month to match (§6.2).
- **W3 — right product, wrong year.** Gated on a broker's signature you don't control and 10–20 days of ordinance modeling *per city*; every founder advantage evaporates the moment the audience is a consumer rather than a landlord.
- **W4 — a feature wearing a wedge costume.** EliseAI raised **$250M at a $2.2B valuation** in August 2025 ([businesswire](https://www.businesswire.com/news/home/20250820023566/en/EliseAI-Secures-$250M-Series-E-to-Automate-Healthcare-and-Housing-Hiring-Hundreds-to-Fuel-Expansion)) and hit **$200M ARR** by June 2026 ([businesswire](https://www.businesswire.com/news/home/20260610244988/en/EliseAI-Hits-$200M-ARR-After-Five-Consecutive-Years-of-100-Growth-Across-Housing-and-Healthcare)); every incumbent is shipping AI. Build it, don't lead with it.
- **W5 — real, but blocked by your own design.** `FEATURES.md` defers roommate split payments to Phase 4+, the "four or fewer unrelated occupants" figure is only **PARTIALLY VERIFIED** (a program page, not the ordinance), and occupancy rules keyed to "family" sit directly on a familial-status fair-housing tripwire (`FEATURES.md` §6.1). Revisit after W1 has users.

### 4.3 Recommendation: W1 — but be honest about which half does the work

**Ship the zero-setup landlord OS. Lead with onboarding speed, not with compliance.**

The temptation is to lead with the compliance calendar because it sounds defensible. It is defensible; it is also a *twice-a-decade* pain. Grand Forks inspects rentals on a **five-year cycle** ([City of Grand Forks Rental Inspections Program](https://www.grandforksgov.com/government/city-departments/building-safety/rental-inspections-program)) — real teeth (citation in municipal court, orders to vacate) but not a weekly reason to open an app. Fargo requires that rentals be **recorded with the Inspections Department at no cost**, enforcing the IPMC under Ordinance 31-0101, with fees and referral to the City Attorney only on non-response ([City of Fargo](https://fargond.gov/city-government/departments/inspections/rental-housing-inspections)). Neither is an acquisition hook on its own.

**Compliance is a retention feature. Onboarding speed is the acquisition hook. The intelligence panel is the demo.** Sequence the pitch that way:

1. *"Paste your addresses."* Portfolio materializes — units, year built, assessed value, lot, flood zone, permits — in seconds, each value showing its source and observation date. No competitor can do this.
2. *"Here's what your city requires and when."* CoC status and inspection-cycle dates per property. Sticky, and nobody national has it.
3. *"Now collect rent and run maintenance here."* The commodity layer, which is why they stay.

**Why this beats the alternatives on all three axes:** it uses the one asset that is free to you and expensive to everyone else; it needs no gatekeeper; and the founder is the first user, so the feedback loop is same-day.

### 4.4 The contrarian option you should price before dismissing

**W6 deserves a real number rather than a shrug.** TruHome Property Solutions, operating in Fargo and Grand Forks, publishes **10% of gross monthly receipts**, plus 50% of first month's rent on new leases and a $250–500 onboarding fee ([truhomeproperties.com](https://www.truhomeproperties.com/property-management-services)).

At Grand Forks' $980 median rent:

| Path | Units needed for ~$100K/yr |
|---|---|
| Management as a service at 10% | **~85 units** |
| Landlord SaaS at $6/unit/month | **~1,390 units — 11% of the entire two-city SMB rental stock** |

**Eighty-five managed units versus eleven percent market penetration.** W6 reaches the same revenue roughly an order of magnitude faster, requires no pricing fight against a $0 competitor, and turns the software from a product that must win a market into a cost advantage nobody can see or copy.

It is a labor business, not a passive one, and that is the honest trade. But if the goal is revenue in 2026 rather than a software asset in 2028, **W6 is the better first move, and W1 is what it justifies building.** They compose: managed units are your design partners, your reference customers, and your proof the software works before you charge a stranger for it.

---

## 5. Table stakes we are missing

*(pending)*

---

## 5. Pricing

### 5.1 The market you are actually pricing into

US Census ACS 2020–2024 5-year estimates, tables B25003 / B25032 / B25064, via [Census Reporter API](https://api.censusreporter.org/1.0/data/show/latest?table_ids=B25032&geo_ids=16000US3832060,16000US3825700):

| | Grand Forks city | Fargo city | Combined |
|---|---|---|---|
| Occupied housing units | 26,171 | 59,970 | 86,141 |
| **Renter-occupied** | **14,016** | **33,770** | **47,786** |
| — in 1-unit structures (det.+att.) | 1,967 | 3,704 | 5,671 |
| — in 2–4 unit structures | 1,332 | 2,408 | 3,740 |
| — **1–4 unit subtotal** | **3,299** | **6,112** | **9,411** |
| — in 5–9 unit structures | 1,148 | 1,884 | 3,032 |
| — **1–9 unit subtotal (the SMB segment)** | **4,447** | **7,996** | **12,443** |
| — in 10+ unit structures | 9,451 | 25,656 | **35,107 (73.5%)** |
| Median gross rent | **$980** | **$946** | — |

**Three-quarters of the rental stock is in buildings large enough to already be on AppFolio, Buildium, or Entrata, under contract, with a migration cost.** They are not the market. The reachable market is 12,443 units across both cities.

Sanity-check the revenue ceiling honestly:

| Price | 100% of SMB segment | 25% (dominant local position) | 10% (realistic) |
|---|---|---|---|
| $2/unit/mo | $299K/yr | $75K/yr | $30K/yr |
| $4/unit/mo | $597K/yr | $149K/yr | $60K/yr |
| $6/unit/mo | $896K/yr | $224K/yr | $90K/yr |

**A perfectly executed, locally dominant landlord SaaS in Grand Forks + Fargo is a $60K–150K/yr business.** That is real money for a solo founder and it is not enough to fund 45–70 focused days of zoning and MLS work on the buyer side. Price and sequence accordingly. This number is the single most important input to §6.

### 5.2 The payment-rails problem — verified, and not addressed anywhere in the design

Stripe's published US pricing, fetched 2026-08-06:

| Item | Cost | Source |
|---|---|---|
| ACH Direct Debit | **0.8%, capped at $5.00** | [stripe.com/pricing/local-payment-methods](https://stripe.com/pricing/local-payment-methods) |
| ACH failed payment | **$4.00** | same |
| ACH dispute | **$15.00**, non-refundable regardless of outcome | same |
| Domestic card | 2.9% + $0.30 | [stripe.com/pricing](https://stripe.com/pricing) |
| Connect, platform-set pricing | **$2.00 per monthly active account** + **0.25% + $0.25 per payout** | [stripe.com/connect/pricing](https://stripe.com/connect/pricing) |
| Financial Connections instant verification | $1.50 | [stripe.com/pricing](https://stripe.com/pricing) |
| ACH settlement | T+4 standard, T+2 if eligible | [docs.stripe.com/payments/ach-direct-debit](https://docs.stripe.com/payments/ach-direct-debit) |
| ACH disputes | **60 calendar days**, personal accounts; final and uncontestable; second dispute blocks the bank account | same |

**The cap binds on every single rent payment in this market.** 0.8% of $980 is $7.84, so the fee is $5.00. 0.8% of $946 is $7.57, so the fee is $5.00. The break-even where the cap starts binding is $625 of rent; both cities' median rents are 50%+ above it.

Worked example — a 6-unit landlord, all units at $950, all ACH, one payout per month, platform handling pricing:

```
ACH debits          6 × $5.00                     = $30.00
Connect MAA         1 × $2.00                     =  $2.00
Payout              0.25% × $5,700 + $0.25        = $14.50
                                              total $46.50/mo
                                          per unit  $7.75/mo
```

**$7.75 per unit per month in payment cost, before a line of code is paid for.** TurboTenant's *entire* landlord-facing price is $16.58/month for unlimited units, with the tenant paying $0–2 per ACH. RentRedi charges the tenant $1.00.

Shifting to Connect's "Stripe handles pricing" model removes the $2 MAA and the payout fee, but then the landlord's connected account pays Stripe's 0.8%/$5 directly — $5/unit/month straight out of the landlord's pocket. The landlord notices. It is the first thing they will compare.

**Conclusion: percentage-priced ACH is the wrong rail for rent, and nothing in `ARCHITECTURE.md` §7 acknowledges it.** The architecture correctly reasons about card fees ("~$36 on a $1,200 rent and nobody absorbs that") and about settlement, disputes, and mandates — but never costs an ACH debit.

**The alternative, verified:** [Moov](https://moov.io/pricing/) publishes flat ACH pricing — **25¢ next-day credit, 40¢ same-day**, $5.00 per return, $15.00 unauthorized return, with a **$500/month minimum** on standard pricing. Dwolla no longer publishes pricing at all ([dwolla.com/pricing](https://www.dwolla.com/pricing/) — "Custom pricing… contact sales"), so its rates are **UNVERIFIED**.

Break-even between Stripe and Moov: `$500 ÷ ($5.00 − $0.40)` ≈ **109 rent payments per month**.

### 5.3 Recommendation

**Unit: per occupied unit per month, billed to the landlord.** Per-unit is the norm at the top of the market and it is the honest unit (cost scales with units, not with landlords). But price it knowing that flat-rate competitors set a hard ceiling around $2/unit/month for a price-shopping landlord — so **do not sell to price-shoppers.** Sell the local compliance and intelligence layer, which nobody else has, and price above the category.

**Launch pricing:**

| Tier | Price | Contents |
|---|---|---|
| **Free — "Property Record"** | $0, unlimited units | Property intelligence panel (parcel, assessment, permits, FEMA, zoning district, schools — every value with source + `observed_at`), rental-compliance calendar (Grand Forks CoC / inspection cycle, Fargo IPMC), document vault. **No payments, no tenant portal.** |
| **Operate** | **$6 / occupied unit / month, $30/month minimum** | Everything above + leases, tenant portal, maintenance with the emergency path, messaging, rent invoicing and collection, ledger, deposit deadline computation |
| **Portfolio** | **$5 / occupied unit / month above 25 units**, capped at $250/month | Adds team roles, owner statements, exports |

**Invert the category's free/paid split.** Every competitor gives away the *listing and application funnel* and charges for *payments*. You have neither a listing funnel nor competitive payment rails. What you have — for free, from [ND GIS Hub's statewide parcel/taxroll feed](https://gishubdata-ndgov.hub.arcgis.com/datasets/parcels-taxroll) — is the intelligence layer everyone else pays for. **Give away the thing that is free to you and that no competitor has locally; charge for the operations layer.** That is a defensible free tier rather than a loss-leader.

**Payment fee structure, sequenced:**

1. **Launch (0–~100 units):** tenant pays a **flat $3.00 disclosed ACH fee**; card at **3.5%, tenant-paid** (category norm, no differentiation available). $3.00 is above the $1–2.50 category norm and you should say why: it is what the rail costs until volume. It still nets you −$2/payment against Stripe's $5, absorbed as customer-acquisition cost. **Do not advertise free ACH at launch — on Stripe's rails it costs you $5/unit/month and you will not notice until it is 40 units deep.**
2. **At ~110 payments/month:** migrate to flat-fee ACH rails. Break-even is arithmetic, not judgment.
3. **Post-migration:** **tenant ACH goes to $0** and that becomes the announcement, the referral engine, and per the Zego data the difference between **47%** and **84.71%** digital utilization. Hold this back deliberately as the growth unlock rather than burning it on day one.

**Do not absorb card fees. Ever.** 3.5% of $980 is $34.30. No one in the category absorbs it and the economics are not close.

**Model the dispute exposure explicitly before launch.** ACH disputes run 60 calendar days, are final, and cost $15 plus the full rent amount clawed back from the platform balance. One disputed $980 payment costs $995. At 12,443 addressable units even a 0.1% monthly dispute rate on 200 units is ~$2,400/yr — survivable, but it must be in the terms of service before the first one, not after. `OPEN_QUESTIONS.md` #6 flags this and it is still unanswered.

---

## 6. The uncomfortable question: one product or two companies?

### The case for one company

- **The spine is genuinely shared.** `addresses`, `parcels`, `property_facts`, `permits`, `hazards`, `assessments` serve both products from the same rows. That is not a rationalization — it is already built in `SCHEMA.sql` and it is the single strongest argument.
- **The free ND data pipeline is a fixed cost amortized across both.** Ingesting Grand Forks County parcels costs the same 3–5 days whether one product or two consumes it.
- **Landlords buy property.** The founder is the proof: the investor and the landlord are the same person. A landlord product is a distribution channel for buyer intelligence at near-zero CAC — the opposite of the buyer product's problem, which is that it has no audience.
- **The property intelligence panel (`FEATURES.md` 2.3) is literally the buyer product rendered for an owner.** Same code, same data, different heading.
- One brand is easier than two in a market of 200,000 people.

### The case for two companies

- **Different gatekeepers, and only one product has any.** The landlord side has none. The buyer side requires MLS broker sponsorship — RMLS rules state third-party access is *"derivative of the rights of the Participant"* with enforcement up to $15,000, and whether Fargo is licensable at all through NorthstarMLS post-CDP is **UNVERIFIED and blocking for half the launch market** (`OPEN_QUESTIONS.md` #11).
- **Different regulatory regimes needing different counsel.** Landlord: money transmission, state landlord-tenant law, FCRA if screening is ever added. Consumer buyer: Fair Housing Act disparate impact, steering, advertising targeting, AVM rules. These do not share a compliance program.
- **Different sales motions.** Landlord: twenty in-person conversations in Grand Forks. Buyer: SEO, content, paid acquisition, thousands of sessions to find a handful of investors.
- **Different cadence.** `FEATURES.md` puts a usable landlord product at ~65 focused days and the full intelligence product at 120–160 with the widest error bars in the plan. The 45–70 days spent on zoning and MLS are 45–70 days not spent getting the landlord product to its first 100 units.
- **The buyer side has none of the founder's structural advantages.** Owning rental property in Grand Forks, being user #1, and having a working scoring engine buy you nothing with a broker or with a consumer audience.

### Position

**It is two companies, and you should only run one of them for the next twelve months — but the split is not where you drew it.**

The correct seam is not *buyer vs. landlord*. It is **search vs. analysis**:

- **Search** — "show me every property in Grand Forks matching my buy box" — requires MLS/IDX, is blocked on a broker's goodwill, has no timeline you control, and if pointed at consumers triggers the entire fair-housing regime.
- **Analysis** — "here is everything knowable about *this* address: parcel, assessment, permit history and permit *absence*, flood zone, zoning district, occupancy math, cost of ownership" — requires **none of that.** Every input is free public data you already have. The user supplies the address.

**Analysis is the differentiator. Search is the commodity that happens to be gated.** The design has them fused because the inherited pipeline was built search-first, and that is the single most expensive assumption in the plan.

So: ship **analysis-by-address inside the landlord product**, aimed at landlords evaluating an acquisition. It needs no MLS, no zoning modeling to start, no consumer fair-housing review (the audience is investors, not homebuyers, so `scoring_factors.consumer_safe` and the documented disparate-impact review can wait until there is a consumer). It is the same panel a landlord already sees for the properties they own, pointed at one they don't.

Defer search — and the consumer product entirely — until either a broker signs or the landlord product is paying for itself. Send the Julie Vorachek sponsorship email this week anyway, because it costs an hour and the clock on it is measured in months; just don't sequence anything behind it.

**Concretely:** retire the current landing page. *"Know everything before you offer"* sells search to a consumer audience you cannot serve, cites Zillow and Redfin as sources the design excludes on ToS grounds, and buries the only shippable product as feature #6.

---

## 7. Fix this week

*(pending)*
