"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Logo from "@/components/Logo";
import type { GlobePoint } from "@/components/Globe";
import {
  OCR_LANGS,
  extractKeyframes,
  frameStats,
  ocrFrames,
  type ExtractMode,
  type Keyframe,
  type Progress,
  type RawFrame,
} from "@/lib/pipeline";
import { COMPASS_POINTS, shadowWindows, type ShadowResult } from "@/lib/sun";
import type { VisualClue } from "@/lib/vision";

const CompassGlobe = dynamic(() => import("@/components/Globe"), {
  ssr: false,
  loading: () => <div className="h-full w-full" />,
});

type StreetImage = { id: string; thumb: string; lat: number; lon: number; source: string; link: string; capturedAt?: string };

type Candidate = {
  key: string; label: string; country: string; admin?: string;
  lat: number; lon: number; score: number; confidence: number;
  band: "Weak" | "Moderate" | "Strong";
  precision: "country" | "sub-national" | "locality";
  coherence?: "agrees" | "conflicts" | "n/a";
  bhuvanUrl?: string | null;
  reasons: { frame: number; kind: string; value: string; rationale: string; weight: number }[];
  streetImages?: StreetImage[];
};

type AnalyzeResponse = {
  id: string; title: string; persisted: boolean; dbConfigured: boolean; mapillaryConfigured: boolean;
  summary: string; geocodeAttempts: number; geocodeHits: number;
  candidates: Candidate[];
  clues: { kind: string; frame: number; value: string; rationale: string; score?: number }[];
  anchorCountry: { code: string; label: string; strength: number } | null;
};

