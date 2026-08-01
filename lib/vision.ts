"use client";

// Vision pass — the layer that works when there is no legible text.
//
// Two open-source, keyless models run side by side, each entirely in the
// browser through transformers.js (ONNX Runtime Web):
//
//   - CLIP ViT-B/32 (Xenova/clip-vit-base-patch32) — the original pass.
//   - SigLIP base  patch16-224 (Xenova/siglip-base-patch16-224) — a second,
//     independently-trained contrastive model whose errors do not correlate
//     with CLIP's. Google released SigLIP under Apache-2.0; the ONNX export
//     is keyless and runs on the same transformers.js runtime as CLIP, so no
//     second inference engine is pulled in.
//
// Both models are zero-shot image-vs-text classifiers over the same prompt
// bank. Their probability vectors are combined into an ensemble score (see
// scoreFrame). Neither replaces the other: if SigLIP fails to load — a slow
// CDN, an unsupported dtype, an out-of-memory WASM heap — the pass degrades
// to CLIP-only and the interface says so rather than failing silently.
//
// The approach is deliberate: text embeddings for the whole prompt bank are
// computed once per model and reused, then each keyframe becomes a single
// image embedding and everything is cosine similarity. That keeps a 200-prompt
// bank affordable on a laptop CPU, where the naive zero-shot pipeline would
// re-encode every prompt for every frame.
//
// This is explicitly a *second opinion*, kept separate from the text evidence
// in the UI. Both models are confidently wrong on a regular basis and the
// interface says so.

import { LANDMARKS, NEGATIVE_PROMPTS, SCENE_PRIORS } from "./visual-priors";
import type { Progress } from "./pipeline";

// transformers.js is loaded as a native ES module at runtime rather than
// bundled. Two reasons: its ONNX Runtime build uses `import.meta` in a way
// Next's minifier rejects, and keeping ~40 MB of inference runtime out of the
// main bundle means the app still loads instantly for anyone who leaves the
// vision pass switched off. Both CLIP and SigLIP share this one import.
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";

let libPromise: Promise<any> | null = null;
function loadLib(): Promise<any> {
  if (!libPromise) {
    libPromise = import(/* webpackIgnore: true */ TRANSFORMERS_URL).then((m: any) => {
      m.env.allowLocalModels = false;
      return m;
    });
  }
  return libPromise;
}

const CLIP_MODEL_ID = "Xenova/clip-vit-base-patch32";
const SIGLIP_MODEL_ID = "Xenova/siglip-base-patch16-224";

/**
 * WebGPU where the browser has it, WASM everywhere else.
 *
 * On a machine with WebGPU this is the difference between a vision pass that
 * takes a couple of seconds and one that takes minutes, which matters a great
 * deal when an investigator is working through a stack of clips. The fallback
 * is silent and automatic — the pass still runs on any browser, just slower.
 */
export function visionBackend(): { device: "webgpu" | "wasm"; dtype: "fp16" | "q8" } {
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  return hasGpu ? { device: "webgpu", dtype: "fp16" } : { device: "wasm", dtype: "q8" };
}

let activeBackend: "webgpu" | "wasm" | null = null;
export const getActiveBackend = () => activeBackend;

export type VisualClue = {
  kind: "landmark" | "scene" | "environment";
  frame: number;
  value: string;
  rationale: string;
  score: number;
  candidates: { key: string; w: number }[];
  lat?: number;
  lon?: number;
  countryCode?: string;
};

// One model's loaded state: its tokenizer/processor/encoders plus the prompt
// bank pre-encoded into a normalized text-embedding matrix. CLIP and SigLIP
// each own one of these; SigLIP's is null when it could not be loaded.
type ModelBank = { prompts: string[]; textEmbeddings: number[][] };
type ModelCtx = {
  tokenizer: any;
  processor: any;
  textModel: any;
  visionModel: any;
  bank: ModelBank;
};

let cached: { clip: ModelCtx; siglip: ModelCtx | null } | null = null;

