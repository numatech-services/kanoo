import Link from "next/link";
import { Card, ClientAvatar } from "@/components/home/primitives";
import { compactXof } from "@/components/ui/charts/geometry";
import type { HomeData } from "@/lib/dashboard-home";

const COLORS = ["rgb(47 89 223)", "rgb(110 68 188)", "rgb(0 150 180)", "rgb(200 110 40)", "rgb(0 120 64)", "rgb(150 160 180)"];

/** Créances par client : anneau des parts, et le retard de chacun. */
export function ReceivablesDonut({ r }: { r: NonNullable<HomeData["receivables"]> }) {
  const R = 54, C = 2 * Math.PI * R;
  // Début de chaque arc, cumulé avant le rendu.
  const starts = r.clients.reduce<number[]>((acc, _c, i) => [...acc, i === 0 ? 0 : acc[i - 1] + (r.clients[i - 1].due / r.total) * C], []);
  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="text-[16px] font-bold tracking-tight text-ink">Créances par client</h2>
        <Link href="/clients" className="text-[13px] font-semibold text-accent hover:underline shrink-0">Voir tout →</Link>
      </div>
      {r.total <= 0 ? <p className="text-sm text-ink3 py-6 text-center">Aucune créance en cours.</p> : (
        <>
          <div className="relative w-[150px] h-[150px] mx-auto">
            <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90" aria-hidden>
              <circle cx={70} cy={70} r={R} fill="none" stroke="currentColor" className="text-surface2" strokeWidth={18} />
              {r.clients.map((c, i) => {
                const len = (c.due / r.total) * C;
                const el = <circle key={i} cx={70} cy={70} r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={18} strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-starts[i]} strokeLinecap="butt" />;
                return el;
              })}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div><p className="text-[22px] font-extrabold num text-ink leading-none">{compactXof(r.total)}</p><p className="text-[11px] text-ink3 mt-1">FCFA à encaisser</p></div>
            </div>
          </div>
          <ul className="mt-4 space-y-3">
            {r.clients.map((c, i) => (
              <li key={c.clientId || i} className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                {c.clientId ? <ClientAvatar name={c.name} size={26} /> : null}
                <span className="min-w-0 flex-1">
                  {c.clientId ? <Link href={`/clients/${c.clientId}`} className="block text-[13px] font-semibold text-ink truncate hover:text-accent">{c.name}</Link> : <span className="block text-[13px] font-semibold text-ink2">{c.name}</span>}
                  {c.overdue > 0 && <span className="block text-[11.5px] text-neg">{c.overdue.toLocaleString("fr-FR")} FCFA en retard</span>}
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-[13px] font-bold num text-ink">{c.due.toLocaleString("fr-FR")}</span>
                  <span className="block text-[11px] text-ink3">{Math.round((c.due / r.total) * 100)} %</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
