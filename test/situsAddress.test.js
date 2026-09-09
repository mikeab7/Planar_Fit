import { describe, it, expect } from "vitest";
import {
  situsAddress, situsKey, siteNameFromParcel, mailingAddressValues, apprRows, tidyAddressLabel,
} from "../src/workspaces/site-planner/lib/appraisal.js";
import { detectField } from "../src/workspaces/site-planner/lib/counties.js";

/* NEW-2 — the situs address must never resolve to the OWNER'S MAILING address.
 *
 * The repro is a real saved plan: site `sms7v3ua7ksy`, a parcel in WELD COUNTY, COLORADO, named
 * "2221 E LAMAR BLVD STE 790" — FORESTAR (USA) REAL ESTATE GROUP INC's corporate mailing address in
 * Arlington, TEXAS. WELD below is that record's attribute bag, copied verbatim from the row (values
 * intact, only the unrelated columns trimmed), IN THE SERVICE'S OWN KEY ORDER — which matters,
 * because "whichever matching key comes first" is precisely what the old resolver did.
 *
 * Note what the defect was NOT: nothing in `ADDRESS1` says "mail", so excluding a mail/owner/billing
 * key family would not have caught it. The fix is the ordered LADDER — every key is tested against
 * "is this the situs?" before any key is tested against the generic catch-all.
 */
const WELD = {
  LOT: " ",
  CITY: "ARLINGTON",                                   // the MAILING city, on a Colorado parcel
  NAME: "FORESTAR (USA) REAL ESTATE GROUP INC",
  LEGAL: "W2NW4 2-4-68 EXC PT LYING WITHIN COMM N4 SEC COR TH S06D25E 30.118 TPOB…",
  SITUS: "4050 CR 50   JOHNSTOWN",                     // ← the land
  STATE: "TX",
  PARCEL: "106102200011",
  LOCCITY: "JOHNSTOWN",
  ZIPCODE: "760067458",
  ADDRESS1: "2221 E LAMAR BLVD STE 790",               // ← the owner's head office
  ADDRESS2: " ",
  STREETNO: "4050",
  ACCOUNTNO: "R8974495",
  GIS_Acres: 62.6569553033,
  STREETNAME: "CR 50",
};

/* The Texas shape this repo already carries: a county whose records hold BOTH a situs column and a
 * mailing one, under names that both contain "addr". */
const WALLER = {
  PROP_ID: 40594,
  OWNER_NAME: "ACME INDUSTRIAL LP",
  MAIL_ADDR: "PO BOX 1200",
  MAIL_CITY: "HEMPSTEAD",
  SITUS_ADDR: "1234 FM 359",
  LEGAL_DESC: "ABST 100 J SMITH TR 5",
};

describe("situsAddress — the LAND's address, never the owner's mailing address (NEW-2)", () => {
  it("Weld County: SITUS beats ADDRESS1 even though nothing in ADDRESS1 says 'mail'", () => {
    expect(situsKey(WELD)).toBe("SITUS");
    expect(situsAddress(WELD)).toBe("4050 CR 50 JOHNSTOWN"); // padding collapsed
    expect(situsAddress(WELD)).not.toBe("2221 E LAMAR BLVD STE 790");
  });

  it("key ORDER cannot change the answer — the ladder is applied rung by rung", () => {
    // Same record, mailing column listed first (some services do). The old "first matching key
    // wins" resolver flipped on exactly this.
    const reordered = Object.fromEntries(
      [["ADDRESS1", WELD.ADDRESS1], ["ADDRESS2", WELD.ADDRESS2], ...Object.entries(WELD)],
    );
    expect(Object.keys(reordered)[0]).toBe("ADDRESS1");     // the ordering the test depends on
    expect(situsAddress(reordered)).toBe("4050 CR 50 JOHNSTOWN");
  });

  it("Waller shape: SITUS_ADDR beats MAIL_ADDR", () => {
    expect(situsAddress(WALLER)).toBe("1234 FM 359");
  });

  it("a record with ONLY a mailing address yields NO address, not the mailing one", () => {
    expect(situsAddress({ OWNER_NAME: "ACME LP", MAIL_ADDR: "PO BOX 1200" })).toBeNull();
    expect(situsAddress({ OWNER_ADDRESS: "1 CORPORATE WAY", CARE_OF: "TAX DEPT" })).toBeNull();
    // …including the un-named mailing block: numbered address LINES are refused by the generic rung.
    expect(situsAddress({ NAME: "ACME LP", ADDRESS1: "2221 E LAMAR BLVD STE 790", ADDRESS2: " ", CITY: "ARLINGTON" })).toBeNull();
  });

  it("a county that names its situs column plainly still resolves (the generic rung survives)", () => {
    expect(situsAddress({ OWNER: "X", ADDRESS: "500 INDUSTRIAL BLVD" })).toBe("500 INDUSTRIAL BLVD");
    expect(situsAddress({ full_addr: "500 INDUSTRIAL BLVD" })).toBe("500 INDUSTRIAL BLVD");
    expect(situsAddress({ prop_addr: "500 INDUSTRIAL BLVD", MAIL_ADDRESS: "PO BOX 9" })).toBe("500 INDUSTRIAL BLVD");
  });

  it("an empty / whitespace-only situs column falls through instead of winning", () => {
    expect(situsAddress({ SITUS: "   ", PROP_ADDR: "9 REAL ST" })).toBe("9 REAL ST");
    expect(situsAddress({ SITUS: null, ADDRESS: "9 REAL ST" })).toBe("9 REAL ST");
  });

  it("no attrs at all is null, not a crash", () => {
    expect(situsAddress(null)).toBeNull();
    expect(situsAddress({})).toBeNull();
  });
});