function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function softmax(xs: number[], temperature = 100): number[] {
  const scaled = xs.map((x) => x * temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/** Every prompt the models score against, in a fixed order. */
function allPrompts(): string[] {
  return [
    ...LANDMARKS.map((l) => l.prompt),
    ...SCENE_PRIORS.map((s) => s.prompt),
    ...NEGATIVE_PROMPTS,
  ];
}

// CLIP's text/vision models expose `text_embeds` / `image_embeds`; SigLIP's
// expose `pooler_output` for both modalities (the projection is built in).
// `encodeTextBank` reads whichever key the model emitted, so a checkpoint that
// names the output differently does not silently break scoring.

/**
 * Pre-encode a model's prompt bank once. Batched so a long bank does not blow
 * the WASM heap in a single allocation. Returns a normalized row per prompt.
 */
async function encodeTextBank(
  textModel: any,
  tokenizer: any,
  prompts: string[],
  batchSize = 24
): Promise<number[][]> {
  const rows: number[][] = [];
  for (let i = 0; i < prompts.length; i += batchSize) {
    const slice = prompts.slice(i, i + batchSize);
    const inputs = tokenizer(slice, { padding: true, truncation: true });
    const out = await textModel(inputs);
    const t = out?.text_embeds ?? out?.pooler_output;
    if (!t) continue;
    const [r, c] = t.dims as [number, number];
    const data = t.data as Float32Array;
    for (let k = 0; k < r; k++) {
      rows.push(l2normalize(Array.from(data.slice(k * c, (k + 1) * c))));
    }
  }
  return rows;
}

export async function loadVision(onProgress: (p: Progress) => void) {
  if (cached) return cached;

  const {
    AutoProcessor, AutoTokenizer,
    CLIPTextModelWithProjection, CLIPVisionModelWithProjection,
    SiglipTextModel, SiglipVisionModel,
  } = await loadLib();

  const prompts = allPrompts();
  const deviceOpts = () => {
    const p = visionBackend();
    return { device: p.device, dtype: p.dtype } as any;
  };

  // ── CLIP (the original pass). A failure here is fatal to the vision pass,
  // so it is allowed to throw — the caller in page.tsx catches and reports it.
  const loadClip = async (device: "webgpu" | "wasm", dtype: "fp16" | "q8") => {
    onProgress({
      stage: "vision",
      detail: `Loading the CLIP vision model on ${device.toUpperCase()} (first run downloads it once)`,
      pct: 0.5,
    });
    const opts = { device, dtype } as any;
    return Promise.all([
      AutoTokenizer.from_pretrained(CLIP_MODEL_ID),
      AutoProcessor.from_pretrained(CLIP_MODEL_ID),
      CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL_ID, opts),
      CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL_ID, opts),
    ]);
  };

  let [tokenizer, processor, textModel, visionModel]: any[] = [];
  const preferred = visionBackend();
  try {
    [tokenizer, processor, textModel, visionModel] = await loadClip(preferred.device, preferred.dtype);
    activeBackend = preferred.device;
  } catch (err) {
    if (preferred.device !== "webgpu") throw err;
    onProgress({ stage: "vision", detail: "WebGPU was unavailable — falling back to WASM", pct: 0.5 });
    [tokenizer, processor, textModel, visionModel] = await loadClip("wasm", "q8");
    activeBackend = "wasm";
  }

  onProgress({ stage: "vision", detail: "Encoding the CLIP visual clue bank", pct: 0.56 });
  const clip: ModelCtx = {
    tokenizer, processor, textModel, visionModel,
    bank: { prompts, textEmbeddings: await encodeTextBank(textModel, tokenizer, prompts) },
  };

  // ── SigLIP (the second pass). This is genuinely optional: if the weights
  // fail to download or the runtime rejects the dtype, the pass simply runs
  // CLIP-only. The failure is swallowed here and surfaced through the mode
  // the UI reads, so an investigator is told SigLIP is unavailable rather
  // than losing the whole vision pass over it.
  onProgress({ stage: "vision", detail: "Loading the SigLIP vision model", pct: 0.62 });
  let siglip: ModelCtx | null = null;
  try {
    const opts = deviceOpts();
    const [st, sp, stm, svm] = await Promise.all([
      AutoTokenizer.from_pretrained(SIGLIP_MODEL_ID),
      AutoProcessor.from_pretrained(SIGLIP_MODEL_ID),
      SiglipTextModel.from_pretrained(SIGLIP_MODEL_ID, opts),
      SiglipVisionModel.from_pretrained(SIGLIP_MODEL_ID, opts),
    ]);
    onProgress({ stage: "vision", detail: "Encoding the SigLIP visual clue bank", pct: 0.66 });
    siglip = {
      tokenizer: st, processor: sp, textModel: stm, visionModel: svm,
      bank: { prompts, textEmbeddings: await encodeTextBank(stm, st, prompts) },
    };
  } catch (err) {
    console.warn("SigLIP vision model could not be loaded; running CLIP-only:", err);
    siglip = null;
  }

  cached = { clip, siglip };
  return cached;
}

