import Link from "next/link";
import { TrendingUp, Wallet, Hourglass, Banknote } from "lucide-react";
import { Amount, Sparkline, Delta } from "@/components/home/primitives";
import type { HomeData } from "@/lib/dashboard-home";

const pct = (v: number, p: number) => (p > 0 ? ((v - p) / p) * 100 : null);

function Tile({ href, icon, chip, label, children, footer, spark, sparkColor }: {
  href: string; icon: React.ReactNode; chip: string; label: string; children: React.ReactNode; footer: React.ReactNode; spark?: number[]; sparkColor?: string;
}) {
  return (
    <Link href={href} className="bg-surface rounded-[22px] border border-line shadow-card p-[18px] flex flex-col gap-3 lift hover:border-accent/30">
      <span className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center text-white shrink-0" style={{ background: chip }}>{icon}</span>
        <span className="text-[13.5px] font-medium text-ink2 leading-tight">{label}</span>
      </span>
      <span className="text-[28px] font-extrabold tracking-tight leading-none text-ink">{children}</span>
      <span className="flex items-end justify-between gap-2 min-h-[34px]">
        <span className="min-w-0">{footer}</span>
        {spark && <Sparkline values={spark} color={sparkColor} className="w-[110px] h-[34px] shrink-0" />}
      </span>
    </Link>
  );
}

/** Quatre indicateurs de la maquette, chacun cliquable vers sa liste. */
export function KpiRow({ k }: { k: HomeData["kpis"] }) {
  const year = new Date().getFullYear();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4">
      {k.revenue && (
        <Tile href="/invoices" chip="linear-gradient(135deg,rgb(0 130 235),rgb(47 89 223))" icon={<TrendingUp size={19} />} label="Chiffre d'affaires"
          footer={<Delta value={pct(k.revenue.value, k.revenue.prev)} label={`vs ${year - 1} à date`} />} spark={k.revenue.trend} sparkColor="rgb(47 89 223)">
          <Amount value={k.revenue.value} />
        </Tile>
      )}
      {k.toCollect && (
        <Tile href="/invoices?status=sent" chip="linear-gradient(135deg,rgb(140 100 230),rgb(110 68 188))" icon={<Wallet size={19} />} label="À encaisser"
          footer={<span className="text-xs text-ink3">{k.toCollect.count} facture{k.toCollect.count > 1 ? "s" : ""} ouverte{k.toCollect.count > 1 ? "s" : ""}</span>} spark={k.toCollect.trend} sparkColor="rgb(110 68 188)">
          <Amount value={k.toCollect.value} />
        </Tile>
      )}
      {k.overdue && (
        <Tile href="/invoices?overdue=true" chip="linear-gradient(135deg,rgb(240 110 90),rgb(194 39 45))" icon={<Hourglass size={19} />} label="En retard"
          footer={<span className="text-xs text-ink3">{k.overdue.count ? `${k.overdue.count} facture${k.overdue.count > 1 ? "s" : ""} · ${k.overdue.share} % des créances` : "Aucun retard"}</span>}>
          <Amount value={k.overdue.value} className={k.overdue.value > 0 ? "text-neg" : ""} />
        </Tile>
      )}
      {k.collected && (
        <Tile href="/payments" chip="linear-gradient(135deg,rgb(40 170 110),rgb(0 120 64))" icon={<Banknote size={19} />} label="Encaissé ce mois"
          footer={<Delta value={k.collected.prev > 0 ? k.collected.value - k.collected.prev : null} suffix="" label="vs mois précédent" />} spark={k.collected.trend} sparkColor="rgb(0 120 64)">
          <Amount value={k.collected.value} />
        </Tile>
      )}
    </div>
  );
}
