import { NextResponse } from "next/server";
import { dbEnabled, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!dbEnabled || !sql) return NextResponse.json({ dbConfigured: false, items: [] });
  try {
    const items = await sql`
      select i.id, i.title, i.video_name, i.frame_count, i.created_at,
             (select label from candidate_locations c
               where c.investigation_id = i.id order by rank asc limit 1) as lead_label,
             (select confidence from candidate_locations c
               where c.investigation_id = i.id order by rank asc limit 1) as lead_confidence
      from investigations i
      order by i.created_at desc
      limit 25`;
    return NextResponse.json({ dbConfigured: true, items });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ dbConfigured: true, items: [], error: "Query failed." }, { status: 500 });
  }
}
