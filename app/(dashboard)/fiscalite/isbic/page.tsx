"use client";
import { useState, useEffect } from "react";
import { showToast } from "@/components/ui/Toast";
export default function ISBICPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear() - 1);
  const [secteur, setSecteur] = useState<"normal"|"agricole">("normal");
  const [data, setData] = useState<Record<string,unknown>|null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inp = "px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";

  useEffect(() => {
    setLoading(true);
    fetch(`/api/fiscal/isbic?annee=${year}&secteur=${secteur}`, { credentials:"include" })
      .then(r=>r.json()).then(d=>setData(d.data)).finally(()=>setLoading(false));
  }, [year, secteur]);

  async function handleSubmit() {
    setSubmitting(true);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    await fetch("/api/fiscal/isbic", { method:"POST", headers:{"Content-Type":"application/json","x-csrf-token":csrfToken}, credentials:"include",
      body: JSON.stringify({ annee: year, resultatFiscal: (data as {resultatFiscal?:number})?.resultatFiscal, montantDu: (data as {calcul?:{montantDu:number}})?.calcul?.montantDu }) });
    setSubmitting(false);
    showToast("Déclaration IS/BIC soumise", "success");
  }

  const d = data as {
    annee?:number; produits?:number; charges?:number; resultatComptable?:number; resultatFiscal?:number;
    calcul?:{montantTheorique:number;montantDu:number;isMinimumApplique:boolean;taux:number};
    acomptes?:{acompte1:{montant:number;echeance:string};acompte2:{montant:number;echeance:string}};
    statut?:string;
  } | null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-ink2 mb-2">
          <a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span>IS/BIC</span>
        </div>
        <h1 className="text-2xl font-bold text-ink">Impôt sur les Sociétés (IS/BIC)</h1>
        <p className="text-sm text-ink2 mt-1">Taux normal 30% · Minimum forfaitaire 1 000 000 XOF · CGI Niger</p>
      </div>

      <div className="flex gap-3">
        <select value={year} onChange={e=>setYear(Number(e.target.value))} className={inp}>
          {[year-1, year, year+1].map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        <select value={secteur} onChange={e=>setSecteur(e.target.value as "normal"|"agricole")} className={inp}>
          <option value="normal">Secteur normal (30%)</option>
          <option value="agricole">Secteur agricole (15%)</option>
        </select>
      </div>

      {loading && <div className="h-64 bg-surface2 animate-pulse rounded-xl"/>}

      {!loading && d && (
        <div className="space-y-4">
          {/* Compte de résultat simplifié */}
          <div className="bg-surface rounded-xl border border-line p-5">
            <h2 className="font-semibold text-ink mb-4">Résultat fiscal {d.annee}</h2>
            {[
              ["Total produits (comptes 7xx)", d.produits || 0, "text-pos"],
              ["Total charges (comptes 6xx)", d.charges || 0, "text-neg"],
              ["Résultat comptable", d.resultatComptable || 0, "font-bold text-ink"],
              ["Résultat fiscal imposable", d.resultatFiscal || 0, "font-bold text-section"],
            ].map(([label, val, cls]) => (
              <div key={String(label)} className="flex justify-between py-2.5 border-b border-line last:border-0 text-sm">
                <span className="text-ink2">{label}</span>
                <span className={`font-mono ${cls}`}>{Number(val).toLocaleString("fr-FR")} XOF</span>
              </div>
            ))}
          </div>

          {/* Calcul IS */}
          {d.calcul && (
            <div className="bg-surface rounded-xl border border-line p-5">
              <h2 className="font-semibold text-ink mb-4">Calcul de l'IS</h2>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-ink2">IS théorique ({Math.round(d.calcul.taux*100)}%)</span><span className="font-mono">{d.calcul.montantTheorique.toLocaleString("fr-FR")} XOF</span></div>
                <div className="flex justify-between"><span className="text-ink2">Minimum forfaitaire</span><span className="font-mono">1 000 000 XOF</span></div>
                {d.calcul.isMinimumApplique && <div className="p-2 bg-warn-50 border border-warn/25 rounded-lg text-xs text-warn">⚠ IS théorique inférieur au minimum — le minimum forfaitaire s'applique</div>}
                <div className="flex justify-between pt-2 border-t border-line font-bold text-base">
                  <span>IS/BIC dû {d.annee}</span>
                  <span className="font-mono text-section">{d.calcul.montantDu.toLocaleString("fr-FR")} XOF</span>
                </div>
              </div>
            </div>
          )}

          {/* Acomptes provisionnels */}
          {d.acomptes && (
            <div className="bg-info-50 border border-info/25 rounded-xl p-4">
              <p className="text-sm font-semibold text-info mb-3">📅 Acomptes provisionnels {(d.annee||year)+1}</p>
              <div className="grid grid-cols-2 gap-3">
                {[d.acomptes.acompte1, d.acomptes.acompte2].map((a, i) => (
                  <div key={i} className="bg-surface rounded-lg p-3">
                    <p className="text-xs text-ink2">Acompte {i+1} — à verser le {a.echeance}</p>
                    <p className="font-bold font-mono text-info">{a.montant.toLocaleString("fr-FR")} XOF</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className={`text-sm px-3 py-1 rounded-full font-medium ${d.statut==="submitted"?"bg-pos-50 text-pos":"bg-surface2 text-ink2"}`}>
              {d.statut === "submitted" ? "✅ Déclaration soumise" : "⬜ Non soumise"}
            </span>
            {d.statut !== "submitted" && (
              <button onClick={handleSubmit} disabled={submitting} className="px-5 py-2 bg-section text-white rounded-xl text-sm font-medium hover:brightness-95 disabled:opacity-60">
                {submitting ? "Envoi…" : "Soumettre la déclaration"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
