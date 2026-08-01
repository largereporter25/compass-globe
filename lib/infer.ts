// Turns a bag of clues into a ranked list of candidate regions.
//
// Deliberately simple additive evidence weighting: it is auditable by a human,
// which matters far more here than squeezing accuracy out of a black box.
//
// The one piece of real machinery is country coherence. OpenStreetMap is far
// more densely mapped in Western Europe than in South Asia or Africa, so a
// generic token read off signage — "Parliament Street", "Commissioner Office" —
// resolves to a European feature long before it resolves to the right one.
// Left unchecked, that gazetteer bias drags results out of the Global South
// even when the rest of the evidence is unambiguous. So the pipeline works out
// which country the non-place evidence points at first, asks the gazetteer
// inside that country, and discounts anything that still disagrees.

import type { Clue } from "./clues";
import { dedupeClues } from "./clues";
import { bhuvanLink, geocode, kartaviewNear, mapillaryNear, panoramaxNear, type StreetImage } from "./geo";
import { resolveRegion } from "./regions";

export type Candidate = {
  key: string;
  label: string;
  country: string;
  countryCode?: string;
  admin?: string;
  lat: number;
  lon: number;
  score: number;
  confidence: number;
  band: "Weak" | "Moderate" | "Strong";
  precision: "country" | "sub-national" | "locality";
  coherence: "agrees" | "conflicts" | "n/a";
  reasons: { frame: number; kind: string; value: string; rationale: string; weight: number }[];
  streetImages?: StreetImage[];
  bhuvanUrl?: string | null;
};

export type InferenceResult = {
  clues: (Clue & { frames?: number[] })[];
  candidates: Candidate[];
  summary: string;
  geocodeAttempts: number;
  geocodeHits: number;
  anchorCountry: { code: string; label: string; strength: number } | null;
};

// Nominatim is a donated community service rate-limited to about one request
// per second, and round trips from a serverless region routinely take several
// seconds each. Seven keeps the worst case inside the 60s function budget.
const MAX_GEOCODES = 7;

// How hard a candidate is punished for sitting in a country the rest of the
// evidence contradicts. Not zero — the anchor can be wrong, and an investigator
// should still see the alternative rather than have it silently deleted.
const CONFLICT_PENALTY = 0.18;

function band(c: number): Candidate["band"] {
  if (c >= 0.62) return "Strong";
  if (c >= 0.32) return "Moderate";
  return "Weak";
}

