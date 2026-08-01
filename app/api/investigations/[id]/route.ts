import { NextResponse } from "next/server";
import { dbEnabled, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!dbEnabled || !sql) return NextResponse.json({ error: "No database configured." }, { status: 404 });
  try {
    const [investigation] = await sql`select * from investigations where id = ${params.id}`;
    if (!investigation) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const keyframes = await sql`select idx, t_sec, thumb from keyframes where investigation_id = ${params.id} order by idx`;
    const ocr = await sql`select frame_idx, text, confidence from ocr_results where investigation_id = ${params.id} order by frame_idx`;
    const [analysis] = await sql`select reasoning from analyses where investigation_id = ${params.id} order by id desc limit 1`;
    return NextResponse.json({ investigation, keyframes, ocr, reasoning: analysis?.reasoning ?? null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Query failed." }, { status: 500 });
  }
}
