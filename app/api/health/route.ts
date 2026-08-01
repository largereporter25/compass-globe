// Lightweight health check for uptime monitors and deploy smoke tests.
// Reports process liveness and which optional backends are configured, and
// pings Neon with a trivial query only when a DATABASE_URL is present — so a
// probe never costs a connection when persistence is off. Everything is
// read-only and keyless; no secrets are echoed.

import { NextResponse } from "next/server";
import { dbEnabled, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let db: "ok" | "error" | "unconfigured" = "unconfigured";
  if (dbEnabled && sql) {
    try {
      await sql`select 1`;
      db = "ok";
    } catch {
      db = "error";
    }
  }

  return NextResponse.json(
    {
      ok: true,
      time: new Date().toISOString(),
      db,
      mapillary: Boolean(process.env.MAPILLARY_TOKEN),
      copernicus: Boolean(process.env.COPERNICUS_CLIENT_ID && process.env.COPERNICUS_CLIENT_SECRET),
    },
    { status: db === "error" ? 503 : 200 }
  );
}