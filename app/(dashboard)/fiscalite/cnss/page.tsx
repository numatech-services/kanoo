"use client";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { showToast } from "@/components/ui/Toast";
import { useApi } from "@/lib/use-api";
import { apiSend } from "@/lib/api-client";
import { useMe, meCanDo } from "@/lib/useMe";
import { pourcent, tauxCnss } from "@/lib/paie-parametres";

interface CnssData {
  periodicite: "mensuelle" | "trimestrielle"; effectif: number; echeance: string;
  payslipsCount: number; salariesDeclares: number;
  totalBrut: number; cnssEmploye: number; cnssPatronal: number; totalCnss: number;
  branches: { pf: number; atmp: number; pensions: number; anpe: number };
  statut: string;
}

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

export default function CNSSPage() {
  const now = new Date();
  const me = useMe();
  const canDeclare = meCanDo(me, "fiscalDeclarations", "create");
  const [year, setYear] = useState(now.getFullYear());
  // Mode choisi par l'utilisateur ; à défaut, celui que fixe l'effectif.
  const [mode, setMode] = useState<"mensuelle" | "trimestrielle" | null>(null);
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [saving, setSaving] = useState(false);

  // Première lecture (trimestre) : donne l'effectif, donc la périodicité légale.
  const probe = useApi<CnssData | null>(mode ? null : `/api/fiscal/cnss?annee=${year}&trimestre=${quarter}`, d => d.data ?? null, null);
  const effectiveMode = mode ?? probe.data?.periodicite ?? "trimestrielle";
  const query = effectiveMode === "mensuelle" ? `annee=${year}&mois=${month}` : `annee=${year}&trimestre=${quarter}`;
  const { data, loading, reload } = useApi<CnssData | null>(`/api/fiscal/cnss?${query}`, d => d.data ?? null, null);
  const t = tauxCnss();
  const inp = "px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";

  async function declare() {
    if (!data) return;
    setSaving(true);
    const body = { annee: year, ...(effectiveMode === "mensuelle" ? { mois: month } : { trimestre: quarter }), totalBrut: data.totalBrut, totalCnss: data.totalCnss };
    const res = await apiSend("POST", "/api/fiscal/cnss", body);
    setSaving(false);
    if (!res.ok) { showToast(res.data?.error || "Enregistrement impossible", "error"); return; }
    showToast("Déclaration CNSS enregistrée", "success");
    reload();
  }

  const pdfHref = `/api/reports/dgi-cnss?year=${year}&${effectiveMode === "mensuelle" ? `mois=${month}` : `trimestre=${quarter}`}`;
  const label = effectiveMode === "mensuelle" ? `${MONTHS[month - 1]} ${year}` : `T${quarter}/${year}`;

  return (
    <div className="space-y-6 max-w-2xl">
      <ScreenTabs group="fiscalite" />
      <div>
        <div className="flex items-center gap-2 text-sm text-ink2 mb-2"><a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span className="text-ink font-medium">CNSS</span></div>
        <h1 className="page-title">Déclaration CNSS</h1>
        <p className="text-sm text-ink2 mt-1">Salarié {pourcent(t.salarie)} + employeur {pourcent(t.employeur)} = {pourcent(t.total)}, sur une assiette plafonnée à 500 000 FCFA par mois.</p>
      </div>
      <div className="flex gap-3 flex-wrap">
        <select aria-label="Périodicité" value={effectiveMode} onChange={e=>setMode(e.target.value as "mensuelle" | "trimestrielle")} className={inp}>
          <option value="trimestrielle">Trimestrielle</option><option value="mensuelle">Mensuelle</option>
        </select>
        {effectiveMode === "mensuelle"
          ? <select aria-label="Mois" value={month} onChange={e=>setMonth(Number(e.target.value))} className={inp}>{MONTHS.map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select>
          : <select aria-label="Trimestre" value={quarter} onChange={e=>setQuarter(Number(e.target.value))} className={inp}>{[1,2,3,4].map(q=><option key={q} value={q}>T{q}</option>)}</select>}
        <select aria-label="Année" value={year} onChange={e=>setYear(Number(e.target.value))} className={inp}>{[year-1,year,year+1].map(y=><option key={y} value={y}>{y}</option>)}</select>
      </div>
      {data && data.periodicite !== effectiveMode && (
        <div className="bg-warn-50 border border-warn/25 rounded-xl p-3 text-xs text-warn">
          Avec {data.effectif} salarié{data.effectif > 1 ? "s" : ""}, la déclaration est {data.periodicite} (mensuelle à partir de 20 salariés).
        </div>
      )}
      {loading && !data ? <div className="h-48 bg-surface2 animate-pulse rounded-xl"/> : data && (
        <div className="space-y-4">
          <div className="bg-surface rounded-xl border border-line p-5 space-y-3">
            <h2 className="font-semibold text-ink">Bordereau — {label}</h2>
            {data.payslipsCount === 0 ? (
              <p className="text-sm text-ink2 text-center py-6">Aucun bulletin pour cette période. Générez d&apos;abord les bulletins de paie.</p>
            ) : (
              <>
                {([
                  ["Salariés déclarés", `${data.salariesDeclares}`],
                  ["Assiette (plafonnée)", `${fmt(data.totalBrut)} FCFA`],
                  [`Part salariale`, `${fmt(data.cnssEmploye)} FCFA`],
                  [`Part patronale`, `${fmt(data.cnssPatronal)} FCFA`],
                  ["  dont prestations familiales", `${fmt(data.branches.pf)} FCFA`],
                  ["  dont accidents du travail", `${fmt(data.branches.atmp)} FCFA`],
                  ["  dont pensions", `${fmt(data.branches.pensions)} FCFA`],
                  ["  dont ANPE", `${fmt(data.branches.anpe)} FCFA`],
                ] as Array<[string, string]>).map(([l, v]) => (
                  <div key={l} className={`flex justify-between text-sm border-b border-line pb-2 last:border-0 ${l.startsWith("  ") ? "pl-4 text-ink2" : ""}`}>
                    <span className={l.startsWith("  ") ? "" : "text-ink2"}>{l.trim()}</span><span className="font-mono">{v}</span>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="rounded-xl p-5 bg-warn-50 border border-warn/25">
            <p className="text-sm font-semibold text-ink">Total à verser à la CNSS</p>
            <p className="text-3xl font-bold font-mono mt-1 text-warn">{fmt(data.totalCnss)} FCFA</p>
          </div>
          <div className="bg-info-50 border border-info/25 rounded-xl p-3 text-xs text-info">
            Date limite : {new Date(data.echeance).toLocaleDateString("fr-FR")} (30 jours après la fin de la période). La déclaration nominative précède le paiement ; retard ou défaut : 200 FCFA par salarié et par mois.
          </div>
          <div className="flex gap-3 flex-wrap">
            <a href={pdfHref} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md", "flex-1")}>Bordereau PDF</a>
            {canDeclare && (data.statut === "non_soumise"
              ? <button onClick={declare} disabled={saving || data.payslipsCount === 0} className={buttonClass("primary", "md", "flex-1")}>{saving ? "Enregistrement…" : "Marquer comme déclarée"}</button>
              : <span className="flex-1 px-4 h-10 inline-flex items-center justify-center rounded-lg bg-pos-50 border border-pos/25 text-pos text-sm font-semibold">Déclarée</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
