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
  restrictedToCountry?: boolean;
};

// Nominatim's usage policy caps automated use at ~1 request/second. We queue
// strictly and cap the number of lookups per investigation.
let lastCall = 0;
async function throttle(ms = 950) {
  const wait = lastCall + ms - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function geocode(name: string, preferCountry?: string | null): Promise<GeocodeHit | null> {
  await throttle();
  const params: Record<string, string> = {
    q: name,
    format: "jsonv2",
    limit: "5",
    addressdetails: "1",
  };
  // When other evidence already points at a country, ask Nominatim inside it.
  // Without this the gazetteer's density bias wins: OSM has far more mapped
  // features in Western Europe than in South Asia, so a generic token like
  // "Parliament Street" resolves to London before it resolves to New Delhi.
  if (preferCountry) params.countrycodes = preferCountry.toLowerCase();

  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams(params);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!Array.isArray(rows) || !rows.length) return null;

    const usable = rows.filter((r) => {
      // jsonv2 returns the feature class under `category`; older formats use `class`.
      const cls = (r.category || r.class) as string;
      // "historic" and "tourism" matter more than they look: OpenStreetMap
      // files monuments, forts, observatories and memorials under them, so
      // excluding them threw away exactly the landmarks an investigator is
      // most likely to read off a signboard. Jantar Mantar itself is
      // historic=monument, and used to be discarded while "Jantar" survived
      // as a village in Poland.
      return ["place", "boundary", "highway", "natural", "landuse", "waterway", "historic", "tourism"].includes(cls);
    });
    if (!usable.length) return null;

    // Settlements and administrative areas beat an incidental street match.
    const rank = (r: any) => {
      const type = String(r.addresstype || r.type || "");
      const settlement = ["city", "town", "state", "country", "county", "district", "suburb", "village", "municipality"].includes(type);
      const landmark = ["monument", "memorial", "attraction", "archaeological_site", "fort", "castle", "ruins", "museum"].includes(type);
      // A named monument is at least as specific as a settlement, and far more
      // specific than a same-named hamlet on the other side of the world.
      return (settlement ? 2 : landmark ? 2.2 : 0) + (typeof r.importance === "number" ? r.importance : 0.3);
    };
    const r = usable.sort((a, b) => rank(b) - rank(a))[0];

    const cls = (r.category || r.class) as string;
    return {
      name,
      displayName: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      countryCode: r.address?.country_code?.toUpperCase(),
      importance: typeof r.importance === "number" ? r.importance : 0.3,
      osmType: r.addresstype || r.type || cls,
      osmClass: cls,
      restrictedToCountry: Boolean(preferCountry),
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
  source: "Mapillary" | "KartaView" | "Panoramax" | "Sentinel-2";
  link: string;
  capturedAt?: string;
};

// Mapillary is the only meaningful open street-level imagery corpus with real
// coverage across South Asia, Africa and Latin America — the exact regions the
// major pretrained geolocation models under-represent.
export async function mapillaryNear(lat: number, lon: number): Promise<StreetImage[]> {
  const token = process.env.MAPILLARY_TOKEN;
  if (!token) return [];

  // Mapillary rejects a bounding box that covers too many images with a 500
  // "reduce the amount of data" error rather than truncating, so start small
  // and only widen when a box comes back empty.
  for (const radiusDeg of [0.004, 0.008, 0.015]) {
    const hits = await mapillaryBox(token, lat, lon, radiusDeg);
    if (hits.length) return hits;
  }
  return [];
}

async function mapillaryBox(token: string, lat: number, lon: number, radiusDeg: number): Promise<StreetImage[]> {
  const bbox = [lon - radiusDeg, lat - radiusDeg, lon + radiusDeg, lat + radiusDeg]
    .map((v) => v.toFixed(6))
    .join(",");
  const url =
    "https://graph.mapillary.com/images?" +
    new URLSearchParams({
      access_token: token,
      fields: "id,thumb_1024_url,geometry,captured_at",
      bbox,
      limit: "4",
    });
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as any;
    if (!Array.isArray(json?.data)) return [];
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

// Panoramax is a federated, publicly-governed street imagery network run by
// French public bodies and OSM communities. Keyless, CC BY-SA, and a useful
// third opinion where Mapillary and KartaView both thin out.
export async function panoramaxNear(lat: number, lon: number, radiusDeg = 0.006): Promise<StreetImage[]> {
  const bbox = [lon - radiusDeg, lat - radiusDeg, lon + radiusDeg, lat + radiusDeg]
    .map((v) => v.toFixed(6))
    .join(",");
  const url = `https://api.panoramax.xyz/api/search?bbox=${bbox}&limit=4`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json = (await res.json()) as any;
    const feats = json?.features;
    if (!Array.isArray(feats)) return [];
    return feats
      .map((f: any) => {
        const thumb = f?.assets?.thumb?.href || f?.assets?.sd?.href;
        const coords = f?.geometry?.coordinates;
        if (!thumb || !Array.isArray(coords)) return null;
        return {
          id: String(f.id),
          thumb,
          lon: coords[0],
          lat: coords[1],
          source: "Panoramax" as const,
          link: `https://api.panoramax.xyz/#focus=pic&pic=${f.id}`,
          capturedAt: typeof f?.properties?.datetime === "string" ? f.properties.datetime.slice(0, 10) : undefined,
        };
      })
      .filter(Boolean) as StreetImage[];
  } catch {
    return [];
  }
}

/**
 * Copernicus Data Space Ecosystem — optional, account-gated high-resolution
 * cross-check. Sentinel-2 L2A (10 m) is the only source here with finer
 * resolution than the keyless basemaps, but it needs a free OAuth client from
 * dataspace.copernicus.eu, so it is entirely optional: with no
 * COPERNICUS_CLIENT_ID / COPERNICUS_CLIENT_SECRET this returns [] and the rest
 * of the app is unaffected. Credentials never reach the browser — this runs
 * server-side inside the analysis route, and only the resulting scene preview
 * (a base64 quicklook the catalogue returns inline via $expand=Quicklook) is
 * passed back, surfaced as another entry in the existing street-imagery grid.
 */
let copToken: { token: string; exp: number } | null = null;
async function copernicusToken(): Promise<string | null> {
  const id = process.env.COPERNICUS_CLIENT_ID;
  const secret = process.env.COPERNICUS_CLIENT_SECRET;
  if (!id || !secret) return null;
  const now = Date.now();
  if (copToken && copToken.exp > now + 60_000) return copToken.token;
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    });
    const res = await fetch(
      "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    copToken = { token: j.access_token, exp: now + (Number(j.expires_in) || 300) * 1000 };
    return copToken.token;
  } catch {
    return null;
  }
}

