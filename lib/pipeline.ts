"use client";

// The whole media pipeline runs in the browser tab. The video file never
// leaves the investigator's machine — only extracted text and small thumbnails
// are sent to the server.
//
// Extraction has two paths and always produces frames:
//
//   NATIVE (default) — the browser's own video decoder is driven by seeking a
//   hidden <video> element and painting each seek onto a canvas. It handles
//   every codec the browser can play, needs no download, and cannot run out of
//   WASM memory on a large file.
//
//   DEEP SCAN (opt-in) — a real ffmpeg build compiled to WebAssembly, using
//   ffmpeg's scene-change detector to pick frames where the shot actually
//   changes. Better frame selection, but it has to load a 32 MB core and copy
//   the whole file into a virtual filesystem, so it is offered rather than
//   forced. Any failure falls back to NATIVE instead of killing the run.

import Tesseract from "tesseract.js";

export type ExtractMode = "native" | "deep";

export type RawFrame = { idx: number; tSec: number; blob: Blob };

export type Keyframe = {
  idx: number;
  tSec: number;
  blobUrl: string;
  thumb: string;
  text: string;
  confidence: number;
  vegetationRatio: number;
  meanLuma: number;
};

export type Progress = { stage: string; detail: string; pct: number };

export type ExtractResult = {
  frames: RawFrame[];
  durationSec: number;
  method: "native" | "ffmpeg scene detection" | "ffmpeg even interval";
  note?: string;
};

/* ------------------------------------------------------------------ *
 * Native extraction — the reliable default
 * ------------------------------------------------------------------ */

function loadVideoElement(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.preload = "auto";
    el.muted = true;
    (el as any).playsInline = true;
    el.crossOrigin = "anonymous";
    const url = URL.createObjectURL(file);
    const fail = () =>
      reject(
        new Error(
          "This browser could not decode the video. Try re-encoding to H.264 MP4, or use Deep scan."
        )
      );
    el.onerror = fail;
    el.onloadeddata = () => resolve(el);
    el.src = url;
    // Some containers only report metadata after an explicit load().
    el.load();
    setTimeout(() => {
      if (el.readyState < 2) fail();
    }, 25000);
  });
}

function seekTo(el: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("seeked", finish);
      resolve();
    };
    el.addEventListener("seeked", finish);
    // Guard against browsers that never fire `seeked` on an exact boundary.
    setTimeout(finish, 4000);
    el.currentTime = Math.max(0, t);
  });
}

async function extractNative(
  file: File,
  target: number,
  onProgress: (p: Progress) => void
): Promise<ExtractResult> {
  onProgress({ stage: "decode", detail: "Opening the clip with the browser's video decoder", pct: 0.04 });
  const el = await loadVideoElement(file);

  let duration = el.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    // Streams written without a duration header (common with phone captures
    // and some WebM recordings) need to be forced to the end to measure.
    el.currentTime = 1e6;
    await new Promise((r) => setTimeout(r, 700));
    duration = Number.isFinite(el.duration) ? el.duration : el.currentTime || 0;
  }
  if (!Number.isFinite(duration) || duration <= 0) duration = 0;

  const w = el.videoWidth || 1280;
  const h = el.videoHeight || 720;
  if (!w || !h) throw new Error("The video reported no picture dimensions, so no frames can be read from it.");

  const outW = Math.min(1024, w);
  const outH = Math.max(1, Math.round((h / w) * outW));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;

  // Sample inside the clip rather than at 0 and at the very last frame, where
  // fades and black leader are most likely.
  const n = Math.max(2, target);
  const times =
    duration > 0
      ? Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * duration)
      : Array.from({ length: n }, (_, i) => i * 0.5);

  const frames: RawFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    onProgress({
      stage: "extract",
      detail: `Capturing keyframe ${i + 1} of ${times.length} at ${times[i].toFixed(1)}s`,
      pct: 0.05 + (i / times.length) * 0.32,
    });
    await seekTo(el, times[i]);
    ctx.drawImage(el, 0, 0, outW, outH);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (blob && blob.size > 512) {
      frames.push({ idx: frames.length, tSec: Number(times[i].toFixed(2)), blob });
    }
  }

  URL.revokeObjectURL(el.src);
  el.removeAttribute("src");

  if (!frames.length) {
    throw new Error("The decoder returned only blank frames. The file may be corrupt or DRM-protected.");
  }
  return { frames, durationSec: duration, method: "native" };
}

