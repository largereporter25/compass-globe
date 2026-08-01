import Link from "next/link";
import Logo from "@/components/Logo";
import { dbEnabled, sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saved investigations — Compass Globe" };

type Row = {
  id: string; title: string; video_name: string | null; frame_count: number;
  created_at: string; lead_label: string | null; lead_confidence: string | null;
};

export default async function CasesPage() {
  let rows: Row[] = [];
  let failed = false;
  if (dbEnabled && sql) {
    try {
      rows = (await sql`
        select i.id, i.title, i.video_name, i.frame_count, i.created_at,
               (select label from candidate_locations c where c.investigation_id = i.id order by rank asc limit 1) as lead_label,
               (select confidence from candidate_locations c where c.investigation_id = i.id order by rank asc limit 1) as lead_confidence
        from investigations i order by i.created_at desc limit 100`) as Row[];
    } catch { failed = true; }
  }

  return (
    <main className="min-h-screen bg-ink-950">
      <header className="flex items-stretch border-b-2 border-bone-100">
        <Link href="/" className="flex items-center gap-3 border-r border-ink-700 px-5 py-4 hover:bg-ink-850">
          <Logo size={24} />
          <span className="font-display text-xl font-bold uppercase leading-none tracking-tight">Compass Globe</span>
        </Link>
        <div className="flex items-center px-5"><span className="marker">Saved investigations</span></div>
        <Link href="/" className="ml-auto flex items-center border-l border-ink-700 px-5 font-display text-sm font-semibold text-bone-400 hover:text-signal">
          New analysis
        </Link>
      </header>

      <div className="mx-auto max-w-4xl p-6">
        {!dbEnabled ? (
          <p className="border-l-4 border-signal bg-ink-850 p-4 text-sm text-bone-200">
            No database is configured, so nothing is being saved. Set <code className="font-mono text-signal">DATABASE_URL</code> to a Neon connection string and run <code className="font-mono text-signal">npm run db:init</code>.
          </p>
        ) : failed ? (
          <p className="border-l-4 border-signal bg-ink-850 p-4 text-sm text-bone-200">
            The database is configured but the query failed. Check that the schema has been created.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-bone-400">No investigations saved yet. Run an analysis and it will appear here.</p>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <li key={r.id} className="border-b border-ink-700">
                <Link href={`/cases/${r.id}`} className="flex items-center gap-4 py-4 hover:bg-ink-850">
                  <span className="tabnum w-10 shrink-0 font-display text-2xl font-bold leading-none text-bone-600">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-base font-semibold">{r.lead_label || "Unplaced"}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-bone-600">
                      {r.video_name || "untitled"} · {r.frame_count} keyframes · {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                    </span>
                  </span>
                  <span className="tabnum shrink-0 font-display text-xl font-bold text-signal">
                    {r.lead_confidence ? `${Math.round(parseFloat(r.lead_confidence) * 100)}%` : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