describe("mailingAddressValues", () => {
  it("collects the owner-mailing values a name can identify", () => {
    expect(mailingAddressValues(WALLER).has("PO BOX 1200")).toBe(true);
    expect(mailingAddressValues(WALLER).has("1234 FM 359")).toBe(false);
    expect(mailingAddressValues(WELD).has("2221 E LAMAR BLVD STE 790")).toBe(true); // ADDRESS1 = a line
  });
});

describe("siteNameFromParcel — what 'Plan this site' names the plan (NEW-2)", () => {
  it("the Weld plan is named after the LAND, not Forestar's head office", () => {
    const name = siteNameFromParcel(WELD, { searched: "4050 COUNTY ROAD 50", acct: "R8974495" });
    expect(name).toBe("4050 CR 50 JOHNSTOWN");
    expect(name).not.toBe("2221 E LAMAR BLVD STE 790");
  });

  it("falls back to what the user SEARCHED when the record carries no situs", () => {
    const attrs = { NAME: "ACME LP", MAIL_ADDR: "PO BOX 1200" };
    expect(siteNameFromParcel(attrs, { searched: "4050 County Road 50", acct: "R1" })).toBe("4050 County Road 50");
  });

  it("falls back to the account id when there is no situs and nothing was searched", () => {
    expect(siteNameFromParcel({ MAIL_ADDR: "PO BOX 1" }, { acct: "R8974495" })).toBe("R8974495");
    expect(siteNameFromParcel({ MAIL_ADDR: "PO BOX 1" }, {})).toBe("Untitled site");
  });

  it("REFUSES any candidate that equals a mailing value, whatever supplied it", () => {
    // The belt-and-braces guard: even handed the mailing address as a resolved `addr`, the seeded
    // name must not become it.
    const name = siteNameFromParcel(WELD, { addr: "2221 E LAMAR BLVD STE 790", searched: "4050 COUNTY ROAD 50" });
    expect(name).toBe("4050 COUNTY ROAD 50");
  });

  it("never returns the owner's mailing address on any shape in this file", () => {
    for (const attrs of [WELD, WALLER]) {
      const mailed = mailingAddressValues(attrs);
      const name = siteNameFromParcel(attrs, { searched: "123 ANY ST", acct: "R1" });
      expect(mailed.has(name.toUpperCase())).toBe(false);
    }
  });
});

describe("the curated rows + the search field use the same ladder", () => {
  it("apprRows' Situs address row is the situs, not the mailing line", () => {
    const byLabel = Object.fromEntries(apprRows(WELD).map((r) => [r.label, String(r.value)]));
    expect(byLabel["Situs address"]).toBe("4050 CR 50 JOHNSTOWN");
    expect(byLabel.Owner).toBe("FORESTAR (USA) REAL ESTATE GROUP INC");
  });

  it("detectField picks the situs column even when the mailing column is listed first", () => {
    const fields = [{ name: "OBJECTID" }, { name: "ADDRESS1" }, { name: "MAIL_ADDR" }, { name: "SITUS" }];
    expect(detectField(fields, "addr")).toBe("SITUS");
    // …and still answers for a service that only publishes a plain address column.
    expect(detectField([{ name: "OBJECTID" }, { name: "ADDRESS" }], "addr")).toBe("ADDRESS");
    // A service with nothing but a mailing column has no address field to search.
    expect(detectField([{ name: "OBJECTID" }, { name: "MAIL_ADDR" }], "addr")).toBeNull();
    // The id side is untouched.
    expect(detectField([{ name: "prop_id" }, { name: "SITUS" }], "id")).toBe("prop_id");
  });
});

/* NEW-1 (owner report, 2026-09-09) — a project name composed from address parts must drop the
 * parts that came back empty instead of keeping their separators. Both fixtures below are copied
 * verbatim from live sources, measured the same day this item was filed:
 *   - BOWIE is Bowie County's real TxGIO/StratMap record for the "ALUMAX RD, NASH," parcel
 *     (queried live against feature.geographic.texas.gov/.../stratmap_land_parcels_48_most_recent
 *     at the exact coordinates production's duplicate-project row carries) — SITUS_ADDR itself
 *     already reads "ALUMAX RD, NASH," with SITUS_STAT/SITUS_ZIP both blank.
 *   - the Esri Match_addr strings are copied verbatim from a live query against
 *     geocode.arcgis.com for the exact addresses production's two rows are named after.
 */
