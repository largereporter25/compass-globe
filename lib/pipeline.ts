"use client";

// The whole media pipeline runs in the browser tab.
//
// This is a deliberate design decision, not a shortcut: the video file itself
// never leaves the investigator's machine. Only extracted text and small
// thumbnails are sent to the server. It also means the pipeline costs nothing
// to run and works within Vercel's serverless limits, which cannot handle
// ffmpeg on video files.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import Tesseract from "tesseract.js";

export type Keyframe = {
  idx: number;
  tSec: number;
  blobUrl: string;
  thumb: string;   // 240px-wide jpeg data URL, cheap enough to persist
  text: string;
  confidence: number;
  vegetationRatio: number;
  meanLuma: number;
};

export type Progress = { stage: string; detail: string; pct: number };

let ffmpeg: FFmpeg | null = null;

export async function loadFFmpeg(onLog?: (s: string) => void): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;
  const instance = new FFmpeg();
  if (onLog) instance.on("log", ({ message }) => onLog(message));
  // The core is vendored in /public/ffmpeg so there is no CDN dependency at
  // runtime. It has to be handed to the worker as blob URLs — importScripts
  // from inside the worker context cannot resolve app-relative paths.
  const base = `${window.location.origin}/ffmpeg`;
  await instance.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpeg = instance;
  return instance;
}

async function readFrames(fs: FFmpeg, pattern: RegExp): Promise<{ name: string; data: Uint8Array }[]> {
  const listing = await fs.listDir("/");
  const names = listing
    .filter((f) => !f.isDir && pattern.test(f.name))
    .map((f) => f.name)
    .sort();
  const out: { name: string; data: Uint8Array }[] = [];
  for (const name of names) {
    const data = (await fs.readFile(name)) as Uint8Array;
    out.push({ name, data });
    await fs.deleteFile(name);
  }
  return out;
}

/**
 * Extract keyframes with ffmpeg. Scene mode uses ffmpeg's scene-change score
 * and falls back to uniform sampling when a clip is too static to trigger it.
 */
export async function extractKeyframes(
  file: File,
  opts: { mode: "scene" | "uniform"; target: number },
  onProgress: (p: Progress) => void
): Promise<{ frames: { idx: number; tSec: number; blob: Blob }[]; durationSec: number; mode: string }> {
  const fs = await loadFFmpeg();
  onProgress({ stage: "decode", detail: "Loading clip into the local ffmpeg build", pct: 0.05 });

  const input = "input" + (file.name.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4");
  await fs.writeFile(input, await fetchFile(file));

  const durationSec = await probeDuration(file);
  const target = Math.max(4, Math.min(opts.target, 24));

  let used = opts.mode;
  let files: { name: string; data: Uint8Array }[] = [];

  fs.on("progress", ({ progress }) =>
    onProgress({ stage: "extract", detail: "Extracting keyframes", pct: 0.05 + Math.max(0, Math.min(progress, 1)) * 0.35 })
  );

  if (opts.mode === "scene") {
    await fs.exec([
      "-i", input,
      "-vf", `select='gt(scene,0.22)',scale=720:-2`,
      "-vsync", "vfr",
      "-frames:v", String(target),
      "-q:v", "3",
      "scene_%03d.jpg",
    ]);
    files = await readFrames(fs, /^scene_\d+\.jpg$/);
  }

  if (files.length < 3) {
    used = "uniform";
    const fps = durationSec > 0 ? Math.max(target / durationSec, 0.05) : 0.5;
    await fs.exec([
      "-i", input,
      "-vf", `fps=${fps.toFixed(4)},scale=720:-2`,
      "-frames:v", String(target),
      "-q:v", "3",
      "uni_%03d.jpg",
    ]);
    files = await readFrames(fs, /^uni_\d+\.jpg$/);
  }

  await fs.deleteFile(input).catch(() => {});

  const step = files.length > 1 && durationSec > 0 ? durationSec / files.length : 0;
  const frames = files.map((f, i) => ({
    idx: i,
    tSec: Number((step * i).toFixed(2)),
    blob: new Blob([f.data.slice().buffer as ArrayBuffer], { type: "image/jpeg" }),
  }));

  return { frames, durationSec, mode: used };
}

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      URL.revokeObjectURL(el.src);
      resolve(d);
    };
    el.onerror = () => resolve(0);
    el.src = URL.createObjectURL(file);
  });
}

/** Cheap, honest image statistics. Reported as observations, never scored. */
export async function frameStats(blob: Blob): Promise<{ thumb: string; vegetationRatio: number; meanLuma: number }> {
  const bitmap = await createImageBitmap(blob);
  const w = 240;
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

/**
 * OCR every keyframe locally with Tesseract. Language packs are fetched once
 * from the open tessdata mirror and cached by the browser; recognition itself
 * happens entirely on the client.
 */
export async function ocrFrames(
  frames: { idx: number; blob: Blob }[],
  langs: string[],
  onProgress: (p: Progress) => void
): Promise<Record<number, { text: string; confidence: number }>> {
  const lang = langs.length ? langs.join("+") : "eng";
  onProgress({ stage: "ocr", detail: `Loading OCR language data (${lang})`, pct: 0.42 });
  const worker = await Tesseract.createWorker(lang);
  const out: Record<number, { text: string; confidence: number }> = {};
  try {
    for (let i = 0; i < frames.length; i++) {
      onProgress({
        stage: "ocr",
        detail: `Reading text from keyframe ${i + 1} of ${frames.length}`,
        pct: 0.45 + (i / frames.length) * 0.4,
      });
      const { data } = await worker.recognize(frames[i].blob);
      out[frames[i].idx] = {
        text: (data.text || "").replace(/\n{3,}/g, "\n\n").trim(),
        confidence: Number((data.confidence ?? 0).toFixed(1)),
      };
    }
  } finally {
    await worker.terminate();
  }
  return out;
}

export const OCR_LANGS: { code: string; label: string }[] = [
  { code: "eng", label: "English / Latin" },
  { code: "hin", label: "Hindi (Devanagari)" },
  { code: "guj", label: "Gujarati" },
  { code: "ben", label: "Bengali" },
  { code: "tam", label: "Tamil" },
  { code: "tel", label: "Telugu" },
  { code: "kan", label: "Kannada" },
  { code: "mal", label: "Malayalam" },
  { code: "pan", label: "Punjabi (Gurmukhi)" },
  { code: "urd", label: "Urdu" },
  { code: "ara", label: "Arabic" },
  { code: "rus", label: "Russian (Cyrillic)" },
  { code: "ukr", label: "Ukrainian" },
  { code: "tha", label: "Thai" },
  { code: "heb", label: "Hebrew" },
  { code: "ell", label: "Greek" },
  { code: "jpn", label: "Japanese" },
  { code: "kor", label: "Korean" },
  { code: "chi_sim", label: "Chinese (simplified)" },
];
