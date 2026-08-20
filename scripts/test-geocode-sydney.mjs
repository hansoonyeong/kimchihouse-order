/**
 * Sydney address normalize + scoring regression (offline).
 * Optional: LIVE=1 node scripts/test-geocode-sydney.mjs  (Nominatim ~1req/s)
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadIife(rel) {
  const code = fs.readFileSync(path.join(root, rel), "utf8");
  const sandbox = {
    console,
    fetch: globalThis.fetch.bind(globalThis),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    URLSearchParams,
    localStorage: {
      _d: {},
      getItem(k) {
        return this._d[k] || null;
      },
      setItem(k, v) {
        this._d[k] = String(v);
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = undefined; // force User-Agent header path
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

const normalizeBox = loadIife("assets/delivery-routes/lib/address-normalize.js");
const geocodeBox = loadIife("assets/delivery-routes/lib/geocode-provider.js");
geocodeBox.KHAddressNormalize = normalizeBox.KHAddressNormalize;

const N = normalizeBox.KHAddressNormalize;
const G = geocodeBox.KHGeocode;

const SAMPLES = [
  { address: "Shop 1 / 33 Railway pde., Eastwood", suburb: "Eastwood", postcode: "2122" },
  { address: "6 Lantry ave, Auburn", suburb: "Auburn", postcode: "2144" },
  { address: "12 High St", suburb: "Parramatta", postcode: "2150" },
  { address: "Unit 5, 88 Church St", suburb: "Lidcombe", postcode: "2141" },
  { address: "Suite 2 / 10 George Rd.", suburb: "Strathfield", postcode: "2135" },
  { address: "Level 1 200 Pacific Hwy", suburb: "Crows Nest", postcode: "2065" },
  { address: "45 Beecroft Rd", suburb: "Beecroft", postcode: "2119" },
  { address: "7 Pennant Hills Rd", suburb: "Carlingford", postcode: "2118" },
  { address: "3/15 Barton Rd", suburb: "Artarmon", postcode: "2064" },
  { address: "U12 / 22 Victoria Ave", suburb: "Chatswood", postcode: "2067" },
  { address: "101 Victoria Rd", suburb: "Gladesville", postcode: "2111" },
  { address: "9 Blaxland Rd", suburb: "Ryde", postcode: "2112" },
  { address: "55 Rowe St", suburb: "Eastwood", postcode: "2122" },
  { address: "2 Midson Rd", suburb: "Eastwood", postcode: "2122" },
  { address: "18 The Boulevarde", suburb: "Strathfield", postcode: "2135" },
  { address: "30 Marion St", suburb: "Harris Park", postcode: "2150" },
  { address: "1 Olympic Bvd", suburb: "Sydney Olympic Park", postcode: "2127" },
  { address: "8 Hillcrest Ave", suburb: "Hurstville", postcode: "2220" },
  { address: "14 Forest Rd", suburb: "Hurstville", postcode: "2220" },
  { address: "6 Woniora Rd", suburb: "Hurstville", postcode: "2220" },
  { address: "22 Woniora Rd", suburb: "South Hurstville", postcode: "2221" },
  { address: "Shop 3, 120 Beamish St", suburb: "Campsie", postcode: "2194" },
  { address: "Apartment 10 / 5 Park Ave", suburb: "Ashfield", postcode: "2131" },
  { address: "16 Liverpool Rd", suburb: "Ashfield", postcode: "2131" },
  { address: "4 Anzac Pde", suburb: "Kensington", postcode: "2033" },
  { address: "9 Alison Rd", suburb: "Randwick", postcode: "2031" },
  { address: "77 Oxford St", suburb: "Bondi Junction", postcode: "2022" },
  { address: "2 Bronte Rd", suburb: "Bondi Junction", postcode: "2022" },
  { address: "11 King St", suburb: "Newtown", postcode: "2042" },
  { address: "50 King St", suburb: "Newtown", postcode: "2042" },
  { address: "8 Missenden Rd", suburb: "Camperdown", postcode: "2050" },
  { address: "25 Glebe Point Rd", suburb: "Glebe", postcode: "2037" },
  { address: "3 Crescent St", suburb: "Hunters Hill", postcode: "2110" },
  { address: "17 Gale St", suburb: "Woolwich", postcode: "2110" },
  { address: "Lantry ave Auburn", suburb: "Auburn", postcode: "" }, // missing house → review
];

function mockHitFromParsed(p, { house = true, postcode = true, suburb = true, road = true } = {}) {
  return {
    lat: -33.79,
    lon: 151.08,
    class: "place",
    type: "house",
    display_name: `${p.street}, ${p.suburb}`,
    address: {
      house_number: house ? p.houseNumber : "",
      road: road ? `${p.streetName} ${p.streetType}` : "",
      suburb: suburb ? p.suburb : "Wrongville",
      postcode: postcode ? p.postcode || "2000" : "2999",
      state: "New South Wales",
    },
  };
}

let parseOk = 0;
let verifyOk = 0;
let partialOk = 0;
let reviewOk = 0;
const failures = [];

console.log("=== Offline normalize + score (n=%d) ===\n", SAMPLES.length);

for (const s of SAMPLES) {
  const original = s.address;
  const p = N.parseAustralianAddress(s);
  const originalUnchanged = p.originalAddress === original;
  const hasNorm = Boolean(p.normalizedAddress);
  const unitSeparated = !p.unit || !String(p.geocodeStreet).toLowerCase().includes("shop");

  const perfect = mockHitFromParsed(p);
  const scored = G.pickBest([perfect], p);
  const decision = G.decideAutoVerify(scored[0], p, scored);

  const mismatchHit = mockHitFromParsed(p, { postcode: false, suburb: false });
  const mismatchScored = G.pickBest([mismatchHit], p);
  const mismatchDecision = G.decideAutoVerify(mismatchScored[0], p, mismatchScored);

  let bucket = "review";
  if (decision.approve) {
    bucket = "verified";
    verifyOk += 1;
  } else if ((scored[0]?.score || 0) >= 75) {
    bucket = "partial";
    partialOk += 1;
  } else {
    reviewOk += 1;
  }

  const okParse =
    originalUnchanged &&
    hasNorm &&
    unitSeparated &&
    p.state === "NSW" &&
    p.country === "Australia" &&
    (!s.postcode || p.postcode === s.postcode);

  if (okParse) parseOk += 1;
  else failures.push({ type: "parse", original, p });

  if (mismatchDecision.approve) {
    failures.push({ type: "safety", original, reason: "mismatch auto-approved" });
  }

  // Expect: with house+pc → verified; without house → not verified
  if (p.houseNumber && p.postcode && p.streetName && !decision.approve) {
    failures.push({
      type: "expect-verify",
      original,
      score: scored[0]?.score,
      reason: decision.reviewReason,
      normalized: p.normalizedAddress,
    });
  }
  if (!p.houseNumber && decision.approve) {
    failures.push({ type: "expect-review", original, score: scored[0]?.score });
  }

  console.log(
    [
      bucket.padEnd(8),
      String(scored[0]?.score ?? "-").padStart(3),
      original.slice(0, 36).padEnd(36),
      "→",
      p.normalizedAddress,
      p.unit ? `(unit=${p.unit})` : "",
    ].join(" ")
  );
}

console.log("\nParse OK: %d/%d", parseOk, SAMPLES.length);
console.log("Offline mock verify: %d | partial: %d | review: %d", verifyOk, partialOk, reviewOk);
console.log("Failures: %d", failures.length);
if (failures.length) console.log(failures.slice(0, 12));

if (process.env.LIVE === "1") {
  console.log("\n=== Live Nominatim (rate-limited) ===\n");
  const provider = new G.NominatimStructuredProvider();
  const svc = new G.PipelineGeocodeService(provider);
  let liveOk = 0;
  const liveSamples = SAMPLES.filter((s) => s.postcode).slice(0, 30);
  for (let i = 0; i < liveSamples.length; i++) {
    const s = liveSamples[i];
    const order = {
      id: `T${i}`,
      originalAddress: s.address,
      address: s.address,
      suburb: s.suburb,
      postcode: s.postcode,
      name: `Sample ${i + 1}`,
    };
    await svc.geocodeOrder(order, { force: true });
    const ok = order.verificationStatus === "verified" && order.lat != null;
    if (ok) liveOk += 1;
    console.log(
      `${ok ? "OK" : "NR"} ${i + 1}/${liveSamples.length} score=${order.geocodeScore ?? "-"} ${s.address} → ${
        order.verificationStatus
      } ${order.reviewReason || ""}`
    );
  }
  console.log(
    `\nLive auto-verify: ${liveOk}/${liveSamples.length} (${Math.round((100 * liveOk) / liveSamples.length)}%)`
  );
}

process.exit(failures.length ? 1 : 0);
