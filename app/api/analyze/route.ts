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
  thumb?: string; // small jpeg data URL, only stored when a database is configured
};

type Body = {
  videoName?: string;
  durationSec?: number;
  frames: FramePayload[];
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
  for (const f of frames) rawClues.push(...extractClues(f.idx, f.text || ""));

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
