/**
 * Canonical field concepts and the observed-alias matchers used to detect them.
 *
 * Field naming in US municipal GIS is not standardised in any way. Fargo calls
 * its primary zoning field `Zone1`; Kennesaw GA calls it `Zoning_1`; a great
 * many shapefile-derived layers carry 10-character truncations like
 * `ZONING_DIS` or `ZONE_CLASS`. This module is the single place that knowledge
 * lives, so `detectFieldMapping()` in the ingestion engine can consume the
 * alias table the crawler emits rather than re-deriving it.
 *
 * Matching is done against a NORMALISED field name: lower-cased with every
 * non-alphanumeric character removed. `Zoning_Dis` -> `zoningdis`.
 */

/** @typedef {'parcel_id'|'zoning_code'|'zoning_secondary'|'pud_flag'|'cup_flag'|'lot_width'|'lot_depth'|'lot_area'|'year_built'|'unit_count'|'building_sqft'|'assessed_value'|'owner'|'situs_address'|'legal_description'} CanonicalConcept */

/** @type {CanonicalConcept[]} */
export const CANONICAL_CONCEPTS = [
  'parcel_id',
  'zoning_code',
  'zoning_secondary',
  'pud_flag',
  'cup_flag',
  'lot_width',
  'lot_depth',
  'lot_area',
  'year_built',
  'unit_count',
  'building_sqft',
  'assessed_value',
  'owner',
  'situs_address',
  'legal_description',
];

export function normaliseFieldName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Ordered rules. First matching rule wins for a given field, so the more
 * specific concepts must be declared before the more generic ones
 * (`zoning_secondary` before `zoning_code`, `lot_width` before `lot_area`).
 *
 * @type {{concept: CanonicalConcept, test: (n: string) => boolean}[]}
 */
/**
 * Fields that contain "zone" but are emphatically not the zoning district.
 * Observed live in the crawl: FEMA flood zones (`FLD_ZONE`, 68 layers) are the
 * single most common false positive, followed by rezoning-application columns
 * (`REZONE`, `RezoneTo`) which describe a proposal, not the adopted code.
 */
export const NOT_ZONING_RE =
  /(fld|fl|flood|fema|sfha|fire|hazard|seismic|liquefac|school|speed|time|fips|utm|spc|stateplane|zip|postal|noise|air|coastal|impact|service|pressure|traffic|evac|snow|census|police|sewer|water|storm|utility|delivery|climate|plant|hardiness|opportunity|enterprise|freetrade|parking?meter)zone|zon(e|ing)(date|notes|note|ord|ordinance|allows|acre|area|sqft|link|url|case|app|amend)|rezon|^statezone$|horizon|amazon/;

