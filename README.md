# Compass Globe

**Geolocation triage for video evidence. Open geodata only. Your video never leaves your browser.**

Drop a clip. ffmpeg cuts keyframes and Tesseract reads them — both inside your browser tab. On-screen
text is turned into auditable location clues, place names are resolved against OpenStreetMap, and
candidate regions land on a globe with the exact reasoning attached to each one.

No Google Vision. No Bing. No paid reverse-image API. No API key required to run it.

**Live:** https://compass-globe.vercel.app

<!-- screenshots -->
<!-- ![Analysis view](docs/screenshot-analysis.png) -->
<!-- ![Reasoning trail](docs/screenshot-reasoning.png) -->

---

## Why this exists

Fact-checkers still geolocate video with InVID and Google Lens. Both work by fanning keyframes out to
Google, Bing, Yandex and TinEye. That has three costs a newsroom actually feels: it is rate-limited,
it is expensive at volume, and every query tells a Big Tech search index exactly what your newsroom
is investigating right now.

Compass Globe does not try to replicate web-scale reverse image search — nobody outside Google can,
and pretending otherwise is how these projects die. It solves the adjacent problem instead: **turning
what is legibly written inside the frame into a defensible shortlist of places to check.** Script,
signage, registration plates, dialling codes, domains, currency marks. The things a human OSINT
investigator reads off a frame first, done systematically across every keyframe, with the reasoning
kept intact.

The pretrained geolocation models everyone reaches for do not cover the Global South well —
StreetCLIP's own model card states its training data excludes India and China entirely. A text-first
pipeline plus OpenStreetMap and Mapillary does not inherit that gap, because the evidence comes out
of the frame rather than out of a Western-skewed training set.

---

## How the pipeline works

```
video file (never uploaded)
   │
   ├─ 1. keyframes ───────── Fast: the browser's own decoder, sampled evenly
   │                         Deep scan: real ffmpeg (WASM) scene detection
   │
   ├─ 2. Tesseract.js ────── OCR per frame, in whichever scripts you select
   │
   ├─ 3. CLIP ViT-B/32 ───── landmark and streetscape recognition, in-browser,
   │                         for the footage that has no legible text at all
   │
   ├─ 4. clue extraction ─── deterministic matchers over the recognised text:
   │        • place-word lexicon (Marg, Chowk, Jalan, Straße…)
   │        • Unicode script blocks       → country priors
   │        • Indian / UK plate formats   → state or country
   │        • +CC dialling prefixes       → country
   │        • ccTLDs on signage           → country
   │        • currency signs              → country
   │        • capitalised tokens          → possible place names
   │
   ├─ 5. country anchor ────────── script, plate, dialling code, ccTLD *and*
   │                               CLIP streetscape signatures fix a country
   │
   ├─ 6. OpenStreetMap Nominatim ─ place names resolved *inside* that country
   │
   ├─ 7. KartaView + Panoramax + Mapillary ─── street-level imagery near the lead candidate
   │
   ├─ 8. SIGINT overlays ───────── GPSJam (ADS-B-derived GNSS interference) +
   │                               OpenSky (live aircraft) for the top candidates
   │
   ├─ 9. weighted aggregation ──── ranked candidates + confidence band
   │
   ├─ 10. globe + reasoning trail ─ every candidate shows the clues that produced it
   │
   └─ 11. Shadowline ────────────── solar geometry turns a shadow direction
                                   into a time-of-day window
```

### The vision pass — for footage with no text

Most viral disinformation clips have no legible signage. A text-only pipeline
has a hard ceiling there, so Compass Globe runs two open-source contrastive
models in the browser through transformers.js and scores every keyframe
against two prompt banks in `lib/visual-priors.ts`:

- **Landmarks** — distinctive built structures with real coordinates. A hit
  here is the strongest clue the tool can produce, because it points at a place
  rather than a region. The bar is deliberately high: a false landmark match is
  the most misleading thing this tool could output, since it looks like
  certainty.
- **Streetscape signatures** — auto-rickshaws and overhead cable bundles, khaki
  police uniforms, span-wire traffic signals, elevated railway girders, matatu
  minibuses, scooter density, truck art. None is conclusive alone. Crucially
  they are **gazetteer-free**, so they anchor a country exactly the way a plate
  prefix does — which is what lets a clip with no text be anchored at all.

A negative prompt bank (blurry frames, faces, blank walls, news studios) sits
alongside them, because without unremarkable options to lose to, some landmark
always "wins" a frame of nothing.

