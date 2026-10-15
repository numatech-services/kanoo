import Link from "next/link";
import { BellRing } from "lucide-react";
import { Card } from "@/components/home/primitives";
import type { HomeData } from "@/lib/dashboard-home";

const STATUS_FR: Record<string, string> = { draft: "Brouillon", sent: "Envoyée", partial: "Part. payée", overdue: "En retard" };

/** Échéances des trente prochains jours, avec le geste qui convient. */
export function UpcomingPanel({ items }: { items: NonNullable<HomeData["upcoming"]> }) {
  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="text-[16px] font-bold tracking-tight text-ink">Échéances à venir</h2>
        <Link href="/agenda" className="text-[13px] font-semibold text-accent hover:underline">Agenda →</Link>
      </div>
      {items.length === 0 ? <p className="text-sm text-ink3 py-4">Rien d&apos;échu dans les trente prochains jours.</p> : (
        <ul className="space-y-2.5">
          {items.map(i => {
            const d = i.dueDate ? new Date(i.dueDate) : null;
            return (
              <li key={i._id} className="flex items-center gap-3">
                <span className="w-11 h-12 rounded-xl bg-accent-50 text-accent grid place-items-center text-center leading-none shrink-0">
                  <span><span className="block text-[17px] font-extrabold">{d ? String(d.getDate()).padStart(2, "0") : "—"}</span><span className="block text-[10.5px] font-semibold mt-0.5">{d ? d.toLocaleDateString("fr-FR", { month: "short" }) : ""}</span></span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink truncate">{i.client}</span>
                  <span className="block text-[11.5px] text-ink3 truncate">{i.number} · {i.remaining.toLocaleString("fr-FR")} FCFA · {STATUS_FR[i.status] ?? i.status}</span>
                </span>
                <Link href={`/invoices/${i._id}`} className="h-8 px-3 rounded-full border border-line2 text-[12px] font-semibold text-ink hover:bg-surface2 inline-flex items-center shrink-0">{i.status === "draft" ? "Envoyer" : "Rappel"}</Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const stepCode = (d: number) => (d < 0 ? `J${d}` : `J+${d}`);

/** Barème de relance et prochains envois automatiques. */
export function RemindersPanel({ r }: { r: NonNullable<HomeData["reminders"]> }) {
  return (
    <Card className="min-w-0">
      <div className="flex items-start gap-3 mb-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-pos-50 text-pos shrink-0"><BellRing size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-bold tracking-tight text-ink">Rappels automatiques</h2>
          <p className="text-xs text-ink3">{r.enabled ? "Envoyés selon votre barème, sans action de votre part." : "Désactivés : les relances partent à la main."}</p>
        </div>
        <Link href="/relances" className="text-[13px] font-semibold text-accent hover:underline shrink-0">Régler →</Link>
      </div>
      <ul className="space-y-1.5 mb-3">
        {r.steps.slice(0, 4).map((s, k) => (
          <li key={k} className="flex items-center gap-2.5 text-[13px]">
            <span className={`w-12 text-center py-1 rounded-lg text-[11.5px] font-bold ${s.offsetDays < 0 ? "bg-accent-50 text-accent" : s.offsetDays <= 7 ? "bg-warn-50 text-warn" : "bg-neg-50 text-neg"}`}>{stepCode(s.offsetDays)}</span>
            <span className="text-ink">{s.label}</span>
          </li>
        ))}
      </ul>
      {r.next.length > 0 && (
        <>
          <p className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-ink3 mb-1.5">Prochains envois</p>
          <ul className="divide-y divide-line">
            {r.next.map((n, k) => (
              <li key={k} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                <span className="w-16 text-ink3 shrink-0">{new Date(n.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</span>
                <span className="font-bold text-[11px] text-ink2 w-10 shrink-0">{stepCode(n.offsetDays)}</span>
                <span className="truncate text-ink">{n.client}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
