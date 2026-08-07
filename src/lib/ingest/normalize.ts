/**
 * Address normalization → `addresses.normalized_key`.  (Ingestion layer, 3 of 3)
 *
 * This is the dedup anchor for the whole system. `addresses_normalized_key_uq`
 * is `(normalized_key, postal_code)`, so whatever this function returns for a
 * given street line is, by construction, "the same house" across every source
 * that ever mentions it.
 *
 * THE RULE THAT MATTERS MOST: unit designators are PRESERVED.
 * -----------------------------------------------------------
 * Stripping "UNIT 2" merges the two halves of a duplex into one row. Every
 * fact, permit, listing and assessment for both halves then collides, and the
 * product confidently reports the wrong square footage, the wrong assessed
 * value, and the wrong owner for one of them. Duplicating a row is a cosmetic
 * defect you can clean up later; merging two dwellings is a correctness defect
 * that silently poisons every downstream number. Fargo alone has ~6,000
 * unit-suffixed parcel addresses in the city GIS feed, so this is not an edge
 * case.
 *
 * DETERMINISM: this module is pure. Same input string → same output, forever,
 * with no locale, clock, or environment dependency. `scripts/test-normalize.mjs`
 * pins that with assertions, including idempotence (normalising a normalised
 * key must be a no-op).
 *
 * SCOPE: this is a canonicaliser, not a USPS CASS validator. It does not
 * correct misspellings, it does not invent ZIP+4, and it does not geocode. It
 * makes two spellings of the same address collide and refuses to make two
 * different addresses collide.
 */

