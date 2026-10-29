"use client";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";

/**
 * Saisie des documents commerciaux (devis, proforma, facture) telle qu'elle
 * s'imprime (lib/pdf-business) : chaque ligne a un intitulé, un descriptif,
 * une unité, et peut ouvrir un poste (« Audiovisuel », « Travaux ») qui
 * regroupe les lignes suivantes ; le document porte objet, référence,
 * période et « à l'attention de ».
 */

export interface EditLine {
  description: string; details?: string; section?: string; unit?: string;
  quantity: number; unitPrice: number; tvaRate: number; discount: number;
  totalHT: number; totalTVA: number; totalTTC: number;
  productId?: string;
}

export function calcDocLine(l: Partial<EditLine>): EditLine {
  const qty = Number(l.quantity) || 0, price = Number(l.unitPrice) || 0, disc = Number(l.discount) || 0;
  const tva = l.tvaRate ?? TVA_TAUX_STANDARD;
  const ht = Math.round(qty * price * (1 - disc / 100)), t = calculerTVA(ht, tva);
  return {
    ...(l.productId ? { productId: l.productId } : {}),
    description: l.description || "", details: l.details || "", section: l.section || "", unit: l.unit || "",
    quantity: qty, unitPrice: price, tvaRate: tva, discount: disc, totalHT: ht, totalTVA: t, totalTTC: ht + t,
  };
}

export const emptyLine = () => calcDocLine({ description: "", quantity: 1, unitPrice: 0, unit: "u" });

/** Lignes envoyées à l'API : champs vides retirés. */
export function linesForApi(lines: EditLine[]) {
  return lines.map(l => {
    const { details, section, unit, ...rest } = l;
    return { ...rest, ...(details?.trim() ? { details: details.trim() } : {}), ...(section?.trim() ? { section: section.trim() } : {}), ...(unit?.trim() ? { unit: unit.trim() } : {}) };
  });
}

const UNITS = ["u", "ens.", "forfait", "m²", "m³", "ml", "kg", "L", "h", "h/j", "jour", "mois", "année"];

