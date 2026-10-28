// finance-validators — Cloudflare Worker
// 5 валідаторів: IBAN, VAT, SWIFT, LEI, Credit Card
// CORS enabled

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ============ IBAN ============
const IBAN_LENGTHS = {
  AD:24, AE:23, AL:28, AT:20, AZ:28, BA:20, BE:16, BG:22, BH:22, BR:29,
  BY:28, CH:21, CR:22, CY:28, CZ:24, DE:22, DK:18, DO:28, EE:20, EG:29,
  ES:24, FI:18, FO:18, FR:27, GB:22, GE:22, GI:23, GL:18, GR:27, GT:28,
  HR:21, HU:28, IE:22, IL:23, IQ:23, IS:26, IT:27, JO:30, KW:30, KZ:20,
  LB:28, LC:32, LI:21, LT:20, LU:20, LV:21, MC:27, MD:24, ME:22, MK:19,
  MR:27, MT:31, MU:30, NL:18, NO:15, PK:24, PL:28, PS:29, PT:25, QA:29,
  RO:24, RS:22, SA:24, SC:31, SE:24, SI:19, SK:24, SM:27, ST:25, SV:28,
  TL:23, TN:24, TR:26, UA:29, VA:22, VG:24, XK:20,
};

function mod97(str) {
  // Move first 4 chars to the end (for IBAN)
  const rearranged = str.slice(4) + str.slice(0, 4);
  let expanded = "";
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      expanded += ch;
    } else {
      expanded += (code - 55).toString();
    }
  }
  let remainder = 0;
  for (const ch of expanded) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder;
}

function validateIBAN(raw) {
  if (!raw || typeof raw !== "string") {
    return { valid: false, error: "Missing or invalid IBAN" };
  }
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (iban.length < 5) return { valid: false, iban, error: "IBAN too short" };

  const country = iban.slice(0, 2);
  const expectedLen = IBAN_LENGTHS[country];
  if (!expectedLen) return { valid: false, iban, country_code: country, error: "Unknown country code" };
  if (iban.length !== expectedLen) {
    return { valid: false, iban, country_code: country, expected_length: expectedLen, actual_length: iban.length, error: "Invalid length" };
  }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
    return { valid: false, iban, country_code: country, error: "Invalid format" };
  }
  const rem = mod97(iban);
  if (rem !== 1) return { valid: false, iban, country_code: country, checksum: rem, error: "Checksum failed" };

  return {
    valid: true,
    iban,
    country_code: country,
    check_digits: iban.slice(2, 4),
    bban: iban.slice(4),
    length: iban.length,
  };
}

// ============ VAT (format only, no VIES) ============
const VAT_PATTERNS = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE\d[A-Z0-9]\d{5}[A-Z]$/,
  IT: /^IT\d{11}$/,
  LT: /^LT\d{9}$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
  GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

function validateVAT(raw) {
  if (!raw || typeof raw !== "string") return { valid: false, error: "Missing or invalid VAT ID" };
  const vat = raw.replace(/\s+/g, "").toUpperCase();
  if (vat.length < 4) return { valid: false, vat_id: vat, error: "Too short" };

  const country = vat.slice(0, 2);
  const pattern = VAT_PATTERNS[country];
  if (!pattern) return { valid: false, vat_id: vat, country_code: country, error: "Unknown country code (format-only check, no VIES)" };

  const valid = pattern.test(vat);
  return {
    valid,
    vat_id: vat,
    country_code: country,
    format_ok: valid,
    note: "Format-only validation. VIES registration check requires a real EU VIES API call.",
    error: valid ? undefined : "Invalid format for " + country,
  };
}

// ============ SWIFT / BIC ============
function validateSWIFT(raw) {
  if (!raw || typeof raw !== "string") return { valid: false, error: "Missing or invalid SWIFT code" };
  const code = raw.replace(/\s+/g, "").toUpperCase();
  if (![8, 11].includes(code.length)) return { valid: false, code, error: "SWIFT must be 8 or 11 characters" };
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(code)) {
    return { valid: false, code, error: "Invalid SWIFT format" };
  }
  return {
    valid: true,
    code,
    bank_code: code.slice(0, 4),
    country_code: code.slice(4, 6),
    location_code: code.slice(6, 8),
    branch_code: code.length === 11 ? code.slice(8, 11) : "XXX",
    is_primary_office: code.length === 8 || code.slice(8, 11) === "XXX",
  };
}

