// Unit tests for src/lib/ingest/normalize.ts — the address dedup anchor.
//
//   node --test scripts/test-normalize.mjs
//   node scripts/test-normalize.mjs          (node:test runs on plain execution too)
//
// Uses node:test + node:assert so there is no test-framework dependency.
// Node >= 22.18 strips the TypeScript types on import.
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAddress,
  normalizeCity,
  normalizePostalCode,
} from "../src/lib/ingest/normalize.ts";

const FARGO = { city: "Fargo", state: "ND", postalCode: "58102" };
const key = (line1, extra = {}) =>
  normalizeAddress({ line1, ...FARGO, ...extra }).normalizedKey;

// -----------------------------------------------------------------------------
test("determinism: same input always yields the same key", () => {
  for (let i = 0; i < 50; i += 1) {
    assert.equal(key("2577 Pacific Dr S Unit 408"), "2577 PACIFIC DR S UNIT 408|FARGO|ND");
  }
});

test("idempotence: normalising a normalised line is a no-op", () => {
  const inputs = [
    "2577 Pacific Dr. S, Unit 408",
    "1220 Main Ave Unit 1A1",
    "909 19th Ave N",
    "3400 48 AVE N",
    "1101 22 St S Unit C7",
  ];
  for (const raw of inputs) {
    const once = normalizeAddress({ line1: raw, ...FARGO });
    const twice = normalizeAddress({ line1: once.line1, ...FARGO });
    assert.equal(twice.normalizedKey, once.normalizedKey, raw);
    assert.equal(twice.line1, once.line1, raw);
  }
});

// -----------------------------------------------------------------------------
test("unit designators are PRESERVED — the duplex rule", () => {
  const a = key("1220 Main Ave Unit 1A1");
  const b = key("1220 Main Ave Unit 1A2");
  const bare = key("1220 Main Ave");
  assert.notEqual(a, b, "two units of one building must not merge");
  assert.notEqual(a, bare, "a unit must not merge into the building address");
  assert.equal(a, "1220 MAIN AVE UNIT 1A1|FARGO|ND");
});

test("# becomes UNIT and still keeps the value distinct", () => {
  assert.equal(key("1220 Main Ave #1A1"), key("1220 Main Ave Unit 1A1"));
  assert.equal(key("1220 Main Ave # 4"), "1220 MAIN AVE UNIT 4|FARGO|ND");
  assert.notEqual(key("1220 Main Ave #4"), key("1220 Main Ave #5"));
});

test("designator synonyms converge, values never do", () => {
  assert.equal(key("500 Broadway N Apartment 3"), key("500 Broadway N Apt 3"));
  assert.equal(key("500 Broadway N Suite 3"), key("500 Broadway N Ste 3"));
  assert.notEqual(key("500 Broadway N Apt 3"), key("500 Broadway N Apt 3B"));
});

test("standalone designators are kept", () => {
  const r = normalizeAddress({ line1: "812 7th St N Rear", ...FARGO });
  assert.equal(r.hasUnit, true);
  assert.equal(r.line2, "REAR");
  assert.equal(r.normalizedKey, "812 7 ST N REAR|FARGO|ND");
});

test("line2 is folded into the same key as an inline unit", () => {
  const inline = normalizeAddress({ line1: "500 Broadway N Apt 3", ...FARGO });
  const split = normalizeAddress({ line1: "500 Broadway N", line2: "Apt 3", ...FARGO });
  assert.equal(split.normalizedKey, inline.normalizedKey);
});

// -----------------------------------------------------------------------------
test("street names that contain unit words are not split", () => {
  // KEY, UNION and LOT all appear in the designator table.
  assert.equal(normalizeAddress({ line1: "1234 Key West Dr", ...FARGO }).hasUnit, false);
  assert.equal(normalizeAddress({ line1: "1234 Union Ave", ...FARGO }).hasUnit, false);
  assert.equal(key("1234 Key West Dr"), "1234 KEY WEST DR|FARGO|ND");
});

// -----------------------------------------------------------------------------
test("suffix canonicalisation converges spellings", () => {
  assert.equal(key("100 Main Street"), key("100 Main St"));
  assert.equal(key("100 Oak Avenue"), key("100 Oak Ave"));
  assert.equal(key("100 Elm Boulevard"), key("100 Elm Blvd"));
  assert.equal(key("100 Cedar Drive"), key("100 Cedar Dr"));
  assert.equal(key("100 Birch Court"), key("100 Birch Ct"));
  assert.equal(key("100 Ash Parkway"), key("100 Ash Pkwy"));
});

test("suffix folding is positional, so street names survive", () => {
  // A blanket fold would turn these into "LK SHR DR" and "PARK RIV RD".
  assert.equal(key("300 Lake Shore Dr"), "300 LAKE SHORE DR|FARGO|ND");
  assert.equal(key("300 Park River Rd"), "300 PARK RIVER RD|FARGO|ND");
});