const BOWIE_ALUMAX = {
  OBJECTID: "1313201", PROP_ID: "16818000123", OWNER_NAME: "SOME OWNER LLC",
  SITUS_ADDR: "ALUMAX RD, NASH,", SITUS_NUM: " ", SITUS_STRE: " ", SITUS_CITY: "NASH",
  SITUS_STAT: " ", SITUS_ZIP: " ", COUNTY: "BOWIE",
  LEGAL_DESC: "NASH BUSINESS PARK PHASE V LOT 1 REPLAT 6516/326 09/18/13 BLK/TRACT 1 6.618 ACRES",
};

describe("tidyAddressLabel — drop empty comma-joined parts instead of keeping their separators (NEW-1)", () => {
  it("all four parts present — unchanged", () => {
    expect(tidyAddressLabel("16000 Aldine Westfield Rd, Houston, Texas, 77032"))
      .toBe("16000 Aldine Westfield Rd, Houston, Texas, 77032");
  });
  it("missing zip only — no trailing separator", () => {
    expect(tidyAddressLabel("16000 Aldine Westfield Rd, Houston, Texas, ")).toBe("16000 Aldine Westfield Rd, Houston, Texas");
  });
  it("missing state only — the empty slot's comma is dropped, not left doubled", () => {
    expect(tidyAddressLabel("16000 Aldine Westfield Rd, Houston, , 77032")).toBe("16000 Aldine Westfield Rd, Houston, 77032");
  });
  it("missing state AND zip — the real production shape (ALUMAX RD, NASH,)", () => {
    expect(tidyAddressLabel("ALUMAX RD, NASH,")).toBe("ALUMAX RD, NASH");
  });
  it("missing city (state/zip present) — the empty middle slot is dropped, not doubled", () => {
    expect(tidyAddressLabel("500 Industrial Blvd, , TX 77447")).toBe("500 Industrial Blvd, TX 77447");
  });
  it("a lookup that returns nothing but a street — unchanged (nothing to drop)", () => {
    expect(tidyAddressLabel("Alumax Rd")).toBe("Alumax Rd");
  });
  it("every part empty — null, so the caller falls through its own ladder", () => {
    expect(tidyAddressLabel(",  ,")).toBeNull();
    expect(tidyAddressLabel("")).toBeNull();
  });
  it("null/undefined in, null out — never throws", () => {
    expect(tidyAddressLabel(null)).toBeNull();
    expect(tidyAddressLabel(undefined)).toBeNull();
  });
  it("a fully-populated label with no empty slot is byte-identical (idempotent)", () => {
    const clean = "1115 E Airtex Dr, Houston, TX 77073";
    expect(tidyAddressLabel(clean)).toBe(clean);
  });
});

describe("siteNameFromParcel never leaves a dangling or doubled separator (NEW-1)", () => {
  it("the real Bowie ALUMAX RD parcel — situs alone, city present, state+zip blank", () => {
    expect(siteNameFromParcel(BOWIE_ALUMAX, {})).toBe("ALUMAX RD, NASH");
  });

  it("the real Harris Match_addr, used as the `searched` fallback when no parcel/situs exists", () => {
    // Copied verbatim from a live geocode.arcgis.com response for this exact address.
    const rawMatchAddr = "16000 Aldine Westfield Rd, Houston, Texas, 77032";
    expect(siteNameFromParcel(null, { searched: rawMatchAddr })).toBe(rawMatchAddr); // fully populated: unchanged
  });

  it("a parcel identifier with no address at all still falls through to the account id (separate question — not fixed here)", () => {
    expect(siteNameFromParcel(null, { acct: "154602" })).toBe("154602");
  });

  // RED-PROOF — this is the invariant the whole item is about. Verified to FAIL on unfixed
  // `main` (`tidyAddressLabel` absent, `siteNameFromParcel` returning the raw candidate): the
  // Bowie case below reads back "ALUMAX RD, NASH," and trips both assertions.
  it.each([
    ["all four parts", { SITUS_ADDR: "500 Industrial Blvd, Katy, TX 77494" }, {}],
    ["missing zip only", { SITUS_ADDR: "500 Industrial Blvd, Katy, TX" }, {}],
    ["missing state only", { SITUS_ADDR: "500 Industrial Blvd, Katy," }, {}],
    ["missing state and zip (the real Bowie shape)", BOWIE_ALUMAX, {}],
    ["missing city", { SITUS_ADDR: "500 Industrial Blvd, , TX 77494" }, {}],
    ["street only, nothing else resolved", null, { searched: "Alumax Rd" }],
  ])("%s — never ends on a separator, never a doubled one", (_label, attrs, opts) => {
    const name = siteNameFromParcel(attrs, opts);
    expect(name).not.toMatch(/[,\s]$/);
    expect(name).not.toMatch(/,\s*,/);
  });
});