export const CONCEPT_RULES = [
  // --- overlay / secondary zone -------------------------------------------
  {
    concept: 'zoning_secondary',
    test: (n) =>
      /^(zone|zoning)(2|3|b|sec|second|secondary|alt|subty|subtype|sub)$/.test(n) ||
      /^(zoning|zone)_?[23]$/.test(n) ||
      /^overlay/.test(n) ||
      /overlayzon|zoneoverlay|zoningoverlay|subzone|zonesubty|secondaryzon|dualzone|splitzone/.test(n),
  },

  // --- planned unit development -------------------------------------------
  {
    concept: 'pud_flag',
    test: (n) => /(^|[^a-z])pud($|[^a-z])/.test(n) || /^pud/.test(n) || /planneddev|plannedunit|pdistrict/.test(n),
  },

  // --- conditional / special use ------------------------------------------
  {
    concept: 'cup_flag',
    test: (n) =>
      /^cup/.test(n) ||
      /conditionaluse|conduse|condusepermit|specialuse|specialexcep|specialpermit|^sup$|^supno$/.test(n),
  },

  // --- primary zoning code -------------------------------------------------
  {
    concept: 'zoning_code',
    test: (n) => {
      if (NOT_ZONING_RE.test(n)) return false;
      if (/^(zone|zoning|zoned|zn|zon)$/.test(n)) return true;
      // Suffix forms: CURRZONE, GENZONE, BASE_ZONE, CNTY_ZONE, County_Zon.
      if (/(?:^|[a-z])zon(e|ing|)(code|cd|cls|class|type|dist)?$/.test(n) && n.length <= 18) return true;
      if (/^(zone|zoning)1$/.test(n)) return true;
      if (/^(zone|zoning)(code|cd|cls|class|classif|classification|clas|type|typ|dist|distr|district|districts|dis|desig|designation|desc|descr|description|abbr|abbrev|sym|symbol|label|lbl|cat|category|id|name|nm)$/.test(n)) return true;
      if (/^(base|current|existing|primary|adopted|official|general|prop|proposed)zon/.test(n)) return true;
      if (/^zon(ing)?(base|cd|code|class|type|dist)/.test(n)) return true;
      // shapefile 10-char truncations: ZONING_DIS, ZONING_COD, ZONING_DES,
      // ZONING_TYP, ZONE_ABV -> zoningdis, zoningcod, zoningdes, zoningtyp, zoneabv
      if (/^zon/.test(n) && /(code|cod|cd|clas|class|typ|type|dist|desig|des|desc|abbr|abv|sym|label|cat|nam)/.test(n)) return true;
      return false;
    },
  },

  // --- lot dimensions ------------------------------------------------------
  {
    concept: 'lot_width',
    test: (n) =>
      /^(lot|parcel|site|land)?_?(width|wdth)(front|back|rear|ft|feet|1|2)?$/.test(n) ||
      /^width(front|back|rear|ft|feet|1|2)?$/.test(n) ||
      /^(lot|parcel|site)?_?frontage$/.test(n) ||
      /^front(ft|feet|footage|width)$/.test(n) ||
      /lotwidth|parcelwidth|widthfront/.test(n),
  },
  {
    concept: 'lot_depth',
    test: (n) => /^(lot|parcel|site)?depth\d?$/.test(n) || /^depth(1|2|ft|feet)?$/.test(n) || /lotdepth/.test(n),
  },
  {
    concept: 'lot_area',
    test: (n) =>
      /^(gis|calc|calculated|deed|deeded|legal|map|shape|total|land|lot|parcel|tax|assess|assessed)?_?(acres|acreage|acre)$/.test(n) ||
      /^(lot|land|parcel|site|deed|gis|calc|shape|total)?_?(size|area|sqft|sqfeet|squarefeet|sf|sqftage)$/.test(n) ||
      /^(acres|acreage|lotsize|lotarea|landarea|landsf|landsqft|parcelarea|parcelsqft|sqftlot|gisacres|calcacres|shapearea|segsqft|areasqft|sqftarea)$/.test(n),
  },

  // --- structure -----------------------------------------------------------
  {
    concept: 'year_built',
    test: (n) => /^(act|eff|effective|actual|orig|original)?(yr|year)(blt|built|bld|const|constructed)\d?$/.test(n) || /^builtyear$/.test(n) || /yearbuilt|yrbuilt|yrblt|actyrblt|effyrblt/.test(n),
  },
  {
    concept: 'unit_count',
    test: (n) =>
      /^(no|num|number|tot|total|res|apt|dwelling|dwell|housing|hsg)?_?(of)?_?units?$/.test(n) ||
      /^unit(s)?(count|cnt|no|num|total)$/.test(n) ||
      /numberofunits|numunits|unitcount|aptunits|dwellingunits|residentialunits|totalunits|housingunits/.test(n),
  },
  {
    concept: 'building_sqft',
    test: (n) =>
      /^(bldg|building|struct|structure|improv|improved|gross|total|heated|finished|fin|liv|living|main|res)_?(sf|sqft|sqfeet|squarefeet|area|size)$/.test(n) ||
      /bldgsf|bldgsqft|buildingsqft|buildingsf|livingarea|livarea|heatedarea|heatedsf|finsqft|finishedsqft|grosssqft|grossarea|totlivarea|structuresf|improvedsqft|sqftbldg|mainfloorsf/.test(n),
  },
  {
    concept: 'assessed_value',
    test: (n) =>
      /^(tot|total|land|bldg|building|improv|improvement|market|just|appr|appraised|assd|assess|assessed|tax|taxable|net|full|cash)_?(val|value|amt|amount|assess|assessed|assessment)\d?$/.test(n) ||
      /assessedvalue|totalvalue|marketvalue|appraisedvalue|justvalue|taxvalue|taxablevalue|landvalue|bldgvalue|improvementvalue|totassess|assdtotal/.test(n),
  },

  // --- identity ------------------------------------------------------------
  {
    concept: 'owner',
    test: (n) =>
      /^(owner|own|ownr)\d?$/.test(n) ||
      /^(owner|own|ownr|deed|tax|current|primary|mail)_?(name|nme|nm|owner|payer|full|first|last|1|2)$/.test(n) ||
      /ownername|ownernm|owneraddr|deedowner|taxpayer|ownerfull|propertyowner/.test(n),
  },
  {
    concept: 'situs_address',
    test: (n) =>
      /^(situs|site|prop|property|physical|land|location|loc|street|st|full|parcel|premise|premises)?_?(addr|address|addr1|address1|adr|add)$/.test(n) ||
      /situsaddr|siteaddr|propaddr|propertyaddr|physicaladdr|fulladdress|locaddress|landaddr|streetaddress|addressline/.test(n),
  },
  {
    concept: 'legal_description',
    test: (n) =>
      /^(legal|leg)_?(desc|description|descr|dsc)?$/.test(n) ||
      /^(lot|block|blk|plat|subdiv|subdivision|addition|tract)(legal|name|no|num|id)?$/.test(n) ||
      /legaldesc|legaldescription|lotlegal|blocklegal|platname|subdivisionname|additionname/.test(n),
  },

  // --- parcel identifier (last: broadest) ----------------------------------
  {
    concept: 'parcel_id',
    test: (n) =>
      /^(pin|apn|pid|ain|tms|strap|folio|parid|parcelid|parcelno|parcelnum|parcelnumber|parcelpin|gispin|taxid|taxpin|propertyid|propid|accountnumber|acctnum|acctno|account|geoid|gpin|ppin|sidwell|prclid|prclno)$/.test(n) ||
      /^(parcel|prop|property|tax|assess|assessor|land)_?(id|no|num|number|pin|apn|key|acct|account)$/.test(n) ||
      /parcelidentif|parcelnumb|apnnumber|pinnumber/.test(n),
  },
];

