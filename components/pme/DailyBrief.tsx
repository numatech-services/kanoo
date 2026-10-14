import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { getServerAccess } from "@/lib/server-auth";
import { dailyBrief } from "@/lib/daily-brief-server";

const TONE = {
  neg: "border-l-neg bg-neg-50/40",
  warn: "border-l-warn bg-warn-50/40",
  info: "border-l-info bg-info-50/30",
} as const;

/**
 * Brief du jour : les trois actions qui comptent le plus aujourd'hui, chacune
 * avec sa raison et le lien pour la faire. Calculé à chaque ouverture, à partir
 * des données que l'utilisateur a le droit de voir (lib/daily-brief-server).
 */
export async function DailyBrief() {
  const access = await getServerAccess();
  if (!access) return null;
  let brief: Awaited<ReturnType<typeof dailyBrief>>;
  try { brief = await dailyBrief(access.auth, access.can); }
  catch { return null; }

  const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <section aria-labelledby="brief-title" className="surface-card p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="brief-title" className="font-semibold text-ink flex items-center gap-2">
          <Sparkles size={16} className="text-section" /> Brief du jour
          <span className="text-xs font-normal text-ink3 first-letter:uppercase">· {date}</span>
        </h2>
        {brief.total > brief.items.length && <span className="text-xs text-ink3">{brief.total - brief.items.length} autre{brief.total - brief.items.length > 1 ? "s" : ""} point{brief.total - brief.items.length > 1 ? "s" : ""} à suivre</span>}
      </div>
      {brief.items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-pos"><CheckCircle2 size={16} /> Rien d&apos;urgent aujourd&apos;hui : pas de retard, pas d&apos;échéance proche.</p>
      ) : (
        <ol className="grid md:grid-cols-3 gap-3">
          {brief.items.map((it, i) => (
            <li key={it.kind} className={`rounded-xl border border-line border-l-4 p-4 flex flex-col ${TONE[it.tone]}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink3">Priorité {i + 1}</p>
              <p className="font-semibold text-ink mt-1 leading-snug">{it.title}</p>
              <p className="text-sm text-ink2 mt-1.5 flex-1">{it.why}</p>
              <Link href={it.href} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-section hover:underline">
                {it.cta} <ArrowRight size={14} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