/** Score one frame against the whole bank and return the clues worth keeping. */
async function scoreFrame(ctx: NonNullable<typeof cached>, blob: Blob, frameIndex: number): Promise<VisualClue[]> {
  const { RawImage } = await loadLib();
  const image = await RawImage.fromBlob(blob);

  // Each model scores the frame against the same prompt bank independently,
  // then the two probability distributions are averaged. Averaging — rather
  // than picking a winner — is the point: CLIP and SigLIP were trained on
  // different data with different losses, so their confident errors do not
  // line up, and the ensemble is conservative on purpose. A frame only reaches
  // the high landmark bar when *both* models lean the same way.
  const probsFor = async (model: ModelCtx) => {
    const inputs = await model.processor(image);
    const out = await model.visionModel(inputs);
    const emb = l2normalize(Array.from((out?.image_embeds ?? out?.pooler_output).data as Float32Array));
    return softmax(model.bank.textEmbeddings.map((t) => dot(emb, t)));
  };

  const clipProbs = await probsFor(ctx.clip);
  let probs: number[];
  let modelTag: string;
  if (ctx.siglip) {
    const siglipProbs = await probsFor(ctx.siglip);
    probs = clipProbs.map((p, i) => (p + siglipProbs[i]) / 2);
    modelTag = "CLIP + SigLIP ensemble";
  } else {
    probs = clipProbs;
    modelTag = "CLIP (SigLIP unavailable)";
  }

  const nLandmarks = LANDMARKS.length;
  const nScenes = SCENE_PRIORS.length;
  const out: VisualClue[] = [];

  // Landmarks. A high bar on purpose — a false landmark hit is the single most
  // misleading thing this tool could output, because it looks like certainty.
  const ranked = Array.from({ length: nLandmarks }, (_, i) => i).sort((a, b) => probs[b] - probs[a]);
  const bestLandmark = ranked[0] ?? -1;
  const runnerUp = ranked[1] != null ? probs[ranked[1]] : 0;
  const bestNegative = Math.max(...NEGATIVE_PROMPTS.map((_, i) => probs[nLandmarks + nScenes + i]));

  // Three conditions, all of which have to hold. An absolute floor, a clear
  // margin over the next landmark (otherwise the model is guessing between
  // lookalikes), and it must beat the "unremarkable frame" prompts — which is
  // what stops a blurry wall from being confidently identified as a monument.
  const clearWinner =
    bestLandmark >= 0 &&
    probs[bestLandmark] >= 0.18 &&
    probs[bestLandmark] >= runnerUp * 1.35 &&
    probs[bestLandmark] > bestNegative;

  // Two visually similar landmarks — say, two red-sandstone Mughal monuments
  // in Delhi — will legitimately score close together. Rejecting both would
  // throw away a perfectly good country signal, so when the pair agrees on a
  // country they are both kept at reduced weight and the ambiguity is stated.
  const tiedPair =
    !clearWinner &&
    bestLandmark >= 0 &&
    ranked[1] != null &&
    probs[bestLandmark] >= 0.14 &&
    probs[bestLandmark] > bestNegative &&
    LANDMARKS[bestLandmark].countryCode === LANDMARKS[ranked[1]].countryCode;

  const emit = (i: number, factor: number, ambiguousWith?: string) => {
    const lm = LANDMARKS[i];
    out.push({
      kind: "landmark",
      frame: frameIndex,
      value: lm.label,
      rationale: ambiguousWith
        ? `${modelTag} scored this frame ${(probs[i] * 100).toFixed(0)}% against "${lm.prompt}", too close to "${ambiguousWith}" to separate them. Both are kept at reduced weight because they agree on the country. Visual match only.`
        : `${modelTag} matched this frame to "${lm.prompt}" at ${(probs[i] * 100).toFixed(0)}% of the bank's total score, ${(probs[i] / Math.max(runnerUp, 1e-6)).toFixed(1)}x clear of the next landmark. Visual match only — confirm against a reference photograph before relying on it.`,
      score: Number((probs[i] * factor).toFixed(4)),
      candidates: [{ key: lm.countryCode, w: 0.5 * factor }],
      lat: lm.lat,
      lon: lm.lon,
      countryCode: lm.countryCode,
    });
  };

  if (clearWinner) {
    emit(bestLandmark, 1);
  } else if (tiedPair) {
    emit(bestLandmark, 0.6, LANDMARKS[ranked[1]].label);
    emit(ranked[1], 0.6, LANDMARKS[bestLandmark].label);
  }

  // Streetscape signatures. Lower bar: these are meant to accumulate across
  // frames rather than decide anything alone.
  const sceneScores = SCENE_PRIORS.map((s, i) => ({ s, p: probs[nLandmarks + i] }));
  sceneScores.sort((a, b) => b.p - a.p);
  for (const { s, p } of sceneScores.slice(0, 3)) {
    if (p < 0.05) continue;
    const isEnvironment = s.candidates.length === 0;
    out.push({
      kind: isEnvironment ? "environment" : "scene",
      frame: frameIndex,
      value: s.note,
      rationale: isEnvironment
        ? `${modelTag} scored this frame ${(p * 100).toFixed(0)}% against "${s.prompt}". Recorded as an observation only — environment is never used to score a location.`
        : `${modelTag} scored this frame ${(p * 100).toFixed(0)}% against "${s.prompt}". Streetscape signatures are suggestive, not conclusive.`,
      score: Number(p.toFixed(4)),
      // Scale the prior by how strongly the frame actually matched.
      candidates: s.candidates.map((c) => ({ key: c.key, w: Number((c.w * Math.min(p / 0.25, 1)).toFixed(4)) })),
    });
  }

  return out;
}

export async function analyseFrames(
  frames: { idx: number; blob: Blob }[],
  onProgress: (p: Progress) => void
): Promise<VisualClue[]> {
  const ctx = await loadVision(onProgress);
  const clues: VisualClue[] = [];
  for (let i = 0; i < frames.length; i++) {
    onProgress({
      stage: "vision",
      detail: `Looking at keyframe ${i + 1} of ${frames.length}`,
      pct: 0.68 + (i / frames.length) * 0.12,
    });
    try {
      clues.push(...(await scoreFrame(ctx, frames[i].blob, frames[i].idx)));
    } catch {
      // One unreadable frame must not sink the pass.
    }
  }
  return clues;
}