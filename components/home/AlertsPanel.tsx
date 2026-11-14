import Link from "next/link";
import { AlarmClock, AlertTriangle, Plus } from "lucide-react";
import { Card, CardTitle } from "@/components/home/primitives";
import { dueWording } from "@/lib/alerts";
import type { AlertsBoard } from "@/lib/alerts-server";

const TONE_CLS: Record<string, string> = { neg: "bg-neg-50 text-neg", warn: "bg-warn-50 text-warn", info: "bg-accent-50 text-accent" };

/**
 * « Alertes et échéances » : ce qui tombe dans le mois (ou dès le premier
 * rappel d'une alerte à longue prévenance) ou est en retard —
 * alertes saisies et droits d'enregistrement des marchés. Composant sans état,
 * rendu côté serveur.
 */
export function AlertsPanel({ board }: { board: AlertsBoard }) {
  const { items, overdue, total, canManage } = board;
  // Rien à venir : une ligne, pour ne pas repousser les indicateurs.
  if (total === 0) {
    return (
      <Card className="!py-3.5">
        <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
          <span className="flex items-center gap-2 text-ink2"><AlarmClock size={15} /> Alertes et échéances : rien dans les 30 prochains jours.</span>
          <span className="flex items-center gap-3 text-xs font-semibold">
            {canManage && <Link href="/alertes?nouvelle=1" className="inline-flex items-center gap-1 text-accent hover:underline"><Plus size={13} /> Nouvelle alerte</Link>}
            <Link href="/alertes" className="text-ink2 hover:text-ink">Tout voir</Link>
          </span>
        </div>
      </Card>
    );
  }
  const sub = `${total} à traiter${overdue ? ` · ${overdue} en retard` : ""}`;
  return (
    <Card className={overdue ? "border-neg/40" : ""}>
      <CardTitle title="Alertes et échéances" sub={sub} action={
        <div className="flex items-center gap-3 text-xs font-semibold">
          {canManage && <Link href="/alertes?nouvelle=1" className="inline-flex items-center gap-1 text-accent hover:underline"><Plus size={13} /> Nouvelle alerte</Link>}
          <Link href="/alertes" className="text-ink2 hover:text-ink">Tout voir</Link>
        </div>
      } />
      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map(i => (
            <li key={i.id}>
              <Link href={i.href} className="flex gap-2.5 group">
                <span className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ${TONE_CLS[i.tone]}`}>
                  {i.left < 0 ? <AlertTriangle size={15} /> : <AlarmClock size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-2">
                    <span className="text-[13px] font-semibold text-ink group-hover:text-accent line-clamp-2">{i.title}</span>
                    <span className={`text-[11px] font-semibold sm:whitespace-nowrap ${i.left <= 0 ? "text-neg" : i.left <= 7 ? "text-warn" : "text-ink3"}`}>
                      {new Date(i.dueDate).toLocaleDateString("fr-FR")} · {dueWording(i.left)}
                    </span>
                  </span>
                  {i.consequence && <span className="block text-[11.5px] text-ink3 line-clamp-2">{i.consequence}</span>}
                  {i.auto && <span className="block text-[10.5px] text-ink3">Calculée par Kanoo</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > items.length && <p className="text-[11.5px] text-ink3 mt-3"><Link href="/alertes" className="hover:underline">+ {total - items.length} autre{total - items.length > 1 ? "s" : ""}</Link></p>}
    </Card>
  );
}