/**
 * When several fields map to the same concept, prefer the most canonical one.
 * Fargo carries LandValue, BldgValue and TotalValue — we want TotalValue.
 * Higher score wins; ties fall back to field order in the layer.
 *
 * @type {Partial<Record<CanonicalConcept, (n: string) => number>>}
 */
export const CONCEPT_PREFERENCE = {
  zoning_code: (n) => {
    if (/^(zoning|zone|zone1|zoning1)$/.test(n)) return 5;
    if (/^(zoning|zone)(code|cd)$/.test(n)) return 5;
    if (/^(base|current|existing|adopted|official)zon/.test(n)) return 4;
    if (/(class|clas|type|dist|desig)/.test(n)) return 3;
    if (/(desc|label|abbr|sym|cat)/.test(n)) return 2;
    if (/(name|nm|id)$/.test(n)) return 1; // often a join key, not the code
    return 2;
  },
  assessed_value: (n) => {
    if (/^tot|total|market|just|appraised|fullvalue|cashvalue/.test(n)) return 5;
    if (/assess/.test(n)) return 4;
    if (/^tax/.test(n)) return 3;
    if (/^(land|bldg|building|improv)/.test(n)) return 1;
    return 2;
  },
  owner: (n) => {
    if (/^(ownername|owner1|ownername1|ownerfull|owner)$/.test(n)) return 5;
    if (/^owner/.test(n)) return 4;
    if (/taxpayer|deedowner/.test(n)) return 2;
    return 3;
  },
  situs_address: (n) => {
    if (/^situs/.test(n)) return 5;
    if (/^(site|prop|property|physical|land|location|loc)/.test(n)) return 4;
    if (/^(full|street|st)/.test(n)) return 3;
    if (/^(addr|address)$/.test(n)) return 2;
    return 2;
  },
  legal_description: (n) => {
    if (/^legal/.test(n)) return 5;
    if (/legaldesc/.test(n)) return 5;
    if (/^(lot|block|blk)legal$/.test(n)) return 4;
    if (/^(subdiv|plat)/.test(n)) return 3;
    if (/^addition/.test(n)) return 2;
    return 2;
  },
  lot_area: (n) => {
    if (/^(acres|acreage|acre)$/.test(n)) return 5;
    if (/acres|acreage/.test(n)) return 4;
    if (/^(lotsize|lotarea|landarea|parcelarea)$/.test(n)) return 4;
    if (/sqft|sf$/.test(n)) return 3;
    return 2;
  },
  parcel_id: (n) => {
    if (/^(parcelid|parcelno|parcelnumber|apn|pin|pid)$/.test(n)) return 5;
    if (/^(gispin|taxid|ain|tms|strap|folio|parid)$/.test(n)) return 4;
    if (/^geoid$/.test(n)) return 1;
    return 3;
  },
  lot_width: (n) => (/^(lotwidth|width|widthfront|frontage)$/.test(n) ? 5 : 3),
  lot_depth: (n) => (/^(lotdepth|depth|depth1)$/.test(n) ? 5 : 3),
  year_built: (n) => (/^(yearbuilt|yrbuilt|yrblt)$/.test(n) ? 5 : /^eff/.test(n) ? 2 : 3),
  building_sqft: (n) => (/^(bldgsf|bldgsqft|buildingsqft|totalsqft|livingarea|grosssqft)$/.test(n) ? 5 : 3),
  unit_count: (n) => (/^(units|numunits|unitcount|totalunits|dwellingunits)$/.test(n) ? 5 : 3),
};