function countryOf(key: string): string | null {
  if (key.startsWith("IN-")) return "IN";
  if (/^[A-Z]{2}$/.test(key)) return key;
  return null;
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
    countryCode: string | undefined,
    admin: string | undefined,
    precision: Candidate["precision"],
    weight: number,
    clue: Clue
  ) => {
    const reason = {
      frame: clue.frame,
      kind: clue.kind,
      value: clue.value,
      rationale: clue.rationale,
      weight: Number(weight.toFixed(3)),
    };
    const existing = buckets.get(key);
    if (existing) {
      existing.score += weight;
      existing.reasons.push(reason);
    } else {
      buckets.set(key, {
        key, label, country, countryCode, admin, lat, lon,
        score: weight, confidence: 0, band: "Weak", precision,
        coherence: "n/a", reasons: [reason],
      });
    }
  };

  // ── Pass 0: landmarks recognised by CLIP. These are the only clues that
  // point at a coordinate rather than a region, so they get their own bucket
  // and a weight that reflects how confident the match was.
  const countryVotes = new Map<string, number>();
  for (const clue of clues) {
    if (clue.kind !== "landmark" || clue.lat == null || clue.lon == null) continue;
    // A landmark seen in several keyframes is far more trustworthy than a
    // single lucky frame, so corroboration counts for more than raw score.
    const seenIn = (clue as any).frames?.length ?? 1;
    const corroboration = Math.min(1 + (seenIn - 1) * 0.45, 2.4);
    const weight = (0.45 + Math.min(clue.score ?? 0, 0.6)) * corroboration;
    add(
      `LM:${clue.value}`, clue.lat, clue.lon, clue.value,
      resolveRegion(clue.countryCode ?? "")?.label ?? clue.countryCode ?? "Unknown",
      clue.countryCode, undefined, "locality", weight, clue
    );
    if (clue.countryCode) countryVotes.set(clue.countryCode, (countryVotes.get(clue.countryCode) ?? 0) + weight);
  }

  // ── Pass 1: clues that resolve locally against the static reference tables.
  // Script, plate prefix, dialling code, ccTLD, currency sign — and the CLIP
  // streetscape signatures. None of these touch a gazetteer, which is exactly
  // why they are allowed to anchor the country: they carry no mapping-density
  // bias, so footage with no legible text can still be anchored.
  for (const clue of clues) {
    if (clue.kind === "landmark") continue;
    for (const cand of clue.candidates) {
      const region = resolveRegion(cand.key);
      if (!region) continue;
      add(
        region.key, region.lat, region.lon, region.label, region.country,
        countryOf(region.key) ?? undefined, region.admin,
        region.admin ? "sub-national" : "country", cand.w, clue
      );
      const cc = countryOf(region.key);
      if (cc) countryVotes.set(cc, (countryVotes.get(cc) ?? 0) + cand.w);
    }
  }

  const anchorFrom = (): { code: string; strength: number } | null => {
    if (!countryVotes.size) return null;
    const sorted = [...countryVotes.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, v]) => s + v, 0);
    const [code, top] = sorted[0];
    const strength = top / total;
    // Require a clear leader. A two-way tie is not an anchor, it is ambiguity.
    return strength >= 0.5 ? { code, strength } : null;
  };

  let anchor = anchorFrom();

  // ── Pass 2: place names, resolved against the OpenStreetMap gazetteer.
  // Ordered so single distinctive proper nouns are spent first — "Delhi" is
  // worth far more of a limited budget than "Parliament Street Station".
  const toponyms = clues
    .filter((c) => c.needsGeocode)
    .sort((a, b) => {
      const af = (a as any).frames?.length ?? 1;
      const bf = (b as any).frames?.length ?? 1;
      const ap = (a as any).priority ?? 0;
      const bp = (b as any).priority ?? 0;
      return bf - af || bp - ap || b.value.length - a.value.length;
    })
    .slice(0, MAX_GEOCODES);

  for (const clue of toponyms) {
    geocodeAttempts++;
    const hit = await geocode(clue.value, anchor?.code ?? null);
    if (!hit) continue;
    geocodeHits++;

    const inAnchor = !anchor || hit.countryCode === anchor.code;
    const weight = (0.25 + Math.min(hit.importance, 0.9) * 0.55) * (inAnchor ? 1 : CONFLICT_PENALTY);
    const scopeNote = hit.restrictedToCountry
      ? ` Search was restricted to ${anchor?.code} because the other evidence points there.`
      : "";

    add(
      `OSM:${hit.lat.toFixed(3)},${hit.lon.toFixed(3)}`,
      hit.lat, hit.lon,
      hit.displayName.split(",").slice(0, 3).join(",").trim(),
      hit.displayName.split(",").pop()?.trim() || "Unknown",
      hit.countryCode, undefined, "locality", weight,
      {
        ...clue,
        rationale:
          `${clue.rationale} OpenStreetMap resolved "${clue.value}" to a ${hit.osmType} at ` +
          `${hit.lat.toFixed(4)}, ${hit.lon.toFixed(4)} (importance ${hit.importance.toFixed(2)}).${scopeNote}`,
      }
    );

    if (hit.countryCode) {
      countryVotes.set(hit.countryCode, (countryVotes.get(hit.countryCode) ?? 0) + weight);
      const region = resolveRegion(hit.countryCode);
      if (region) {
        add(region.key, region.lat, region.lon, region.label, region.country,
          hit.countryCode, region.admin, "country", weight * 0.5,
          { ...clue, rationale: `"${clue.value}" resolves to a place inside ${region.label} in OpenStreetMap.` });
      }
      // A resolved settlement is strong evidence in its own right, so let the
      // anchor form even when there were no plates, dialling codes or scripts.
      if (!anchor) anchor = anchorFrom();
    }
  }

  // ── Coherence pass. Anything sitting in a country the weight of evidence
  // contradicts is demoted and flagged, not deleted.
  const list = Array.from(buckets.values());
  for (const c of list) {
    if (!anchor) { c.coherence = "n/a"; continue; }
    if (!c.countryCode) { c.coherence = "n/a"; continue; }
    if (c.countryCode === anchor.code) {
      c.coherence = "agrees";
    } else {
      c.coherence = "conflicts";
      c.score *= CONFLICT_PENALTY;
    }
  }

  list.sort((a, b) => b.score - a.score);
  const total = list.reduce((s, c) => s + c.score, 0) || 1;
  for (const c of list) {
    const share = c.score / total;
    const evidenceDepth = Math.min(c.reasons.length / 4, 1);
    c.confidence = Number(Math.min(share * (0.55 + 0.45 * evidenceDepth), 0.92).toFixed(3));
    c.band = band(c.confidence);
    c.score = Number(c.score.toFixed(3));
  }

  const top = list.slice(0, 8);
  for (const c of top) c.bhuvanUrl = bhuvanLink(c.lat, c.lon);

  // Street-level cross-check. KartaView needs no token, so imagery works on a
  // fresh deploy; Mapillary is added on top when a token is present. A country
  // centroid is a meaningless place to look, so attach it to the best-ranked
  // candidate that is actually a place.
  const imageryTarget =
    top.find((c) => c.precision === "locality" && c.coherence !== "conflicts") ??
    top.find((c) => c.precision === "sub-national");
  if (imageryTarget) {
    const [mly, kv, pnx] = await Promise.all([
      mapillaryNear(imageryTarget.lat, imageryTarget.lon),
      kartaviewNear(imageryTarget.lat, imageryTarget.lon),
      panoramaxNear(imageryTarget.lat, imageryTarget.lon),
    ]);
    const imgs = [...mly, ...kv, ...pnx].slice(0, 6);
    if (imgs.length) imageryTarget.streetImages = imgs;
  }

  const anchorRegion = anchor ? resolveRegion(anchor.code) : null;
  const anchorOut = anchor
    ? { code: anchor.code, label: anchorRegion?.label ?? anchor.code, strength: Number(anchor.strength.toFixed(2)) }
    : null;

  return {
    clues,
    candidates: top,
    summary: buildSummary(top, clues.length, geocodeHits, anchorOut),
    geocodeAttempts,
    geocodeHits,
    anchorCountry: anchorOut,
  };
}

