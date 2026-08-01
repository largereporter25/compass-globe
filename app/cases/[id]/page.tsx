import Link from "next/link";
import { notFound } from "next/navigation";
import Logo from "@/components/Logo";
import { dbEnabled, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Reason = { frame: number; kind: string; value: string; rationale: string; weight: number };
type Cand = {
  label: string; lat: number; lon: number; confidence: number; band: string;
  precision: string; coherence?: string; reasons: Reason[];
};

export default async function CasePage({ params }: { params: { id: string } }) {
  if (!dbEnabled || !sql) notFound();

  let inv: any, keyframes: any[] = [], ocr: any[] = [], reasoning: any = null;
  try {
    const [row] = await sql`select * from investigations where id = ${params.id}`;
    if (!row) notFound();
    inv = row;
    keyframes = (await sql`select idx, t_sec, thumb from keyframes where investigation_id = ${params.id} order by idx`) as any[];
    ocr = (await sql`select frame_idx, text, confidence from ocr_results where investigation_id = ${params.id} order by frame_idx`) as any[];
    const [a] = await sql`select reasoning from analyses where investigation_id = ${params.id} order by id desc limit 1`;
    reasoning = a?.reasoning ?? null;
  } catch {
    notFound();
  }

  const candidates: Cand[] = reasoning?.candidates ?? [];
  const textFor = (i: number) => ocr.find((o) => o.frame_idx === i)?.text || "";

  return (
    <main className="min-h-screen bg-ink-950">
      <header className="flex items-stretch border-b-2 border-bone-100">
        <Link href="/" className="flex items-center gap-3 border-r border-ink-700 px-5 py-4 hover:bg-ink-850">
          <Logo size={24} />
          <span className="font-display text-xl font-bold uppercase leading-none tracking-tight">Compass Globe</span>
        </Link>
        <Link href="/cases" className="flex items-center border-r border-ink-700 px-5 font-display text-sm font-semibold text-bone-400 hover:text-signal">
          All investigations
        </Link>
        <div className="ml-auto flex items-center px-5"><span className="marker">Shareable record</span></div>
      </header>

      <div className="mx-auto max-w-4xl space-y-10 p-6">
        <section>
          <p className="marker mb-2">Investigation</p>
          <h1 className="font-display text-2xl font-bold leading-tight">{inv.title}</h1>
          <p className="tabnum mt-2 font-mono text-xs text-bone-600">
            {inv.video_name || "untitled"} · {inv.frame_count} keyframes ·{" "}
            {new Date(inv.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-bone-200">{inv.summary}</p>
        </section>

        <section>
          <p className="marker mb-3">Candidates</p>
          <ul className="space-y-px bg-ink-700">
            {candidates.map((c, i) => (
              <li key={i} className="bg-ink-950 p-4">
                <div className="flex items-baseline gap-4">
                  <span className="tabnum w-8 shrink-0 font-display text-2xl font-bold leading-none">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-base font-semibold">{c.label}</span>
                    <span className="tabnum mt-0.5 block font-mono text-[11px] text-bone-600">
                      {c.lat.toFixed(4)}, {c.lon.toFixed(4)} · {c.precision} · {c.band}
                      {c.coherence === "conflicts" ? " · conflicts with the country anchor" : ""}
                    </span>
                  </span>
                  <span className="tabnum shrink-0 font-display text-xl font-bold text-signal">
                    {Math.round(c.confidence * 100)}%
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5 pl-12">
                  {c.reasons.map((r, j) => (
                    <li key={j} className="text-xs leading-snug text-bone-400">
                      <span className="marker text-signal">{r.kind} · frame {r.frame + 1}</span>{" "}
                      <span className="font-mono text-bone-100">{r.value}</span> — {r.rationale}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="marker mb-3">Keyframes and recognised text</p>
          <div className="grid gap-px bg-ink-700 sm:grid-cols-2">
            {keyframes.map((k) => (
              <div key={k.idx} className="bg-ink-950 p-3">
                {k.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={k.thumb} alt={`Keyframe ${k.idx + 1}`} className="w-full border border-ink-700" />
                ) : null}
                <p className="tabnum mt-2 font-mono text-[11px] text-bone-600">
                  frame {k.idx + 1} · {Number(k.t_sec).toFixed(1)}s
                </p>
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-bone-200">
                  {textFor(k.idx) || "— nothing legible —"}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <p className="border-l-4 border-signal bg-ink-850 p-4 text-xs leading-relaxed text-bone-400">
          Candidate regions are probabilistic hypotheses derived from on-screen text and visual
          similarity. They are not a determination of location. Verify against street-level imagery,
          terrain and known landmarks before publishing.
        </p>
      </div>
    </main>
  );
}
