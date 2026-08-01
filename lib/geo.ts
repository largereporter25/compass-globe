// Open geodata access. Two sources, both free and community/openly governed:
//   - OpenStreetMap Nominatim (ODbL) for gazetteer lookup. No key required.
//   - Mapillary (CC BY-SA imagery) for street-level ground truth. Optional key.
// No Google, Bing, or paid vision/reverse-image service is used anywhere.

const UA =
  process.env.NOMINATIM_USER_AGENT || "compass-globe/0.1 (set NOMINATIM_USER_AGENT)";

export type GeocodeHit = {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  countryCode?: string;
  importance: number;
  osmType: string;
  osmClass: string;
};

// Nominatim's usage policy caps automated use at ~1 request/second. We queue
// strictly and cap the number of lookups per investigation.
let lastCall = 0;
async function throttle(ms = 1100) {
  const wait = lastCall + ms - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function geocode(name: string): Promise<GeocodeHit | null> {
  await throttle();
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q: name, format: "jsonv2", limit: "1", addressdetails: "1" });
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    const r = rows?.[0];
    if (!r) return null;
    // jsonv2 returns the feature class under `category`; older formats use `class`.
    const cls = (r.category || r.class) as string;
    // Only accept results that are actually places, not shops or brands.
    if (!["place", "boundary", "highway", "natural", "landuse", "waterway"].includes(cls)) return null;
    return {
      name,
      displayName: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      countryCode: r.address?.country_code?.toUpperCase(),
      importance: typeof r.importance === "number" ? r.importance : 0.3,
      osmType: r.addresstype || r.type || cls,
      osmClass: cls,
    };
  } catch {
    return null;
  }
}

export type StreetImage = {
  id: string;
  thumb: string;
  lat: number;
  lon: number;
  source: "Mapillary" | "KartaView";
  link: string;
  capturedAt?: string;
};

// Mapillary is the only meaningful open street-level imagery corpus with real
// coverage across South Asia, Africa and Latin America — the exact regions the
// major pretrained geolocation models under-represent.
export async function mapillaryNear(lat: number, lon: number, radiusDeg = 0.05): Promise<StreetImage[]> {
  const token = process.env.MAPILLARY_TOKEN;
  if (!token) return [];
  const bbox = [lon - radiusDeg, lat - radiusDeg, lon + radiusDeg, lat + radiusDeg].join(",");
  const url =
    "https://graph.mapillary.com/images?" +
    new URLSearchParams({
      access_token: token,
      fields: "id,thumb_1024_url,geometry,captured_at",
      bbox,
      limit: "6",
    });
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as any;
    return (json.data || [])
      .filter((d: any) => d.thumb_1024_url && d.geometry?.coordinates)
      .map((d: any) => ({
        id: String(d.id),
        thumb: d.thumb_1024_url,
        lon: d.geometry.coordinates[0],
        lat: d.geometry.coordinates[1],
        source: "Mapillary" as const,
        link: `https://www.mapillary.com/app/?pKey=${d.id}`,
        capturedAt: d.captured_at ? new Date(d.captured_at).toISOString().slice(0, 10) : undefined,
      }));
  } catch {
    return [];
  }
}

// KartaView (formerly OpenStreetCam) is fully open and needs no token, so
// street-level cross-checking works out of the box on a fresh deployment.
// Its coverage complements Mapillary, which matters most outside Europe.
export async function kartaviewNear(lat: number, lon: number, radiusM = 2000): Promise<StreetImage[]> {
  const url =
    "https://api.openstreetcam.org/2.0/photo/?" +
    new URLSearchParams({
      lat: String(lat),
      lng: String(lon),
      radius: String(Math.min(radiusM, 2000)),
      itemsPerPage: "6",
    });
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json = (await res.json()) as any;
    const rows = json?.result?.data;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((d: any) => d.fileurlTh || d.fileurlProc)
      .map((d: any) => ({
        id: String(d.id),
        thumb: d.fileurlTh || d.fileurlProc,
        lat: parseFloat(d.lat),
        lon: parseFloat(d.lng),
        source: "KartaView" as const,
        link: `https://kartaview.org/details/${d.sequenceId}/${d.sequenceIndex}`,
        capturedAt: typeof d.shotDate === "string" ? d.shotDate.slice(0, 10) : undefined,
      }))
      .filter((d: StreetImage) => Number.isFinite(d.lat) && Number.isFinite(d.lon));
  } catch {
    return [];
  }
}
