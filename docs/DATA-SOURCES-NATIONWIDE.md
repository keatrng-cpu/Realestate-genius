# Nationwide parcel & zoning data sources — what we verified

Generated `2026-08-07T16:49:05.579Z` by `scripts/discover/discover-arcgis.mjs`. Do not hand-edit — re-run the crawler.

## What this file answers

"Which US cities and counties can we ingest tomorrow, for free, and how good is each one?"
Every row below was probed live: the service responded, we read its field list, we counted its
records, and where a zoning field exists we sampled 25 rows to confirm the column is actually
populated rather than an empty placeholder.

## The one thing to not misread

**A high score does not mean we have zoning standards for that jurisdiction.**

These sources give geometry and attributes — where the parcel is, what district it sits in, how
wide the lot is. They do **not** give the ordinance: setbacks, height limits, FAR, lot coverage,
parking minimums, ADU rules. That text lives in prose in the municipal code and takes a human
roughly **16–34 hours per jurisdiction** to extract reliably. Every registry entry carries
`providesDimensionalStandards: false` as a literal so nothing downstream can quietly assume
otherwise.

The automatable half is free and wide. The expensive half is per-jurisdiction human labour.

### One honest exception, and it is small

**36** of 1637 sources (2.2%) carry columns that look like dimensional standards — a few jurisdictions join a slice of their ordinance table onto the zoning layer. Observed field names include:

`Zoning2__Minimum_Size` ×9, `Zoning2__Minimum___Open_Space` ×9, `Zoning2__Front_Setback__ft_` ×9, `Zoning2__All_Other_Setbacks__ft_` ×7, `Zoning__Minimum_Size` ×7, `Zoning__Minimum___Open_Space` ×7, `Zoning__Front_Setback__ft_` ×7, `Zoning__All_Other_Setbacks__ft_` ×7, `FAR` ×5, `Public_Works_Setback_Zone` ×3, `Height_Limit_Overlay` ×3, `Height_Limit_1_Overlay` ×3

These are listed per entry in `partialStandardsFields`. They are a **partial, unverified subset of
one ordinance** — typically front setback and minimum lot size, never the full rule set, and never
the conditional cases. They do not flip `providesDimensionalStandards`, and they do not remove the
human read. What they do is tell you which jurisdictions are cheapest to start with.

## Headline numbers

| Measure | Value |
| --- | --- |
| Services probed live | 2,610 |
| Layers inspected | 3,306 |
| **Verified, ingestible sources** | **1,637** |
| Distinct jurisdictions | 827 |
| States + DC represented | 51 / 51 |
| Parcel-level **with zoning joined** (the Fargo class) | 495 |
| Zoning-district boundaries only | 509 |
| Parcels only, no zoning attribute | 633 |
| Total parcel/district records reachable | 259,973,533 |
| Statewide aggregators | 233 |
| Duplicate endpoints collapsed | 93 |

### How the three kinds split

Only **30.2%** of verified sources are parcel-level with zoning joined — the shape that is immediately useful without a spatial join. **Most parcel layers do not carry zoning at all.**

| Kind | Sources | Share | What it costs you |
| --- | ---: | ---: | --- |
| `parcel_with_zoning` | 495 | 30.2% | Nothing. Ingest and use. |
| `zoning_districts` | 509 | 31.1% | Needs a spatial join against a parcel layer for that jurisdiction. |
| `parcels_only` | 633 | 38.7% | Needs a separate zoning source, then a spatial join. |

Of the 495 joined sources, **203** are classified `inferred` rather than `high`: they carry a populated zoning attribute and far too many polygons to be a district map, but no owner, APN or situs-address column to prove parcel granularity. Check those before relying on them.

## Honest coverage against the national universe

Denominators from US Census Bureau TIGERweb, queried live during this crawl:

- **19,731** incorporated places
- **3,235** counties and county equivalents

We verified **827 distinct jurisdictions**. Against incorporated places alone that is **4.2%**. That is the honest number and it is small.

Three caveats that cut in both directions:

1. **Downward.** Jurisdiction names are derived from publisher metadata and Census geography (see
   below), so the distinct-jurisdiction count is approximate. Some rows are the same city under two
   names; some are labelled only to county level.
2. **Upward.** Statewide and county-wide layers cover many municipalities from one endpoint. A
   single statewide parcel service can carry every place in that state.
3. **Upward, and this is the big one.** This crawl is time-boxed. It probed a prioritised slice of
   the candidate pool, not all of it. The ceiling is much higher than what is in this file — the
   crawler is resumable and re-running it extends the registry without redoing finished work.

### How jurisdiction names were established