/* ------------------------------------------------------------------ *
 * Deep scan — real ffmpeg, scene-change selection
 * ------------------------------------------------------------------ */

let ffmpegInstance: any = null;

async function getFFmpeg(onLog?: (s: string) => void) {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);
  const instance = new FFmpeg();
  if (onLog) instance.on("log", ({ message }: { message: string }) => onLog(message));
  const base = `${window.location.origin}/ffmpeg`;
  await instance.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegInstance = instance;
  return instance;
}

const DEEP_SCAN_LIMIT = 120 * 1024 * 1024; // ffmpeg.wasm copies the whole file into memory

async function extractDeep(
  file: File,
  target: number,
  onProgress: (p: Progress) => void,
  onLog: (s: string) => void
): Promise<ExtractResult> {
  if (file.size > DEEP_SCAN_LIMIT) {
    throw new Error(
      `Deep scan holds the whole file in memory and this clip is ${(file.size / 1048576).toFixed(0)} MB. Trim it below 120 MB or use Fast extract.`
    );
  }

  onProgress({ stage: "decode", detail: "Loading the ffmpeg WebAssembly core (32 MB, cached after the first run)", pct: 0.03 });
  const fs = await getFFmpeg(onLog);
  const { fetchFile } = await import("@ffmpeg/util");

  const input = "in" + (file.name.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4");
  await fs.writeFile(input, await fetchFile(file));

  // Measure duration with the native decoder — cheaper and more reliable than
  // parsing ffmpeg's log output.
  let duration = 0;
  try {
    const el = await loadVideoElement(file);
    duration = Number.isFinite(el.duration) ? el.duration : 0;
    URL.revokeObjectURL(el.src);
  } catch {
    /* duration stays 0; timestamps become relative */
  }

  const read = async (pattern: RegExp) => {
    const listing = await fs.listDir("/");
    const names = listing
      .filter((f: any) => !f.isDir && pattern.test(f.name))
      .map((f: any) => f.name)
      .sort();
    const out: Uint8Array[] = [];
    for (const name of names) {
      out.push((await fs.readFile(name)) as Uint8Array);
      await fs.deleteFile(name).catch(() => {});
    }
    return out;
  };

  onProgress({ stage: "extract", detail: "Running ffmpeg scene-change detection", pct: 0.1 });
  let method: ExtractResult["method"] = "ffmpeg scene detection";
  let note: string | undefined;

  await fs.exec([
    "-i", input,
    "-vf", "select='gt(scene,0.22)',scale=1024:-2",
    "-vsync", "vfr", "-frames:v", String(target), "-q:v", "3",
    "sc_%03d.jpg",
  ]);
  let buffers = await read(/^sc_\d+\.jpg$/);

  if (buffers.length < 3) {
    method = "ffmpeg even interval";
    note = "The clip had too few scene changes to sample, so ffmpeg fell back to an even interval.";
    onProgress({ stage: "extract", detail: "Too few scene changes — sampling at an even interval", pct: 0.22 });
    const fps = duration > 0 ? Math.max(target / duration, 0.05) : 0.5;
    await fs.exec([
      "-i", input,
      "-vf", `fps=${fps.toFixed(4)},scale=1024:-2`,
      "-frames:v", String(target), "-q:v", "3",
      "ev_%03d.jpg",
    ]);
    buffers = await read(/^ev_\d+\.jpg$/);
  }

  await fs.deleteFile(input).catch(() => {});
  if (!buffers.length) throw new Error("ffmpeg produced no frames from this file.");

  const step = buffers.length > 1 && duration > 0 ? duration / buffers.length : 0;
  const frames: RawFrame[] = buffers.map((data, i) => ({
    idx: i,
    tSec: Number((step * i).toFixed(2)),
    blob: new Blob([data.slice().buffer as ArrayBuffer], { type: "image/jpeg" }),
  }));

  return { frames, durationSec: duration, method, note };
}

/** Entry point. Never throws for a recoverable reason — it degrades instead. */
export async function extractKeyframes(
  file: File,
  opts: { mode: ExtractMode; target: number },
  onProgress: (p: Progress) => void,
  onLog: (s: string) => void = () => {}
): Promise<ExtractResult> {
  if (opts.mode === "deep") {
    try {
      return await extractDeep(file, opts.target, onProgress, onLog);
    } catch (err: any) {
      const why = err?.message || String(err);
      onLog(`Deep scan unavailable: ${why}`);
      onProgress({ stage: "extract", detail: "Deep scan failed — falling back to the browser decoder", pct: 0.05 });
      const res = await extractNative(file, opts.target, onProgress);
      return { ...res, note: `Deep scan was skipped (${why}) — frames came from the browser decoder instead.` };
    }
  }
  return extractNative(file, opts.target, onProgress);
}

/* ------------------------------------------------------------------ *
 * Frame statistics and OCR
 * ------------------------------------------------------------------ */

/** Cheap, honest image statistics. Reported as observations, never scored. */
export async function frameStats(blob: Blob): Promise<{ thumb: string; vegetationRatio: number; meanLuma: number }> {
  const bitmap = await createImageBitmap(blob);
  const w = 256;
  const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let green = 0;
  let luma = 0;
  const px = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (g > r * 1.08 && g > b * 1.08 && g > 45) green++;
  }
  bitmap.close();
  return {
    thumb: canvas.toDataURL("image/jpeg", 0.6),
    vegetationRatio: Number((green / px).toFixed(3)),
    meanLuma: Number((luma / px).toFixed(1)),
  };
}

