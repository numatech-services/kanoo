/**
 * Petits éléments partagés du tableau de bord (charte v5) : carte, montant
 * compact, courbe miniature. Sans état, utilisables côté serveur comme client.
 */
import { compactXof } from "@/components/ui/charts/geometry";

/** Carte de la charte v5 : rayon 22 px, ombre longue, rembourrage 22×24. */
export function Card({ children, className = "", as: Tag = "section" }: { children: React.ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`bg-surface rounded-[22px] border border-line shadow-card p-[22px] sm:px-6 ${className}`}>{children}</Tag>;
}

export function CardTitle({ title, sub, action }: { title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-[16px] font-bold tracking-tight text-ink">{title}</h2>
        {sub && <p className="text-xs text-ink3 mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** « 37,9 M » + unité discrète, comme sur la maquette. */
export function Amount({ value, className = "", unitClass = "text-[13px] font-semibold text-ink3 ml-1" }: { value: number; className?: string; unitClass?: string }) {
  return <span className={`num ${className}`}>{compactXof(value)}<span className={unitClass}>FCFA</span></span>;
}

/** Courbe miniature avec aire, normalisée sur sa propre étendue. */
export function Sparkline({ values, color = "rgb(47 89 223)", className = "w-[120px] h-[34px]" }: { values: number[]; color?: string; className?: string }) {
  if (values.length < 2) return null;
  const w = 120, h = 34, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Variation en pastille : ▲ 18 % (vert si favorable). `goodWhenUp` inverse le sens pour les retards. */
export function Delta({ value, suffix = "%", goodWhenUp = true, label }: { value: number | null; suffix?: string; goodWhenUp?: boolean; label?: string }) {
  if (value === null || !Number.isFinite(value)) return label ? <span className="text-xs text-ink3">{label}</span> : null;
  const up = value >= 0, good = up === goodWhenUp;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink3">
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-bold ${good ? "bg-pos-50 text-pos" : "bg-neg-50 text-neg"}`}>
        {up ? "▲" : "▼"} {suffix === "%" ? `${Math.abs(Math.round(value))} %` : compactXof(Math.abs(value))}
      </span>
      {label}
    </span>
  );
}

/** Initiales et teinte stable d'un client (même client, même couleur partout). */
const AVATAR = ["0 150 180", "110 68 188", "47 89 223", "200 110 40", "0 120 64", "194 39 45"];
export function ClientAvatar({ name, size = 30 }: { name: string; size?: number }) {
  const parts = name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(w => w.length > 2 || /^[A-Z]/.test(w));
  const ini = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="rounded-full grid place-items-center text-white font-bold shrink-0" aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36, background: `rgb(${AVATAR[h % AVATAR.length]})` }}>{ini}</span>
  );
}