| Method | Sources |
| --- | ---: |
| Publisher metadata (ArcGIS org name, attribution, title) | 1080 |
| Census incorporated place containing the layer footprint | 210 |
| County only — jurisdiction could not be resolved | 347 |

Names resolved from a Census place carry `jurisdictionFromCensusPlace: true`. They describe the
territory the data covers, which is not necessarily the body that adopted the zoning — a county
may zone unincorporated land inside a city's bounding box. Treat those names as geographic.
The publisher of record is always in `publisherOrg`, resolved from the ArcGIS organisation that
hosts the service.

Most US municipalities publish nothing machine-readable at all. Small towns typically have a PDF
zoning map and no GIS server. Coverage is heavily biased toward larger cities and toward states
with a statewide GIS program.

## How these were discovered

| Channel | Sources | What it reaches |
| --- | ---: | --- |
| ArcGIS Online item search | 1536 | Everything registered as an AGO item — mostly Esri-hosted `services*.arcgis.com` |
| ArcGIS Hub DCAT-US feeds | 100 | Hub site catalogues, which list **self-hosted** ArcGIS Server endpoints the item search never indexes |
| Hand-verified seed | 1 | `scripts/discover/seeds.json` — jurisdictions with no AGO presence at all, like Fargo |

**217** of 1637 sources (13.3%) live on a jurisdiction's own ArcGIS Server rather than Esri hosting. Those are invisible to item search alone — the DCAT pass is what finds them, and it is the reason the crawler has three channels rather than one.

## Access and licence — what "free" actually means here

| | Count | Share |
| --- | ---: | ---: |
| Sources requiring a token or key | 0 | 0% — tokened services are excluded from the registry |
| Services that returned a token error during the crawl | 67 | 2.6% of probed |
| Registry entries carrying any licence text | 831 | 50.8% |
| …an explicit open licence (CC / public domain / open data) | 70 | 4.3% |
| …a liability disclaimer rather than a use restriction | 285 | 17.4% |

The dominant pattern is *no stated licence at all*, and where text exists it is almost always an
accuracy disclaimer ("not for legal or survey use", "no warranty as to completeness") rather than a
restriction on use. That is permissive in practice but it is **not** an explicit grant. Before
commercialising any specific jurisdiction's data, read the `licenseInfo` field on that entry.

Under 4% of probed services demanded a token. Publishing parcel and zoning data openly is the norm,
not the exception — the constraint on national coverage is which jurisdictions publish at all, not
whether the published ones are gated.

## Score distribution

| Band | Sources | Share |
| --- | ---: | ---: |
| 90-100 | 5 | 0.3% |
| 70-79 | 15 | 0.9% |
| 60-69 | 105 | 6.4% |
| 50-59 | 268 | 16.4% |
| 40-49 | 126 | 7.7% |
| 30-39 | 208 | 12.7% |
| 0-29 | 910 | 55.6% |

Median **28**, p75 **49**, p90 **57**, max **95**.

### The rubric

| Component | Max points | Why |
| --- | ---: | --- |
| Parcel-level with zoning joined | 40 | The only shape that is per-parcel useful with no extra work |
| …zoning districts only | 18 | Needs a spatial join before it is per-parcel useful |
| …parcels only | 12 | Geometry and ownership, no district |
| PUD flag | 8 | Planned developments override base zoning; without this the base code lies |
| Conditional-use flag | 8 | Same reason |
| Lot width | 5 | Feasibility maths needs the dimension, not just the area |
| Lot depth | 5 | Same |
| Lot area | 4 | Weaker signal; almost universally present |
| Record count | 10 | log-scaled, full marks at ≥20,000 records |
| Structure attributes | 10 | year built / units / building sqft / assessed value |
| Identity attributes | 5 | owner / situs address / legal description |
| Freshness | 5 | Service reports an edit within 12 months |

Calibration: **City of Fargo, ND** — https://gis.cityoffargo.com/arcgis/rest/services/General/Zoning/MapServer/0

Fargo scores **95/100** in this run (38,857 records, zoning `Zone1`, PUD `PUDNo`, CUP `cup`, width `WidthFront`, depth `Depth1`). It is the reference the rubric is tuned against.

### Fargo is an outlier, not a template

Across every verified source, the attributes that make Fargo valuable are rare:

| Attribute | Sources that have it |
| --- | ---: |
| `zoning_code` | 1040 (63.5%) |
| `lot_area` | 632 (38.6%) |
| `lot_depth` | 52 (3.2%) |
| `lot_width` | 40 (2.4%) |
| `pud_flag` | 43 (2.6%) |
| `cup_flag` | 14 (0.9%) |