export async function copernicusNear(lat: number, lon: number): Promise<StreetImage[]> {
  const token = await copernicusToken();
  if (!token) return [];
  // A ~11 km box around the coordinate. WKT is lon/lat order.
  const d = 0.05;
  const wkt = `POLYGON((${lon - d} ${lat - d},${lon + d} ${lat - d},${lon + d} ${lat + d},${lon - d} ${lat + d},${lon - d} ${lat - d}))`;
  const start = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const end = new Date().toISOString();
  const filter = [
    "Collection/Name eq 'SENTINEL-2'",
    "Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' and att/OData.CSC.StringAttribute/Value eq 'S2MSI2A')",
    "Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value le 25.00)",
    `OData.CSC.Intersects(area=geography'SRID=4326;${wkt}')`,
    `ContentDate/Start gt ${start}`,
    `ContentDate/Start lt ${end}`,
  ].join(" and ");
  const url =
    "https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=" +
    encodeURIComponent(filter) +
    "&$top=1&$expand=Quicklook,Attributes&$orderby=ContentDate/Start desc";
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as any;
    const prod = j?.value?.[0];
    if (!prod || !prod.Quicklook) return [];
    return [
      {
        id: String(prod.Id),
        thumb: `data:image/jpeg;base64,${prod.Quicklook}`,
        lat,
        lon,
        source: "Sentinel-2",
        link: `https://browser.dataspace.copernicus.eu/?lat=${lat.toFixed(4)}&lng=${lon.toFixed(4)}&zoom=12`,
        capturedAt: prod.ContentDate?.Start ? String(prod.ContentDate.Start).slice(0, 10) : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Bhuvan is ISRO's national geoportal: authoritative Indian satellite imagery,
 * land-use and terrain layers that no Western dataset matches. There is no
 * open JSON API worth depending on, so rather than fake an integration this
 * returns a deep link into Bhuvan's 2D viewer centred on the candidate, for a
 * manual terrain and land-use cross-check.
 */
export function bhuvanLink(lat: number, lon: number): string | null {
  const inIndia = lat > 6 && lat < 37.5 && lon > 68 && lon < 97.5;
  if (!inIndia) return null;
  return `https://bhuvan-app1.nrsc.gov.in/bhuvan2d/bhuvan/bhuvan2d.php?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=15`;
}
