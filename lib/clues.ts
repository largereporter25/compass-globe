// Clue extraction. Pure functions over OCR text — deterministic, inspectable,
// no model inference, no external service. Every clue carries the exact
// substring that triggered it so an investigator can audit the reasoning.

import { CALLING_CODES, CCTLDS, CURRENCY_SIGNS, IN_STATES, SCRIPT_PRIORS } from "./regions";

export type Clue = {
  kind: "script" | "plate" | "phone" | "domain" | "currency" | "toponym";
  frame: number;          // keyframe index the clue came from
  value: string;          // the literal evidence, e.g. "GJ 01 KA 4321"
  rationale: string;      // plain-language explanation
  candidates: { key: string; w: number }[]; // region key -> weight contribution
  needsGeocode?: boolean; // toponyms are resolved against OpenStreetMap later
  priority?: number;      // ordering hint for the limited geocoding budget
};

const PLATE_IN = /\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{3,4})\b/g;
const PLATE_GB = /\b([A-Z]{2}\d{2})\s?([A-Z]{3})\b/g;
const PHONE = /(?:^|[^\d])\+(\d{1,3})[\s-]?(\d[\d\s-]{6,13}\d)/g;
const DOMAIN = /\b(?:[a-z0-9-]+\.)+([a-z]{2,4})\b/gi;

// Tokens that look like proper nouns worth asking OpenStreetMap about.
const TOPONYM = /\b([A-Z][A-Za-z]{3,}(?:[ \t]+[A-Z][A-Za-z]{2,}){0,2})\b/g;
const TOPONYM_STOPWORDS = new Set([
  // Function words and generic signage.
  "THE", "AND", "FOR", "WITH", "FROM", "THIS", "THAT", "YOUR", "ALWAYS", "NOT",
  "OPEN", "CLOSED", "SALE", "FREE", "NEWS", "LIVE", "PRESS", "STOP", "EXIT",
  "ENTER", "ENTRY", "PARKING", "WELCOME", "PLEASE", "CAUTION", "WARNING",
  "DANGER", "NOTICE", "PROHIBITED", "RESTRICTED", "AUTHORISED", "AUTHORIZED",
  // Buildings, facilities and civic vocabulary. These match a street or an
  // amenity in almost every city on Earth, and OSM is far denser in Europe
  // than in South Asia, so leaving them in drags every result westward.
  "POLICE", "HOSPITAL", "SCHOOL", "HOTEL", "RESTAURANT", "BANK", "PHARMACY",
  "MARKET", "STORE", "STATION", "TERMINAL", "AIRPORT", "DEPOT", "GARAGE",
  "COMPANY", "LIMITED", "PRIVATE", "SERVICES", "SOLUTIONS", "CENTRE", "CENTER",
  "MUNICIPAL", "CORPORATION", "GOVERNMENT", "AUTHORITY", "DEPARTMENT",
  "DEVELOPMENT", "INTERNATIONAL", "NATIONAL", "GENERAL", "SPECIAL", "OFFICIAL",
  "MEDICAL", "DENTAL", "TRAVELS", "TRADERS", "ENTERPRISE", "ENTERPRISES",
  "INDUSTRIES", "ELECTRIC", "ELECTRONICS", "FURNITURE", "JEWELLERS", "TAILORS",
  "OPTICAL", "COMPUTERS", "MOBILE", "DIGITAL", "STUDIO", "ACADEMY", "COLLEGE",
  "INSTITUTE", "LIBRARY", "SUPER", "GRAND", "ROYAL", "GOLDEN", "CLASSIC",
  // Ranks, units and desk furniture — extremely common on protest and
  // policing footage, and pure noise for a gazetteer.
  "CONTROL", "ROOM", "COMMAND", "HEADQUARTERS", "OFFICE", "OFFICER", "OFFICERS",
  "COMMISSIONER", "SUPERINTENDENT", "INSPECTOR", "CONSTABLE", "DEPUTY",
  "ASSISTANT", "SENIOR", "JUNIOR", "RESERVE", "BATTALION", "SQUAD", "PATROL",
  "MARSHAL", "SECURITY", "GUARD", "BARRICADE", "CHECKPOINT", "CORDON",
  "EMERGENCY", "RESPONSE", "RESCUE", "AMBULANCE", "GRIEVANCE", "PUBLIC",
  "HELP", "DESK", "COUNTER", "RECEPTION", "VISITOR", "STAFF", "CELL", "UNIT",
  "DIVISION", "BRANCH", "SECTION", "WING", "TRAFFIC", "LINE", "POINT", "CROSS",
  // Address components. Kept out on their own, but still allowed inside a
  // phrase, because "Parliament Street" is a real road in New Delhi.
  "STREET", "ROAD", "AVENUE", "LANE", "MARG", "PATH", "GATE", "BLOCK",
  "SECTOR", "PHASE", "PLOT", "FLOOR", "BUILDING", "TOWER", "COMPLEX",
]);