Lot **width** and the PUD / conditional-use flags are the scarcest fields in US municipal GIS, and
they are exactly the ones feasibility maths needs — a PUD silently overrides the base zoning code,
so a source without that flag will confidently return the wrong answer on those parcels. Do not
design the ingestion schema assuming the Fargo field set is typical. It is not.

## Top 50 by score

| # | Score | Jurisdiction | ST | Kind | Records | Layer URL |
| ---: | ---: | --- | --- | --- | ---: | --- |
| 1 | 95 | City of Fargo | ND | parcel+zoning | 38,857 | `https://gis.cityoffargo.com/arcgis/rest/services/General/Zoning/MapServer/0` |
| 2 | 95 | City of Fargo | ND | parcel+zoning | 37,843 | `https://services6.arcgis.com/SAzG4Xt2MtnnJdpJ/arcgis/rest/services/Parcel_Maps_WFL1/FeatureServer/2` |
| 3 | 95 | City of Fargo | ND | parcel+zoning | 37,696 | `https://services6.arcgis.com/SAzG4Xt2MtnnJdpJ/arcgis/rest/services/Parcel_Maps_WFL1/FeatureServer/4` |
| 4 | 95 | City of Fargo | ND | parcel+zoning | 32,417 | `https://services6.arcgis.com/SAzG4Xt2MtnnJdpJ/arcgis/rest/services/Parcel_Maps_WFL1/FeatureServer/0` |
| 5 | 92 | City of Fargo | ND | parcel+zoning | 770 | `https://services6.arcgis.com/SAzG4Xt2MtnnJdpJ/arcgis/rest/services/Parcel_Maps_WFL1/FeatureServer/8` |
| 6 | 79 | City of Tustin | CA | parcel+zoning | 19,620 | `https://services8.arcgis.com/omhBSxytABi3T0US/arcgis/rest/services/Tustin_Base_Data/FeatureServer/5` |
| 7 | 77 | City of Texas City | TX | parcel+zoning | 25,244 | `https://services7.arcgis.com/2iAOv9D7729Bn31m/arcgis/rest/services/City_Zoning_Districts_ReadOnly_view/FeatureServer/0` |
| 8 | 75 | Anne Arundel County (jurisdiction unresolved) | MD | parcel+zoning | 1,411,877 | `https://services1.arcgis.com/X3lKekbdaBmNjCHu/arcgis/rest/services/ParcelsforApprovedCounties/FeatureServer/1` |
| 9 | 75 | Jefferson County, Missouri | MO | parcel+zoning | 100,888 | `https://services1.arcgis.com/Ur3TPhgM56qvxaar/arcgis/rest/services/UDO_Zoning/FeatureServer/1` |
| 10 | 75 | City of Salisbury | MD | parcel+zoning | 48,656 | `https://services6.arcgis.com/Hx8jJ6McXQ0jnqLk/arcgis/rest/services/Parcels1/FeatureServer/12` |
| 11 | 74 | Los Angeles County (jurisdiction unresolved) | CA | parcel+zoning | 49,028 | `https://services1.arcgis.com/SPm6TOk52QjLKxth/arcgis/rest/services/Land_Base/FeatureServer/95` |
| 12 | 74 | City of Bismarck | ND | parcel+zoning | 27,640 | `https://services1.arcgis.com/XxHmL09eFqJWI0gE/arcgis/rest/services/ParcelsPublic/FeatureServer/0` |
| 13 | 72 | Los Angeles County (jurisdiction unresolved) | CA | parcel+zoning | 2,819 | `https://services1.arcgis.com/SPm6TOk52QjLKxth/arcgis/rest/services/Land_Base/FeatureServer/90` |
| 14 | 71 | City of Madison | WI | parcel+zoning | 81,809 | `https://services.arcgis.com/qvVnajWeXlTaQQu1/arcgis/rest/services/Madison_WI_City_Parcels_(80000_polygons)/FeatureServer/0` |
| 15 | 71 | City of Naperville | IL | parcel+zoning | 62,345 | `https://services1.arcgis.com/rXJ6QApc2sOtl1Pd/arcgis/rest/services/YourPlace_Parcels/FeatureServer/0` |
| 16 | 70 | Chesapeake Bay Foundation | VA | parcel+zoning | 56,432 | `https://services5.arcgis.com/pGIpkO9l9XlmojjG/arcgis/rest/services/Solar_Siting_Scores_MD_Statewide/FeatureServer/0` |
| 17 | 70 | City of Gainesville | FL | parcel+zoning | 45,620 | `https://services2.arcgis.com/Zzhtlau4ccHkQgTu/arcgis/rest/services/Gainesville_Parcels_35/FeatureServer/0` |
| 18 | 70 | Warren County (jurisdiction unresolved) | OH | parcel+zoning | 12,090 | `https://services1.arcgis.com/vV4gRvVCTYLVB8jU/arcgis/rest/services/Hamilton_Township_Zoning_Parcels_view/FeatureServer/0` |
| 19 | 70 | City of Lockport | NY | parcel+zoning | 8,114 | `https://services1.arcgis.com/yisUfwZZ4fyubK3R/arcgis/rest/services/Lockport_Zoning/FeatureServer/0` |
| 20 | 70 | City of New York | NY | parcel+zoning | 3,871 | `https://services.arcgis.com/VXxCfMpXUKuFKFvE/arcgis/rest/services/BronxVacantparcels/FeatureServer/0` |
| 21 | 69 | City of Balch Springs | TX | parcel+zoning | 34,582 | `https://services5.arcgis.com/HmZrfXtpyBP9VLYQ/arcgis/rest/services/Parcels_Zoning/FeatureServer/0` |
| 22 | 69 | Cass County | NE | parcel+zoning | 20,467 | `https://services3.arcgis.com/oIhWXTph9P1clNT3/arcgis/rest/services/Tax_Parcel/FeatureServer/0` |
| 23 | 69 | Cass County | NE | parcel+zoning | 20,467 | `https://services3.arcgis.com/oIhWXTph9P1clNT3/arcgis/rest/services/Tax_Parcels_(Cass_County)/FeatureServer/0` |
| 24 | 69 | Queen Anne's County (jurisdiction unresolved) | MD | parcel+zoning | 13,758 | `https://services6.arcgis.com/RWHujKM5TItecIqp/arcgis/rest/services/Parcel_Viewer_experience_builder/FeatureServer/0` |
| 25 | 69 | Queen Anne's County (jurisdiction unresolved) | MD | parcel+zoning | 13,755 | `https://services6.arcgis.com/RWHujKM5TItecIqp/arcgis/rest/services/Econ_Electric_parcel_viewer_layers/FeatureServer/20` |
| 26 | 69 | City of Santa Barbara | CA | parcel+zoning | 12,226 | `https://services3.arcgis.com/hMpg7vsYb74pEKjX/arcgis/rest/services/ODS_Zones_Webmap/FeatureServer/2` |
| 27 | 68 | DeKalb County GIS | GA | parcel+zoning | 246,602 | `https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services/Tax_Parcels_2025/FeatureServer/0` |
| 28 | 68 | DeKalb County GIS | GA | parcel+zoning | 246,442 | `https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services/Tax_Parcels_2024/FeatureServer/1` |
| 29 | 68 | DeKalb County GIS | — | parcel+zoning | 245,688 | `https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services/Tax_Parcels_2023/FeatureServer/2` |
| 30 | 68 | DeKalb County GIS | GA | parcel+zoning | 245,252 | `https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services/Tax_Parcels_2022/FeatureServer/3` |
| 31 | 68 | City of Syracuse | NY | parcel+zoning | 41,331 | `https://services.arcgis.com/uDTUpUPbk8X8mXwl/arcgis/rest/services/Parcel_Flood_Zone_Risk_Map_WFL1/FeatureServer/6` |
| 32 | 68 | City of Syracuse | NY | parcel+zoning | 41,331 | `https://services.arcgis.com/uDTUpUPbk8X8mXwl/arcgis/rest/services/Parcel_Flood_Zone_Risk_Map_3_WFL1/FeatureServer/6` |
| 33 | 68 | City of Syracuse | NY | parcel+zoning | 41,263 | `https://services6.arcgis.com/bdPqSfflsdgFRVVM/arcgis/rest/services/Syracuse_Parcel_Map_(2025_Q3)_view/FeatureServer/0` |
| 34 | 68 | City of Syracuse | NY | parcel+zoning | 38,466 | `https://services.arcgis.com/uDTUpUPbk8X8mXwl/arcgis/rest/services/Parcel_Flood_Zone_Risk_Map_WFL1/FeatureServer/12` |
| 35 | 68 | Los Angeles County (jurisdiction unresolved) | CA | parcel+zoning | 50 | `https://services1.arcgis.com/SPm6TOk52QjLKxth/arcgis/rest/services/Land_Base/FeatureServer/97` |
| 36 | 68 | City of Gilbert | AZ | parcel+zoning | 24 | `https://services1.arcgis.com/JLuzSHjNrLL4Okwb/arcgis/rest/services/Council_Request__Town_owned__Maricopa_owned__and_School_District_owned_Parcels_WFL1/FeatureServer/4` |
| 37 | 67 | Burlington, New Jersey County | NJ | parcel+zoning | 218,704 | `https://services1.arcgis.com/X3dmaNvzWUnemDAc/arcgis/rest/services/MOD4Parcels/FeatureServer/0` |
| 38 | 67 | City of Baltimore | MD | parcel+zoning | 159,839 | `https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/realprop_lulc_footprint/FeatureServer/0` |
| 39 | 67 | Linn County Iowa GIS | IA | parcel+zoning | 18,971 | `https://services.arcgis.com/i14SLLmXo7Hn9vNc/arcgis/rest/services/PlanningRuralZoning/FeatureServer/0` |
| 40 | 67 | City of Forest Grove, Oregon | OR | parcel+zoning | 7,788 | `https://services5.arcgis.com/h6jGBY6OUzMBTZcz/arcgis/rest/services/Zoning_By_Parcels/FeatureServer/0` |
| 41 | 67 | City of Wyoming Public Works | MN | parcel+zoning | 3,457 | `https://services6.arcgis.com/CWUB5LdQqLSWLhLO/arcgis/rest/services/Wyoming_Interactive_Zoning_Map/FeatureServer/3` |
| 42 | 67 | City of Wyoming Public Works | MN | parcel+zoning | 2,226 | `https://services6.arcgis.com/CWUB5LdQqLSWLhLO/arcgis/rest/services/Wyoming_Interactive_Zoning_Map/FeatureServer/0` |
| 43 | 67 | City of Gilbert | AZ | parcel+zoning | 10 | `https://services1.arcgis.com/JLuzSHjNrLL4Okwb/arcgis/rest/services/Council_Request__Town_owned__Maricopa_owned__and_School_District_owned_Parcels_WFL1/FeatureServer/0` |
| 44 | 66 | King County | WA | parcel+zoning | 628,567 | `https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_EXTR_213/FeatureServer/0` |
| 45 | 66 | City of Sunland Park | TX | parcel+zoning | 7,663 | `https://services5.arcgis.com/4MEMBPMfRkN9N7wp/arcgis/rest/services/Sunland_Park_Zoning/FeatureServer/0` |
| 46 | 66 | Middlesex County (jurisdiction unresolved) | MA | parcel+zoning | 7,659 | `https://services5.arcgis.com/BGG0OHtiXRaYFSqx/arcgis/rest/services/Burlington_Zoning_Map_WFL1/FeatureServer/8` |
| 47 | 66 | City of Syracuse | NY | parcel+zoning | 1,614 | `https://services.arcgis.com/uDTUpUPbk8X8mXwl/arcgis/rest/services/Parcel_Flood_Zone_Risk_Map_WFL1/FeatureServer/4` |
| 48 | 66 | City of Wyoming Public Works | MN | parcel+zoning | 1,026 | `https://services6.arcgis.com/CWUB5LdQqLSWLhLO/arcgis/rest/services/Wyoming_Interactive_Zoning_Map/FeatureServer/2` |
| 49 | 66 | Cass County | NE | parcel+zoning | 1,021 | `https://services3.arcgis.com/oIhWXTph9P1clNT3/arcgis/rest/services/ROW/FeatureServer/0` |
| 50 | 66 | Talbot County | MD | parcel+zoning | 668 | `https://services2.arcgis.com/I9cUOJUZvdGAJncI/arcgis/rest/services/Talbot_County_Flood_Susceptible_Cities_WFL1/FeatureServer/6` |