export async function ocrFrames(
  frames: RawFrame[],
  langs: string[],
  onProgress: (p: Progress) => void
): Promise<Record<number, { text: string; confidence: number }>> {
  const lang = langs.length ? langs.join("+") : "eng";
  onProgress({ stage: "ocr", detail: `Loading OCR language data (${lang})`, pct: 0.4 });

  let worker: Tesseract.Worker;
  try {
    worker = await Tesseract.createWorker(lang);
  } catch (err: any) {
    throw new Error(
      `Could not load the OCR language pack "${lang}". Check your connection or deselect the unusual scripts. (${err?.message || err})`
    );
  }

  const out: Record<number, { text: string; confidence: number }> = {};
  try {
    for (let i = 0; i < frames.length; i++) {
      onProgress({
        stage: "ocr",
        detail: `Reading text from keyframe ${i + 1} of ${frames.length}`,
        pct: 0.42 + (i / frames.length) * 0.42,
      });
      try {
        const { data } = await worker.recognize(frames[i].blob);
        out[frames[i].idx] = {
          text: (data.text || "").replace(/\n{3,}/g, "\n\n").trim(),
          confidence: Number((data.confidence ?? 0).toFixed(1)),
        };
      } catch {
        // A single unreadable frame must not sink the whole investigation.
        out[frames[i].idx] = { text: "", confidence: 0 };
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }
  return out;
}

export const OCR_LANGS: { code: string; label: string }[] = [
  { code: "eng", label: "English / Latin" },
  { code: "hin", label: "Hindi" },
  { code: "guj", label: "Gujarati" },
  { code: "ben", label: "Bengali" },
  { code: "tam", label: "Tamil" },
  { code: "tel", label: "Telugu" },
  { code: "kan", label: "Kannada" },
  { code: "mal", label: "Malayalam" },
  { code: "pan", label: "Punjabi" },
  { code: "urd", label: "Urdu" },
  { code: "ara", label: "Arabic" },
  { code: "rus", label: "Russian" },
  { code: "ukr", label: "Ukrainian" },
  { code: "tha", label: "Thai" },
  { code: "heb", label: "Hebrew" },
  { code: "ell", label: "Greek" },
  { code: "jpn", label: "Japanese" },
  { code: "kor", label: "Korean" },
  { code: "chi_sim", label: "Chinese" },
];