// ============ LEI ============
// LEI uses mod-97-10 algorithm (ISO 17442), NOT mod-97-1 like IBAN.
// Algorithm:
//   1. Take first 18 chars, append "00"
//   2. Expand letters: A=10, ..., Z=35
//   3. Compute mod 97 of the big number
//   4. Check digits = 98 - remainder (2 digits)
//   5. Compare with chars 19-20 of the LEI
function validateLEI(raw) {
  if (!raw || typeof raw !== "string") return { valid: false, error: "Missing or invalid LEI" };
  const lei = raw.replace(/\s+/g, "").toUpperCase();
  if (lei.length !== 20) return { valid: false, lei, error: "LEI must be exactly 20 characters" };
  if (!/^[A-Z0-9]{20}$/.test(lei)) return { valid: false, lei, error: "LEI must be alphanumeric" };

  const payload = lei.slice(0, 18) + "00";
  let expanded = "";
  for (const ch of payload) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      expanded += ch;
    } else {
      expanded += (code - 55).toString();
    }
  }
  let remainder = 0;
  for (const ch of expanded) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  const expected = (98 - remainder).toString().padStart(2, "0");
  const actual = lei.slice(18, 20);
  const valid = expected === actual;

  return {
    valid,
    lei,
    lou_prefix: lei.slice(0, 4),
    reserved: lei.slice(4, 6),
    entity_id: lei.slice(6, 18),
    check_digits: actual,
    expected_check_digits: expected,
    error: valid ? undefined : "Checksum failed (expected " + expected + ", got " + actual + ")",
  };
}

// ============ Credit Card (Luhn + brand) ============
function detectCardBrand(num) {
  if (/^4/.test(num)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(num)) return "mastercard";
  if (/^3[47]/.test(num)) return "amex";
  if (/^6(?:011|5)/.test(num)) return "discover";
  if (/^3(?:0[0-5]|[68])/.test(num)) return "diners";
  if (/^(?:2131|1800|35\d{3})/.test(num)) return "jcb";
  if (/^(?:5[06-8]|6\d)/.test(num)) return "maestro";
  if (/^62/.test(num)) return "unionpay";
  return "unknown";
}

function luhn(num) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = parseInt(num[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validateCard(raw) {
  if (!raw || typeof raw !== "string") return { valid: false, error: "Missing or invalid card number" };
  const num = raw.replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(num)) return { valid: false, card_number: num, error: "Card number must be 12–19 digits" };

  const brand = detectCardBrand(num);
  const luhn_ok = luhn(num);
  const length_ok =
    (brand === "visa" && [13, 16, 19].includes(num.length)) ||
    (brand === "mastercard" && num.length === 16) ||
    (brand === "amex" && num.length === 15) ||
    (brand === "discover" && [16, 19].includes(num.length)) ||
    (["diners", "jcb", "maestro", "unionpay", "unknown"].includes(brand));

  const valid = luhn_ok && length_ok;
  return {
    valid,
    card_number: num,
    brand,
    luhn_ok,
    length_ok,
    last4: num.slice(-4),
    length: num.length,
    note: "Format-only check. Does not verify if card is active.",
    error: valid ? undefined : (!luhn_ok ? "Luhn checksum failed" : "Invalid length for brand"),
  };
}

// ============ ROUTER ============
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      if (path === "/health" || path === "/") {
        return json({
          status: "healthy",
          service: "finance-validators",
          version: "1.0.1",
          endpoints: ["/iban", "/vat", "/swift", "/lei", "/card"],
          timestamp: new Date().toISOString(),
        });
      }

      if (path === "/iban") {
        const v = await readValue(request);
        if (v.error) return json({ error: v.error }, 400);
        return json(validateIBAN(v.value));
      }
      if (path === "/vat") {
        const v = await readValue(request);
        if (v.error) return json({ error: v.error }, 400);
        return json(validateVAT(v.value));
      }
      if (path === "/swift") {
        const v = await readValue(request);
        if (v.error) return json({ error: v.error }, 400);
        return json(validateSWIFT(v.value));
      }
      if (path === "/lei") {
        const v = await readValue(request);
        if (v.error) return json({ error: v.error }, 400);
        return json(validateLEI(v.value));
      }
      if (path === "/card") {
        const v = await readValue(request);
        if (v.error) return json({ error: v.error }, 400);
        return json(validateCard(v.value));
      }

      if (path === "/validate" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || !body.type || !body.value) return json({ error: "Body must be {type, value}" }, 400);
        const map = { iban: validateIBAN, vat: validateVAT, swift: validateSWIFT, lei: validateLEI, card: validateCard };
        const fn = map[body.type.toLowerCase()];
        if (!fn) return json({ error: "Unknown type. Use: iban, vat, swift, lei, card" }, 400);
        return json(fn(body.value));
      }

      return json({ error: "Not found", path }, 404);
    } catch (err) {
      return json({ error: "Internal error", message: String(err) }, 500);
    }
  },
};

async function readValue(request) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const v = url.searchParams.get("value");
    if (!v) return { error: "Missing ?value= query parameter" };
    return { value: v };
  }
  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.value) return { error: "Body must be {\"value\": \"...\"}" };
    return { value: body.value };
  }
  return { error: "Method not allowed. Use GET or POST." };
}