## Statewide aggregators — the highest-leverage sources

One endpoint that covers every jurisdiction in a state is worth far more than one city. A layer
qualifies here when its footprint covers ≥55% of the state's bounding box (measured against real
Census TIGERweb state extents) or the publisher labels it statewide.

| Score | ST | Kind | Records | State coverage | Layer URL |
| ---: | --- | --- | ---: | ---: | --- |
| 70 | VA | parcel+zoning | 56,432 | title | `https://services5.arcgis.com/pGIpkO9l9XlmojjG/arcgis/rest/services/Solar_Siting_Scores_MD_Statewide/FeatureServer/0` |
| 65 | CT | parcel+zoning | 1,282,833 | 97% | `https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0` |
| 65 | CT | parcel+zoning | 37,679 | 97% | `https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer_Public_Parcels/FeatureServer/0` |
| 65 | IA | parcel+zoning | 2,723 | 97% | `https://services.arcgis.com/XORNS2fPFySPlBgy/arcgis/rest/services/zoning_districts_all_data_v2/FeatureServer/217` |
| 63 | DC | parcel+zoning | 138,594 | 100% | `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCOZ/Zone_Mapservice/MapServer/56` |
| 62 | NE | parcel+zoning | 1,133,295 | 100% | `https://services8.arcgis.com/jzdN07B7ZhRTxuzU/arcgis/rest/services/Layers_Data_WFL1/FeatureServer/29` |
| 60 | NE | parcel+zoning | 1,154,898 | title | `https://gis.ne.gov/Enterprise/rest/services/StatewideParcelsExternal/FeatureServer/0` |
| 60 | MA | parcel+zoning | 17 | title | `https://services6.arcgis.com/euKKjtGUuDiy24vy/arcgis/rest/services/Exploring_Densities_MF_Housing_Sites/FeatureServer/0` |
| 57 | CA | parcel+zoning | 13,147,243 | 100% | `https://services2.arcgis.com/zr3KAIbsRSUyARHG/arcgis/rest/services/CA_State_Parcels/FeatureServer/0` |
| 57 | OR | parcel+zoning | 9,831 | 100% | `https://services5.arcgis.com/W1uyphp8h2tna3qJ/arcgis/rest/services/Coos_Bay_SLR/FeatureServer/8` |
| 55 | WA | parcel+zoning | 470,130 | 100% | `https://services6.arcgis.com/tboeqGwETr5ppr5Q/arcgis/rest/services/WAZA_Prototype_Layers/FeatureServer/0` |
| 55 | RI | parcel+zoning | 15,733 | 91% | `https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/RI_Zoning/FeatureServer/1` |
| 52 | RI | parcel+zoning | 1,639 | 91% | `https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/RI_Zoning/FeatureServer/0` |
| 51 | DC | parcel+zoning | 1,088 | 100% | `https://services1.arcgis.com/HbzrdBZjOwNHp70P/arcgis/rest/services/Purpleline_Econ_forWeb/FeatureServer/4` |
| 51 | DC | parcel+zoning | 1,088 | 100% | `https://services1.arcgis.com/HbzrdBZjOwNHp70P/arcgis/rest/services/Purpleline_Econ_forWeb/FeatureServer/5` |
| 51 | IN | parcel+zoning | 358 | 100% | `https://services.arcgis.com/2Mcx1M1MORKfBNPM/arcgis/rest/services/Weekly_Waterfowl_Inventory_Zone_Report_Public_Update/FeatureServer/0` |
| 50 | DC | parcel+zoning | 85,121 | 92% | `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_Parking_WebMercator/MapServer/156` |
| 50 | DC | parcel+zoning | 12,847 | 100% | `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/Washington_DC_Street_Parking_Zones/FeatureServer/3` |
| 50 | DC | parcel+zoning | 12,847 | 100% | `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/DC_Parking_Zones_Map/FeatureServer/2` |
| 49 | DC | parcel+zoning | 8,475 | 100% | `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/Washington_DC_Street_Parking_Zones/FeatureServer/5` |
| 49 | DC | parcel+zoning | 8,475 | 100% | `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/DC_Parking_Zones_Map/FeatureServer/4` |
| 49 | MT | parcel+zoning | 8,160 | 100% | `https://services2.arcgis.com/DRQySz3VhPgOv7Bo/arcgis/rest/services/UrbanForestry2/FeatureServer/2` |
| 49 | DC | parcel+zoning | 7,391 | 100% | `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/Washington_DC_Street_Parking_Zones/FeatureServer/7` |
| 49 | DC | parcel+zoning | 7,391 | 100% | `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/DC_Parking_Zones_Map/FeatureServer/6` |
| 49 | DC | parcel+zoning | 6,883 | 100% | `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/Washington_DC_Street_Parking_Zones/FeatureServer/1` |
| 49 | DC | parcel+zoning | 6,883 | 100% | `https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/DC_Parking_Zones_Map/FeatureServer/0` |
| 49 | MT | parcel+zoning | 56 | 100% | `https://services.arcgis.com/iTQUx5ZpNUh47Geb/arcgis/rest/services/COUNTY_ZONING/FeatureServer/0` |
| 48 | DC | parcel+zoning | 4,488 | 75% | `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_Commerce_WebMercator/MapServer/159` |
| 47 | OR | parcel+zoning | 1,233 | 100% | `https://services5.arcgis.com/W1uyphp8h2tna3qJ/arcgis/rest/services/Coos_Bay_SLR/FeatureServer/14` |
| 47 | NY | parcel+zoning | 1,004 | 98% | `https://services.arcgis.com/jDGuO8tYggdCCnUJ/arcgis/rest/services/unified_solar_permit/FeatureServer/1` |

