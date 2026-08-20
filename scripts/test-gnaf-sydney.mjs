#!/usr/bin/env node
/**
 * Sydney G-NAF lookup smoke test (20 addresses).
 * Uses local index only — no Nominatim.
 *
 *   npm run import-gnaf -- --sample
 *   npm run test:gnaf
 */

import { getGnafStore, resetGnafStoreCache } from "../api/_lib/gnaf/store.js";
import { lookupGnaf } from "../api/_lib/gnaf/lookup.js";

const CASES = [
  { label: "exact-1", address: "10 High Street, Epping NSW 2121", houseNumber: "10", streetName: "High", streetType: "Street", suburb: "Epping", postcode: "2121", expect: "exact" },
  { label: "exact-2", address: "7 Beecroft Road, Eastwood NSW 2122", houseNumber: "7", streetName: "Beecroft", streetType: "Road", suburb: "Eastwood", postcode: "2122", expect: "exact" },
  { label: "exact-3", address: "15 Blaxland Road, Ryde NSW 2112", houseNumber: "15", streetName: "Blaxland", streetType: "Road", suburb: "Ryde", postcode: "2112", expect: "exact" },
  { label: "exact-4", address: "2 Rider Boulevard, Rhodes NSW 2138", houseNumber: "2", streetName: "Rider", streetType: "Boulevard", suburb: "Rhodes", postcode: "2138", expect: "exact" },
  { label: "exact-5", address: "1 Church Street, Parramatta NSW 2150", houseNumber: "1", streetName: "Church", streetType: "Street", suburb: "Parramatta", postcode: "2150", expect: "exact" },
  { label: "exact-6", address: "20 Restwell Street, Bankstown NSW 2200", houseNumber: "20", streetName: "Restwell", streetType: "Street", suburb: "Bankstown", postcode: "2200", expect: "exact" },
  { label: "exact-7", address: "1 Victor Street, Chatswood NSW 2067", houseNumber: "1", streetName: "Victor", streetType: "Street", suburb: "Chatswood", postcode: "2067", expect: "exact" },
  { label: "exact-8", address: "12 Station Street, Hornsby NSW 2077", houseNumber: "12", streetName: "Station", streetType: "Street", suburb: "Hornsby", postcode: "2077", expect: "exact" },
  { label: "exact-9", address: "8 Burwood Road, Burwood NSW 2134", houseNumber: "8", streetName: "Burwood", streetType: "Road", suburb: "Burwood", postcode: "2134", expect: "exact" },
  { label: "exact-10", address: "3 Defries Avenue, Zetland NSW 2017", houseNumber: "3", streetName: "Defries", streetType: "Avenue", suburb: "Zetland", postcode: "2017", expect: "exact" },
  { label: "exact-11", address: "40 Botany Road, Alexandria NSW 2015", houseNumber: "40", streetName: "Botany", streetType: "Road", suburb: "Alexandria", postcode: "2015", expect: "exact" },
  { label: "exact-12", address: "100 George Street, Sydney NSW 2000", houseNumber: "100", streetName: "George", streetType: "Street", suburb: "Sydney", postcode: "2000", expect: "exact" },
  { label: "norm-1", address: "10 High St, Epping NSW 2121", houseNumber: "10", streetName: "High", streetType: "St", suburb: "Epping", postcode: "2121", expect: "exact" },
  { label: "norm-2", address: "7 Beecroft Rd, Eastwood 2122", houseNumber: "7", streetName: "Beecroft", streetType: "Rd", suburb: "Eastwood", postcode: "2122", expect: "exact" },
  { label: "norm-3", address: "Unit 2/15 Blaxland Rd, Ryde NSW 2112", houseNumber: "15", streetName: "Blaxland", streetType: "Road", suburb: "Ryde", postcode: "2112", expect: "exact" },
  { label: "fuzzy-1", address: "10 High, Epping NSW 2121", houseNumber: "10", streetName: "High", streetType: "", suburb: "Epping", postcode: "2121", expect: "exact|postcode_street|suburb_street|fuzzy" },
  { label: "fuzzy-2", address: "4 Pennant Hills Rd, Carlingford NSW 2118", houseNumber: "4", streetName: "Pennant Hills", streetType: "Road", suburb: "Carlingford", postcode: "2118", expect: "exact|fuzzy" },
  { label: "fail-1", address: "999 Nowhere Road, Epping NSW 2121", houseNumber: "999", streetName: "Nowhere", streetType: "Road", suburb: "Epping", postcode: "2121", expect: "fail" },
  { label: "fail-2", address: "1 Fake Parade, Atlantis NSW 9999", houseNumber: "1", streetName: "Fake", streetType: "Parade", suburb: "Atlantis", postcode: "9999", expect: "fail" },
  { label: "fail-3", address: "50 Unknown Street, Miranda NSW 2228", houseNumber: "50", streetName: "Unknown", streetType: "Street", suburb: "Miranda", postcode: "2228", expect: "fail" },
];

function classify(result) {
  if (!result?.ready) return "not_ready";
  if (result.status === "not_found" || !result.best) return "fail";
  return result.best.matchLevel || "hit";
}

function okExpect(got, expect) {
  if (expect === "fail") return got === "fail";
  return String(expect).split("|").includes(got);
}

async function main() {
  resetGnafStoreCache();
  const store = await getGnafStore();
  console.log("G-NAF store:", store.stats());
  if (!store.isReady()) {
    console.error("❌ G-NAF index not ready. Run: npm run import-gnaf -- --sample");
    process.exit(1);
  }

  const summary = {
    exact: 0,
    postcode_street: 0,
    suburb_street: 0,
    fuzzy: 0,
    fail: 0,
    not_ready: 0,
    pass: 0,
    miss: 0,
  };

  console.log("\n#  Sydney G-NAF test (20)\n");
  console.log("| # | label | result | score | match | address |");
  console.log("|---|-------|--------|-------|-------|---------|");

  CASES.forEach((c, i) => {
    const parsed = {
      houseNumber: c.houseNumber,
      streetName: c.streetName,
      streetType: c.streetType,
      suburb: c.suburb,
      postcode: c.postcode,
      state: "NSW",
    };
    const result = lookupGnaf(store, parsed, { limit: 5 });
    const got = classify(result);
    summary[got] = (summary[got] || 0) + 1;
    const pass = okExpect(got, c.expect);
    if (pass) summary.pass += 1;
    else summary.miss += 1;
    const score = result.best?.score ?? "—";
    const mark = pass ? "✅" : "⚠️";
    console.log(
      `| ${i + 1} | ${c.label} | ${mark} ${got} | ${score} | ${result.best?.matchLevel || "—"} | ${c.address} |`
    );
  });

  console.log("\n========== SUMMARY ==========");
  console.log(`  exact          : ${summary.exact || 0}`);
  console.log(`  postcode_street: ${summary.postcode_street || 0}`);
  console.log(`  suburb_street  : ${summary.suburb_street || 0}`);
  console.log(`  fuzzy          : ${summary.fuzzy || 0}`);
  console.log(`  fail           : ${summary.fail || 0}`);
  console.log(`  expectations   : ${summary.pass} pass / ${summary.miss} miss`);
  console.log("=============================\n");
  console.log("Note: With full NSW G-NAF import, more real addresses become exact hits.");
  console.log("      Nominatim is only used as fallback when G-NAF has no match.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