test("directionals canonicalise in the pre and post slots", () => {
  assert.equal(key("2577 Pacific Dr South"), key("2577 Pacific Dr S"));
  assert.equal(key("1400 North Broadway"), key("1400 N Broadway"));
  assert.equal(key("100 Main St Northwest"), key("100 Main St NW"));
});

test("ordinal suffixes on numbered streets are dropped, both directions", () => {
  // Fargo publishes "12 ST N"; other feeds publish "12TH ST N". Same street.
  assert.equal(key("909 19th Ave N"), key("909 19 Ave N"));
  assert.equal(key("1101 22nd St S"), key("1101 22 St S"));
  assert.equal(key("400 1st Ave N"), key("400 1 Ave N"));
  assert.equal(key("400 3rd St S"), key("400 3 St S"));
});

test("punctuation and case are irrelevant; digits are not", () => {
  assert.equal(key("2577 pacific dr. s, unit 408"), key("2577 PACIFIC DR S UNIT 408"));
  assert.equal(key("100 O'Brien St"), key("100 OBRIEN ST"));
  assert.notEqual(key("100 Main St"), key("101 Main St"));
});

test("diacritics fold", () => {
  assert.equal(key("100 Peña Blvd"), key("100 Pena Blvd"));
});

// -----------------------------------------------------------------------------
test("city and state are part of the key, so a shared ZIP cannot collide", () => {
  const fargo = normalizeAddress({ line1: "100 Main St", city: "Fargo", state: "ND", postalCode: "58102" });
  const moorhead = normalizeAddress({ line1: "100 Main St", city: "Moorhead", state: "MN", postalCode: "58102" });
  assert.notEqual(fargo.normalizedKey, moorhead.normalizedKey);
});

test("city directionals canonicalise", () => {
  assert.equal(normalizeCity("West Fargo"), normalizeCity("W Fargo"));
  assert.equal(normalizeCity("  st. paul "), "ST PAUL");
});

// -----------------------------------------------------------------------------
test("postal codes are validated, never repaired", () => {
  assert.equal(normalizePostalCode("58102"), "58102");
  assert.equal(normalizePostalCode("58102-4371"), "58102");
  assert.equal(normalizePostalCode(" 58102 "), "58102");
  // Real values from the Fargo feed that must NOT become a dedup bucket.
  assert.equal(normalizePostalCode("5812"), null);
  assert.equal(normalizePostalCode("99999"), null);
  assert.equal(normalizePostalCode("00000"), null);
  assert.equal(normalizePostalCode(""), null);
  assert.equal(normalizePostalCode(null), null);
  assert.equal(normalizePostalCode("ND 58102"), null);
});

test("unkeyable input reports problems rather than producing a blank key", () => {
  const r = normalizeAddress({ line1: "   ", city: "Fargo", state: "ND", postalCode: "58102" });
  assert.equal(r.normalizedKey, "");
  assert.ok(r.problems.includes("empty_street_line"));

  const z = normalizeAddress({ line1: "100 Main St", city: "Fargo", state: "ND", postalCode: "5812" });
  assert.equal(z.postalCode, null);
  assert.ok(z.problems.includes("unusable_postal_code"));
  // Still keyable — the parcel is real, only the ZIP is not.
  assert.notEqual(z.normalizedKey, "");
});

// -----------------------------------------------------------------------------
test("real rows from the live Fargo layer", () => {
  const cases = [
    ["3400 48 AVE N", "3400 48 AVE N|FARGO|ND"],
    ["1601 43 ST N ", "1601 43 ST N|FARGO|ND"],
    ["2577 PACIFIC DR S UNIT 408", "2577 PACIFIC DR S UNIT 408|FARGO|ND"],
    ["2536 UNIVERSITY DR S UNIT C", "2536 UNIVERSITY DR S UNIT C|FARGO|ND"],
    ["1801 43 ST N UNIT 1A", "1801 43 ST N UNIT 1A|FARGO|ND"],
    ["1400 32 AVE N BLDG 215", "1400 32 AVE N BLDG 215|FARGO|ND"],
    ["5256 50 AVE S STE E104", "5256 50 AVE S STE E104|FARGO|ND"],
    ["3101 US HWY 81 N", "3101 US HWY 81 N|FARGO|ND"],
    ["1220 MAIN AVE UNIT 1A1", "1220 MAIN AVE UNIT 1A1|FARGO|ND"],
  ];
  for (const [raw, expected] of cases) assert.equal(key(raw), expected, raw);
});

test("no two distinct Fargo unit addresses collapse", () => {
  const raws = [
    "1101 22 ST S UNIT C7", "1101 22 ST S UNIT C16", "1101 22 ST S UNIT C2",
    "1101 22 ST S UNIT C11", "1101 22 ST S UNIT C1", "1101 22 ST S UNIT C9",
    "1101 22 ST S UNIT C18", "1101 22 ST S UNIT C8", "1101 22 ST S",
  ];
  const keys = new Set(raws.map((r) => key(r)));
  assert.equal(keys.size, raws.length);
});
