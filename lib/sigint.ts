// Server-side SIGINT / open-data overlays surfaced in the right-side panel.
//
// Two keyless sources, both free, both degrading to [] on any error so the
// analysis never blocks on them:
//
//   - GPSJam (gpsjam.org): a daily H3-resolution-4 CSV of GPS/GNSS interference
//     derived from ADS-B telemetry. No key. The latest daily file is fetched
//     once and cached for the process, then each candidate is resolved to its
//     H3 cell and looked up.
//   - OpenSky Network: live aircraft state vectors inside a small bounding
//     box. Anonymous and keyless, credit-rate-limited (400 credits/day); one
//     small bbox per candidate costs a single credit.
//
// aprs.fi was considered and deferred: its v2 API has no documented area query
// (callsign lookup only), which is not useful for geolocation triage where no
// callsign is known. Faking it would violate the project's honesty rule.
//
// Everything here runs server-side inside the analysis route; only the
// resulting text summaries reach the browser.

import { latLngToCell } from "h3-js";

export type SigintReport = {
  source: "GPSJam" | "OpenSky";
  title: string;
  detail: string;
  link: string;
  lat?: number;
  lon?: number;
};

const UA =
  process.env.NOMINATIM_USER_AGENT || "compass-globe/0.1 (set NOMINATIM_USER_AGENT)";

// ── GPSJam ────────────────────────────────────────────────────────────────
type HexRow = { good: number; bad: number };
let gpsjamCache: { date: string; rows: Map<string, HexRow>; ts: number } | null = null;
const GPSJAM_TTL = 6 * 3600_000; // refresh the daily file at most every 6h

async function gpsjamRows(): Promise<{ date: string; rows: Map<string, HexRow> } | null> {
  const now = Date.now();
  if (gpsjamCache && now - gpsjamCache.ts < GPSJAM_TTL) return gpsjamCache;
  try {
    const manRes = await fetch("https://gpsjam.org/data/manifest.csv", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!manRes.ok) return gpsjamCache; // stale is better than nothing
    const manifest = (await manRes.text()).trim().split("\n");
    const date = manifest[manifest.length - 1].split(",")[0].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return gpsjamCache;
    const csvRes = await fetch(`https://gpsjam.org/data/${date}-h3_4.csv`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!csvRes.ok) return gpsjamCache;
    const lines = (await csvRes.text()).trim().split("\n").slice(1); // skip header
    const rows = new Map<string, HexRow>();
    for (const line of lines) {
      const [hex, good, bad] = line.split(",");
      if (!hex) continue;
      rows.set(hex, { good: Number(good) || 0, bad: Number(bad) || 0 });
    }
    gpsjamCache = { date, rows, ts: now };
    return gpsjamCache;
  } catch {
    return gpsjamCache; // keep stale, or null if never loaded
  }
}

export async function gpsjamAt(lat: number, lon: number): Promise<SigintReport[]> {
  const data = await gpsjamRows();
  if (!data) return [];
  const cell = latLngToCell(lat, lon, 4);
  const row = data.rows.get(cell);
  if (!row) {
    // A clean hex is itself information — say so, and pin the date, so the
    // absence is distinguishable from "never checked".
    return [
      {
        source: "GPSJam",
        title: "No GPS/GNSS interference reported",
        detail: `H3 ${cell} clean on ${data.date} — no aircraft reported degraded navigation here.`,
        link: `https://gpsjam.org/?date=${data.date}&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`,
      },
    ];
  }
  const total = row.good + row.bad || 1;
  const pct = (row.bad / total) * 100;
  const level = pct > 10 ? "HIGH" : pct >= 2 ? "MEDIUM" : "LOW";
  return [
    {
      source: "GPSJam",
      title: `${level} GPS/GNSS interference (${pct.toFixed(0)}%)`,
      detail: `${row.bad} of ${total} aircraft reported degraded navigation in H3 ${cell} on ${data.date}. GPSJam derives this from ADS-B telemetry.`,
      link: `https://gpsjam.org/?date=${data.date}&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`,
    },
  ];
}

// ── OpenSky Network ───────────────────────────────────────────────────────
// State vector layout (positional): 0 icao24, 1 callsign, 2 origin_country,
// 3 time_position, 4 last_contact, 5 lon, 6 lat, 7 baro_altitude, 8 on_ground,
// 9 velocity, 10 true_track, 13 geo_altitude.
export async function openskyNear(lat: number, lon: number): Promise<SigintReport[]> {
  const d = 0.4; // ~0.64 deg² bbox → 1 credit, well inside anonymous limits
  const url =
    `https://opensky-network.org/api/states/all?lamin=${(lat - d).toFixed(3)}` +
    `&lomin=${(lon - d).toFixed(3)}&lamax=${(lat + d).toFixed(3)}&lomax=${(lon + d).toFixed(3)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as any;
    const states = j?.states;
    if (!Array.isArray(states) || !states.length) return [];
    return states.slice(0, 6).map((s: any[]) => {
      const icao = s[0];
      const callsign = String(s[1] || "").trim() || icao;
      const origin = s[2] || "?";
      const slat = s[6];
      const slon = s[5];
      const onGround = s[8];
      const alt = s[7] ?? s[13];
      const vel = s[9];
      const altStr = onGround ? "on ground" : alt != null ? `${Math.round(alt)} m` : "alt unknown";
      const velStr = vel != null ? `, ${Math.round(vel)} m/s` : "";
      const coordStr =
        slat != null && slon != null ? ` · ${Number(slat).toFixed(2)},${Number(slon).toFixed(2)}` : "";
      return {
        source: "OpenSky",
        title: `${callsign} · ${origin}`,
        detail: `${altStr}${velStr}${coordStr}`,
        link: `https://opensky-network.org/aircraft-profile?icao24=${icao}`,
        lat: slat != null ? Number(slat) : undefined,
        lon: slon != null ? Number(slon) : undefined,
      };
    });
  } catch {
    return [];
  }
}

/** All SIGINT/open-data reports for one coordinate, GPSJam then OpenSky. */
export async function sigintAt(lat: number, lon: number): Promise<SigintReport[]> {
  const [g, o] = await Promise.all([gpsjamAt(lat, lon), openskyNear(lat, lon)]);
  return [...g, ...o];
}