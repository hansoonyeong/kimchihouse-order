/**
 * Australian delivery address parsing for geocoding.
 * originalAddress is never mutated — geocoding fields are separate.
 */
(function (global) {
  const STREET_TYPES = [
    { full: "Parade", abbr: ["pde", "pde."] },
    { full: "Road", abbr: ["rd", "rd."] },
    { full: "Street", abbr: ["st", "st."] },
    { full: "Avenue", abbr: ["ave", "ave.", "av", "av."] },
    { full: "Drive", abbr: ["dr", "dr."] },
    { full: "Crescent", abbr: ["cres", "cres.", "cr", "cr."] },
    { full: "Court", abbr: ["ct", "ct."] },
    { full: "Place", abbr: ["pl", "pl."] },
    { full: "Lane", abbr: ["ln", "ln."] },
    { full: "Highway", abbr: ["hwy", "hwy."] },
    { full: "Terrace", abbr: ["tce", "tce.", "ter", "ter."] },
    { full: "Close", abbr: ["cl", "cl."] },
    { full: "Circuit", abbr: ["cct", "cct."] },
    { full: "Boulevard", abbr: ["bvd", "bvd.", "blvd", "blvd."] },
    { full: "Way", abbr: ["way"] },
    { full: "Grove", abbr: ["gr", "gr."] },
    { full: "Parade", abbr: ["parade"] },
  ];

  const FULL_BY_TOKEN = (() => {
    const map = new Map();
    for (const t of STREET_TYPES) {
      map.set(t.full.toLowerCase(), t.full);
      for (const a of t.abbr) map.set(a.replace(/\.$/, "").toLowerCase(), t.full);
      map.set(t.full.toLowerCase(), t.full);
    }
    return map;
  })();

  const STREET_TYPE_RE = new RegExp(
    "\\b(" +
      [
        "parade",
        "road",
        "street",
        "avenue",
        "drive",
        "crescent",
        "court",
        "place",
        "lane",
        "highway",
        "terrace",
        "close",
        "circuit",
        "boulevard",
        "way",
        "grove",
        "pde",
        "rd",
        "st",
        "ave?",
        "av",
        "dr",
        "cres",
        "cr",
        "ct",
        "pl",
        "ln",
        "hwy",
        "tce",
        "ter",
        "cl",
        "cct",
        "bvd",
        "blvd",
        "gr",
      ].join("|") +
      ")\\.?\\b",
    "i"
  );

  function cleanSpaces(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/,\s*,+/g, ", ")
      .trim();
  }

  function titleCaseWords(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }

  function expandStreetTypeToken(token) {
    const key = String(token || "")
      .replace(/\./g, "")
      .toLowerCase()
      .trim();
    return FULL_BY_TOKEN.get(key) || titleCaseWords(token);
  }

  /** Expand all street abbreviations in a free-form line (for display / cache key). */
  function expandAbbreviations(text) {
    let s = String(text || "");
    // longer / dotted forms first
    const ordered = [
      [/\bpde\.?\b/gi, "Parade"],
      [/\bblvd\.?\b/gi, "Boulevard"],
      [/\bbvd\.?\b/gi, "Boulevard"],
      [/\bcres\.?\b/gi, "Crescent"],
      [/\bcct\.?\b/gi, "Circuit"],
      [/\bhwy\.?\b/gi, "Highway"],
      [/\btce\.?\b/gi, "Terrace"],
      [/\bter\.?\b/gi, "Terrace"],
      [/\bave\.?\b/gi, "Avenue"],
      [/\bav\.?\b/gi, "Avenue"],
      [/\brd\.?\b/gi, "Road"],
      [/\bst\.?\b/gi, "Street"],
      [/\bdr\.?\b/gi, "Drive"],
      [/\bct\.?\b/gi, "Court"],
      [/\bpl\.?\b/gi, "Place"],
      [/\bln\.?\b/gi, "Lane"],
      [/\bcl\.?\b/gi, "Close"],
      [/\bcr\.?\b/gi, "Crescent"],
      [/\bgr\.?\b/gi, "Grove"],
    ];
    for (const [re, full] of ordered) s = s.replace(re, full);
    s = s.replace(/([A-Za-z])\.(?=\s|,|$)/g, "$1");
    return cleanSpaces(s);
  }

  function extractPostcode(text) {
    const m = String(text || "").match(/\b(\d{4})\b/);
    return m ? m[1] : "";
  }

  function extractUnitPrefix(raw) {
    const s = String(raw || "").trim();
    if (!s) return { unit: "", rest: "" };

    // Shop 1 / 33 Railway …  | Unit 2, 10 High St
    const labeled = s.match(
      /^((?:shop|unit|apt|apartment|suite|level|lvl|fl(?:oor)?)\s*[\dA-Za-z/\-]+)\s*[/,]\s*(.+)$/i
    );
    if (labeled) {
      return { unit: cleanSpaces(labeled[1]), rest: cleanSpaces(labeled[2]) };
    }

    const labeledSpace = s.match(
      /^((?:shop|unit|apt|apartment|suite|level|lvl|fl(?:oor)?)\s*[\dA-Za-z/\-]+)\s+(.+)$/i
    );
    if (labeledSpace) {
      return { unit: cleanSpaces(labeledSpace[1]), rest: cleanSpaces(labeledSpace[2]) };
    }

    // AU unit/streetNumber: 614/15 Barton Rd
    const slashNums = s.match(/^(\d+[A-Za-z]?)\s*\/\s*(\d+[A-Za-z]?)\s+(.+)$/);
    if (slashNums) {
      return {
        unit: `Unit ${slashNums[1]}`,
        rest: cleanSpaces(`${slashNums[2]} ${slashNums[3]}`),
      };
    }

    // U12 / 10 High St
    const uSlash = s.match(/^(u\s*\d+[A-Za-z]?)\s*[/,]\s*(.+)$/i);
    if (uSlash) {
      return { unit: cleanSpaces(uSlash[1].replace(/^u\s*/i, "Unit ")), rest: cleanSpaces(uSlash[2]) };
    }

    return { unit: "", rest: s };
  }

  function stripTrailingLocality(streetish, suburb, postcode) {
    let s = cleanSpaces(streetish);
    s = s.replace(/,?\s*Australia\s*$/i, "");
    s = s.replace(/,?\s*NSW\b\.?\s*$/i, "");
    if (postcode) {
      s = s.replace(new RegExp(",?\\s*" + postcode + "\\s*$"), "");
    }
    s = s.replace(/\s+NSW\s+\d{4}\s*$/i, "");
    s = s.replace(/\s+NSW\s*$/i, "");
    s = s.replace(/\s+\d{4}\s*$/, "");

    // Only strip suburb when it trails a street-type token
    // (avoids eating "7 Beecroft Rd" when suburb is also Beecroft)
    if (suburb) {
      const esc = suburb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const typeAlt =
        "Parade|Road|Street|Avenue|Drive|Crescent|Court|Place|Lane|Highway|Terrace|Close|Circuit|Boulevard|Way|Grove|Pde|Rd|St|Ave|Av|Dr|Cres|Cr|Ct|Pl|Ln|Hwy|Tce|Ter|Cl|Cct|Bvd|Blvd|Gr";
      const trailingSuburb = new RegExp(
        "\\b(?:" + typeAlt + ")\\.?\\s+" + esc + "\\s*$",
        "i"
      );
      if (trailingSuburb.test(s)) {
        s = s.replace(new RegExp("\\s+" + esc + "\\s*$", "i"), "");
      }
    }
    return cleanSpaces(s.replace(/,\s*$/, ""));
  }

  function parseStreetLine(streetLine) {
    let line = cleanSpaces(streetLine);
    if (!line) {
      return { houseNumber: "", streetName: "", streetType: "", street: "" };
    }

    // house number at start (33, 33A, 12-14)
    let houseNumber = "";
    const hn = line.match(/^(\d+[A-Za-z]?(?:\s*-\s*\d+[A-Za-z]?)?)\s+(.+)$/);
    if (hn) {
      houseNumber = hn[1].replace(/\s+/g, "");
      line = hn[2];
    }

    // street type at end
    let streetType = "";
    let streetName = line;
    const typeMatch = line.match(
      new RegExp(
        "^(.*?)\\s+(" +
          [
            "Parade",
            "Road",
            "Street",
            "Avenue",
            "Drive",
            "Crescent",
            "Court",
            "Place",
            "Lane",
            "Highway",
            "Terrace",
            "Close",
            "Circuit",
            "Boulevard",
            "Way",
            "Grove",
            "Pde",
            "Rd",
            "St",
            "Ave",
            "Av",
            "Dr",
            "Cres",
            "Cr",
            "Ct",
            "Pl",
            "Ln",
            "Hwy",
            "Tce",
            "Ter",
            "Cl",
            "Cct",
            "Bvd",
            "Blvd",
            "Gr",
          ].join("|") +
          ")\\.?(?:\\s*,.*)?$",
        "i"
      )
    );
    if (typeMatch) {
      streetName = cleanSpaces(typeMatch[1]);
      streetType = expandStreetTypeToken(typeMatch[2]);
    } else {
      // try expand then re-parse
      const expanded = expandAbbreviations(line);
      const again = expanded.match(/^(.+?)\s+(Parade|Road|Street|Avenue|Drive|Crescent|Court|Place|Lane|Highway|Terrace|Close|Circuit|Boulevard|Way|Grove)\s*$/i);
      if (again) {
        streetName = cleanSpaces(again[1]);
        streetType = expandStreetTypeToken(again[2]);
      } else {
        streetName = expandAbbreviations(line);
      }
    }

    streetName = titleCaseWords(streetName.replace(/,/g, " ").trim());
    const street = cleanSpaces([houseNumber, streetName, streetType].filter(Boolean).join(" "));
    return { houseNumber, streetName, streetType, street };
  }

  function guessSuburbFromAddress(address, knownSuburb) {
    if (knownSuburb) {
      return titleCaseWords(
        String(knownSuburb)
          .replace(/\([^)]*\)/g, " ")
          .replace(/\bNSW\b/gi, "")
          .replace(/\b\d{4}\b/g, "")
          .trim()
      );
    }
    const parts = String(address || "")
      .split(",")
      .map((p) => cleanSpaces(p))
      .filter(Boolean);
    if (parts.length >= 2) {
      let cand = parts[parts.length - 1]
        .replace(/\bNSW\b/gi, "")
        .replace(/\bAustralia\b/gi, "")
        .replace(/\b\d{4}\b/g, "")
        .trim();
      // if last is only NSW/postcode, use previous
      if (!cand && parts.length >= 3) {
        cand = parts[parts.length - 2]
          .replace(/\bNSW\b/gi, "")
          .replace(/\b\d{4}\b/g, "")
          .trim();
      }
      // "Eastwood NSW 2122" in one segment
      if (!cand) {
        const m = parts[parts.length - 1].match(/^([A-Za-z][A-Za-z\s'-]+?)\s+NSW\b/i);
        if (m) cand = m[1];
      }
      return titleCaseWords(cand);
    }
    // no commas: "... Eastwood NSW 2122"
    const m = String(address || "").match(
      /\b([A-Za-z][A-Za-z\s'-]{1,40}?)\s+NSW(?:\s+\d{4})?\s*$/i
    );
    if (m) return titleCaseWords(m[1]);
    return "";
  }

  /**
   * Structured AU address parse.
   * @returns {{
   *   originalAddress: string,
   *   unit: string,
   *   unitOrShop: string,
   *   houseNumber: string,
   *   streetName: string,
   *   streetType: string,
   *   street: string,
   *   suburb: string,
   *   state: string,
   *   postcode: string,
   *   country: string,
   *   normalizedAddress: string,
   *   geocodeStreet: string,
   *   valid: boolean,
   *   invalidReason?: string
   * }}
   */
  function parseAustralianAddress({ address = "", suburb = "", postcode = "" } = {}) {
    const originalAddress = String(address || "").trim();
    const state = "NSW";
    const country = "Australia";

    if (!originalAddress || originalAddress.length < 3) {
      return {
        originalAddress,
        unit: "",
        unitOrShop: "",
        subpremise: "",
        houseNumber: "",
        streetName: "",
        streetType: "",
        street: "",
        suburb: titleCaseWords(suburb),
        state,
        postcode: String(postcode || "").trim(),
        country,
        normalizedAddress: "",
        geocodeStreet: "",
        valid: false,
        invalidReason: "배송주소 누락/불완전",
      };
    }

    let pc =
      String(postcode || "").trim() ||
      extractPostcode(originalAddress) ||
      extractPostcode(suburb);
    let sub = guessSuburbFromAddress(originalAddress, suburb);

    const { unit, rest } = extractUnitPrefix(originalAddress);
    let streetish = rest || originalAddress;
    // drop suburb/postcode from streetish when embedded
    streetish = streetish.split(",")[0] || streetish;
    streetish = stripTrailingLocality(streetish, sub, pc);

    const parsedStreet = parseStreetLine(streetish);
    const street = parsedStreet.street;
    const geocodeStreet = street; // unit removed

    const normalizedAddress = cleanSpaces(
      [street, sub, pc ? `${state} ${pc}` : state, country].filter(Boolean).join(", ")
    );

    const valid = Boolean(parsedStreet.streetName || parsedStreet.houseNumber);
    return {
      originalAddress,
      unit,
      unitOrShop: unit,
      subpremise: unit,
      houseNumber: parsedStreet.houseNumber,
      streetName: parsedStreet.streetName,
      streetType: parsedStreet.streetType,
      street,
      suburb: sub,
      state,
      postcode: pc,
      country,
      normalizedAddress,
      geocodeStreet,
      streetLine: street,
      queries: [], // legacy; structured pipeline builds its own steps
      valid,
      invalidReason: valid ? undefined : "도로명/번지를 파싱하지 못했습니다",
    };
  }

  /** @deprecated alias — keep for older callers */
  function normalizeDeliveryAddress(opts) {
    const p = parseAustralianAddress(opts);
    return {
      ...p,
      queries: buildLegacyQueries(p),
    };
  }

  function buildLegacyQueries(p) {
    const out = [];
    if (p.street && p.suburb && p.postcode) {
      out.push(`${p.street}, ${p.suburb} NSW ${p.postcode}, Australia`);
    }
    if (p.street && p.suburb) {
      out.push(`${p.street}, ${p.suburb}, NSW, Australia`);
    }
    if (p.streetName && p.streetType && p.suburb && p.postcode) {
      out.push(`${p.streetName} ${p.streetType}, ${p.suburb} NSW ${p.postcode}, Australia`);
    }
    return [...new Set(out)];
  }

  function extractUnitOrShop(address) {
    const { unit, rest } = extractUnitPrefix(address);
    return { unitOrShop: unit, streetPart: rest };
  }

  global.KHAddressNormalize = {
    parseAustralianAddress,
    normalizeDeliveryAddress,
    expandAbbreviations,
    expandStreetTypeToken,
    extractUnitOrShop,
    extractPostcode,
    parseStreetLine,
    STREET_TYPES,
  };
})(typeof window !== "undefined" ? window : globalThis);
