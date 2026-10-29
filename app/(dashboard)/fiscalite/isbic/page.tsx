"use client";
import { useState } from "react";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { apiSend } from "@/lib/api-client";
import { promptDialog, confirmDialog } from "@/components/ui/Dialogs";
import { useApi } from "@/lib/use-api";
export default function ISBICPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear() - 1);
  const [secteur, setSecteur] = useState<"normal"|"industrie"|"reduit">("normal");
  const { data, loading, reload } = useApi<Record<string,unknown>|null>(`/api/fiscal/isbic?annee=${year}&secteur=${secteur}`, d=>d.data ?? null, null);
  const [submitting, setSubmitting] = useState(false);
  const inp = "px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";

  async function handleSubmit(rectify: boolean) {
    // Une déclaration déjà déposée ne se rectifie qu'avec un motif (tracé).
    const motif = rectify ? await promptDialog({ title: "Rectifier la déclaration IS/BIC ?", message: "Les montants sont recalculés sur la comptabilité actuelle. L'ancienne version est conservée au journal d'audit.", label: "Motif de la rectification", confirmLabel: "Rectifier", required: true }) : undefined;
    if (rectify && !motif) return;
    if (!rectify && !(await confirmDialog({ title: "Enregistrer la déclaration IS/BIC ?", message: "À faire une fois la déclaration déposée auprès de la DGI. Exercice non clôturé : les montants peuvent encore changer.", confirmLabel: "Enregistrer" }))) return;
    setSubmitting(true);
    const res = await apiSend("POST", "/api/fiscal/isbic", { annee: year, secteur, motif });
    setSubmitting(false);
    if (!res.ok) { showToast((res.data as { error?: string })?.error || "Déclaration non enregistrée.", "error"); return; }
    showToast(rectify ? "Déclaration IS/BIC rectifiée" : "Déclaration IS/BIC enregistrée", "success");
    reload();
  }
  const finished = year < now.getFullYear();

  const d = data as {
    annee?:number; chiffreAffaires?:number; produits?:number; charges?:number; resultatComptable?:number; resultatFiscal?:number;
    calcul?:{base:number;montantTheorique:number;montantDu:number;isMinimumApplique:boolean;taux:number;minimumForfaitaire:number;tauxIMF:number};
    acomptes?:{acomptes:Array<{montant:number;echeance:string}>};
    statut?:string;
  } | null;

  return (
    <div className="space-y-6 max-w-2xl">
      <ScreenTabs group="fiscalite" />
      <div>
        <div className="flex items-center gap-2 text-xs text-ink2 mb-2">
          <a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span>IS/BIC</span>
        </div>
        <h1 className="page-title">Impôt sur les Sociétés (IS/BIC)</h1>
        <p className="text-sm text-ink2 mt-1">CGI 2026 : IS 30 % (26 % secteurs prévus) · IMF 1,75 % du chiffre d&apos;affaires HT · impôt dû = le plus élevé des deux</p>
        <p className="mt-2 p-2.5 bg-warn-50 border border-warn/25 rounded-lg text-xs text-warn">Calcul indicatif, à faire valider par votre fiscaliste avant dépôt. Il applique le CGI 2026 tel que le décrit le référentiel de Kanoo, sans les retraitements fiscaux (réintégrations, charges plafonnées, déficits), l&apos;IMF sur marge brute, l&apos;exonération des entreprises nouvelles, ni l&apos;imputation des retenues subies et des acomptes versés.</p>
      </div>

      <div className="flex gap-3">
        <select value={year} onChange={e=>setYear(Number(e.target.value))} className={inp}>
          {[now.getFullYear()-3, now.getFullYear()-2, now.getFullYear()-1, now.getFullYear()].map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        <select value={secteur} onChange={e=>setSecteur(e.target.value as "normal"|"industrie"|"reduit")} className={inp}>
          <option value="normal">Régime normal (IS 30 %, IMF 1,75 %)</option>
          <option value="industrie">Industrie manufacturière (IS 26 %, IMF 0,75 %)</option>
          <option value="reduit">Presse agréée, enseignement ou santé (IS 26 %)</option>
        </select>
      </div>

      {loading && <div className="h-64 bg-surface2 animate-pulse rounded-xl"/>}

      {!loading && d && (
        <div className="space-y-4">
          {/* Compte de résultat simplifié */}
          <div className="bg-surface rounded-xl border border-line p-5">
            <h2 className="font-semibold text-ink mb-4">Résultat fiscal {d.annee}</h2>
            {[
              ["Total produits (classe 7 et produits HAO 82, 84, 86, 88)", d.produits || 0, "text-pos"],
              ["Total charges (classe 6, charges HAO 81, 83, 85 et participation 87)", d.charges || 0, "text-neg"],
              ["Résultat comptable", d.resultatComptable || 0, "font-bold text-ink"],
              ["Résultat fiscal imposable", d.resultatFiscal || 0, "font-bold text-section"],
            ].map(([label, val, cls]) => (
              <div key={String(label)} className="flex justify-between py-2.5 border-b border-line last:border-0 text-sm">
                <span className="text-ink2">{label}</span>
                <span className={`font-mono ${cls}`}>{Number(val).toLocaleString("fr-FR")} FCFA</span>
              </div>
            ))}
          </div>

          {/* Calcul IS */}
          {d.calcul && (
            <div className="bg-surface rounded-xl border border-line p-5">
              <h2 className="font-semibold text-ink mb-4">Calcul de l'IS</h2>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-ink2">IS théorique ({Math.round(d.calcul.taux*100)}%)</span><span className="font-mono">{d.calcul.montantTheorique.toLocaleString("fr-FR")} FCFA</span></div>
                <div className="flex justify-between"><span className="text-ink2">IMF ({(d.calcul.tauxIMF*100).toLocaleString("fr-FR")} % de {(d.chiffreAffaires||0).toLocaleString("fr-FR")} FCFA de chiffre d&apos;affaires HT)</span><span className="font-mono">{d.calcul.minimumForfaitaire.toLocaleString("fr-FR")} FCFA</span></div>
                {d.calcul.isMinimumApplique && <div className="p-2 bg-warn-50 border border-warn/25 rounded-lg text-xs text-warn">IS inférieur à l'IMF : l'IMF est dû</div>}
                <div className="flex justify-between pt-2 border-t border-line font-bold text-base">
                  <span>IS/BIC dû {d.annee}</span>
                  <span className="font-mono text-section">{d.calcul.montantDu.toLocaleString("fr-FR")} FCFA</span>
                </div>
              </div>
            </div>
          )}

          {/* Acomptes provisionnels */}
          {d.acomptes && (
            <div className="bg-info-50 border border-info/25 rounded-xl p-4">
              <p className="text-sm font-semibold text-info mb-3">Acomptes provisionnels {(d.annee||year)+1}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {d.acomptes.acomptes.map((a, i) => (
                  <div key={i} className="bg-surface rounded-lg p-3">
                    <p className="text-xs text-ink2">Acompte {i+1} (20 %) — {a.echeance}</p>
                    <p className="font-bold font-mono text-info">{a.montant.toLocaleString("fr-FR")} FCFA</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className={`text-sm px-3 py-1 rounded-full font-medium ${d.statut==="submitted"||d.statut==="paid"?"bg-pos-50 text-pos":"bg-surface2 text-ink2"}`}>
              {d.statut === "paid" ? "Déclaration payée" : d.statut === "submitted" ? "Déclaration enregistrée" : "Non enregistrée"}
            </span>
            {!finished ? <span className="text-xs text-ink3">L&apos;exercice n&apos;est pas terminé.</span>
              : d.statut !== "paid" && (
              <button onClick={() => handleSubmit(d.statut === "submitted")} disabled={submitting} className={buttonClass(d.statut === "submitted" ? "secondary" : "primary", "md")}>
                {submitting ? "Envoi…" : d.statut === "submitted" ? "Rectifier la déclaration" : "Enregistrer la déclaration"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