function uniq<T>(arr: T[], keyer: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((t) => {
    const k = keyer(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function extractClues(frameIndex: number, rawText: string): Clue[] {
  const clues: Clue[] = [];
  const text = (rawText || "").trim();
  if (!text) return clues;
  const upper = text.toUpperCase();

  // 1. Writing system. The single most reliable signal in noisy OCR, because
  //    it survives misrecognised individual characters.
  for (const s of SCRIPT_PRIORS) {
    const m = text.match(s.test);
    if (!m) continue;
    clues.push({
      kind: "script",
      frame: frameIndex,
      value: s.name,
      rationale: `${s.note} detected in on-screen text (first match: "${m[0]}").`,
      candidates: s.candidates,
    });
  }

  // 2. Vehicle registration plates.
  for (const m of Array.from(upper.matchAll(PLATE_IN))) {
    const st = IN_STATES[m[1]];
    if (!st) continue;
    clues.push({
      kind: "plate",
      frame: frameIndex,
      value: `${m[1]} ${m[2]} ${m[3]} ${m[4]}`,
      rationale: `Matches the Indian registration-plate format. The "${m[1]}" prefix is issued in ${st.admin}.`,
      candidates: [{ key: st.key, w: 0.7 }, { key: "IN", w: 0.2 }],
    });
  }
  for (const m of Array.from(upper.matchAll(PLATE_GB))) {
    clues.push({
      kind: "plate",
      frame: frameIndex,
      value: `${m[1]} ${m[2]}`,
      rationale: "Matches the UK post-2001 registration-plate format (two letters, two digits, three letters).",
      candidates: [{ key: "GB", w: 0.45 }],
    });
  }

  // 3. Phone numbers written in international form.
  for (const m of Array.from(text.matchAll(PHONE))) {
    const digits = m[1];
    // Try the longest prefix first: +1, +91 and +977 are all valid lengths.
    const prefix = [digits, digits.slice(0, 2), digits.slice(0, 1)].find((p) => CALLING_CODES[p]);
    if (!prefix) continue;
    const rest = digits.slice(prefix.length);
    clues.push({
      kind: "phone",
      frame: frameIndex,
      value: `+${prefix} ${(rest + " " + m[2]).trim()}`,
      rationale: `International dialling prefix +${prefix} is assigned to this country.`,
      candidates: [{ key: CALLING_CODES[prefix], w: 0.4 }],
    });
  }

  // 4. Country-code top-level domains on signage or vehicle livery.
  for (const m of Array.from(text.matchAll(DOMAIN))) {
    const tld = m[1].toLowerCase();
    const key = CCTLDS[tld];
    if (!key) continue;
    clues.push({
      kind: "domain",
      frame: frameIndex,
      value: m[0],
      rationale: `The .${tld} country-code top-level domain is registered to this country.`,
      candidates: [{ key, w: 0.35 }],
    });
  }

  // 5. Currency symbols on price boards.
  for (const c of CURRENCY_SIGNS) {
    if (!text.includes(c.sign)) continue;
    clues.push({
      kind: "currency",
      frame: frameIndex,
      value: c.sign,
      rationale: `${c.label} present in on-screen text.`,
      candidates: [{ key: c.key, w: 0.3 }],
    });
  }

  // 6. Candidate place names, resolved later against OpenStreetMap.
  const seenNames = new Set<string>();
  const isStop = (w: string) => TOPONYM_STOPWORDS.has(w.toUpperCase());

  for (const m of Array.from(text.matchAll(TOPONYM))) {
    const phrase = m[1].trim();
    const words = phrase.split(/\s+/);
    // Query the whole phrase and its individual words. "DELHI POLICE" fails as
    // a phrase while "Delhi" resolves cleanly, so both have to be tried.
    const variants = words.length > 1 ? [phrase, ...words] : [phrase];

    for (const name of variants) {
      if (name.length < 5 || name.length > 40) continue;
      if (isStop(name)) continue;
      const parts = name.split(/\s+/);
      // Drop a phrase once half or more of it is generic vocabulary. Its
      // distinctive word is still queried on its own.
      if (parts.length > 1 && parts.filter(isStop).length / parts.length >= 0.5) continue;
      if (seenNames.has(name.toUpperCase())) continue;
      seenNames.add(name.toUpperCase());
      clues.push({
        kind: "toponym",
        frame: frameIndex,
        value: name,
        rationale: "Possible place name read from signage. Checked against the OpenStreetMap gazetteer.",
        candidates: [],
        needsGeocode: true,
        // Single distinctive proper nouns resolve far more reliably than long
        // strings of signage text, so they are queried first.
        priority: (parts.length === 1 ? 2 : 0) + (name === name.toUpperCase() ? 0.5 : 0),
      });
    }
  }

  return uniq(clues, (c) => `${c.kind}:${c.value.toUpperCase()}`);
}

export function dedupeClues(clues: Clue[]): Clue[] {
  // Keep the earliest frame for each distinct piece of evidence, but remember
  // how many frames corroborated it — repetition across frames matters.
  const map = new Map<string, Clue & { frames: number[] }>();
  for (const c of clues) {
    const k = `${c.kind}:${c.value.toUpperCase()}`;
    const hit = map.get(k);
    if (hit) hit.frames.push(c.frame);
    else map.set(k, { ...c, frames: [c.frame] });
  }
  return Array.from(map.values()).map((c) => {
    const corroboration = Math.min(1 + (c.frames.length - 1) * 0.15, 1.6);
    return {
      ...c,
      candidates: c.candidates.map((x) => ({ ...x, w: x.w * corroboration })),
      rationale:
        c.frames.length > 1
          ? `${c.rationale} Seen in ${c.frames.length} keyframes (${c.frames.map((f) => `#${f + 1}`).join(", ")}).`
          : c.rationale,
    };
  });
}