Text embeddings for the whole bank are computed once and reused; each keyframe
becomes a single image embedding and the rest is cosine similarity. That keeps
a 200-prompt bank affordable on a laptop CPU. Weights download once from the
Hugging Face CDN and are then cached — the images never leave the tab.

A second model, Google's **SigLIP** (base patch16-224, Apache-2.0), runs on the
same transformers.js runtime alongside CLIP. Its errors do not correlate with
CLIP's, so the two models' per-prompt probability distributions are averaged
into one ensemble score. The landmark bar only clears when *both* lean the same
way, which is deliberately conservative — a false landmark match is the most
misleading thing this tool could output. If SigLIP fails to load, the pass
falls back to CLIP-only and the toggle says so.

**Tested:** a clip built only from Jantar Mantar photographs, with no readable
text in any frame, returns *Jantar Mantar, New Delhi* and *Red Fort, Delhi* as
the top two candidates, anchored to India. Both are red-sandstone Mughal-era
Delhi structures, so the confusion between them is the honest one to make.

This is a **second opinion, clearly separated in the UI**. Both models are
confidently wrong on a regular basis. The vision pass can be switched off
entirely.

### The place-word lexicon

The worst blind spot in a Latin-script OCR pipeline is text that is Latin but
not English. "Sansad Marg", "Karol Bagh", "Jalan Sudirman", "Prospekt Peremohy"
all read as plain Latin characters, so the script detector says nothing — yet
the words themselves are decisive.

`lib/lexicon.ts` matches street and administrative vocabulary across ~30
language groups: Indian suffixes (*marg, chowk, nagar, vihar, bagh, ganj*),
administrative terms (*thana, tehsil, mandal*), and their equivalents in German,
French, Spanish, Portuguese, Turkish, Malay, Thai, Swahili and others. It also
carries registration-plate layouts for Bangladesh, Pakistan, Mercosur, the
Netherlands, Germany, Türkiye and the UAE alongside the original India and UK
patterns.

These matches **never touch a gazetteer**, so like a plate prefix they can
anchor a country without inheriting OSM's mapping-density bias.

**Tested:** "Sansad Marg" / "Karol Bagh Police Chowki" — no English place name
and no non-Latin script anywhere — now produces three lexicon hits, anchors to
India at 100%, and resolves Karol Bagh in Central Delhi. Before this, none of
those words carried any signal at all.

### The globe is a real map

Not a stylised sphere. The globe streams live slippy tiles and descends to
street level, so a candidate can be inspected against actual imagery rather
than a dot on a diagram:

| Layer | Source | Licence |
| --- | --- | --- |
| Satellite | NASA GIBS — MODIS Terra daily true-color | NASA open data, keyless |
| VIIRS | NASA GIBS — NOAA-20 VIIRS daily true-color | NASA open data, keyless |
| Sentinel-2 | EOX Sentinel-2 cloudless (2016/2017 mosaic) | CC BY 4.0, keyless |
| Esri | Esri World Imagery (Maxar, Earthstar Geographics) | Free with attribution, **non-commercial use only** per Esri terms |
| Street | OpenStreetMap standard tiles | ODbL |
| Terrain | OpenTopoMap with SRTM elevation | CC BY-SA |

The default `Satellite` layer is live NASA GIBS (daily, ~250 m) rather than a
frozen mosaic. GIBS tiles are pinned to a UTC date a couple of days back because
its EPSG:3857 REST endpoint 404s on the `default` time token. For a sharper,
cloudless static basemap use `Sentinel-2`; for the highest-resolution street
detail (or where a candidate must be read at road level) switch to `Esri` or
`Sentinel-2` before descending — GIBS' 250 m resolution caps out at zoom 9.

Selecting a candidate flies the camera to district altitude; **Descend to
street** drops it to roughly a kilometre up, close enough to read a road layout
and match it against a keyframe. Each candidate also carries direct links into
OpenStreetMap, the OSM trace view, and Bhuvan for Indian coordinates.

### WebGPU

The CLIP pass runs on WebGPU where the browser exposes it and falls back to
WASM everywhere else, silently and automatically. The active backend is shown
on the vision toggle. transformers.js is loaded as a native ES module from a
CDN rather than bundled — its ONNX runtime uses `import.meta` in a way Next's
minifier rejects, and keeping the inference runtime out of the main bundle
means the app still loads instantly for anyone who leaves the vision pass off.

### Country anchoring — why this exists

OpenStreetMap is not evenly mapped. Western Europe has vastly more named
features than South Asia, Africa or Latin America, so a generic token read off
signage resolves westward by default. Real example from testing: footage shot at
Jantar Mantar in New Delhi, with "Delhi Police" clearly legible, ranked
**Westminster, London** first — because "Parliament Street Station" matched a
London feature before "Delhi" was ever queried.