/** USPS Publication 28 street-suffix abbreviations, long form → canonical. */
const STREET_SUFFIXES: Record<string, string> = {
  ALLEE: "ALY", ALLEY: "ALY", ALLY: "ALY", ALY: "ALY",
  ANEX: "ANX", ANNEX: "ANX", ANNX: "ANX", ANX: "ANX",
  ARC: "ARC", ARCADE: "ARC",
  AV: "AVE", AVE: "AVE", AVEN: "AVE", AVENU: "AVE", AVENUE: "AVE", AVN: "AVE", AVNUE: "AVE",
  BAYOO: "BYU", BAYOU: "BYU", BYU: "BYU",
  BCH: "BCH", BEACH: "BCH",
  BEND: "BND", BND: "BND",
  BLF: "BLF", BLUF: "BLF", BLUFF: "BLF", BLUFFS: "BLFS", BLFS: "BLFS",
  BOT: "BTM", BOTTM: "BTM", BOTTOM: "BTM", BTM: "BTM",
  BLVD: "BLVD", BOUL: "BLVD", BOULEVARD: "BLVD", BOULV: "BLVD",
  BR: "BR", BRANCH: "BR", BRNCH: "BR",
  BRDGE: "BRG", BRG: "BRG", BRIDGE: "BRG",
  BRK: "BRK", BROOK: "BRK", BROOKS: "BRKS", BRKS: "BRKS",
  BURG: "BG", BG: "BG", BURGS: "BGS", BGS: "BGS",
  BYP: "BYP", BYPA: "BYP", BYPAS: "BYP", BYPASS: "BYP", BYPS: "BYP",
  CAMP: "CP", CP: "CP", CMP: "CP",
  CANYN: "CYN", CANYON: "CYN", CNYN: "CYN", CYN: "CYN",
  CAPE: "CPE", CPE: "CPE",
  CAUSEWAY: "CSWY", CAUSWA: "CSWY", CSWY: "CSWY",
  CEN: "CTR", CENT: "CTR", CENTER: "CTR", CENTR: "CTR", CENTRE: "CTR",
  CNTER: "CTR", CNTR: "CTR", CTR: "CTR", CENTERS: "CTRS", CTRS: "CTRS",
  CIR: "CIR", CIRC: "CIR", CIRCL: "CIR", CIRCLE: "CIR", CRCL: "CIR", CRCLE: "CIR",
  CIRCLES: "CIRS", CIRS: "CIRS",
  CLF: "CLF", CLIFF: "CLF", CLFS: "CLFS", CLIFFS: "CLFS",
  CLB: "CLB", CLUB: "CLB",
  COMMON: "CMN", CMN: "CMN", COMMONS: "CMNS", CMNS: "CMNS",
  COR: "COR", CORNER: "COR", CORNERS: "CORS", CORS: "CORS",
  COURSE: "CRSE", CRSE: "CRSE",
  COURT: "CT", CT: "CT", COURTS: "CTS", CTS: "CTS",
  COVE: "CV", CV: "CV", COVES: "CVS", CVS: "CVS",
  CREEK: "CRK", CRK: "CRK",
  CRESCENT: "CRES", CRES: "CRES", CRSENT: "CRES", CRSNT: "CRES",
  CREST: "CRST", CRST: "CRST",
  CROSSING: "XING", CRSSNG: "XING", XING: "XING",
  CROSSROAD: "XRD", XRD: "XRD", CROSSROADS: "XRDS", XRDS: "XRDS",
  CURVE: "CURV", CURV: "CURV",
  DALE: "DL", DL: "DL",
  DAM: "DM", DM: "DM",
  DIV: "DV", DIVIDE: "DV", DV: "DV", DVD: "DV",
  DR: "DR", DRIV: "DR", DRIVE: "DR", DRV: "DR", DRIVES: "DRS", DRS: "DRS",
  EST: "EST", ESTATE: "EST", ESTATES: "ESTS", ESTS: "ESTS",
  EXP: "EXPY", EXPR: "EXPY", EXPRESS: "EXPY", EXPRESSWAY: "EXPY", EXPW: "EXPY", EXPY: "EXPY",
  EXT: "EXT", EXTENSION: "EXT", EXTN: "EXT", EXTNSN: "EXT", EXTS: "EXTS", EXTENSIONS: "EXTS",
  FALL: "FALL", FALLS: "FLS", FLS: "FLS",
  FERRY: "FRY", FRRY: "FRY", FRY: "FRY",
  FIELD: "FLD", FLD: "FLD", FIELDS: "FLDS", FLDS: "FLDS",
  FLAT: "FLT", FLT: "FLT", FLATS: "FLTS", FLTS: "FLTS",
  FORD: "FRD", FRD: "FRD", FORDS: "FRDS", FRDS: "FRDS",
  FOREST: "FRST", FORESTS: "FRST", FRST: "FRST",
  FORG: "FRG", FORGE: "FRG", FRG: "FRG", FORGES: "FRGS", FRGS: "FRGS",
  FORK: "FRK", FRK: "FRK", FORKS: "FRKS", FRKS: "FRKS",
  FORT: "FT", FRT: "FT", FT: "FT",
  FREEWAY: "FWY", FREEWY: "FWY", FRWAY: "FWY", FRWY: "FWY", FWY: "FWY",
  GARDEN: "GDN", GARDN: "GDN", GRDEN: "GDN", GRDN: "GDN", GDN: "GDN",
  GARDENS: "GDNS", GDNS: "GDNS", GRDNS: "GDNS",
  GATEWAY: "GTWY", GATEWY: "GTWY", GATWAY: "GTWY", GTWAY: "GTWY", GTWY: "GTWY",
  GLEN: "GLN", GLN: "GLN", GLENS: "GLNS", GLNS: "GLNS",
  GREEN: "GRN", GRN: "GRN", GREENS: "GRNS", GRNS: "GRNS",
  GROV: "GRV", GROVE: "GRV", GRV: "GRV", GROVES: "GRVS", GRVS: "GRVS",
  HARB: "HBR", HARBOR: "HBR", HARBR: "HBR", HBR: "HBR", HRBOR: "HBR",
  HARBORS: "HBRS", HBRS: "HBRS",
  HAVEN: "HVN", HVN: "HVN",
  HEIGHTS: "HTS", HT: "HTS", HTS: "HTS",
  HIGHWAY: "HWY", HIGHWY: "HWY", HIWAY: "HWY", HIWY: "HWY", HWAY: "HWY", HWY: "HWY",
  HILL: "HL", HL: "HL", HILLS: "HLS", HLS: "HLS",
  HLLW: "HOLW", HOLLOW: "HOLW", HOLLOWS: "HOLW", HOLW: "HOLW", HOLWS: "HOLW",
  INLT: "INLT", INLET: "INLT",
  IS: "IS", ISLAND: "IS", ISLND: "IS", ISLANDS: "ISS", ISLNDS: "ISS", ISS: "ISS",
  ISLE: "ISLE", ISLES: "ISLE",
  JCT: "JCT", JCTION: "JCT", JCTN: "JCT", JUNCTION: "JCT", JUNCTN: "JCT", JUNCTON: "JCT",
  JCTNS: "JCTS", JCTS: "JCTS", JUNCTIONS: "JCTS",
  KEY: "KY", KY: "KY", KEYS: "KYS", KYS: "KYS",
  KNL: "KNL", KNOL: "KNL", KNOLL: "KNL", KNLS: "KNLS", KNOLLS: "KNLS",
  LK: "LK", LAKE: "LK", LKS: "LKS", LAKES: "LKS",
  LAND: "LAND",
  LANDING: "LNDG", LNDG: "LNDG", LNDNG: "LNDG",
  LANE: "LN", LN: "LN",
  LGT: "LGT", LIGHT: "LGT", LIGHTS: "LGTS", LGTS: "LGTS",
  LF: "LF", LOAF: "LF",
  LCK: "LCK", LOCK: "LCK", LCKS: "LCKS", LOCKS: "LCKS",
  LDG: "LDG", LDGE: "LDG", LODG: "LDG", LODGE: "LDG",
  LOOP: "LOOP", LOOPS: "LOOP",
  MALL: "MALL",
  MNR: "MNR", MANOR: "MNR", MANORS: "MNRS", MNRS: "MNRS",
  MEADOW: "MDW", MDW: "MDW", MDWS: "MDWS", MEADOWS: "MDWS", MEDOWS: "MDWS",
  MEWS: "MEWS",
  MILL: "ML", ML: "ML", MILLS: "MLS", MLS: "MLS",
  MISSN: "MSN", MSSN: "MSN", MSN: "MSN", MISSION: "MSN",
  MOTORWAY: "MTWY", MTWY: "MTWY",
  MNT: "MT", MT: "MT", MOUNT: "MT",
  MNTAIN: "MTN", MNTN: "MTN", MOUNTAIN: "MTN", MOUNTIN: "MTN", MTIN: "MTN", MTN: "MTN",
  MNTNS: "MTNS", MOUNTAINS: "MTNS", MTNS: "MTNS",
  NCK: "NCK", NECK: "NCK",
  ORCH: "ORCH", ORCHARD: "ORCH", ORCHRD: "ORCH",
  OVAL: "OVAL", OVL: "OVAL",
  OVERPASS: "OPAS", OPAS: "OPAS",
  PARK: "PARK", PRK: "PARK", PARKS: "PARK",
  PARKWAY: "PKWY", PARKWY: "PKWY", PKWAY: "PKWY", PKWY: "PKWY", PKY: "PKWY", PARKWAYS: "PKWY", PKWYS: "PKWY",
  PASS: "PASS", PASSAGE: "PSGE", PSGE: "PSGE",
  PATH: "PATH", PATHS: "PATH",
  PIKE: "PIKE", PIKES: "PIKE",
  PINE: "PNE", PNE: "PNE", PINES: "PNES", PNES: "PNES",
  PL: "PL", PLACE: "PL",
  PLAIN: "PLN", PLN: "PLN", PLAINS: "PLNS", PLNS: "PLNS",
  PLAZA: "PLZ", PLZ: "PLZ", PLZA: "PLZ",
  POINT: "PT", PT: "PT", POINTS: "PTS", PTS: "PTS",
  PORT: "PRT", PRT: "PRT", PORTS: "PRTS", PRTS: "PRTS",
  PR: "PR", PRAIRIE: "PR", PRR: "PR",
  RAD: "RADL", RADIAL: "RADL", RADIEL: "RADL", RADL: "RADL",
  RAMP: "RAMP",
  RANCH: "RNCH", RANCHES: "RNCH", RNCH: "RNCH", RNCHS: "RNCH",
  RAPID: "RPD", RPD: "RPD", RAPIDS: "RPDS", RPDS: "RPDS",
  REST: "RST", RST: "RST",
  RDG: "RDG", RIDGE: "RDG", RDGE: "RDG", RDGS: "RDGS", RIDGES: "RDGS",
  RIV: "RIV", RIVER: "RIV", RVR: "RIV", RIVR: "RIV",
  RD: "RD", ROAD: "RD", RDS: "RDS", ROADS: "RDS",
  ROUTE: "RTE", RTE: "RTE",
  ROW: "ROW",
  RUE: "RUE",
  RUN: "RUN",
  SHL: "SHL", SHOAL: "SHL", SHLS: "SHLS", SHOALS: "SHLS",
  SHOAR: "SHR", SHORE: "SHR", SHR: "SHR", SHOARS: "SHRS", SHORES: "SHRS", SHRS: "SHRS",
  SKYWAY: "SKWY", SKWY: "SKWY",
  SPG: "SPG", SPNG: "SPG", SPRING: "SPG", SPRNG: "SPG",
  SPGS: "SPGS", SPNGS: "SPGS", SPRINGS: "SPGS", SPRNGS: "SPGS",
  SPUR: "SPUR", SPURS: "SPUR",
  SQ: "SQ", SQR: "SQ", SQRE: "SQ", SQU: "SQ", SQUARE: "SQ",
  SQRS: "SQS", SQS: "SQS", SQUARES: "SQS",
  STA: "STA", STATION: "STA", STATN: "STA", STN: "STA",
  STRA: "STRA", STRAV: "STRA", STRAVEN: "STRA", STRAVENUE: "STRA", STRAVN: "STRA", STRVN: "STRA", STRVNUE: "STRA",
  STREAM: "STRM", STREME: "STRM", STRM: "STRM",
  STREET: "ST", STRT: "ST", ST: "ST", STR: "ST",
  STREETS: "STS", STS: "STS",
  SMT: "SMT", SUMIT: "SMT", SUMITT: "SMT", SUMMIT: "SMT",
  TER: "TER", TERR: "TER", TERRACE: "TER",
  THROUGHWAY: "TRWY", TRWY: "TRWY",
  TRACE: "TRCE", TRACES: "TRCE", TRCE: "TRCE",
  TRACK: "TRAK", TRACKS: "TRAK", TRAK: "TRAK", TRK: "TRAK", TRKS: "TRAK",
  TRAFFICWAY: "TRFY", TRFY: "TRFY",
  TRAIL: "TRL", TRAILS: "TRL", TRL: "TRL", TRLS: "TRL",
  TRAILER: "TRLR", TRLR: "TRLR", TRLRS: "TRLR",
  TUNEL: "TUNL", TUNL: "TUNL", TUNNEL: "TUNL", TUNNELS: "TUNL", TUNNL: "TUNL",
  TRNPK: "TPKE", TURNPIKE: "TPKE", TURNPK: "TPKE", TPKE: "TPKE",
  UNDERPASS: "UPAS", UPAS: "UPAS",
  UN: "UN", UNION: "UN", UNIONS: "UNS", UNS: "UNS",
  VALLEY: "VLY", VALLY: "VLY", VLLY: "VLY", VLY: "VLY",
  VALLEYS: "VLYS", VLYS: "VLYS",
  VDCT: "VIA", VIADCT: "VIA", VIADUCT: "VIA", VIA: "VIA",
  VIEW: "VW", VW: "VW", VIEWS: "VWS", VWS: "VWS",
  VILL: "VLG", VILLAG: "VLG", VILLAGE: "VLG", VILLG: "VLG", VILLIAGE: "VLG", VLG: "VLG",
  VILLAGES: "VLGS", VLGS: "VLGS",
  VILLE: "VL", VL: "VL",
  VIS: "VIS", VIST: "VIS", VISTA: "VIS", VST: "VIS", VSTA: "VIS",
  WALK: "WALK", WALKS: "WALK",
  WALL: "WALL",
  WY: "WAY", WAY: "WAY", WAYS: "WAYS",
  WELL: "WL", WL: "WL", WELLS: "WLS", WLS: "WLS",
};