export function LinesEditor({ lines, onChange, title = "Lignes" }: { lines: EditLine[]; onChange: (l: EditLine[]) => void; title?: string }) {
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((l, k) => (k === i ? calcDocLine({ ...l, ...patch }) : l)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines]; [next[i], next[j]] = [next[j], next[i]]; onChange(next);
  };
  const total = (k: "totalHT" | "totalTVA" | "totalTTC") => lines.reduce((s, l) => s + l[k], 0);
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <button type="button" onClick={() => onChange([...lines, { ...emptyLine(), section: lines[lines.length - 1]?.section ?? "" }])} className="text-xs text-section font-semibold hover:underline inline-flex items-center gap-1"><Plus size={13} /> Ligne</button>
      </div>
      <datalist id="doc-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
      {/* En-têtes visibles : une fois les champs remplis, leur rôle ne se devine plus. */}
      <div className="hidden sm:grid grid-cols-12 gap-2 px-3 text-[11px] font-semibold text-ink2 uppercase tracking-wide" aria-hidden="true">
        <span className="col-span-5">Intitulé</span><span className="col-span-1 text-center">Qté</span><span className="col-span-1 text-center">Unité</span>
        <span className="col-span-2 text-right">P.U. HT</span><span className="col-span-1">TVA</span><span className="col-span-1 text-right">Rem. %</span><span className="col-span-1 text-right">Total HT</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface2/60 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-section w-6">{i + 1}</span>
            <input className={`${inputCls} h-8 text-xs max-w-[14rem]`} value={l.section ?? ""} onChange={e => set(i, { section: e.target.value })}
              placeholder="Poste (facultatif) : Audiovisuel…" aria-label={`Poste de la ligne ${i + 1}`} />
            <span className="ml-auto inline-flex gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter la ligne" className="p-1 rounded text-ink2 hover:bg-surface disabled:opacity-30"><ArrowUp size={14} /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === lines.length - 1} aria-label="Descendre la ligne" className="p-1 rounded text-ink2 hover:bg-surface disabled:opacity-30"><ArrowDown size={14} /></button>
              <button type="button" onClick={() => lines.length > 1 && onChange(lines.filter((_, k) => k !== i))} disabled={lines.length === 1} aria-label="Retirer la ligne" className="p-1 rounded text-ink2 hover:text-neg disabled:opacity-30"><X size={15} /></button>
            </span>
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
            <input className={`${inputCls} col-span-6 sm:col-span-5 font-semibold`} value={l.description} onChange={e => set(i, { description: e.target.value })} placeholder="Intitulé (en gras sur le document)" aria-label={`Intitulé de la ligne ${i + 1}`} required />
            <input type="number" inputMode="decimal" step="0.01" min={0} className={`${inputCls} col-span-2 sm:col-span-1 text-center`} value={l.quantity} onChange={e => set(i, { quantity: parseFloat(e.target.value) || 0 })} aria-label="Quantité" />
            <input list="doc-units" className={`${inputCls} col-span-2 sm:col-span-1 text-center`} value={l.unit ?? ""} onChange={e => set(i, { unit: e.target.value.slice(0, 20) })} placeholder="u" aria-label="Unité" />
            <input type="number" inputMode="numeric" min={0} className={`${inputCls} col-span-2 sm:col-span-2 text-right`} value={l.unitPrice} onChange={e => set(i, { unitPrice: parseFloat(e.target.value) || 0 })} placeholder="P.U. HT" aria-label="Prix unitaire HT" />
            <select className={`${selectCls} col-span-2 sm:col-span-1`} value={l.tvaRate} onChange={e => set(i, { tvaRate: parseFloat(e.target.value) })} aria-label="TVA">
              <option value={0.19}>19 %</option><option value={0.1}>10 %</option><option value={0}>0 %</option>
            </select>
            <input type="number" inputMode="decimal" min={0} max={100} className={`${inputCls} col-span-2 sm:col-span-1 text-right`} value={l.discount} onChange={e => set(i, { discount: parseFloat(e.target.value) || 0 })} aria-label="Remise %" title="Remise %" placeholder="Rem. %" />
            <div className="col-span-2 sm:col-span-1 flex items-center justify-end font-mono text-sm font-semibold text-ink">{l.totalHT.toLocaleString("fr-FR")}</div>
          </div>
          <textarea className={`${textareaCls} text-sm`} rows={2} value={l.details ?? ""} onChange={e => set(i, { details: e.target.value })}
            placeholder="Descriptif imprimé sous l'intitulé : caractéristiques, période, références…" aria-label={`Descriptif de la ligne ${i + 1}`} />
        </div>
      ))}
      <div className="flex justify-end">
        <div className="w-64 space-y-1.5 bg-surface2 rounded-xl p-3 text-sm">
          <div className="flex justify-between"><span className="text-ink2">Total HT</span><span className="font-mono">{total("totalHT").toLocaleString("fr-FR")} FCFA</span></div>
          <div className="flex justify-between"><span className="text-ink2">TVA</span><span className="font-mono">{total("totalTVA").toLocaleString("fr-FR")} FCFA</span></div>
          <div className="flex justify-between font-bold border-t border-line pt-1.5"><span>Total TTC</span><span className="font-mono text-section">{total("totalTTC").toLocaleString("fr-FR")} FCFA</span></div>
        </div>
      </div>
    </div>
  );
}

export interface Mentions { object: string; reference: string; period: string; attention: string }
export const emptyMentions = (init?: object | null): Mentions => {
  const i = (init ?? {}) as Partial<Record<keyof Mentions, unknown>>;
  return {
    object: String(i.object ?? ""), reference: String(i.reference ?? ""), period: String(i.period ?? ""), attention: String(i.attention ?? ""),
  };
};

export function MentionsFields({ value, onChange }: { value: Mentions; onChange: (m: Mentions) => void }) {
  const set = (k: keyof Mentions) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <FormField label="Objet" hint="Imprimé en tête du document.">
        <textarea className={textareaCls} rows={2} value={value.object} onChange={set("object")} maxLength={600}
          placeholder="Ex. Fourniture et installation d'un écran interactif, mise en service et formation" />
      </FormField>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label="Référence"><input className={inputCls} value={value.reference} onChange={set("reference")} maxLength={120} placeholder="Convention, bon de commande du client…" /></FormField>
        <FormField label="Période"><input className={inputCls} value={value.period} onChange={set("period")} maxLength={120} placeholder="1er novembre 2026 – 31 octobre 2027" /></FormField>
        <FormField label="À l'attention de"><input className={inputCls} value={value.attention} onChange={set("attention")} maxLength={160} placeholder="Madame la Directrice générale" /></FormField>
      </div>
    </div>
  );
}
