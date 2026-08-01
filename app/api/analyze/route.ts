import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { extractClues, type Clue } from "@/lib/clues";
import { infer } from "@/lib/infer";
import { dbEnabled, sql } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

type FramePayload = {
  idx: number;
  tSec: number;
  text: string;
  confidence: number;
  quality?: number; // 0-100 focus/exposure score from the browser
  thumb?: string;   // small jpeg data URL, only stored when a database is configured
};

type Body = {
  videoName?: string;
  durationSec?: number;
  frames: FramePayload[];
  // Produced by the CLIP pass in the browser. The images themselves are never
  // uploaded — only the resulting clue objects.
  visualClues?: Clue[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const frames = Array.isArray(body.frames) ? body.frames : [];
  if (!frames.length) {
    return NextResponse.json({ error: "No keyframes were submitted." }, { status: 400 });
  }

  const rawClues: Clue[] = [];
  for (const f of frames) {
    const clues = extractClues(f.idx, f.text || "");
    // Evidence read off a soft or badly exposed frame is worth less. OCR
    // confidence alone is not enough — Tesseract is happy to report 90% on a
    // confidently misread word — so focus and exposure are folded in too.
    const q = typeof f.quality === "number" ? Math.max(0, Math.min(100, f.quality)) / 100 : 1;
    const ocrConf = typeof f.confidence === "number" ? Math.max(0, Math.min(100, f.confidence)) / 100 : 1;
    const reliability = 0.45 + 0.3 * q + 0.25 * ocrConf; // 0.45 floor, 1.0 ceiling
    if (reliability < 0.999) {
      for (const c of clues) {
        c.candidates = c.candidates.map((x) => ({ ...x, w: Number((x.w * reliability).toFixed(4)) }));
        if (q < 0.4) {
          c.rationale += ` Read from a low-quality keyframe (focus/exposure ${Math.round(q * 100)}/100), so this clue is down-weighted.`;
        }
      }
    }
    rawClues.push(...clues);
  }

  const visual = Array.isArray(body.visualClues) ? body.visualClues : [];
  for (const v of visual) {
    if (!v || !["landmark", "scene", "environment"].includes(v.kind)) continue;
    rawClues.push({
      kind: v.kind,
      frame: Number(v.frame) || 0,
      value: String(v.value || "").slice(0, 160),
      rationale: String(v.rationale || "").slice(0, 500),
      candidates: Array.isArray(v.candidates) ? v.candidates.slice(0, 12) : [],
      score: typeof v.score === "number" ? v.score : undefined,
      lat: typeof v.lat === "number" ? v.lat : undefined,
      lon: typeof v.lon === "number" ? v.lon : undefined,
      countryCode: typeof v.countryCode === "string" ? v.countryCode : undefined,
    });
  }

  const result = await infer(rawClues);
  const id = randomUUID();
  const title =
    result.candidates[0]?.label
      ? `${result.candidates[0].label} — ${body.videoName || "untitled clip"}`
      : body.videoName || "Unplaced clip";

  let persisted = false;
  if (dbEnabled && sql) {
    try {
      await sql`insert into investigations (id, title, video_name, duration_sec, frame_count, summary)
                values (${id}, ${title}, ${body.videoName || null}, ${body.durationSec ?? null}, ${frames.length}, ${result.summary})`;

      for (const f of frames) {
        await sql`insert into keyframes (investigation_id, idx, t_sec, thumb)
                  values (${id}, ${f.idx}, ${f.tSec}, ${f.thumb || null})
                  on conflict (investigation_id, idx) do nothing`;
        if (f.text?.trim()) {
          await sql`insert into ocr_results (investigation_id, frame_idx, text, confidence)
                    values (${id}, ${f.idx}, ${f.text}, ${f.confidence ?? null})`;
        }
      }
      for (const c of result.clues) {
        await sql`insert into clues (investigation_id, frame_idx, kind, value, rationale)
                  values (${id}, ${c.frame}, ${c.kind}, ${c.value}, ${c.rationale})`;
      }
      let rank = 1;
      for (const c of result.candidates) {
        await sql`insert into candidate_locations
                  (investigation_id, rank, label, country, admin, lat, lon, confidence, band, precision_level)
                  values (${id}, ${rank++}, ${c.label}, ${c.country}, ${c.admin || null},
                          ${c.lat}, ${c.lon}, ${c.confidence}, ${c.band}, ${c.precision})`;
      }
      await sql`insert into analyses (investigation_id, reasoning)
                values (${id}, ${JSON.stringify({ clues: result.clues, candidates: result.candidates })})`;
      persisted = true;
    } catch (err) {
      console.error("persistence failed:", err);
    }
  }

  return NextResponse.json({
    id,
    title,
    persisted,
    dbConfigured: dbEnabled,
    mapillaryConfigured: Boolean(process.env.MAPILLARY_TOKEN),
    ...result,
  });
}