/** Directional words → USPS abbreviation. Order matters: two-letter first. */
const DIRECTIONALS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  NE: "NE", NW: "NW", SE: "SE", SW: "SW",
  N: "N", S: "S", E: "E", W: "W",
  NORTHE: "NE", NORTHW: "NW", SOUTHE: "SE", SOUTHW: "SW",
};

/**
 * Secondary-unit designators, long form → canonical abbreviation.
 * These are PRESERVED in the output. `#` normalises to `UNIT`.
 */
const UNIT_DESIGNATORS: Record<string, string> = {
  APARTMENT: "APT", APT: "APT",
  BASEMENT: "BSMT", BSMT: "BSMT",
  BUILDING: "BLDG", BLDG: "BLDG", BLD: "BLDG",
  DEPARTMENT: "DEPT", DEPT: "DEPT",
  FLOOR: "FL", FL: "FL", FLR: "FL",
  FRONT: "FRNT", FRNT: "FRNT",
  HANGAR: "HNGR", HNGR: "HNGR",
  KEY: "KEY",
  LOBBY: "LBBY", LBBY: "LBBY",
  LOT: "LOT",
  LOWER: "LOWR", LOWR: "LOWR",
  OFFICE: "OFC", OFC: "OFC",
  PENTHOUSE: "PH", PH: "PH",
  PIER: "PIER",
  REAR: "REAR",
  ROOM: "RM", RM: "RM",
  SIDE: "SIDE",
  SLIP: "SLIP",
  SPACE: "SPC", SPC: "SPC",
  STOP: "STOP",
  SUITE: "STE", STE: "STE", SUIT: "STE",
  TRAILER: "TRLR", TRLR: "TRLR",
  UNIT: "UNIT",
  UPPER: "UPPR", UPPR: "UPPR",
};

