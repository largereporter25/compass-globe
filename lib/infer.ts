// Turns a bag of clues into a ranked list of candidate regions.
// Deliberately simple additive evidence weighting: it is auditable by a human,
// which matters far more here than squeezing out accuracy from a black box.

import type { Clue } from "./clues";
import { dedupeClues } from "./clues";
import { geocode, mapillaryNear, type StreetImage } from "./geo";
import { resolveRegion } from "./regions";

export type Candidate = {
  key: string;
  label: string;
  country: string;
  admin?: string;
  lat: number;
  lon: number;
  score: number;
  confidence: number;   // 0..1, deliberately capped below 1
  band: "Weak" | "Moderate" | "Strong";
  precision: "country" | "sub-national" | "locality";
  reasons: { frame: number; kind: string; value: string; rationale: string; weight: number }[];
  streetImages?: StreetImage[];
};

export type InferenceResult = {
  clues: (Clue & { frames?: number[] })[];
  candidates: Candidate[];
  summary: string;
  geocodeAttempts: number;
  geocodeHits: number;
};

// Hard cap. Nominatim is a donated community service rate-limited to ~1 req/s,
// and the whole route has to finish inside a serverless function's time budget.
const MAX_GEOCODES = 6;

function band(c: number): Candidate["band"] {
  if (c >= 0.62) return "Strong";
  if (c >= 0.32) return "Moderate";
  return "Weak";
}

export async function infer(rawClues: Clue[]): Promise<InferenceResult> {
  const clues = dedupeClues(rawClues);
  const buckets = new Map<string, Candidate>();
  let geocodeAttempts = 0;
  let geocodeHits = 0;

  const add = (
    key: string,
    lat: number,
    lon: number,
    label: string,
    country: string,
    admin: string | undefined,
    precision: Candidate["precision"],
    weight: number,
    clue: Clue
  ) => {
    const existing = buckets.get(key);
    const reason = {
      frame: clue.frame,
      kind: clue.kind,
      value: clue.value,
      rationale: clue.rationale,
      weight: Number(weight.toFixed(3)),
    };
    if (existing) {
      existing.score += weight;
      existing.reasons.push(reason);
    } else {
      buckets.set(key, {
        key, label, country, admin, lat, lon,
        score: weight, confidence: 0, band: "Weak", precision,
        reasons: [reason],
      });
    }
  };

  // Pass 1: clues that resolve locally against the static reference tables.
  for (const clue of clues) {
    for (const cand of clue.candidates) {
      const region = resolveRegion(cand.key);
      if (!region) continue;
      add(
        region.key, region.lat, region.lon, region.label, region.country, region.admin,
        region.admin ? "sub-national" : "country", cand.w, clue
      );
    }
  }

  // Pass 2: place names, resolved against the OpenStreetMap gazetteer.
  // Ranked by OSM "importance" so a real city outranks an incidental match.
  const toponyms = clues
    .filter((c) => c.needsGeocode)
    .sort((a, b) => {
      const af = (a as any).frames?.length ?? 1;
      const bf = (b as any).frames?.length ?? 1;
      return bf - af || b.value.length - a.value.length;
    })
    .slice(0, MAX_GEOCODES);
  for (const clue of toponyms) {
    geocodeAttempts++;
    const hit = await geocode(clue.value);
    if (!hit) continue;
    geocodeHits++;
    // Importance is 0..1 from OSM. A named settlement carries far more signal
    // than a random matching street, so weight it by importance.
    const weight = 0.25 + Math.min(hit.importance, 0.9) * 0.55;
    add(
      `OSM:${hit.lat.toFixed(3)},${hit.lon.toFixed(3)}`,
      hit.lat, hit.lon,
      hit.displayName.split(",").slice(0, 3).join(",").trim(),
      hit.displayName.split(",").pop()?.trim() || "Unknown",
      undefined,
      "locality",
      weight,
      { ...clue, rationale: `${clue.rationale} OpenStreetMap resolved "${clue.value}" to a ${hit.osmType} at ${hit.lat.toFixed(4)}, ${hit.lon.toFixed(4)} (OSM importance ${hit.importance.toFixed(2)}).` }
    );
    // A resolved toponym also reinforces its country.
    if (hit.countryCode) {
      const region = resolveRegion(hit.countryCode);
      if (region) {
        add(region.key, region.lat, region.lon, region.label, region.country, region.admin,
          "country", weight * 0.5,
          { ...clue, rationale: `"${clue.value}" resolves to a place inside ${region.label} in OpenStreetMap.` });
      }
    }
  }

  const list = Array.from(buckets.values()).sort((a, b) => b.score - a.score);
  const total = list.reduce((s, c) => s + c.score, 0) || 1;

  for (const c of list) {
    // Share of total evidence, damped so a single clue can never read as certainty.
    const share = c.score / total;
    const evidenceDepth = Math.min(c.reasons.length / 4, 1);
    c.confidence = Number(Math.min(share * (0.55 + 0.45 * evidenceDepth), 0.92).toFixed(3));
    c.band = band(c.confidence);
    c.score = Number(c.score.toFixed(3));
  }

  const top = list.slice(0, 8);

  // Optional street-level cross-check for the leading candidate only.
  if (top[0]) {
    const imgs = await mapillaryNear(top[0].lat, top[0].lon);
    if (imgs.length) top[0].streetImages = imgs;
  }

  const summary = buildSummary(top, clues.length, geocodeHits);
  return { clues, candidates: top, summary, geocodeAttempts, geocodeHits };
}

function buildSummary(top: Candidate[], clueCount: number, hits: number): string {
  if (!top.length) {
    return "No location-bearing text was recovered from the keyframes. OCR found nothing that maps to a script, plate format, dialling code, domain, currency or gazetteer entry. This is not evidence that the footage is undateable or unplaceable — it means this text-first pipeline had nothing to work with, and the frames need a human eye or a non-textual method.";
  }
  const lead = top[0];
  const parts: string[] = [];
  parts.push(
    `${clueCount} distinct clue${clueCount === 1 ? "" : "s"} were recovered across the keyframes${hits ? `, of which ${hits} place name${hits === 1 ? "" : "s"} resolved against the OpenStreetMap gazetteer` : ""}.`
  );
  parts.push(
    `The strongest converging candidate is ${lead.label} (${lead.band.toLowerCase()} support, ${(lead.confidence * 100).toFixed(0)}% of the recovered evidence weight), driven by ${lead.reasons.length} independent clue${lead.reasons.length === 1 ? "" : "s"}.`
  );
  if (top[1]) {
    parts.push(
      `${top[1].label} is the next competing hypothesis and has not been ruled out.`
    );
  }
  parts.push(
    "These are hypotheses to narrow a manual search, not a determination. Verify against street-level imagery, terrain and known landmarks before publishing."
  );
  return parts.join(" ");
}
