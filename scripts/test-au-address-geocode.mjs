/**
 * AU address parse + structured geocode tests (Sydney samples).
 *
 * Usage:
 *   node scripts/test-au-address-geocode.mjs           # parse + scoring (offline)
 *   node scripts/test-au-address-geocode.mjs --live    # also hit Nominatim (slow)
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const LIVE = process.argv.includes("--live");

function loadIife(rel) {
  const code = fs.readFileSync(path.join(root, rel), "utf8");
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    fetch: globalThis.fetch.bind(globalThis),
    URLSearchParams,
    localStorage: {
      _data: {},
      getItem(k) {
        return this._data[k] ?? null;
      },
      setItem(k, v) {
        this._data[k] = String(v);
      },
      removeItem(k) {
        delete this._data[k];
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  sandbox.dispatchEvent = () => true;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const addrCtx = loadIife("assets/delivery-routes/lib/address-normalize.js");
const geoCtx = loadIife("assets/delivery-routes/lib/geocode-provider.js");
// geocode needs KHAddressNormalize on same global
geoCtx.KHAddressNormalize = addrCtx.KHAddressNormalize;

const N = addrCtx.KHAddressNormalize;
const G = geoCtx.KHGeocode;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const SAMPLES = [
  {
    address: "33 Railway Parade, Eastwood NSW 2122",
    expect: { houseNumber: "33", streetName: "Railway", streetType: "Parade", suburb: "Eastwood", postcode: "2122" },
  },
  {
    address: "Shop 1 / 33 Railway pde., Eastwood NSW 2122",
    expect: {
      unit: "Shop 1",
      houseNumber: "33",
      streetName: "Railway",
      streetType: "Parade",
      suburb: "Eastwood",
      postcode: "2122",
    },
  },
  {
    address: "5 Rosebank Ave, Epping NSW 2121",
    expect: { houseNumber: "5", streetName: "Rosebank", streetType: "Avenue", suburb: "Epping", postcode: "2121" },
  },
  {
    address: "12 Albert Ave, Chatswood NSW 2067",
    expect: { houseNumber: "12", streetName: "Albert", streetType: "Avenue", suburb: "Chatswood", postcode: "2067" },
  },
  {
    address: "25 Church St, Parramatta NSW 2150",
    expect: { houseNumber: "25", streetName: "Church", streetType: "Street", suburb: "Parramatta", postcode: "2150" },
  },
  {
    address: "Unit 2, 10 High St, Strathfield NSW 2135",
    expect: {
      unit: "Unit 2",
      houseNumber: "10",
      streetName: "High",
      streetType: "Street",
      suburb: "Strathfield",
      postcode: "2135",
    },
  },
  {
    address: "614/15 Barton Rd, Artarmon NSW 2064",
    expect: {
      unit: "Unit 614",
      houseNumber: "15",
      streetName: "Barton",
      streetType: "Road",
      suburb: "Artarmon",
      postcode: "2064",
    },
  },
  {
    address: "2/24 Macquarie Rd, Auburn NSW 2144",
    expect: {
      unit: "Unit 2",
      houseNumber: "24",
      streetName: "Macquarie",
      streetType: "Road",
      suburb: "Auburn",
      postcode: "2144",
    },
  },
  {
    address: "6 Lantry ave, Auburn",
    suburb: "Auburn",
    postcode: "2144",
    expect: { houseNumber: "6", streetName: "Lantry", streetType: "Avenue", suburb: "Auburn", postcode: "2144" },
  },
  {
    address: "100 George St, Sydney NSW 2000",
    expect: { houseNumber: "100", streetName: "George", streetType: "Street", suburb: "Sydney", postcode: "2000" },
  },
  {
    address: "1 Martin Pl, Sydney NSW 2000",
    expect: { houseNumber: "1", streetName: "Martin", streetType: "Place", suburb: "Sydney", postcode: "2000" },
  },
  {
    address: "42 Pacific Hwy, Waitara NSW 2077",
    expect: { houseNumber: "42", streetName: "Pacific", streetType: "Highway", suburb: "Waitara", postcode: "2077" },
  },
  {
    address: "8 Victoria Rd, Parramatta NSW 2150",
    expect: { houseNumber: "8", streetName: "Victoria", streetType: "Road", suburb: "Parramatta", postcode: "2150" },
  },
  {
    address: "Level 3 / 50 Miller St, North Sydney NSW 2060",
    expect: {
      unit: "Level 3",
      houseNumber: "50",
      streetName: "Miller",
      streetType: "Street",
      suburb: "North Sydney",
      postcode: "2060",
    },
  },
  {
    address: "Suite 5, 20 Berry St, North Sydney NSW 2060",
    expect: {
      unit: "Suite 5",
      houseNumber: "20",
      streetName: "Berry",
      streetType: "Street",
      suburb: "North Sydney",
      postcode: "2060",
    },
  },
  {
    address: "7 Beecroft Rd, Beecroft NSW 2119",
    expect: { houseNumber: "7", streetName: "Beecroft", streetType: "Road", suburb: "Beecroft", postcode: "2119" },
  },
  {
    address: "15 Railway Pde, Burwood NSW 2134",
    expect: { houseNumber: "15", streetName: "Railway", streetType: "Parade", suburb: "Burwood", postcode: "2134" },
  },
  {
    address: "3/377 Great North Rd, Wareemba NSW 2046",
    expect: {
      unit: "Unit 3",
      houseNumber: "377",
      streetName: "Great North",
      streetType: "Road",
      suburb: "Wareemba",
      postcode: "2046",
    },
  },
  {
    address: "9 Oxford St, Bondi Junction NSW 2022",
    expect: {
      houseNumber: "9",
      streetName: "Oxford",
      streetType: "Street",
      suburb: "Bondi Junction",
      postcode: "2022",
    },
  },
  {
    address: "22 King St, Newtown NSW 2042",
    expect: { houseNumber: "22", streetName: "King", streetType: "Street", suburb: "Newtown", postcode: "2042" },
  },
  {
    address: "4 Crescent St, Haberfield NSW 2045",
    expect: { houseNumber: "4", streetName: "Crescent", streetType: "Street", suburb: "Haberfield", postcode: "2045" },
  },
  {
    address: "11 Boulevard, Strathfield NSW 2135",
    // edge: street type as name — still should parse house + type
    expect: { houseNumber: "11", postcode: "2135", suburb: "Strathfield" },
    soft: true,
  },
];

console.log("\n== Parse Australian addresses ==");
assert(SAMPLES.length >= 20, `sample count >= 20 (got ${SAMPLES.length})`);

for (const sample of SAMPLES) {
  const original = sample.address;
  const parsed = N.parseAustralianAddress({
    address: sample.address,
    suburb: sample.suburb || "",
    postcode: sample.postcode || "",
  });

  assert(parsed.originalAddress === original, `original unchanged: ${original}`);
  if (sample.expect.unit) {
    assert(
      parsed.unit === sample.expect.unit || parsed.unitOrShop === sample.expect.unit,
      `unit=${sample.expect.unit} ← ${parsed.unit} (${original})`
    );
  }
  if (sample.expect.houseNumber) {
    assert(
      parsed.houseNumber === sample.expect.houseNumber,
      `house=${sample.expect.houseNumber} ← ${parsed.houseNumber} (${original})`
    );
  }
  if (sample.expect.streetName) {
    assert(
      parsed.streetName === sample.expect.streetName,
      `streetName=${sample.expect.streetName} ← ${parsed.streetName} (${original})`
    );
  }
  if (sample.expect.streetType) {
    assert(
      parsed.streetType === sample.expect.streetType,
      `streetType=${sample.expect.streetType} ← ${parsed.streetType} (${original})`
    );
  }
  if (sample.expect.suburb) {
    assert(
      parsed.suburb === sample.expect.suburb,
      `suburb=${sample.expect.suburb} ← ${parsed.suburb} (${original})`
    );
  }
  if (sample.expect.postcode) {
    assert(
      parsed.postcode === sample.expect.postcode,
      `postcode=${sample.expect.postcode} ← ${parsed.postcode} (${original})`
    );
  }
  // unit must not appear in geocode street
  if (parsed.unit) {
    assert(
      !/shop|unit|suite|level/i.test(parsed.geocodeStreet),
      `geocodeStreet excludes unit (${parsed.geocodeStreet})`
    );
  }
}

console.log("\n== Abbreviation expansion ==");
assert(N.expandStreetTypeToken("pde") === "Parade", "pde → Parade");
assert(N.expandStreetTypeToken("Pde.") === "Parade", "Pde. → Parade");
assert(N.expandStreetTypeToken("rd") === "Road", "rd → Road");
assert(N.expandStreetTypeToken("St") === "Street", "St → Street");
assert(N.expandStreetTypeToken("Ave") === "Avenue", "Ave → Avenue");
assert(N.expandStreetTypeToken("Hwy") === "Highway", "Hwy → Highway");
assert(N.expandStreetTypeToken("Tce") === "Terrace", "Tce → Terrace");
assert(N.expandStreetTypeToken("Cl") === "Close", "Cl → Close");
assert(N.expandStreetTypeToken("Cct") === "Circuit", "Cct → Circuit");
assert(N.expandStreetTypeToken("Blvd") === "Boulevard", "Blvd → Boulevard");

console.log("\n== Candidate scoring ==");
{
  const parsed = N.parseAustralianAddress({
    address: "33 Railway Parade, Eastwood NSW 2122",
  });
  const good = {
    address: {
      house_number: "33",
      road: "Railway Parade",
      suburb: "Eastwood",
      postcode: "2122",
      state: "New South Wales",
    },
  };
  const suburbOnly = {
    class: "place",
    type: "suburb",
    address: { suburb: "Eastwood", postcode: "2122", state: "New South Wales" },
  };
  const { score } = G.scoreCandidate(good, parsed);
  assert(score === 100, `perfect score 100 ← ${score}`);
  assert(G.hasStreetLevel(good), "good hit is street-level");
  assert(G.isSuburbCentroid(suburbOnly), "suburb centroid detected");
  assert(!G.hasStreetLevel(suburbOnly), "suburb centroid not street-level");
}

console.log("\n== Fallback steps (D not auto-approve) ==");
{
  const parsed = N.parseAustralianAddress({
    address: "Shop 1 / 33 Railway pde., Eastwood NSW 2122",
  });
  const steps = G.buildFallbackSteps(parsed);
  assert(steps.some((s) => s.id === "A" && s.autoApprove), "step A auto");
  assert(steps.some((s) => s.id === "D" && !s.autoApprove), "step D reference-only");
  assert(
    steps.every((s) => !("q" in (s.params || {}))),
    "no free-form q= in structured params"
  );
}

if (LIVE) {
  console.log("\n== Live Nominatim structured geocode ==");
  if (process.argv.includes("--debug")) G.setDebugEnabled(true);
  const service = new G.PipelineGeocodeService(new G.NominatimStructuredProvider());
  const liveSamples = SAMPLES.filter((s) => !s.soft).slice(0, 20);
  let verified = 0;
  let review = 0;
  let withSuggestion = 0;
  for (const sample of liveSamples) {
    const order = {
      id: "T",
      originalAddress: sample.address,
      address: sample.address,
      suburb: sample.suburb || "",
      postcode: sample.postcode || "",
    };
    await service.geocodeOrder(order, { force: true });
    const ok = order.verificationStatus === "verified" || order.geocodingStatus === "ok";
    if (ok) verified += 1;
    else review += 1;
    if (order.suggestedLat != null && order.suggestedLng != null) withSuggestion += 1;
    const coord =
      order.lat != null
        ? `${order.lat.toFixed(5)},${order.lng.toFixed(5)}`
        : order.suggestedLat != null
          ? `suggest ${order.suggestedLat.toFixed(5)},${order.suggestedLng.toFixed(5)} · ${order.reviewReason}`
          : order.reviewReason;
    console.log(
      `  ${ok ? "OK" : "RV"} ${order.verificationStatus || order.geocodingStatus} · ${sample.address} → ${coord}`
    );
    assert(order.originalAddress === sample.address, `live original preserved: ${sample.address}`);
  }
  assert(verified >= 8, `live verified >= 8 (got ${verified}, review ${review})`);
  assert(
    verified + withSuggestion >= 14,
    `live verified+suggested >= 14 (verified ${verified}, suggested ${withSuggestion})`
  );
} else {
  console.log("\n(skip live Nominatim — pass --live to run)");
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
