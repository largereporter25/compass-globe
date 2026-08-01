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
};

const PLATE_IN = /\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{3,4})\b/g;
const PLATE_GB = /\b([A-Z]{2}\d{2})\s?([A-Z]{3})\b/g;
const PHONE = /(?:^|[^\d])\+(\d{1,3})[\s-]?(\d[\d\s-]{6,13}\d)/g;
const DOMAIN = /\b(?:[a-z0-9-]+\.)+([a-z]{2,4})\b/gi;

// Tokens that look like proper nouns worth asking OpenStreetMap about.
const TOPONYM = /\b([A-Z][A-Za-z]{3,}(?:[ \t]+[A-Z][A-Za-z]{2,}){0,2})\b/g;
const TOPONYM_STOPWORDS = new Set([
  "THE", "AND", "FOR", "WITH", "FROM", "THIS", "THAT", "YOUR", "OPEN", "CLOSED",
  "SALE", "FREE", "NEWS", "LIVE", "PRESS", "STOP", "EXIT", "ENTER", "PARKING",
  "WELCOME", "PLEASE", "CAUTION", "WARNING", "DANGER", "POLICE", "HOSPITAL",
  "SCHOOL", "HOTEL", "RESTAURANT", "BANK", "PHARMACY", "MARKET", "STORE",
  "COMPANY", "LIMITED", "PRIVATE", "SERVICES", "SOLUTIONS", "CENTRE", "CENTER",
  // Generic institutional and commercial words. Left in, they geocode to
  // arbitrary streets on the other side of the planet and pollute the ledger.
  "MUNICIPAL", "CORPORATION", "GOVERNMENT", "AUTHORITY", "DEPARTMENT",
  "DEVELOPMENT", "INTERNATIONAL", "NATIONAL", "GENERAL", "SPECIAL", "OFFICIAL",
  "MEDICAL", "DENTAL", "TRAVELS", "TRADERS", "ENTERPRISE", "ENTERPRISES",
  "INDUSTRIES", "ELECTRIC", "ELECTRONICS", "FURNITURE", "JEWELLERS", "TAILORS",
  "OPTICAL", "COMPUTERS", "MOBILE", "DIGITAL", "STUDIO", "ACADEMY", "COLLEGE",
  "INSTITUTE", "LIBRARY", "SUPER", "GRAND", "ROYAL", "GOLDEN", "CLASSIC",
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
  for (const m of Array.from(text.matchAll(TOPONYM))) {
    const phrase = m[1].trim();
    // Query the whole phrase and its individual words. "ASHRAM ROAD Ahmedabad"
    // may fail as one string while "Ahmedabad" resolves cleanly.
    const words = phrase.split(/\s+/);
    const variants = words.length > 1 ? [phrase, ...words] : [phrase];
    for (const name of variants) {
      if (name.length < 5 || name.length > 40) continue;
      if (TOPONYM_STOPWORDS.has(name.toUpperCase())) continue;
      if (name.split(/\s+/).every((w) => TOPONYM_STOPWORDS.has(w.toUpperCase()))) continue;
      if (seenNames.has(name.toUpperCase())) continue;
      seenNames.add(name.toUpperCase());
      clues.push({
        kind: "toponym",
        frame: frameIndex,
        value: name,
        rationale: "Possible place name read from signage. Checked against the OpenStreetMap gazetteer.",
        candidates: [],
        needsGeocode: true,
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
