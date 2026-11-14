"use client";
import Link from "next/link";
import { AlarmClock } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { dueWording } from "@/lib/alerts";

interface Row { _id: string; title: string; dueDate: string; left: number; status: "open" | "done" | "cancelled" }
const NONE: Row[] = [];

/** Alertes rattachées au contrat : on voit qu'une échéance est déjà suivie (pas de doublon). */
export function ContractAlerts({ contractId }: { contractId: string }) {
  const list = useApi<Row[]>(`/api/alerts?status=all&contractId=${contractId}`, d => d?.data?.items ?? NONE, NONE, { quiet: true });
  const rows = list.data.filter(a => a.status !== "cancelled");
  if (!rows.length) return null;
  return (
    <section className="bg-surface rounded-xl border border-line p-4 space-y-2" aria-label="Alertes de ce contrat">
      <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5"><AlarmClock size={15} /> Alertes de ce contrat</h2>
      <ul className="divide-y divide-line">
        {rows.map(a => (
          <li key={a._id} className="py-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <Link href={`/alertes?alerte=${a._id}`} className="font-medium text-ink hover:text-section">{a.title}</Link>
            <span className={`text-xs font-semibold ${a.status === "done" ? "text-pos" : a.left <= 0 ? "text-neg" : a.left <= 7 ? "text-warn" : "text-ink3"}`}>
              {new Date(a.dueDate).toLocaleDateString("fr-FR")} · {a.status === "done" ? "traitée" : dueWording(a.left)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