/**
 * Dimensional-standards columns — setbacks, height caps, FAR, lot coverage,
 * minimum lot size. These are RARE. A handful of jurisdictions join a slice of
 * their ordinance table onto the zoning layer (observed live: fields like
 * `Zoning__Front_Setback__ft_`, `Zoning__All_Other_Setbacks__ft_`,
 * `Zoning__Minimum_Size`).
 *
 * Detecting these does NOT mean the registry entry gives usable standards. It
 * is a partial, unverified subset of one ordinance; `providesDimensionalStandards`
 * stays false regardless. Treat a hit as "worth a look first", nothing more.
 */
export const STANDARDS_RE =
  /setback|frontyard|rearyard|sideyard|yardfront|yardrear|yardside|maxheight|heightmax|heightlimit|maxstories|buildingheight|bldgheight|^far$|floorarearatio|farmax|maxfar|lotcoverage|coveragemax|maxcoverage|impervious(max|limit)|minlotsize|minimumlotsize|minlotarea|minimumsize|minlotwidth|minimumlotwidth|minfrontage|minimumfrontage|maxdensity|densitymax|dwellingsperacre|unitsperacre|openspacemin|minimumopenspace|parkingmin|minparking/;

export function detectStandardsFields(fieldNames) {
  return fieldNames.filter((f) => STANDARDS_RE.test(normaliseFieldName(f)));
}

/**
 * Map a layer's field list onto the canonical concepts.
 * Returns { concept -> best observed field name } plus every alias observed.
 */
export function detectConcepts(fieldNames) {
  /** @type {Record<string, string|null>} */
  const found = Object.fromEntries(CANONICAL_CONCEPTS.map((c) => [c, null]));
  /** @type {Record<string, number>} */
  const bestScore = {};
  /** @type {{concept: string, field: string}[]} */
  const aliases = [];

  for (const raw of fieldNames) {
    const n = normaliseFieldName(raw);
    if (!n) continue;
    // Ignore Esri housekeeping fields outright.
    if (/^(objectid|fid|globalid|shape|shapelength|shapearea|shapestlength|shapestarea|created(user|date)|last(edited|edit)(user|date)|se_anno_cad_data)$/.test(n)) continue;
    for (const rule of CONCEPT_RULES) {
      if (!rule.test(n)) continue;
      aliases.push({ concept: rule.concept, field: raw });
      const pref = CONCEPT_PREFERENCE[rule.concept];
      const s = pref ? pref(n) : 3;
      if (found[rule.concept] === null || s > bestScore[rule.concept]) {
        found[rule.concept] = raw;
        bestScore[rule.concept] = s;
      }
      break; // first matching concept wins for this field
    }
  }
  return { found, aliases };
}