## Coverage by state

| ST | Sources | parcel+zoning | districts | parcels only | Best score |
| --- | ---: | ---: | ---: | ---: | ---: |
| AK | 9 | 1 | 5 | 3 | 52 |
| AL | 22 | 2 | 7 | 13 | 55 |
| AR | 16 | 1 | 12 | 3 | 48 |
| AZ | 53 | 10 | 0 | 43 | 68 |
| CA | 43 | 16 | 12 | 15 | 79 |
| CO | 41 | 11 | 16 | 14 | 65 |
| CT | 18 | 6 | 4 | 8 | 65 |
| DC | 29 | 15 | 7 | 7 | 63 |
| DE | 9 | 0 | 5 | 4 | 27 |
| FL | 40 | 15 | 6 | 19 | 70 |
| GA | 32 | 16 | 9 | 7 | 68 |
| HI | 32 | 25 | 2 | 5 | 61 |
| IA | 19 | 4 | 9 | 6 | 67 |
| ID | 32 | 6 | 22 | 4 | 63 |
| IL | 25 | 6 | 14 | 5 | 71 |
| IN | 21 | 7 | 6 | 8 | 54 |
| KS | 29 | 12 | 10 | 7 | 59 |
| KY | 35 | 21 | 7 | 7 | 61 |
| LA | 15 | 4 | 8 | 3 | 64 |
| MA | 32 | 7 | 13 | 12 | 66 |
| MD | 35 | 15 | 9 | 11 | 75 |
| ME | 32 | 6 | 15 | 11 | 59 |
| MI | 31 | 15 | 7 | 9 | 63 |
| MN | 36 | 8 | 18 | 10 | 67 |
| MO | 34 | 13 | 13 | 8 | 75 |
| MS | 19 | 5 | 5 | 9 | 65 |
| MT | 28 | 11 | 3 | 14 | 60 |
| NC | 45 | 21 | 12 | 12 | 61 |
| ND | 40 | 15 | 7 | 18 | 95 |
| NE | 41 | 11 | 12 | 18 | 69 |
| NH | 22 | 1 | 8 | 13 | 48 |
| NJ | 25 | 7 | 3 | 15 | 67 |
| NM | 31 | 5 | 13 | 13 | 61 |
| NV | 19 | 3 | 6 | 10 | 62 |
| NY | 46 | 21 | 17 | 8 | 70 |
| OH | 66 | 20 | 35 | 11 | 70 |
| OK | 33 | 5 | 15 | 13 | 63 |
| OR | 37 | 9 | 19 | 9 | 67 |
| PA | 43 | 9 | 19 | 15 | 61 |
| RI | 22 | 7 | 9 | 6 | 62 |
| SC | 35 | 11 | 10 | 14 | 58 |
| SD | 18 | 2 | 4 | 12 | 53 |
| TN | 25 | 6 | 7 | 12 | 63 |
| TX | 68 | 9 | 21 | 38 | 77 |
| UT | 40 | 9 | 14 | 17 | 58 |
| VA | 49 | 18 | 6 | 25 | 70 |
| VT | 34 | 3 | 3 | 28 | 55 |
| WA | 28 | 7 | 10 | 11 | 66 |
| WI | 42 | 22 | 7 | 13 | 71 |
| WV | 27 | 3 | 1 | 23 | 54 |
| WY | 14 | 4 | 5 | 5 | 52 |
| unknown | 20 | 9 | 2 | 9 | 68 |

