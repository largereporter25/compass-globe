"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Logo from "@/components/Logo";
import type { GlobePoint } from "@/components/Globe";
import { OCR_LANGS, extractKeyframes, frameStats, ocrFrames, type Keyframe, type Progress } from "@/lib/pipeline";

const CompassGlobe = dynamic(() => import("@/components/Globe"), {
  ssr: false,
  loading: () => <div className="h-full w-full" />,
});

type Candidate = {
  key: string; label: string; country: string; admin?: string;
  lat: number; lon: number; score: number; confidence: number;
  band: "Weak" | "Moderate" | "Strong";
  precision: "country" | "sub-national" | "locality";
  reasons: { frame: number; kind: string; value: string; rationale: string; weight: number }[];
  streetImages?: { id: string; thumb: string; lat: number; lon: number }[];
};

type AnalyzeResponse = {
  id: string; title: string; persisted: boolean; dbConfigured: boolean; mapillaryConfigured: boolean;
  summary: string; geocodeAttempts: number; geocodeHits: number;
  candidates: Candidate[];
  clues: { kind: string; frame: number; value: string; rationale: string }[];
};

const BAND_WIDTH: Record<string, string> = { Weak: "w-1/4", Moderate: "w-1/2", Strong: "w-3/4" };

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<"scene" | "uniform">("scene");
  const [target, setTarget] = useState(10);
  const [langs, setLangs] = useState<string[]>(["eng"]);
  const [langOpen, setLangOpen] = useState(false);

  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<Progress>({ stage: "", detail: "", pct: 0 });
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const [frames, setFrames] = useState<Keyframe[]>([]);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);

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
    () => (result && selectedFrame !== null ? result.clues.filter((c) => c.frame === selectedFrame) : []),
    [result, selectedFrame]
  );

  const pushLog = useCallback((s: string) => {
    setLog((l) => (l[l.length - 1] === s ? l : [...l.slice(-40), s]));
  }, []);

  const onPick = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError("That file is not a video. Supported: mp4, webm, mov, mkv, avi.");
      return;
    }
    setError(null);
    setFile(f);
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setResult(null);
    setFrames([]);
    setPhase("idle");
  };

  async function run() {
    if (!file) return;
    setPhase("running");
    setError(null);
    setLog([]);
    setResult(null);
    setFrames([]);

    try {
      const { frames: raw, durationSec, mode: usedMode } = await extractKeyframes(
        file,
        { mode, target },
        (p) => { setProgress(p); pushLog(p.detail); }
      );
      if (!raw.length) throw new Error("ffmpeg produced no frames from this file. Try a different clip or container.");
      pushLog(`${raw.length} keyframes extracted (${usedMode} sampling)`);

      const stats = await Promise.all(raw.map((f) => frameStats(f.blob)));
      const partial: Keyframe[] = raw.map((f, i) => ({
        idx: f.idx, tSec: f.tSec, blobUrl: URL.createObjectURL(f.blob),
        thumb: stats[i].thumb, text: "", confidence: 0,
        vegetationRatio: stats[i].vegetationRatio, meanLuma: stats[i].meanLuma,
      }));
      setFrames(partial);
      setSelectedFrame(0);

      const ocr = await ocrFrames(raw, langs, (p) => { setProgress(p); pushLog(p.detail); });
      const complete = partial.map((f) => ({
        ...f, text: ocr[f.idx]?.text || "", confidence: ocr[f.idx]?.confidence || 0,
      }));
      setFrames(complete);

      setProgress({ stage: "infer", detail: "Matching clues against open geodata", pct: 0.9 });
      pushLog("Resolving place names against the OpenStreetMap gazetteer");

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoName: file.name,
          durationSec,
          frames: complete.map((f) => ({
            idx: f.idx, tSec: f.tSec, text: f.text, confidence: f.confidence, thumb: f.thumb,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Analysis failed (${res.status}).`);
      const data: AnalyzeResponse = await res.json();
      setResult(data);
      setSelectedCandidate(data.candidates[0]?.key ?? null);
      setProgress({ stage: "done", detail: "Analysis complete", pct: 1 });
      setPhase("done");
    } catch (e: any) {
      console.error("Compass Globe pipeline failed:", e);
      const detail = e?.message || e?.toString?.() || String(e);
      setError(detail && detail !== "[object Object]" ? detail : "The pipeline failed. Open the browser console for the underlying error.");
      setPhase("error");
    }
  }

  function exportJson() {
    if (!result) return;
    const payload = {
      tool: "Compass Globe", generatedAt: new Date().toISOString(),
      video: { name: file?.name, frames: frames.length },
      summary: result.summary, candidates: result.candidates, clues: result.clues,
      ocr: frames.map((f) => ({ frame: f.idx, tSec: f.tSec, confidence: f.confidence, text: f.text })),
      caveat: "Candidate regions are probabilistic hypotheses derived from on-screen text. They are not a determination of location.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `compass-globe-${result.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-ink-950">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-4 border-b border-ink-800 px-5 py-3">
        <div className="flex items-center gap-2.5 text-signal">
          <Logo size={20} />
          <span className="font-display text-[15px] font-bold tracking-tight text-bone-100">
            Compass Globe
          </span>
        </div>
        <span className="hidden text-[11px] text-bone-600 md:inline">
          Geolocation triage for video evidence
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Chip on={true} text="Video never leaves this browser" />
          <Chip on={Boolean(result?.dbConfigured)} text={result?.dbConfigured ? (result.persisted ? "Saved to Neon" : "Neon write failed") : "Neon not configured"} />
          <Chip on={Boolean(result?.mapillaryConfigured)} text={result?.mapillaryConfigured ? "Mapillary on" : "Mapillary off"} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ── Globe pane ───────────────────────────────────────── */}
        <section className="relative min-h-[46vh] min-w-0 flex-1 overflow-hidden">
          <div className="absolute inset-0">
            <CompassGlobe points={points} selected={selectedCandidate} onSelect={setSelectedCandidate} />
          </div>

          {phase === "idle" && !result && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="label breathe">Awaiting evidence</p>
            </div>
          )}

          {phase === "running" && (
            <div className="pointer-events-none absolute inset-x-0 top-0 p-5">
              <div className="max-w-md border border-ink-800 bg-ink-900/85 p-4 backdrop-blur-sm fade-up">
                <p className="label">{progress.stage || "working"}</p>
                <p className="mt-1.5 text-sm text-bone-100">{progress.detail}</p>
                <div className="relative mt-3 h-[3px] w-full overflow-hidden bg-ink-700 sweep">
                  <div
                    className="h-full bg-signal transition-[width] duration-500 ease-out"
                    style={{ width: `${Math.round(progress.pct * 100)}%` }}
                  />
                </div>
                <div className="mt-3 max-h-20 overflow-hidden font-mono text-[10px] leading-relaxed text-bone-600">
                  {log.slice(-4).map((l, i) => <div key={i}>· {l}</div>)}
                </div>
              </div>
            </div>
          )}

          {result && (
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <div className="max-w-2xl border border-ink-800 bg-ink-900/88 backdrop-blur-sm fade-up">
                <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
                  <p className="label">Candidate ledger · ranked by evidence weight</p>
                  <button onClick={exportJson} className="label hover:text-signal" data-testid="button-export">
                    Export JSON
                  </button>
                </div>

                {result.candidates.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-bone-400">
                    No candidate regions. Nothing in the on-screen text mapped to a script, plate,
                    dialling code, domain, currency or gazetteer entry.
                  </p>
                ) : (
                  <ul className="max-h-44 divide-y divide-ink-800 overflow-y-auto">
                    {result.candidates.map((c, i) => {
                      const active = c.key === (selectedCandidate ?? result.candidates[0].key);
                      return (
                        <li key={c.key}>
                          <button
                            onClick={() => setSelectedCandidate(c.key)}
                            data-testid={`button-candidate-${i}`}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              active ? "bg-ink-850" : "hover:bg-ink-900"
                            }`}
                          >
                            <span className="tabnum w-5 font-mono text-[11px] text-bone-600">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-sm ${active ? "text-bone-100" : "text-bone-200"}`}>
                                {c.label}
                              </span>
                              <span className="label mt-0.5 block">
                                {c.precision} · {c.reasons.length} clue{c.reasons.length === 1 ? "" : "s"}
                              </span>
                            </span>
                            <span className="w-24 shrink-0">
                              <span className="mb-1 block h-[3px] w-full bg-ink-700">
                                <span
                                  className="block h-full bg-signal"
                                  style={{ width: `${Math.max(6, c.confidence * 100)}%` }}
                                />
                              </span>
                              <span className="tabnum block text-right font-mono text-[10px] text-bone-400">
                                {(c.confidence * 100).toFixed(0)}% · {c.band}
                              </span>
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

        {/* ── Rail ─────────────────────────────────────────────── */}
        <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-ink-800 bg-ink-900 lg:w-[400px] lg:border-l lg:border-t-0">
          {/* Upload + controls */}
          <div className="border-b border-ink-800 p-5">
            <p className="label mb-3">01 · Source clip</p>

            {!file ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files?.[0] ?? null); }}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                data-testid="dropzone-video"
                className="cursor-pointer border border-dashed border-ink-600 px-4 py-9 text-center transition-colors hover:border-signal/60 hover:bg-ink-850"
              >
                <p className="text-sm text-bone-200">Drop a video, or click to choose</p>
                <p className="mt-1.5 text-xs text-bone-600">
                  mp4 · webm · mov · mkv · avi — decoded locally by ffmpeg
                </p>
              </div>
            ) : (
              <div className="fade-up">
                {videoUrl && (
                  <video
                    src={videoUrl}
                    controls
                    className="w-full border border-ink-800 bg-black"
                    data-testid="video-preview"
                  />
                )}
                <div className="mt-2.5 flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate text-xs text-bone-200" title={file.name}>{file.name}</p>
                  <button
                    onClick={() => { setFile(null); setVideoUrl(null); setResult(null); setFrames([]); setPhase("idle"); }}
                    className="label shrink-0 hover:text-signal"
                    data-testid="button-clear"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              data-testid="input-video"
            />

            <div className="mt-5 space-y-3">
              <div>
                <p className="label mb-1.5">Frame sampling</p>
                <div className="flex gap-1.5">
                  {(["scene", "uniform"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      data-testid={`button-mode-${m}`}
                      className={`flex-1 border px-3 py-1.5 text-xs transition-colors ${
                        mode === m
                          ? "border-signal/70 bg-signal/10 text-signal"
                          : "border-ink-700 text-bone-400 hover:border-ink-600 hover:text-bone-200"
                      }`}
                    >
                      {m === "scene" ? "Scene changes" : "Even interval"}
                    </button>
                  ))}
                </div>
                {mode === "scene" && (
                  <p className="mt-1.5 text-[11px] leading-snug text-bone-600">
                    Falls back to even sampling if the clip is too static to trigger ffmpeg&apos;s scene detector.
                  </p>
                )}
              </div>

              <label className="block">
                <span className="label mb-1.5 flex items-center justify-between">
                  <span>Max keyframes</span>
                  <span className="tabnum text-bone-200">{target}</span>
                </span>
                <input
                  type="range" min={4} max={24} step={1} value={target}
                  onChange={(e) => setTarget(Number(e.target.value))}
                  className="w-full accent-signal"
                  data-testid="input-target"
                />
              </label>

              <div>
                <button
                  onClick={() => setLangOpen((v) => !v)}
                  className="label flex w-full items-center justify-between hover:text-signal"
                  data-testid="button-langs"
                >
                  <span>OCR scripts · {langs.length} selected</span>
                  <span>{langOpen ? "–" : "+"}</span>
                </button>
                <p className="mt-1 truncate text-[11px] text-bone-400">
                  {langs.map((l) => OCR_LANGS.find((o) => o.code === l)?.label).join(", ")}
                </p>
                {langOpen && (
                  <div className="mt-2 grid max-h-44 grid-cols-2 gap-1 overflow-y-auto border border-ink-800 p-2">
                    {OCR_LANGS.map((l) => {
                      const on = langs.includes(l.code);
                      return (
                        <button
                          key={l.code}
                          onClick={() =>
                            setLangs((cur) =>
                              cur.includes(l.code)
                                ? cur.filter((c) => c !== l.code) || ["eng"]
                                : [...cur, l.code]
                            )
                          }
                          className={`truncate px-2 py-1 text-left text-[11px] transition-colors ${
                            on ? "bg-signal/12 text-signal" : "text-bone-400 hover:bg-ink-850 hover:text-bone-200"
                          }`}
                          title={l.label}
                        >
                          {l.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1.5 text-[11px] leading-snug text-bone-600">
                  Each added script downloads a language pack once. Non-Latin scripts are where this
                  pipeline earns its keep — Latin-only OCR will miss most South Asian signage.
                </p>
              </div>
            </div>

            <button
              onClick={run}
              disabled={!file || phase === "running"}
              data-testid="button-run"
              className="mt-5 w-full border border-signal bg-signal/12 px-4 py-2.5 text-sm font-medium text-signal transition-colors hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-transparent disabled:text-bone-600"
            >
              {phase === "running" ? "Analysing…" : "Run analysis"}
            </button>

            {error && (
              <p className="mt-3 border-l-2 border-signal-deep bg-ink-850 px-3 py-2 text-xs text-bone-200" data-testid="text-error">
                {error}
              </p>
            )}
          </div>

          {/* Filmstrip */}
          {frames.length > 0 && (
            <div className="border-b border-ink-800 p-5">
              <p className="label mb-3">02 · Keyframes · {frames.length}</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {frames.map((f) => (
                  <button
                    key={f.idx}
                    onClick={() => setSelectedFrame(f.idx)}
                    data-testid={`button-frame-${f.idx}`}
                    className={`relative shrink-0 border transition-all fade-up ${
                      selectedFrame === f.idx ? "border-signal" : "border-ink-700 opacity-70 hover:opacity-100"
                    }`}
                    style={{ animationDelay: `${f.idx * 40}ms` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.thumb} alt={`Keyframe ${f.idx + 1}`} className="h-14 w-auto" />
                    <span className="tabnum absolute bottom-0 left-0 bg-ink-950/85 px-1 font-mono text-[9px] text-bone-200">
                      {f.tSec.toFixed(1)}s
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Frame evidence */}
          {selectedFrame !== null && frames[selectedFrame] && (
            <div className="border-b border-ink-800 p-5">
              <p className="label mb-3">
                03 · Frame {selectedFrame + 1} evidence
              </p>
              <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
                <Stat label="OCR conf." value={`${frames[selectedFrame].confidence.toFixed(0)}%`} />
                <Stat label="Green px" value={`${(frames[selectedFrame].vegetationRatio * 100).toFixed(0)}%`} />
                <Stat label="Mean luma" value={frames[selectedFrame].meanLuma.toFixed(0)} />
              </div>
              <p className="label mb-1.5">Recognised text</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border border-ink-800 bg-ink-950 p-2.5 font-mono text-[11px] leading-relaxed text-bone-200">
                {frames[selectedFrame].text || "— nothing legible in this frame —"}
              </pre>

              {frameClues.length > 0 && (
                <>
                  <p className="label mb-1.5 mt-4">Clues from this frame</p>
                  <ul className="space-y-1.5">
                    {frameClues.map((c, i) => (
                      <li key={i} className="border-l-2 border-signal/45 bg-ink-850 px-3 py-2">
                        <div className="flex items-baseline gap-2">
                          <span className="label text-signal">{c.kind}</span>
                          <span className="truncate font-mono text-[11px] text-bone-100">{c.value}</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-bone-400">{c.rationale}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-3 text-[11px] leading-snug text-bone-600">
                Green-pixel share and luma are recorded as observations only. They are not used to
                score any location — they exist so you can spot vegetation or lighting that
                contradicts a candidate.
              </p>
            </div>
          )}

          {/* Reasoning trail */}
          {result && (
            <div className="border-b border-ink-800 p-5">
              <p className="label mb-3">04 · Reasoning trail</p>
              <p className="mb-4 text-[13px] leading-relaxed text-bone-200">{result.summary}</p>

              {activeCandidate && (
                <>
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate font-display text-[15px] text-bone-100">
                      {activeCandidate.label}
                    </p>
                    <span className="label shrink-0 text-signal">{activeCandidate.band}</span>
                  </div>
                  <div className="mb-3 h-[3px] w-full bg-ink-700">
                    <div className={`h-full bg-signal ${BAND_WIDTH[activeCandidate.band]}`} />
                  </div>
                  <ul className="space-y-2">
                    {activeCandidate.reasons.map((r, i) => (
                      <li key={i} className="border border-ink-800 p-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="label text-signal">
                            {r.kind} · frame {r.frame + 1}
                          </span>
                          <span className="tabnum font-mono text-[10px] text-bone-600">+{r.weight}</span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-bone-100">{r.value}</p>
                        <p className="mt-1 text-[11px] leading-snug text-bone-400">{r.rationale}</p>
                      </li>
                    ))}
                  </ul>

                  {activeCandidate.streetImages?.length ? (
                    <>
                      <p className="label mb-2 mt-4">Mapillary street imagery near this candidate</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {activeCandidate.streetImages.map((s) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a key={s.id} href={`https://www.mapillary.com/app/?pKey=${s.id}`} target="_blank" rel="noreferrer">
                            <img src={s.thumb} alt="Mapillary street-level view" className="h-16 w-full border border-ink-800 object-cover transition-opacity hover:opacity-80" />
                          </a>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-bone-600">
                        Community imagery, CC BY-SA. Compare it against the keyframes yourself — the
                        tool does not claim these match.
                      </p>
                    </>
                  ) : null}
                </>
              )}
            </div>
          )}

          {/* Empty-state briefing, so the rail is never a blank column */}
          {!result && phase !== "running" && (
            <div className="border-b border-ink-800 p-5">
              <p className="label mb-3">What happens when you run it</p>
              <ol className="space-y-3">
                {[
                  ["ffmpeg cuts keyframes", "A WebAssembly build of ffmpeg runs in this tab. Your video is never uploaded."],
                  ["Tesseract reads the frames", "On-screen text is recognised locally, in whichever scripts you select."],
                  ["Text becomes clues", "Writing systems, plate formats, dialling codes, ccTLDs and currency signs are matched deterministically."],
                  ["OpenStreetMap resolves names", "Possible place names are looked up in the Nominatim gazetteer."],
                  ["Candidates land on the globe", "Ranked by evidence weight, each with the clues that produced it."],
                ].map(([h, d], i) => (
                  <li key={i} className="flex gap-3">
                    <span className="tabnum shrink-0 font-mono text-[11px] text-signal/70">{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      <span className="block text-[13px] text-bone-200">{h}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-bone-600">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Method and limits */}
          <div className="mt-auto p-5">
            <button
              onClick={() => setShowMethod((v) => !v)}
              className="label flex w-full items-center justify-between hover:text-signal"
              data-testid="button-method"
            >
              <span>Method and limits</span>
              <span>{showMethod ? "–" : "+"}</span>
            </button>
            {showMethod && (
              <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-bone-400 fade-up">
                <p>
                  Keyframes are cut by ffmpeg compiled to WebAssembly and read by Tesseract, both
                  running inside this browser tab. The video file is never uploaded.
                </p>
                <p>
                  Recognised text is matched against writing systems, vehicle-plate formats,
                  international dialling prefixes, country-code domains and currency signs. Possible
                  place names are looked up in the OpenStreetMap gazetteer via Nominatim.
                </p>
                <p className="text-bone-200">Where this breaks:</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>No legible text means no result. Silence here is not evidence of anything.</li>
                  <li>OCR is noisy. A misread plate prefix will point at the wrong state.</li>
                  <li>Signage travels. A shop sign in a language does not fix the country.</li>
                  <li>Confidence is a share of recovered evidence weight, not a probability of being correct.</li>
                  <li>Region markers sit on centroids. They mark a hypothesis area, never a camera position.</li>
                </ul>
                <p>
                  Treat every candidate as a lead to check against terrain, street-level imagery and
                  known landmarks before you publish anything.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Chip({ on, text }: { on: boolean; text: string }) {
  return (
    <span className="hidden items-center gap-1.5 border border-ink-800 px-2 py-1 lg:inline-flex">
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-signal" : "bg-ink-600"}`} />
      <span className="text-[10px] tracking-wide text-bone-400">{text}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink-800 px-2 py-1.5">
      <p className="label">{label}</p>
      <p className="tabnum mt-0.5 font-mono text-xs text-bone-100">{value}</p>
    </div>
  );
}