Three things fix that, and they are the difference between a toy and a tool:

1. **Anchor the country from bias-free evidence first.** Writing system, plate
   prefix, dialling code, ccTLD and currency sign carry no gazetteer skew. If
   they agree on a country by a clear majority, that becomes the anchor.
2. **Query inside the anchor.** Nominatim is called with `countrycodes=` so
   "Parliament Street" resolves to Sansad Marg in New Delhi, not to London.
3. **Demote, don't delete, conflicts.** A candidate outside the anchor keeps its
   place in the ledger flagged `conflicts` and scaled to 18% weight, because the
   anchor can be wrong and hiding the alternative would be dishonest.

Alongside that, the place-name extractor now discards a phrase once half or more
of its words are generic civic vocabulary — "Commissioner Office", "Traffic
Marshal Point", "Police Control Room" — and spends its limited lookup budget on
single distinctive proper nouns first. On the Delhi test that cut 32 junk
toponyms down to 2 useful ones and moved the top result from London to New
Delhi. The clean-text version of the same clip now surfaces **Jantar Mantar
Astronomical Observatory** directly.

### Two extraction modes

**Fast (default)** drives the browser's own video decoder — seek a hidden
`<video>`, paint each seek to a canvas. It handles every codec the browser can
play, downloads nothing, and cannot run out of WebAssembly memory on a large
file. This is the reliable path and it is the default for a reason.

**Deep scan** runs a real ffmpeg build compiled to WebAssembly and uses
ffmpeg's `select='gt(scene,0.22)'` filter, so frames land where the shot
actually cuts rather than on a fixed clock. Better frame selection, but it
loads a 32 MB core and copies the whole file into a virtual filesystem, so it
is capped at 120 MB and **falls back to Fast automatically** on any failure
rather than killing the run. The UI always reports which path produced the
frames.

### Shadowline

A shadow points exactly 180° away from the sun. Given a candidate coordinate, a
date, and the compass bearing a shadow runs in frame, the time of day is a
direct inversion — no fitting, no model. Compass Globe implements the NOAA solar
position algorithm in `lib/sun.ts` (verified against known values: London
summer-solstice noon elevation 61.9°, Ahmedabad solar noon 84.9° on 1 August).
It runs in the browser tab.

Enter the shadow bearing and optionally the shadow-length ÷ object-height ratio,
and it returns the time windows on that date when the sun could have cast it,
plus sunrise, sunset and solar-noon elevation. Times are a **local solar clock
derived from longitude** — not a political timezone, no DST. If no window
matches, that is itself a finding: the date, the bearing reading, or the
candidate location is wrong.

Steps 1–2 run in the browser. Steps 3–5 run in a Next.js route handler. Only extracted text and small
JPEG thumbnails cross the network — never the video.

### Confidence, honestly

`confidence` is **a candidate's share of the total recovered evidence weight**, damped by how many
independent clues support it and hard-capped at 0.92. It is not a probability that the location is
correct. Bands are `Weak` / `Moderate` / `Strong`.

---

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 14 App Router | One deployable unit, API routes included |
| Video | Browser decoder (default) + `@ffmpeg/ffmpeg` WASM, vendored in `public/ffmpeg` | Vercel serverless cannot run ffmpeg on video; the browser can, and the file stays local |
| Solar math | `lib/sun.ts`, NOAA algorithm | Astronomy needs no service and no dataset |
| OCR | `tesseract.js` | Runs client-side, ~20 scripts, no key |
| Clue engine | Plain TypeScript in `lib/clues.ts` | Deterministic and auditable beats opaque and slightly better |
| Gazetteer | OpenStreetMap Nominatim | Free, keyless, ODbL |
| Vision | CLIP ViT-B/32 + SigLIP base (Apache-2.0) via `@huggingface/transformers`, in-browser ensemble | Landmark and streetscape recognition without a paid vision API; two models' scores are averaged |
| Street imagery | KartaView + Panoramax (keyless) + Mapillary (optional token) + Copernicus Sentinel-2 (optional token) | CC BY-SA, complementary Global South coverage, works with zero configuration |
| SIGINT overlays | GPSJam (ADS-B-derived GNSS interference) + OpenSky (live aircraft) | Keyless situational context in the panel, not a location fix |
| India terrain | Bhuvan (ISRO) deep link | Authoritative Indian satellite and land-use data, opened for manual cross-check |
| Globe | `react-globe.gl` / three.js slippy-tile engine | Real satellite, street and terrain tiles, zoomable to street level |
| Database | Neon Postgres over HTTP | Serverless-friendly; app degrades gracefully without it |