type Tab = "frames" | "trail" | "shadow";

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ExtractMode>("native");
  const [target, setTarget] = useState(10);
  const [sceneThreshold, setSceneThreshold] = useState(0.22);
  const [useVision, setUseVision] = useState(true);
  const [langs, setLangs] = useState<string[]>(["eng"]);
  const [langOpen, setLangOpen] = useState(false);

  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<Progress>({ stage: "", detail: "", pct: 0 });
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [extractMethod, setExtractMethod] = useState<string | null>(null);

  const [frames, setFrames] = useState<Keyframe[]>([]);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("frames");
  const [showMethod, setShowMethod] = useState(false);
  const [showSetup, setShowSetup] = useState(true);

  // Shadowline inputs
  const [shDate, setShDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shBearing, setShBearing] = useState(315);
  const [shTol, setShTol] = useState(12);
  const [shRatio, setShRatio] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  const points: GlobePoint[] = useMemo(
    () =>
      (result?.candidates || []).map((c, i) => ({
        key: c.key, label: c.label, lat: c.lat, lon: c.lon,
        confidence: c.confidence, band: c.band, rank: i + 1,
      })),
    [result]
  );

  const activeCandidate =
    result?.candidates.find((c) => c.key === selectedCandidate) || result?.candidates[0] || null;

  const frameClues = useMemo(
    () => (result ? result.clues.filter((c) => c.frame === selectedFrame) : []),
    [result, selectedFrame]
  );

  const shadow: ShadowResult | null = useMemo(() => {
    if (!activeCandidate) return null;
    const ratio = parseFloat(shRatio);
    return shadowWindows({
      lat: activeCandidate.lat,
      lon: activeCandidate.lon,
      date: shDate,
      shadowBearing: shBearing,
      bearingTolerance: shTol,
      lengthRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : null,
    });
  }, [activeCandidate, shDate, shBearing, shTol, shRatio]);

  const pushLog = useCallback((s: string) => {
    setLog((l) => (l[l.length - 1] === s ? l : [...l.slice(-60), s]));
  }, []);

  const reset = () => {
    setResult(null); setFrames([]); setPhase("idle"); setError(null);
    setExtractNote(null); setExtractMethod(null); setSelectedFrame(0); setTab("frames");
  };

  const onPick = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("video/") && !/\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(f.name)) {
      setError("That is not a video file. Supported: mp4, webm, mov, mkv, avi.");
      return;
    }
    reset();
    setFile(f);
    setVideoUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
  };

  async function run() {
    if (!file) return;
    setPhase("running"); setError(null); setLog([]); setResult(null); setFrames([]);
    setExtractNote(null); setExtractMethod(null);

    let raw: RawFrame[] = [];
    let durationSec = 0;

    // Stage 1 — extraction. This is the stage that must never silently fail.
    try {
      const out = await extractKeyframes(file, { mode, target, sceneThreshold }, (p) => { setProgress(p); pushLog(p.detail); }, pushLog);
      raw = out.frames;
      durationSec = out.durationSec;
      setExtractMethod(out.method);
      if (out.note) setExtractNote(out.note);
      pushLog(`${raw.length} keyframes extracted via ${out.method}`);
    } catch (e: any) {
      console.error("extraction failed:", e);
      setError(`Keyframe extraction failed. ${e?.message || e}`);
      setPhase("error");
      return;
    }

    // Stage 2 — thumbnails and image statistics. Show frames immediately.
    let partial: Keyframe[] = [];
    try {
      const stats = await Promise.all(raw.map((f) => frameStats(f.blob)));
      partial = raw.map((f, i) => ({
        idx: f.idx, tSec: f.tSec, blobUrl: URL.createObjectURL(f.blob),
        thumb: stats[i].thumb, text: "", confidence: 0,
        vegetationRatio: stats[i].vegetationRatio, meanLuma: stats[i].meanLuma,
        sharpness: stats[i].sharpness, quality: stats[i].quality,
      }));
      setFrames(partial);
      setSelectedFrame(0);
    } catch (e: any) {
      console.error("thumbnailing failed:", e);
      setError(`Frames were extracted but could not be rendered. ${e?.message || e}`);
      setPhase("error");
      return;
    }

    // Stage 3 — OCR.
    let complete = partial;
    try {
      const ocr = await ocrFrames(raw, langs, (p) => { setProgress(p); pushLog(p.detail); });
      complete = partial.map((f) => ({ ...f, text: ocr[f.idx]?.text || "", confidence: ocr[f.idx]?.confidence || 0 }));
      setFrames(complete);
    } catch (e: any) {
      console.error("OCR failed:", e);
      setError(`Keyframes are ready, but OCR failed. ${e?.message || e}`);
      setPhase("error");
      return;
    }

    // Stage 3b — CLIP vision pass. Optional, and a failure here must not lose
    // the text evidence that is already in hand.
    let visualClues: VisualClue[] = [];
    if (useVision) {
      try {
        const { analyseFrames } = await import("@/lib/vision");
        visualClues = await analyseFrames(raw, (p) => { setProgress(p); pushLog(p.detail); });
        pushLog(`${visualClues.length} visual clues from CLIP`);
      } catch (e: any) {
        console.error("vision pass failed:", e);
        pushLog(`Vision pass skipped: ${e?.message || e}`);
        setExtractNote((n) => n ?? `The CLIP vision pass could not run (${e?.message || e}). Text evidence was used on its own.`);
      }
    }

    // Stage 4 — clue matching and geodata.
    try {
      setProgress({ stage: "geodata", detail: "Matching clues against open geodata", pct: 0.88 });
      pushLog("Resolving place names against the OpenStreetMap gazetteer");
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoName: file.name, durationSec, visualClues,
          frames: complete.map((f) => ({ idx: f.idx, tSec: f.tSec, text: f.text, confidence: f.confidence, thumb: f.thumb })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `server returned ${res.status}`);
      const data: AnalyzeResponse = await res.json();
      setResult(data);
      setSelectedCandidate(data.candidates[0]?.key ?? null);
      setTab("trail");
      setShowSetup(false);
      setProgress({ stage: "done", detail: "Analysis complete", pct: 1 });
      setPhase("done");
    } catch (e: any) {
      console.error("inference failed:", e);
      setError(`Keyframes and OCR are ready, but the geodata step failed. ${e?.message || e}`);
      setPhase("error");
    }
  }

  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    if (!result) return;
    download(`compass-globe-${result.id.slice(0, 8)}.json`, JSON.stringify({
      tool: "Compass Globe", generatedAt: new Date().toISOString(),
      video: { name: file?.name, frames: frames.length, extraction: extractMethod },
      summary: result.summary, candidates: result.candidates, clues: result.clues,
      ocr: frames.map((f) => ({ frame: f.idx, tSec: f.tSec, confidence: f.confidence, text: f.text })),
      caveat: "Candidate regions are probabilistic hypotheses derived from on-screen text. They are not a determination of location.",
    }, null, 2), "application/json");
  }

  function exportMarkdown() {
    if (!result) return;
    const L: string[] = [];
    L.push(`# Geolocation triage — ${file?.name || "clip"}`);
    L.push(`\nGenerated ${new Date().toISOString()} with Compass Globe.`);
    L.push(`\n> Candidate regions are probabilistic hypotheses derived from on-screen text. They are not a determination of location. Verify before publishing.\n`);
    L.push(`## Summary\n\n${result.summary}`);
    L.push(`\n## Method\n`);
    L.push(`- Keyframes: ${frames.length}, extracted via ${extractMethod}`);
    L.push(`- OCR scripts: ${langs.join(", ")}`);
    L.push(`- Vision pass: ${useVision ? "CLIP ViT-B/32 in-browser" : "disabled"}`);
    if (result.anchorCountry) L.push(`- Country anchor: ${result.anchorCountry.label} (${(result.anchorCountry.strength * 100).toFixed(0)}% of bias-free evidence)`);
    L.push(`- Gazetteer lookups: ${result.geocodeHits} resolved of ${result.geocodeAttempts} attempted (OpenStreetMap Nominatim)`);
    L.push(`\n## Candidates\n`);
    L.push(`| # | Region | Precision | Confidence | Band | Coordinates |`);
    L.push(`|---|---|---|---|---|---|`);
    result.candidates.forEach((c, i) =>
      L.push(`| ${i + 1} | ${c.label} | ${c.precision} | ${(c.confidence * 100).toFixed(0)}% | ${c.band} | ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)} |`)
    );
    result.candidates.forEach((c, i) => {
      L.push(`\n### ${i + 1}. ${c.label}\n`);
      c.reasons.forEach((r) => L.push(`- **${r.kind}** (frame ${r.frame + 1}, weight ${r.weight}) — \`${r.value}\` — ${r.rationale}`));
      if (c.streetImages?.length) {
        L.push(`\nStreet-level imagery near this candidate:`);
        c.streetImages.forEach((s) => L.push(`- [${s.source} ${s.id}](${s.link})${s.capturedAt ? ` — captured ${s.capturedAt}` : ""}`));
      }
    });
    L.push(`\n## Recognised text by keyframe\n`);
    frames.forEach((f) => {
      L.push(`\n**Frame ${f.idx + 1} — ${f.tSec.toFixed(1)}s** (quality ${f.quality}/100, OCR confidence ${f.confidence.toFixed(0)}%)\n`);
      L.push("```\n" + (f.text || "— nothing legible —") + "\n```");
    });
    if (shadow && activeCandidate && shadow.windows.length) {
      L.push(`\n## Shadow timing — ${activeCandidate.label}, ${shDate}\n`);
      L.push(`Shadow bearing ${shBearing}° ±${shTol}°. Sunrise ${shadow.sunrise ?? "n/a"}, sunset ${shadow.sunset ?? "n/a"}, solar-noon elevation ${shadow.solarNoonElevation}°. Times are local solar clock.\n`);
      shadow.windows.forEach((w) => L.push(`- ${w.startLocal}–${w.endLocal} — sun ${w.meanElevation}° elevation, ${w.meanAzimuth}° azimuth, shadow ${w.shadowRatio}× object height`));
    }
    L.push(`\n---\n\nGeodata © OpenStreetMap contributors (ODbL). Street imagery: Mapillary and KartaView contributors (CC BY-SA).`);
    download(`compass-globe-${result.id.slice(0, 8)}.md`, L.join("\n"), "text/markdown");
  }

  const busy = phase === "running";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-ink-950">
      {/* ══ Header ══════════════════════════════════════════════ */}
      <header className="flex shrink-0 items-stretch border-b-2 border-bone-100">
        <div className="flex items-center gap-3 border-r border-ink-700 px-5 py-4">
          <Logo size={24} />
          <span className="font-display text-xl font-bold uppercase leading-none tracking-tight">
            Compass Globe
          </span>
        </div>
        <div className="hidden items-center px-5 md:flex">
          <span className="text-sm text-bone-400">
            Geolocation triage for video evidence. Nothing but text leaves your machine.
          </span>
        </div>
        <div className="ml-auto flex items-stretch">
          <a
            href="/cases"
            className="hidden items-center border-l border-ink-700 px-4 font-display text-sm font-semibold text-bone-400 hover:text-signal lg:flex"
            data-testid="link-cases"
          >
            Saved
          </a>
          <Chip on label="LOCAL" note="video stays in browser" />
          <Chip on={Boolean(result?.dbConfigured)} label="NEON" note={result ? (result.persisted ? "saved" : "write failed") : "standby"} />
          <Chip on label="OSM" note="gazetteer" />
          <Chip on={Boolean(result?.mapillaryConfigured)} label="IMAGERY" note={result?.mapillaryConfigured ? "mapillary + kartaview" : "kartaview"} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ══ Globe ═════════════════════════════════════════════ */}
        <section className="relative min-h-[44vh] min-w-0 flex-1 overflow-hidden">
          <div className="absolute inset-0">
            <CompassGlobe points={points} selected={selectedCandidate} onSelect={setSelectedCandidate} />
          </div>

          {!result && !busy && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="marker">No evidence loaded</p>
            </div>
          )}

          {busy && (
            <div className="absolute inset-x-0 top-0 p-6">
              <div className="max-w-lg border-2 border-bone-100 bg-ink-950 rise">
                <div className="flex items-baseline justify-between border-b border-ink-700 px-4 py-2">
                  <span className="marker text-signal">{progress.stage || "working"}</span>
                  <span className="tabnum font-mono text-xs text-bone-400">{Math.round(progress.pct * 100)}%</span>
                </div>
                <p className="px-4 pt-4 font-display text-lg font-semibold leading-tight">{progress.detail}</p>
                <div className="mt-4 h-2 w-full bg-ink-800">
                  <div className="h-full bg-signal transition-[width] duration-500 ease-out" style={{ width: `${progress.pct * 100}%` }} />
                </div>
                <div className="max-h-24 overflow-hidden px-4 py-3 font-mono text-[11px] leading-relaxed text-bone-600">
                  {log.slice(-4).map((l, i) => <div key={i} className="truncate">{l}</div>)}
                </div>
              </div>
            </div>
          )}

          {result && (
            <div className="absolute inset-x-0 bottom-0 p-6">
              <div className="max-w-2xl border-2 border-bone-100 bg-ink-950 rise">
                <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2">
                  <span className="marker">Candidate ledger</span>
                  <span className="flex gap-4">
                    {result.persisted && (
                      <a href={`/cases/${result.id}`} target="_blank" rel="noreferrer" className="marker text-bone-200 hover:text-signal" data-testid="link-share">Share link</a>
                    )}
                    <button onClick={exportMarkdown} className="marker text-bone-200 hover:text-signal" data-testid="button-export-md">Report .md</button>
                    <button onClick={exportJson} className="marker text-bone-200 hover:text-signal" data-testid="button-export">Data .json</button>
                  </span>
                </div>

                {result.candidates.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-bone-200">
                    Nothing in the recognised text mapped to a script, plate, dialling code, domain,
                    currency or gazetteer entry. That is a null result, not a finding.
                  </p>
                ) : (
                  <ul className="max-h-[34vh] overflow-y-auto">
                    {result.candidates.map((c, i) => {
                      const active = c.key === (selectedCandidate ?? result.candidates[0].key);
                      return (
                        <li key={c.key} className="border-b border-ink-800 last:border-0">
                          <button
                            onClick={() => { setSelectedCandidate(c.key); setTab("trail"); }}
                            data-testid={`button-candidate-${i}`}
                            className={`flex w-full items-center gap-4 px-4 py-3 text-left ${active ? "bg-signal text-ink-950" : "hover:bg-ink-850"}`}
                          >
                            <span className="tabnum w-8 shrink-0 font-display text-2xl font-bold leading-none">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-display text-base font-semibold leading-tight">{c.label}</span>
                              <span className={`mt-0.5 block font-mono text-[11px] uppercase tracking-wider ${active ? "text-ink-950/70" : "text-bone-600"}`}>
                                {c.precision} · {c.reasons.length} clue{c.reasons.length === 1 ? "" : "s"} · {c.band}
                              </span>
                            </span>
                            <span className="tabnum shrink-0 font-display text-2xl font-bold leading-none">
                              {(c.confidence * 100).toFixed(0)}
                              <span className="text-sm">%</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ══ Rail ══════════════════════════════════════════════ */}
        <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-t-2 border-bone-100 bg-ink-950 lg:w-[420px] lg:border-l-2 lg:border-t-0">
          {/* Source */}
          <div className="border-b border-ink-700 p-6">
            <p className="marker mb-4">Source clip</p>

            {!file ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files?.[0] ?? null); }}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                role="button" tabIndex={0} data-testid="dropzone-video"
                className="cursor-pointer border-2 border-dashed border-ink-600 px-4 py-12 text-center hover:border-signal"
              >
                <p className="font-display text-xl font-semibold leading-tight">Drop a video</p>
                <p className="mt-2 text-sm text-bone-400">mp4 · webm · mov · mkv · avi</p>
              </div>
            ) : (
              <div className="rise">
                {videoUrl && <video src={videoUrl} controls className="w-full border border-ink-700 bg-black" data-testid="video-preview" />}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-bone-200" title={file.name}>{file.name}</p>
                  <button onClick={() => { setFile(null); setVideoUrl(null); reset(); }} className="marker shrink-0 hover:text-signal" data-testid="button-clear">Clear</button>
                </div>
              </div>
            )}
            <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} data-testid="input-video" />

            {!showSetup ? (
              <button
                onClick={() => setShowSetup(true)}
                className="mt-4 w-full border border-ink-600 px-4 py-3 text-left font-display text-sm font-semibold text-bone-400 hover:border-signal hover:text-bone-100"
                data-testid="button-show-setup"
              >
                Extraction settings — {extractMethod}, {target} keyframes, {langs.length} script{langs.length === 1 ? "" : "s"}
              </button>
            ) : (
            <div className="mt-6 space-y-5">
              <div>
                <p className="marker mb-2">Extraction</p>
                <div className="grid grid-cols-2 gap-0 border border-ink-600">
                  {([["native", "Fast"], ["deep", "Deep scan"]] as const).map(([m, label], i) => (
                    <button
                      key={m} onClick={() => setMode(m)} data-testid={`button-mode-${m}`}
                      className={`px-3 py-2.5 font-display text-sm font-semibold ${i === 0 ? "border-r border-ink-600" : ""} ${
                        mode === m ? "bg-bone-100 text-ink-950" : "text-bone-400 hover:text-bone-100"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-snug text-bone-600">
                  {mode === "native"
                    ? "Your browser's own video decoder samples evenly across the clip. Instant, handles any codec the browser can play, and cannot run out of memory."
                    : "Real ffmpeg compiled to WebAssembly, using its scene-change detector to pick frames where the shot actually cuts. Downloads a 32 MB core once. Falls back to Fast automatically if anything goes wrong."}
                </p>
              </div>

              {mode === "deep" && (
                <label className="block">
                  <span className="marker mb-2 flex items-baseline justify-between">
                    <span>Scene-change threshold</span>
                    <span className="tabnum font-display text-xl font-bold text-bone-100">{sceneThreshold.toFixed(2)}</span>
                  </span>
                  <input
                    type="range" min={0.05} max={0.6} step={0.01} value={sceneThreshold}
                    onChange={(e) => setSceneThreshold(Number(e.target.value))}
                    className="w-full" data-testid="input-scene-threshold"
                  />
                  <span className="mt-1.5 block text-xs leading-snug text-bone-600">
                    Lower catches soft transitions and pans. Higher keeps only hard cuts. Falls back
                    to even sampling if fewer than three cuts clear it.
                  </span>
                </label>
              )}

              <label className="block">
                <span className="marker mb-2 flex items-baseline justify-between">
                  <span>Keyframes</span>
                  <span className="tabnum font-display text-xl font-bold text-bone-100">{target}</span>
                </span>
                <input type="range" min={4} max={24} step={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-full" data-testid="input-target" />
              </label>

              <div>
                <button onClick={() => setLangOpen((v) => !v)} className="marker flex w-full items-center justify-between hover:text-signal" data-testid="button-langs">
                  <span>OCR scripts</span><span>{langOpen ? "CLOSE" : `${langs.length} ON`}</span>
                </button>
                <p className="mt-1.5 text-xs text-bone-400">{langs.map((l) => OCR_LANGS.find((o) => o.code === l)?.label).join(" · ")}</p>
                {langOpen && (
                  <div className="mt-3 grid max-h-48 grid-cols-2 gap-px overflow-y-auto border border-ink-700 bg-ink-700">
                    {OCR_LANGS.map((l) => {
                      const on = langs.includes(l.code);
                      return (
                        <button
                          key={l.code}
                          onClick={() => setLangs((cur) => {
                            const next = cur.includes(l.code) ? cur.filter((c) => c !== l.code) : [...cur, l.code];
                            return next.length ? next : ["eng"];
                          })}
                          className={`truncate px-2.5 py-2 text-left text-xs ${on ? "bg-signal font-semibold text-ink-950" : "bg-ink-950 text-bone-400 hover:text-bone-100"}`}
                        >
                          {l.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2 text-xs leading-snug text-bone-600">
                  Latin-only OCR will miss most South Asian signage. Each extra script pulls one language pack.
                </p>
              </div>

              <button
                onClick={() => setUseVision((v) => !v)}
                data-testid="button-vision"
                className={`flex w-full items-center justify-between border px-3 py-2.5 text-left ${
                  useVision ? "border-signal bg-signal/10" : "border-ink-600"
                }`}
              >
                <span>
                  <span className="block font-display text-sm font-semibold text-bone-100">Vision pass (CLIP)</span>
                  <span className="mt-0.5 block text-xs text-bone-600">
                    Recognises landmarks and streetscape signatures when there is no legible text
                  </span>
                </span>
                <span className={`ml-3 shrink-0 font-mono text-[11px] ${useVision ? "text-signal" : "text-bone-600"}`}>
                  {useVision ? "ON" : "OFF"}
                </span>
              </button>
            </div>
            )}

            <button
              onClick={run} disabled={!file || busy} data-testid="button-run"
              className="mt-6 w-full bg-signal px-4 py-4 font-display text-lg font-bold uppercase tracking-wide text-ink-950 hover:bg-bone-100 disabled:cursor-not-allowed disabled:bg-ink-800 disabled:text-bone-600"
            >
              {busy ? "Analysing" : "Run analysis"}
            </button>

            {error && (
              <div className="mt-4 border-l-4 border-signal bg-ink-850 p-4" data-testid="text-error">
                <p className="marker text-signal">Failed</p>
                <p className="mt-1.5 text-sm leading-snug text-bone-100">{error}</p>
              </div>
            )}
            {extractNote && !error && (
              <p className="mt-4 border-l-4 border-ink-600 bg-ink-850 p-3 text-xs leading-snug text-bone-400">{extractNote}</p>
            )}
          </div>

          {/* Tabs */}
          {frames.length > 0 && (
            <>
              <div className="sticky top-0 z-10 grid grid-cols-3 border-b border-ink-700 bg-ink-950">
                {([["frames", `Frames ${frames.length}`], ["trail", "Trail"], ["shadow", "Shadow"]] as const).map(([t, label]) => (
                  <button
                    key={t} onClick={() => setTab(t)} data-testid={`button-tab-${t}`}
                    className={`border-r border-ink-700 px-3 py-3 font-display text-sm font-semibold last:border-r-0 ${
                      tab === t ? "bg-bone-100 text-ink-950" : "text-bone-400 hover:text-bone-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Frames */}
              {tab === "frames" && (
                <div className="p-6">
                  {extractMethod && <p className="marker mb-3">Extracted via {extractMethod}</p>}
                  <div className="grid grid-cols-3 gap-px bg-ink-700">
                    {frames.map((f) => (
                      <button
                        key={f.idx} onClick={() => setSelectedFrame(f.idx)} data-testid={`button-frame-${f.idx}`}
                        className={`relative bg-ink-950 ${selectedFrame === f.idx ? "outline outline-2 -outline-offset-2 outline-signal" : "opacity-70 hover:opacity-100"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.thumb} alt={`Keyframe ${f.idx + 1}`} className="aspect-video w-full object-cover" />
                        <span className="tabnum absolute bottom-0 left-0 bg-ink-950 px-1 font-mono text-[10px] text-bone-200">{f.tSec.toFixed(1)}s</span>
                        <span
                          className={`tabnum absolute right-0 top-0 px-1 font-mono text-[10px] ${
                            f.quality >= 55 ? "bg-ink-950 text-bone-400" : "bg-signal text-ink-950"
                          }`}
                          title={`Keyframe quality ${f.quality}/100 — focus and exposure. Low frames produce unreliable OCR and vision results.`}
                        >
                          {f.quality}
                        </span>
                      </button>
                    ))}
                  </div>

                  {frames[selectedFrame] && (
                    <div className="mt-6">
                      <div className="flex items-baseline justify-between">
                        <p className="font-display text-xl font-bold leading-none">Frame {selectedFrame + 1}</p>
                        <p className="tabnum font-mono text-xs text-bone-400">
                          quality {frames[selectedFrame].quality}/100 · OCR {frames[selectedFrame].confidence.toFixed(0)}% · green {(frames[selectedFrame].vegetationRatio * 100).toFixed(0)}% · luma {frames[selectedFrame].meanLuma.toFixed(0)}
                        </p>
                      </div>
                      <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words border border-ink-700 p-3 font-mono text-xs leading-relaxed text-bone-200">
                        {frames[selectedFrame].text || "— nothing legible in this frame —"}
                      </pre>
                      {frameClues.length > 0 && (
                        <ul className="mt-4 space-y-px bg-ink-700">
                          {frameClues.map((c, i) => (
                            <li key={i} className="bg-ink-950 p-3">
                              <div className="flex items-baseline gap-3">
                                <span className="marker text-signal">{c.kind}</span>
                                <span className="truncate font-mono text-xs text-bone-100">{c.value}</span>
                              </div>
                              <p className="mt-1.5 text-xs leading-snug text-bone-400">{c.rationale}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-4 text-xs leading-snug text-bone-600">
                        Green share and luma are observations only. They are never used to score a location.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Trail */}
              {tab === "trail" && result && (
                <div className="p-6">
                  <p className="text-sm leading-relaxed text-bone-200">{result.summary}</p>
                  {activeCandidate && (
                    <>
                      <div className="mt-6 border-t-2 border-bone-100 pt-4">
                        <p className="font-display text-2xl font-bold leading-tight">{activeCandidate.label}</p>
                        <p className="tabnum mt-1 font-mono text-xs text-bone-400">
                          {activeCandidate.lat.toFixed(4)}, {activeCandidate.lon.toFixed(4)} · {activeCandidate.band} · {(activeCandidate.confidence * 100).toFixed(0)}% of evidence weight
                        </p>
                      </div>
                      <ul className="mt-4 space-y-px bg-ink-700">
                        {activeCandidate.reasons.map((r, i) => (
                          <li key={i} className="bg-ink-950 p-3">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="marker text-signal">{r.kind} · frame {r.frame + 1}</span>
                              <span className="tabnum font-mono text-[11px] text-bone-600">+{r.weight}</span>
                            </div>
                            <p className="mt-1 font-mono text-sm text-bone-100">{r.value}</p>
                            <p className="mt-1 text-xs leading-snug text-bone-400">{r.rationale}</p>
                          </li>
                        ))}
                      </ul>
                      {activeCandidate.bhuvanUrl && (
                        <a
                          href={activeCandidate.bhuvanUrl} target="_blank" rel="noreferrer"
                          className="mt-4 block border border-ink-600 p-3 hover:border-signal"
                          data-testid="link-bhuvan"
                        >
                          <span className="marker text-signal">Bhuvan · ISRO</span>
                          <span className="mt-1 block text-xs leading-snug text-bone-400">
                            Open this coordinate in India&apos;s national geoportal for terrain, land-use
                            and satellite cross-checking. Authoritative Indian data that no Western
                            dataset matches.
                          </span>
                        </a>
                      )}

                      {activeCandidate.streetImages?.length ? (
                        <>
                          <p className="marker mb-2 mt-6">Street imagery nearby</p>
                          <div className="grid grid-cols-3 gap-px bg-ink-700">
                            {activeCandidate.streetImages.map((s) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <a key={s.source + s.id} href={s.link} target="_blank" rel="noreferrer" className="relative bg-ink-950 hover:opacity-80">
                                <img src={s.thumb} alt={`${s.source} street-level view`} className="aspect-video w-full object-cover" />
                                <span className="absolute bottom-0 left-0 bg-ink-950 px-1 font-mono text-[9px] uppercase text-bone-400">{s.source}</span>
                              </a>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-bone-600">
                            Community imagery, CC BY-SA. Compare it yourself — the tool makes no claim that these match.
                          </p>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              )}

              {/* Shadowline */}
              {tab === "shadow" && (
                <div className="p-6">
                  {!activeCandidate ? (
                    <p className="text-sm text-bone-400">Run an analysis and select a candidate first — shadow timing needs a coordinate.</p>
                  ) : (
                    <>
                      <p className="font-display text-xl font-bold leading-tight">Shadowline</p>
                      <p className="mt-2 text-xs leading-snug text-bone-400">
                        A shadow points 180° away from the sun. Given a coordinate and a date, the
                        direction of a shadow in frame fixes the time of day. Pure astronomy, computed
                        in this tab — no service involved.
                      </p>
                      <p className="tabnum mt-3 font-mono text-xs text-bone-600">
                        against {activeCandidate.label} — {activeCandidate.lat.toFixed(3)}, {activeCandidate.lon.toFixed(3)}
                      </p>

                      <div className="mt-5 space-y-5">
                        <label className="block">
                          <span className="marker mb-2 block">Date of capture</span>
                          <input
                            type="date" value={shDate} onChange={(e) => setShDate(e.target.value)}
                            className="w-full border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-sm text-bone-100"
                            data-testid="input-sh-date"
                          />
                        </label>

                        <div>
                          <span className="marker mb-2 flex items-baseline justify-between">
                            <span>Shadow points towards</span>
                            <span className="tabnum font-display text-xl font-bold text-bone-100">{shBearing}°</span>
                          </span>
                          <div className="mb-2 grid grid-cols-8 gap-px bg-ink-700">
                            {COMPASS_POINTS.map((p) => (
                              <button
                                key={p.label} onClick={() => setShBearing(p.bearing)}
                                className={`py-2 font-mono text-[11px] ${shBearing === p.bearing ? "bg-signal text-ink-950" : "bg-ink-950 text-bone-400 hover:text-bone-100"}`}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                          <input type="range" min={0} max={359} value={shBearing} onChange={(e) => setShBearing(Number(e.target.value))} className="w-full" data-testid="input-sh-bearing" />
                        </div>

                        <label className="block">
                          <span className="marker mb-2 flex items-baseline justify-between">
                            <span>Reading tolerance</span>
                            <span className="tabnum font-mono text-sm text-bone-100">±{shTol}°</span>
                          </span>
                          <input type="range" min={3} max={30} value={shTol} onChange={(e) => setShTol(Number(e.target.value))} className="w-full" />
                        </label>

                        <label className="block">
                          <span className="marker mb-2 block">Shadow length ÷ object height (optional)</span>
                          <input
                            type="number" step="0.1" min="0" placeholder="e.g. 1.6"
                            value={shRatio} onChange={(e) => setShRatio(e.target.value)}
                            className="w-full border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-sm text-bone-100"
                            data-testid="input-sh-ratio"
                          />
                          <span className="mt-1.5 block text-xs leading-snug text-bone-600">
                            If a pole and its shadow are both measurable in frame, this narrows the window sharply.
                          </span>
                        </label>
                      </div>

                      {shadow && (
                        <div className="mt-6 border-t-2 border-bone-100 pt-4">
                          <p className="tabnum font-mono text-xs text-bone-400">
                            sunrise {shadow.sunrise ?? "—"} · sunset {shadow.sunset ?? "—"} · noon elevation {shadow.solarNoonElevation}°
                          </p>
                          {shadow.windows.length === 0 ? (
                            <p className="mt-3 text-sm leading-snug text-bone-200" data-testid="text-sh-none">
                              No time on {shDate} puts the sun in the right place for that shadow at this
                              coordinate. Either the date is wrong, the bearing is misread, or the
                              candidate location is wrong — which is itself a useful finding.
                            </p>
                          ) : (
                            <ul className="mt-3 space-y-px bg-ink-700" data-testid="list-sh-windows">
                              {shadow.windows.map((w, i) => (
                                <li key={i} className="bg-ink-950 p-3">
                                  <p className="tabnum font-display text-xl font-bold leading-none">
                                    {w.startLocal}–{w.endLocal}
                                  </p>
                                  <p className="tabnum mt-1.5 font-mono text-[11px] text-bone-400">
                                    sun {w.meanElevation}° up, {w.meanAzimuth}° azimuth · shadow {w.shadowRatio}× height · {w.startUTC}–{w.endUTC} UTC
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-3 text-xs leading-snug text-bone-600">
                            Times are a local solar clock derived from longitude, not a political
                            timezone — no DST, no zone boundaries. Convert before comparing against a
                            claimed timestamp.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Briefing when idle */}
          {!frames.length && !busy && (
            <div className="border-b border-ink-700 p-6">
              <p className="marker mb-4">Pipeline</p>
              <ol className="space-y-4">
                {[
                  ["Cut keyframes", "Browser decoder by default, real ffmpeg scene detection on demand."],
                  ["Read the frames", "Tesseract OCR locally, in the scripts you choose."],
                  ["Turn text into clues", "Scripts, plate formats, dialling codes, ccTLDs, currency marks."],
                  ["Resolve names", "OpenStreetMap gazetteer lookup for anything that looks like a place."],
                  ["Rank and plot", "Candidates on the globe, each with the clues that produced it."],
                  ["Time the shadows", "Solar geometry turns a shadow direction into a time window."],
                ].map(([h, d], i) => (
                  <li key={i} className="flex gap-4">
                    <span className="tabnum shrink-0 font-display text-xl font-bold leading-none text-signal">{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      <span className="block font-display text-base font-semibold leading-tight">{h}</span>
                      <span className="mt-1 block text-xs leading-snug text-bone-600">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Method and limits */}
          <div className="mt-auto p-6">
            <button onClick={() => setShowMethod((v) => !v)} className="marker flex w-full items-center justify-between hover:text-signal" data-testid="button-method">
              <span>Method and limits</span><span>{showMethod ? "CLOSE" : "OPEN"}</span>
            </button>
            {showMethod && (
              <div className="mt-4 space-y-3 text-xs leading-relaxed text-bone-400 rise">
                <p className="font-display text-sm font-semibold text-bone-100">Where this breaks</p>
                <ul className="space-y-2">
                  {[
                    "No legible text means no result. Silence here is not evidence of anything.",
                    "OCR is noisy. A misread plate prefix points confidently at the wrong state.",
                    "Signage travels. A language on a shop front does not fix a country.",
                    "Confidence is a share of recovered evidence weight, not a probability of being correct.",
                    "Region markers sit on centroids. They mark a hypothesis area, never a camera position.",
                    "Shadow timing assumes the date you enter and a flat horizon.",
                  ].map((t, i) => (
                    <li key={i} className="border-l-2 border-ink-600 pl-3">{t}</li>
                  ))}
                </ul>
                <p>Every candidate is a lead to check against terrain, street imagery and landmarks before you publish.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Chip({ on, label, note }: { on: boolean; label: string; note: string }) {
  return (
    <span className="hidden flex-col justify-center border-l border-ink-700 px-4 py-2 xl:flex">
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 ${on ? "bg-signal" : "bg-ink-600"}`} />
        <span className="font-mono text-[11px] font-medium tracking-wider text-bone-100">{label}</span>
      </span>
      <span className="mt-0.5 font-mono text-[10px] text-bone-600">{note}</span>
    </span>
  );
}