/** Designators that stand alone with no following value (e.g. "REAR"). */
const STANDALONE_UNIT_DESIGNATORS = new Set(["BSMT", "FRNT", "LBBY", "LOWR", "PH", "REAR", "SIDE", "UPPR"]);

/** Tokens that carry no information and are dropped wherever they appear. */
const NOISE_TOKENS = new Set(["", "NULL", "NONE", "N/A", "NA", "UNKNOWN", "TBD"]);

export type AddressInput = {
  /** The raw street line as published, e.g. `"2577 PACIFIC DR S UNIT 408"`. */
  line1: string;
  /** Optional separate secondary line, e.g. `"APT 3"`. Merged into the key. */
  line2?: string | null;
  city: string;
  /** Two-letter USPS state code. Case-insensitive on input. */
  state: string;
  /** 5-digit ZIP, ZIP+4, or anything; validated, not repaired. */
  postalCode?: string | null;
};

export type NormalizedAddress = {
  /**
   * The dedup key. Shape: `PRIMARY|CITY|ST`, where PRIMARY includes the unit.
   * City and state are in the key because ZIP codes are reused across city
   * lines in plenty of the country, and `(normalized_key, postal_code)` alone
   * would let two different towns collide.
   */
  normalizedKey: string;
  /** Canonicalised primary line, unit included. Stored in `addresses.line1`. */
  line1: string;
  /** Canonicalised secondary designator + value, or null. `addresses.line2`. */
  line2: string | null;
  city: string;
  state: string;
  /** 5 digits, or null when the source value was not a usable US ZIP. */
  postalCode: string | null;
  /** True when the input carried a secondary unit. Never inferred. */
  hasUnit: boolean;
  /** Why the address could not be keyed, when `normalizedKey` is empty. */
  problems: string[];
};