```
app/
  page.tsx                  the whole UI
  api/analyze/route.ts      clues → geodata → candidates → persistence
  api/investigations/       saved investigation list and detail
lib/
  pipeline.ts               browser-side extraction + Tesseract + frame stats
  sun.ts                    NOAA solar position and shadow-window solver
  vision.ts                 CLIP + SigLIP ensemble pass, runs in the browser
  visual-priors.ts          landmark and streetscape prompt banks (plain data)
  clues.ts                  deterministic clue matchers
  regions.ts                centroids, plate prefixes, dialling codes, script priors
  geo.ts                    Nominatim, Mapillary, KartaView, Panoramax, Copernicus, Bhuvan
  sigint.ts                 GPSJam + OpenSky overlays (server-side)
  infer.ts                  evidence weighting and ranking
  db.ts                     Neon client + schema
app/cases/                  saved investigation browser and shareable records
components/Globe.tsx        three.js globe
scripts/init-db.mjs         one-shot schema bootstrap
scripts/make-test-clip.py   generates a synthetic signage clip for testing
public/ffmpeg/              vendored ffmpeg-core (~32 MB) — no CDN at runtime
public/data/                Natural Earth country polygons
```

---

## Run it locally

```bash
git clone <your-repo-url> compass-globe
cd compass-globe
npm install
cp .env.example .env.local     # optional — the app runs without any of it
npm run dev                    # http://localhost:3000
```

Generate a test clip with legible signage in English, Hindi and Gujarati:

```bash
python3 scripts/make-test-clip.py     # writes ./test-clip.mp4
```

## Deploy to Vercel + Neon

