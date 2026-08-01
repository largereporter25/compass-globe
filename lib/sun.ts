// Shadowline — solar position and shadow-based time estimation.
//
// Pure trigonometry, no service and no dataset. Implements the NOAA solar
// position algorithm, which is accurate to well under a degree for any date
// and place on Earth. Investigators do this by hand or with clunky online
// calculators; there is no reason it cannot be exact and offline.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export type SolarPosition = {
  /** Degrees above the horizon. Negative means the sun has set. */
  elevation: number;
  /** Compass bearing of the sun, 0 = north, 90 = east. */
  azimuth: number;
};

/** Solar elevation and azimuth for a coordinate at an instant (UTC-based). */
export function solarPosition(date: Date, lat: number, lon: number): SolarPosition {
  const jd = julianDay(date);
  const t = (jd - 2451545) / 36525;

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const sunEqCtr =
    Math.sin(meanAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnom * RAD) * 0.000289;

  const trueLong = meanLong + sunEqCtr;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(omega * RAD);

  const declination = Math.asin(Math.sin(obliqCorr * RAD) * Math.sin(appLong * RAD)) * DEG;

  const y = Math.tan((obliqCorr / 2) * RAD) ** 2;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * meanLong * RAD) -
      2 * eccent * Math.sin(meanAnom * RAD) +
      4 * eccent * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * y * y * Math.sin(4 * meanLong * RAD) -
      1.25 * eccent * eccent * Math.sin(2 * meanAnom * RAD));

  const minutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (minutesUTC + eqTime + 4 * lon + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const zenith =
    Math.acos(
      Math.sin(lat * RAD) * Math.sin(declination * RAD) +
        Math.cos(lat * RAD) * Math.cos(declination * RAD) * Math.cos(hourAngle * RAD)
    ) * DEG;

  const elevation = 90 - zenith;

  let azimuth: number;
  const denom = Math.cos(lat * RAD) * Math.sin(zenith * RAD);
  if (Math.abs(denom) > 1e-9) {
    let a =
      Math.acos(
        Math.min(
          1,
          Math.max(-1, (Math.sin(lat * RAD) * Math.cos(zenith * RAD) - Math.sin(declination * RAD)) / denom)
        )
      ) * DEG;
    azimuth = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360;
  } else {
    azimuth = lat > 0 ? 180 : 0;
  }

  return { elevation: Number(elevation.toFixed(3)), azimuth: Number(azimuth.toFixed(3)) };
}

export type ShadowWindow = {
  /** Minutes after local midnight UTC-adjusted to the coordinate's solar day. */
  startUTC: string;
  endUTC: string;
  startLocal: string;
  endLocal: string;
  meanElevation: number;
  meanAzimuth: number;
  shadowRatio: number; // shadow length ÷ object height at the midpoint
};

export type ShadowQuery = {
  lat: number;
  lon: number;
  /** ISO date, e.g. "2026-08-01". */
  date: string;
  /** Compass bearing the shadow points towards, 0 = north. */
  shadowBearing: number;
  /** Tolerance in degrees on the bearing reading. */
  bearingTolerance: number;
  /** Optional: shadow length ÷ object height, if both are measurable. */
  lengthRatio?: number | null;
  /** Tolerance on the ratio, as a fraction. */
  ratioTolerance?: number;
};

export type ShadowResult = {
  windows: ShadowWindow[];
  sunrise: string | null;
  sunset: string | null;
  solarNoonElevation: number;
  /** Longitude-derived offset in minutes, used to label a local solar clock. */
  offsetMinutes: number;
  samples: { minute: number; elevation: number; azimuth: number }[];
};

function fmt(minutesFromMidnightUTC: number): string {
  const m = ((minutesFromMidnightUTC % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(Math.round(m % 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Given a coordinate, a date and the direction a shadow points, return the
 * time windows on that date when the sun could have cast it.
 *
 * The sun's azimuth is 180 degrees opposite the shadow it casts, so this is a
 * direct inversion — no fitting, no guessing.
 */
export function shadowWindows(q: ShadowQuery): ShadowResult {
  const targetSolarAz = (q.shadowBearing + 180) % 360;
  const tol = Math.max(1, q.bearingTolerance);
  const ratioTol = q.ratioTolerance ?? 0.2;

  // Approximate local clock offset from longitude, for a readable label. This
  // is solar-clock time, not a political timezone.
  const offsetMinutes = Math.round((q.lon / 15) * 60);

  const samples: { minute: number; elevation: number; azimuth: number }[] = [];
  const base = new Date(`${q.date}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return { windows: [], sunrise: null, sunset: null, solarNoonElevation: 0, offsetMinutes, samples };
  }

  for (let minute = 0; minute < 1440; minute += 2) {
    const d = new Date(base.getTime() + minute * 60000);
    const { elevation, azimuth } = solarPosition(d, q.lat, q.lon);
    samples.push({ minute, elevation, azimuth });
  }

  let sunrise: string | null = null;
  let sunset: string | null = null;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1].elevation < 0 && samples[i].elevation >= 0) sunrise = fmt(samples[i].minute + offsetMinutes);
    if (samples[i - 1].elevation >= 0 && samples[i].elevation < 0) sunset = fmt(samples[i].minute + offsetMinutes);
  }
  const solarNoonElevation = Math.max(...samples.map((s) => s.elevation));

  const matches = samples.filter((s) => {
    if (s.elevation < 1.5) return false; // shadows below this are unusable
    if (angleDiff(s.azimuth, targetSolarAz) > tol) return false;
    if (q.lengthRatio != null && q.lengthRatio > 0) {
      const modelled = 1 / Math.tan(s.elevation * RAD);
      if (Math.abs(modelled - q.lengthRatio) / q.lengthRatio > ratioTol) return false;
    }
    return true;
  });

  const windows: ShadowWindow[] = [];
  let run: typeof matches = [];
  const flush = () => {
    if (!run.length) return;
    const mid = run[Math.floor(run.length / 2)];
    windows.push({
      startUTC: fmt(run[0].minute),
      endUTC: fmt(run[run.length - 1].minute + 2),
      startLocal: fmt(run[0].minute + offsetMinutes),
      endLocal: fmt(run[run.length - 1].minute + 2 + offsetMinutes),
      meanElevation: Number(mid.elevation.toFixed(1)),
      meanAzimuth: Number(mid.azimuth.toFixed(1)),
      shadowRatio: Number((1 / Math.tan(mid.elevation * RAD)).toFixed(2)),
    });
    run = [];
  };
  for (let i = 0; i < matches.length; i++) {
    if (i > 0 && matches[i].minute - matches[i - 1].minute > 4) flush();
    run.push(matches[i]);
  }
  flush();

  return { windows, sunrise, sunset, solarNoonElevation: Number(solarNoonElevation.toFixed(1)), offsetMinutes, samples };
}

export const COMPASS_POINTS: { label: string; bearing: number }[] = [
  { label: "N", bearing: 0 },
  { label: "NE", bearing: 45 },
  { label: "E", bearing: 90 },
  { label: "SE", bearing: 135 },
  { label: "S", bearing: 180 },
  { label: "SW", bearing: 225 },
  { label: "W", bearing: 270 },
  { label: "NW", bearing: 315 },
];
