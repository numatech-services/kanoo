"use client";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { useApi } from "@/lib/use-api";
import { apiSend } from "@/lib/api-client";
import { showToast } from "@/components/ui/Toast";
import { promptDialog, confirmDialog } from "@/components/ui/Dialogs";
export default function TVAPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()+1);
  const { data, loading, reload } = useApi<{tvaCollectee:number;tvaDeductible:number;tvaNette:number;aVerser:number;creditReporte:number;statut:string;ecartDeclaration?:number}|null>(`/api/fiscal/tva?annee=${year}&mois=${month}`, d=>d.data ?? null, null);
  const [submitting, setSubmitting] = useState(false);
  const finished = new Date(year, month, 1) <= now;
  const declared = data?.statut === "submitted" || data?.statut === "paid";

  // Enregistre la déclaration du mois, montants recalculés par le serveur ;
  // une déclaration déjà enregistrée ne se rectifie qu'avec un motif.
  async function submit() {
    const motif = declared
      ? await promptDialog({ title: "Rectifier la déclaration de TVA ?", message: "Les montants sont recalculés sur la comptabilité actuelle. L'ancienne version est conservée au journal d'audit. Déposez aussi la rectificative auprès de la DGI.", label: "Motif de la rectification", confirmLabel: "Rectifier", required: true })
      : (await confirmDialog({ title: "Enregistrer la déclaration de TVA ?", message: "À faire une fois la déclaration déposée auprès de la DGI, avec les montants affichés.", confirmLabel: "Enregistrer" })) ? "" : null;
    if (motif === null) return;
    setSubmitting(true);
    const res = await apiSend("POST", "/api/fiscal/tva", { annee: year, mois: month, motif: motif || undefined });
    setSubmitting(false);
    if (!res.ok) { showToast((res.data as { error?: string })?.error || "Déclaration non enregistrée.", "error"); return; }
    showToast(declared ? "Déclaration de TVA rectifiée" : "Déclaration de TVA enregistrée", "success");
    reload();
  }
  const inp = "px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";
  const MONTHS = ["","Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  return (
    <div className="space-y-6 max-w-2xl">
      <ScreenTabs group="fiscalite" />
      <div>
        <div className="flex items-center gap-2 text-sm text-ink2 mb-2"><a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span className="text-ink font-medium">TVA</span></div>
        <h1 className="page-title">Déclaration TVA</h1>
      </div>
      <div className="flex gap-3">
        <select value={month} onChange={e=>setMonth(Number(e.target.value))} className={inp}>{MONTHS.slice(1).map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select>
        <select value={year} onChange={e=>setYear(Number(e.target.value))} className={inp}>{[year-1,year,year+1].map(y=><option key={y} value={y}>{y}</option>)}</select>
      </div>
      {loading ? <div className="h-48 bg-surface2 animate-pulse rounded-xl"/> : data && (
        <div className="space-y-4">
          <div className="bg-surface rounded-xl border border-line p-5 space-y-3">
            {[["TVA collectée (ventes)",data.tvaCollectee,"text-neg"],["TVA déductible (achats)",data.tvaDeductible,"text-pos"],["TVA nette",data.tvaNette,data.tvaNette>=0?"text-warn":"text-pos"]].map(([l,v,c])=>(
              <div key={String(l)} className="flex justify-between text-sm border-b border-line pb-3 last:border-0 last:pb-0">
                <span className="text-ink2">{l}</span><span className={`font-mono font-bold ${c}`}>{Number(v).toLocaleString("fr-FR")} FCFA</span>
              </div>
            ))}
          </div>
          <div className={`rounded-xl p-5 ${data.aVerser>0?"bg-warn-50 border border-warn/25":"bg-pos-50 border border-pos/25"}`}>
            <p className="text-sm font-semibold text-ink">{data.aVerser>0?"Montant à verser à la DGI":"Crédit de TVA à reporter"}</p>
            <p className={`text-3xl font-bold font-mono mt-1 ${data.aVerser>0?"text-warn":"text-pos"}`}>{(data.aVerser||data.creditReporte).toLocaleString("fr-FR")} FCFA</p>
          </div>
          <div className="bg-info-50 border border-info/25 rounded-xl p-3 text-xs text-info">Date limite de dépôt : avant le 15/{String(month===12?1:month+1).padStart(2,"0")}/{month===12?year+1:year}</div>
          {declared && !!data.ecartDeclaration && <div className="bg-warn-50 border border-warn/25 rounded-xl p-3 text-xs text-warn">La comptabilité du mois a changé depuis la déclaration : écart de {data.ecartDeclaration.toLocaleString("fr-FR")} FCFA.</div>}
          {!finished ? <p className="text-xs text-ink3 text-center">Le mois n&apos;est pas terminé.</p>
            : data.statut === "paid" ? <p className="text-sm text-pos text-center">Déclaration payée.</p>
            : <button onClick={submit} disabled={submitting} className={buttonClass(declared ? "secondary" : "primary", "md", "w-full")}>{submitting ? "Envoi…" : declared ? "Rectifier la déclaration" : "Enregistrer la déclaration"}</button>}
        </div>
      )}
    </div>
  );
}