export function visualSummary(clues: Clue[]): { landmarks: number; scenes: number; environment: string[] } {
  return {
    landmarks: clues.filter((c) => c.kind === "landmark").length,
    scenes: clues.filter((c) => c.kind === "scene").length,
    environment: Array.from(new Set(clues.filter((c) => c.kind === "environment").map((c) => c.value))),
  };
}

function buildSummary(
  top: Candidate[],
  clueCount: number,
  hits: number,
  anchor: { code: string; label: string; strength: number } | null
): string {
  if (!top.length) {
    return "No location-bearing text was recovered from the keyframes. OCR found nothing that maps to a script, plate format, dialling code, domain, currency or gazetteer entry. This is not evidence that the footage is unplaceable — it means this text-first pipeline had nothing to work with, and the frames need a human eye or a non-textual method.";
  }
  const lead = top[0];
  const parts: string[] = [];
  parts.push(
    `${clueCount} distinct clue${clueCount === 1 ? "" : "s"} were recovered across the keyframes${hits ? `, of which ${hits} place name${hits === 1 ? "" : "s"} resolved against the OpenStreetMap gazetteer` : ""}.`
  );
  if (anchor) {
    parts.push(
      `The non-place evidence anchors this to ${anchor.label} (${(anchor.strength * 100).toFixed(0)}% of that evidence), so gazetteer lookups were restricted there and any candidate outside it was demoted.`
    );
  }
  parts.push(
    `The strongest converging candidate is ${lead.label} (${lead.band.toLowerCase()} support, ${(lead.confidence * 100).toFixed(0)}% of the recovered evidence weight), driven by ${lead.reasons.length} independent clue${lead.reasons.length === 1 ? "" : "s"}.`
  );
  const conflict = top.find((c) => c.coherence === "conflicts");
  if (conflict) {
    parts.push(
      `${conflict.label} matched the text but sits outside the anchor country, so it is shown demoted rather than hidden — check it if you think the anchor is wrong.`
    );
  } else if (top[1]) {
    parts.push(`${top[1].label} is the next competing hypothesis and has not been ruled out.`);
  }
  parts.push(
    "These are hypotheses to narrow a manual search, not a determination. Verify against street-level imagery, terrain and known landmarks before publishing."
  );
  return parts.join(" ");
}
