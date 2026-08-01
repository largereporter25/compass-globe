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
   ├─ 3. clue extraction ─── deterministic matchers, no model inference:
   │        • Unicode script blocks       → country priors
   │        • Indian / UK plate formats   → state or country
   │        • +CC dialling prefixes       → country
   │        • ccTLDs on signage           → country
   │        • currency signs              → country
   │        • capitalised tokens          → possible place names
   │
   ├─ 4. OpenStreetMap Nominatim ─ resolves place names to real coordinates
   │
   ├─ 5. KartaView + Mapillary ─── street-level imagery near the lead candidate
   │
   ├─ 6. weighted aggregation ──── ranked candidates + confidence band
   │
   ├─ 7. globe + reasoning trail ─ every candidate shows the clues that produced it
   │
   └─ 8. Shadowline ────────────── solar geometry turns a shadow direction
                                   into a time-of-day window
```

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
| Street imagery | KartaView (keyless) + Mapillary (optional token) | CC BY-SA, complementary Global South coverage, works with zero configuration |
| Globe | `react-globe.gl` / three.js | Hex-polygon countries, confidence-scaled points |
| Database | Neon Postgres over HTTP | Serverless-friendly; app degrades gracefully without it |

```
app/
  page.tsx                  the whole UI
  api/analyze/route.ts      clues → geodata → candidates → persistence
  api/investigations/       saved investigation list and detail
lib/
  pipeline.ts               browser-side extraction + Tesseract + frame stats
  sun.ts                    NOAA solar position and shadow-window solver
  clues.ts                  deterministic clue matchers
  regions.ts                centroids, plate prefixes, dialling codes, script priors
  geo.ts                    Nominatim + Mapillary + KartaView clients
  infer.ts                  evidence weighting and ranking
  db.ts                     Neon client + schema
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

### Deployment notes

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
- **OCR is noisy.** A misread plate prefix points confidently at the wrong state.
- **Signage travels.** A language on a shop front does not fix a country.
- **Confidence is a share of recovered evidence weight,** not a probability of being correct.
- **Region markers sit on centroids.** They mark a hypothesis area, never a camera position.
- **The gazetteer produces false positives.** Generic words get filtered, but not perfectly.
- **Green-pixel share and luma are observations only.** They are displayed, never scored.
- **Shadow timing assumes the date you enter** and a flat, unobstructed horizon.
- **Shadowline times are a solar clock,** not a wall clock. Convert before comparing to a claimed timestamp.

The UI states all of this in the "Method and limits" panel. Please leave it there in any fork.

---

## Roadmap

- [x] Browser-decoder extraction path so keyframes never fail to appear
- [x] Sun-angle / shadow time estimation from a candidate coordinate (Shadowline)
- [x] KartaView alongside Mapillary, working without any API key
- [x] Markdown evidence report alongside the JSON bundle
- [ ] Panoramax as a third open imagery source
- [ ] Bhuvan (ISRO) layers for India-specific terrain and land-use cross-checking
- [ ] Local GeoCLIP / StreetCLIP inference as a second, clearly-separated opinion
- [ ] Saved investigation browser and shareable case links
- [ ] Scene-change threshold exposed in the UI, with a keyframe-quality score
- [ ] Community-contributed regional signage patterns beyond India and the UK

## Contributing

The clue engine is the part worth extending, and it needs no machine learning knowledge — just local
expertise. Registration-plate formats, script priors, dialling codes and gazetteer stopwords all live
in `lib/regions.ts` and `lib/clues.ts` as plain data. If you know how plates or signage work in your
country, that is a directly useful pull request.

Two rules: no paid or proprietary vision APIs, and no clue may be added without a human-readable
`rationale` string explaining it.

## Licence and data attribution

Code: MIT. Geodata: © OpenStreetMap contributors, ODbL. Street imagery: Mapillary and KartaView
contributors, CC BY-SA. Country polygons: Natural Earth, public domain.