/** Uppercase, de-punctuate, collapse whitespace. `#` becomes a UNIT marker. */
function scrub(raw: string): string[] {
  const upper = raw
    .normalize("NFKD")
    // Drop combining marks so "PEÑA" and "PENA" key identically.
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  return upper
    // `#4`, `# 4`, `#4B` -> `UNIT 4...`. Done before punctuation stripping
    // because `#` is the one punctuation mark that carries meaning.
    .replace(/#\s*/g, " UNIT ")
    // Ordinals attached to a number keep the number only: 12TH -> 12, 1ST -> 1.
    // Fargo publishes "12 ST N"; other feeds publish "12TH ST N". Same street.
    .replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1")
    // Apostrophes close up: O'BRIEN -> OBRIEN, matching USPS.
    .replace(/['’`]/g, "")
    // A period at a token boundary closes up too: "DR. S" -> "DR S", "U.S." -> "US".
    .replace(/\.(?=\s|$)/g, "")
    // Remaining punctuation separates. Hyphens and slashes in house numbers and
    // street names become spaces: keep the digits, drop the glue.
    .replace(/[.,"()\[\]{}]/g, " ")
    .replace(/[/\\\-_]+/g, " ")
    .replace(/&/g, " AND ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => !NOISE_TOKENS.has(t));
}

/**
 * Canonicalise the primary street portion using USPS positional rules rather
 * than folding every token that happens to appear in the suffix table.
 *
 * WHY POSITIONAL: a blanket fold turns "LAKE SHORE DR" into "LK SHR DR" and
 * "PARK RIVER RD" into "PARK RIV RD". Both still dedup correctly, but `line1`
 * is a displayed field and mangling it is a needless self-inflicted wound.
 * USPS only abbreviates the suffix slot and the directional slots, so that is
 * what this does:
 *
 *   [house#]  [pre-directional]  [ ...street name... ]  [suffix]  [post-directional]
 *
 * A directional is folded only in slot 2 or the final slot. A street suffix is
 * folded only in the suffix slot. Everything else is left as scrubbed
 * uppercase text.
 */
function canonicalizePrimary(tokens: string[]): string[] {
  if (tokens.length === 0) return [];
  const out = [...tokens];
  const last = out.length - 1;

  // Post-directional: trailing N / S / E / W / NE / ... (Fargo's quadrant style).
  let suffixIdx = last;
  if (last >= 2 && DIRECTIONALS[out[last]]) {
    out[last] = DIRECTIONALS[out[last]];
    suffixIdx = last - 1;
  }

  // Pre-directional, immediately after the house number.
  if (out.length >= 3 && DIRECTIONALS[out[1]] && suffixIdx > 1) {
    out[1] = DIRECTIONALS[out[1]];
  }

  // Suffix slot only — and never the house number itself.
  if (suffixIdx >= 1 && STREET_SUFFIXES[out[suffixIdx]]) {
    out[suffixIdx] = STREET_SUFFIXES[out[suffixIdx]];
  }

  return out;
}

/** Does this token look like a street suffix in its own right? */
function looksLikeSuffix(token: string): boolean {
  return Object.prototype.hasOwnProperty.call(STREET_SUFFIXES, token);
}

/**
 * Split a token list into the primary street portion and a secondary unit
 * portion. The unit value is preserved verbatim (uppercased) — `UNIT 1A1` and
 * `UNIT 1A2` must never converge.
 *
 * Two guards stop a street NAME being mistaken for a unit designator:
 *   1. The designator must sit at index >= 2, so "1234 KEY WEST DR" cannot
 *      split on KEY (index 1).
 *   2. The tokens after it must contain no street suffix, so "100 OLD KEY
 *      WEST RD" cannot split either — a real unit value never ends in "RD".
 */
function splitUnit(tokens: string[]): {
  primary: string[];
  unitDesignator: string | null;
  unitValue: string | null;
} {
  for (let i = 2; i < tokens.length; i += 1) {
    const canon = UNIT_DESIGNATORS[tokens[i]];
    if (!canon) continue;
    const rest = tokens.slice(i + 1);
    if (rest.length > 0) {
      if (rest.some(looksLikeSuffix)) continue;
      return { primary: tokens.slice(0, i), unitDesignator: canon, unitValue: rest.join(" ") };
    }
    if (STANDALONE_UNIT_DESIGNATORS.has(canon)) {
      return { primary: tokens.slice(0, i), unitDesignator: canon, unitValue: null };
    }
  }
  return { primary: tokens, unitDesignator: null, unitValue: null };
}

/** Normalise a city name: uppercase, de-punctuate, fold leading directionals. */
export function normalizeCity(city: string): string {
  const tokens = scrub(city);
  if (tokens.length === 0) return "";
  return tokens
    .map((t, i) => (i < tokens.length - 1 && DIRECTIONALS[t] ? DIRECTIONALS[t] : t))
    .join(" ");
}

/**
 * Validate a US postal code. Accepts `#####` and `#####-####` (taking the
 * first five). Returns null for anything else — including the `99999` and
 * `00000` placeholders that appear in real assessor extracts, because a
 * placeholder that looks valid is worse than a null.
 */
export function normalizePostalCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).trim();
  const m = digits.match(/^(\d{5})(?:[-\s]?\d{4})?$/);
  if (!m) return null;
  const zip = m[1];
  if (zip === "00000" || zip === "99999") return null;
  return zip;
}

/**
 * The whole point of the module. Pure, deterministic, idempotent.
 *
 * `normalizedKey` is empty string when the input cannot be keyed at all (no
 * street line, or no city/state). Callers must treat that as "cannot create an
 * address row" rather than inserting a blank key.
 */
export function normalizeAddress(input: AddressInput): NormalizedAddress {
  const problems: string[] = [];

  const rawLine = [input.line1 ?? "", input.line2 ?? ""]
    .map((s) => String(s ?? "").trim())
    .filter((s) => s.length > 0)
    .join(" ");

  const tokens = scrub(rawLine);
  const { primary, unitDesignator, unitValue } = splitUnit(tokens);

  const primaryLine = canonicalizePrimary(primary).join(" ");

  const city = normalizeCity(input.city ?? "");
  const state = String(input.state ?? "").trim().toUpperCase().slice(0, 2);
  const postalCode = normalizePostalCode(input.postalCode);

  if (primaryLine.length === 0) problems.push("empty_street_line");
  if (city.length === 0) problems.push("empty_city");
  if (state.length !== 2) problems.push("invalid_state");
  if (postalCode === null) problems.push("unusable_postal_code");

  const unitPart = unitDesignator
    ? unitValue
      ? `${unitDesignator} ${unitValue}`
      : unitDesignator
    : null;

  const line1 = unitPart ? `${primaryLine} ${unitPart}` : primaryLine;

  const keyable = primaryLine.length > 0 && city.length > 0 && state.length === 2;
  const normalizedKey = keyable ? `${line1}|${city}|${state}` : "";

  return {
    normalizedKey,
    line1,
    line2: unitPart,
    city,
    state,
    postalCode,
    hasUnit: unitDesignator !== null,
    problems,
  };
}

export { STREET_SUFFIXES, DIRECTIONALS, UNIT_DESIGNATORS };