1. **Neon** — create a project at [neon.tech](https://neon.tech), copy the pooled connection string.
2. **Schema** — put the string in `.env.local` and run `npm run db:init`.
3. **Vercel** — import the GitHub repo. Framework preset: Next.js. No build overrides needed.
4. **Environment variables** — add the three below in Vercel's project settings.
5. Deploy.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No | Neon Postgres pooled connection string. Without it, analysis still runs and the header says `Neon not configured`; nothing is saved. |
| `MAPILLARY_TOKEN` | No | Free client token from the [Mapillary developer dashboard](https://www.mapillary.com/dashboard/developers). Adds Mapillary imagery on top of KartaView, which already works without any key. |
| `NOMINATIM_USER_AGENT` | **Yes before deploying** | Nominatim's usage policy requires a real identifying contact string, e.g. `compass-globe/0.1 (you@example.com)`. Set it or you risk being blocked. |
| `COPERNICUS_CLIENT_ID` | No | Free OAuth client from the [Copernicus Data Space dashboard](https://dataspace.copernicus.eu) (User settings → OAuth clients, client_credentials grant). Adds a high-resolution (10 m) Sentinel-2 L2A scene preview to the street-imagery grid. Without both keys the layer is silently skipped. |
| `COPERNICUS_CLIENT_SECRET` | No | Secret paired with `COPERNICUS_CLIENT_ID`. No credit card; free. |

### Deployment notes

- `/api/health` is a read-only uptime probe — `GET /api/health` returns liveness, the DB state
  (`ok`/`error`/`unconfigured`), and whether the optional Mapillary/Copernicus backends are
  configured. It returns 503 when the configured DB is unreachable. Point an uptime monitor at it.
- If you are updating an **existing** Neon database, re-run `npm run db:init` so the idempotent
  `alter table ... add column if not exists model` adds the new `clues.model` column; existing rows
  stay readable with `model = null`, no backfill needed.
- `/api/analyze` makes up to six sequential Nominatim lookups at ~1 request/second, so the route can
  run for 6–8 seconds. It declares `maxDuration = 60`. On Vercel Hobby without Fluid compute the
  ceiling is lower — reduce `MAX_GEOCODES` in `lib/infer.ts` if you hit a timeout.
- `public/ffmpeg/ffmpeg-core.wasm` is ~32 MB and is committed on purpose, so the app has no runtime
  CDN dependency. It is downloaded once per browser and then cached.
- Thumbnails are stored as data URLs in Postgres. Fine at this scale; swap to object storage if you
  start archiving thousands of investigations.

---

## Limitations — read these before you publish anything

- **Geolocation here is probabilistic.** Every result is a hypothesis to check, not a determination.
- **No legible text means no result.** Silence from the tool is not evidence about the footage.
- **OCR is noisy.** A misread plate prefix points confidently at the wrong state. Clues are down-weighted by keyframe focus and exposure, which reduces this but does not remove it.
- **Signage travels.** A language on a shop front does not fix a country.
- **Confidence is a share of recovered evidence weight,** not a probability of being correct.
- **Region markers sit on centroids.** They mark a hypothesis area, never a camera position.
- **The gazetteer produces false positives.** Generic words get filtered, but not perfectly.
- **The country anchor can be wrong.** If it is, the right answer is demoted rather than removed — read the `conflicts` rows.
- **Anchoring needs bias-free evidence.** A clip with nothing but generic Latin signage has nothing to anchor on, and stays vulnerable to gazetteer skew.
- **Green-pixel share and luma are observations only.** They are displayed, never scored.
- **The vision pass is confidently wrong.** A landmark match is a visual similarity score from two models, not an identification. Always confirm against a reference photograph.
- **The landmark bank is small and unevenly distributed.** A place that is not in it cannot be recognised, and absence means nothing.
- **The vision pass is slow on CPU.** Expect a minute or more for a first run while weights download.
- **Shadow timing assumes the date you enter** and a flat, unobstructed horizon.
- **Shadowline times are a solar clock,** not a wall clock. Convert before comparing to a claimed timestamp.

The UI states all of this in the "Method and limits" panel. Please leave it there in any fork.

---

## Roadmap

- [x] Browser-decoder extraction path so keyframes never fail to appear
- [x] Sun-angle / shadow time estimation from a candidate coordinate (Shadowline)
- [x] KartaView alongside Mapillary, working without any API key
- [x] Markdown evidence report alongside the JSON bundle
- [x] Country anchoring to defeat the gazetteer's Global North bias
- [x] In-browser CLIP inference as a second, clearly-separated visual opinion
- [x] Landmark recognition with real coordinates
- [x] Panoramax as a third open imagery source
- [x] Bhuvan (ISRO) deep link for India-specific terrain cross-checking
- [x] Saved investigation browser and shareable case links
- [x] Scene-change threshold exposed in the UI, plus a keyframe-quality score
- [x] Real satellite, street and terrain basemaps with street-level descent
- [x] WebGPU inference path with automatic WASM fallback
- [x] SigLIP second vision model, ensemble-scored alongside CLIP
- [x] Optional Copernicus Sentinel-2 high-res scene previews
- [x] GPSJam + OpenSky SIGINT/open-data overlays for the top candidates
- [ ] Bhuvan WMS layers rendered in-app rather than linked out
- [x] Place-word lexicon for Latin-script non-English signage
- [x] Registration-plate formats beyond India and the UK
- [x] Evidence weighted by keyframe focus and exposure
- [ ] A larger landmark bank — the current one is ~120 entries and needs hundreds
- [ ] GeoCLIP proper (needs an ONNX export; no browser-runnable build exists yet)
- [ ] Community-contributed regional signage patterns beyond India, UK and the US

## Contributing

The clue engine is the part worth extending, and it needs no machine learning knowledge — just local
expertise. Registration-plate formats, script priors, dialling codes and gazetteer stopwords all live
in `lib/regions.ts` and `lib/clues.ts` as plain data. If you know how plates or signage work in your
country, that is a directly useful pull request.

**The prompt banks in `lib/visual-priors.ts` are the easiest and most valuable place to contribute.**
They are plain data — a description string, a note, and the regions it implies. `lib/lexicon.ts` is
the same: one row per street-word or plate format. If you know what the
street furniture, police uniforms, utility poles, number plates or bus liveries look like where you
work, that is a directly useful pull request and needs no machine-learning knowledge. The landmark
bank is currently ~120 entries and is still heavily under-covered outside India, the US and Europe.

Two rules: no paid or proprietary vision APIs, and no clue may be added without a human-readable
`rationale` string explaining it.

## Licence and data attribution

Code: MIT. Geodata: © OpenStreetMap contributors, ODbL. Street imagery: Mapillary, KartaView and
Panoramax contributors, CC BY-SA. Satellite basemaps: NASA GIBS (MODIS Terra & NOAA-20
VIIRS, daily true-color, NASA open data); EOX Sentinel-2 cloudless (CC BY 4.0, Contains
modified Copernicus Sentinel data 2016 & 2017); Esri World Imagery (Maxar, Earthstar
Geographics — non-commercial use only per Esri terms). Optional high-resolution scene
previews: Copernicus Data Space Ecosystem (Sentinel-2 L2A). Terrain: OpenTopoMap, CC BY-SA.
Country polygons: Natural Earth, public domain.