**Every state + DC has at least one verified source.**

## Field naming varies wildly — the observed alias table

Fargo calls its zoning field `Zone1`. Others use `ZONING`, `ZONE_CODE`, `BASEZONING`, `ZONE_DESC`,
`Zoning_Dis` (a 10-character shapefile truncation), and dozens more. There is no standard.
Compare case-insensitively with non-alphanumerics stripped.

Full machine-readable table: `src/lib/ingest/registry/field-aliases.json`. Top aliases per concept:

| Canonical concept | Layers with it | Most common observed field names |
| --- | ---: | --- |
| `parcel_id` | 584 (35.7%) | `PIN` ×108, `PARCELID` ×94, `APN` ×62, `PARCEL_ID` ×48, `GEOID` ×42, `ParcelID` ×41, `PID` ×35, `GEO_ID` ×32 |
| `zoning_code` | 1040 (63.5%) | `ZONING` ×139, `Zoning` ×116, `Zone` ×111, `ZONE` ×79, `zone` ×52, `ZONECLASS` ×38, `ZONEDESC` ×37, `zoning` ×32 |
| `zoning_secondary` | 82 (5.0%) | `ZONE_SUBTY` ×10, `Overlay` ×7, `DUAL_ZONE` ×7, `SPLIT_ZONE` ×6, `Zone2` ×5, `Zoning2` ×5, `Zoning3` ×5, `ZONING2` ×4 |
| `pud_flag` | 43 (2.6%) | `PUD` ×14, `PUDNo` ×5, `PUDDate` ×5, `PUD_NAME` ×4, `PUD_NUM` ×4, `Planned_Units` ×4, `PU_DESC` ×4, `PU_DOR_CD` ×4 |
| `cup_flag` | 14 (0.9%) | `cup` ×4, `CUP` ×4, `SUP` ×1, `CondUsePermitNumber` ×1, `CondUseDescription` ×1, `CONDITIONAL_USE` ×1, `CONDUSE` ×1, `CUP_Ordinances_Orders` ×1 |
| `lot_width` | 40 (2.4%) | `lot_width` ×7, `WIDTH` ×7, `lot_width_allows` ×6, `FRONTAGE` ×6, `WidthFront` ×5, `WidthBack` ×5, `Lot_Width` ×5, `width` ×2 |
| `lot_depth` | 52 (3.2%) | `DEPTH` ×33, `Depth1` ×5, `Depth2` ×5, `Lot_Depth` ×5, `Depth` ×3, `depth` ×2, `DEPTH_1` ×2, `LotDepth` ×2 |
| `lot_area` | 632 (38.6%) | `ACRES` ×146, `Acres` ×96, `AREA` ×79, `Acreage` ×34, `GIS_AREA` ×33, `GISAcres` ×30, `CALC_ACRE` ×24, `ACREAGE` ×24 |
| `year_built` | 156 (9.5%) | `YEAR_BUILT` ×47, `YearBuilt` ×21, `YEARBLT` ×13, `yr_built` ×12, `year_built` ×9, `YrBuilt` ×7, `EFF_YR_BLT` ×7, `ACT_YR_BLT` ×7 |
| `unit_count` | 92 (5.6%) | `UNITS` ×21, `UNIT` ×17, `NUM_UNITS` ×6, `UNIT_NUM` ×6, `AptUnits` ×5, `UNITNO` ×5, `Units` ×5, `num_units` ×4 |
| `building_sqft` | 54 (3.3%) | `Living_Area` ×6, `RES_AREA` ×6, `BldgSF` ×5, `AptBldgSF` ×4, `fin_sq_ft` ×4, `BLDG_SQFT` ×4, `BLDG_SIZE` ×4, `BLDGAREA` ×4 |
| `assessed_value` | 174 (10.6%) | `LAND_VALUE` ×35, `LandValue` ×20, `TotalValue` ×20, `LAND_VAL` ×17, `Land_Value` ×14, `landval` ×11, `BldgValue` ×10, `LANDVALUE` ×9 |
| `owner` | 344 (21.0%) | `OWNER_NAME` ×60, `Owner` ×60, `OWNER2` ×44, `OWNER` ×39, `OWNER1` ×37, `OwnerName` ×19, `OWNERNME1` ×15, `Owner2` ×13 |
| `situs_address` | 423 (25.8%) | `ADDRESS` ×95, `Address` ×58, `SITUS_ADDR` ×29, `ADDRESS1` ×11, `SITEADDRESS` ×10, `ADDRESS_1` ×10, `Situs_Address` ×10, `SITE_ADDR` ×9 |
| `legal_description` | 330 (20.2%) | `LOT` ×74, `BLOCK` ×63, `LEGAL_DESC` ×43, `Block` ×38, `Lot` ×32, `plat` ×28, `LEGAL` ×21, `PLAT` ×20 |

## How to re-run

```bash
node scripts/discover/discover-arcgis.mjs                    # resume, full pipeline
node scripts/discover/discover-arcgis.mjs --phase=search     # ArcGIS Online item search
node scripts/discover/discover-arcgis.mjs --phase=dcat --dcat  # ArcGIS Hub DCAT-US feeds
node scripts/discover/discover-arcgis.mjs --phase=probe --max-probe=1500
node scripts/discover/discover-arcgis.mjs --phase=emit       # rebuild JSON + this file
node scripts/discover/discover-arcgis.mjs --reset            # start clean
```

The crawl state lives in `scripts/discover/.cache/` (gitignored). Finished search queries and
probed services are skipped on re-run, so a long crawl can be stopped and restarted freely.
Add hand-verified self-hosted endpoints to `scripts/discover/seeds.json` — that is how Fargo gets
in, since it runs its own ArcGIS Server and has no ArcGIS Online item.
