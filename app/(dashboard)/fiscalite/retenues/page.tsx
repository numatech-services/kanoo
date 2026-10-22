"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { DataTable, Column } from "@/components/ui/DataTable";

import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { TreasuryAccountSelect } from "@/components/shared/TreasuryAccountSelect";
import { SufferedWithholdings } from "@/components/fiscal/SufferedWithholdings";
interface Retenue { _id:string; type:string; beneficiaire:string; nifBeneficiaire?:string; montantBrut:number; montantRetenue:number; montantNet:number; article:string; date:string; isPaid:boolean; }
interface TypeInfo { key:string; taux:number; description:string; article:string; }

const TYPE_LABELS: Record<string,string> = { marche_public:"Marché public",prestation_service:"Prestation service",loyer_immeuble:"Loyer immeuble",dividendes:"Dividendes",honoraires:"Honoraires",commissions:"Commissions",interet_pret:"Intérêt de prêt",transport_inter:"Transport international" };

export default function RetenuesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ type:"marche_public", beneficiaire:"", nifBeneficiaire:"", montantBrut:0, reference:"", treasuryAccountId:"" });

  const { data: { retenues, total, totalRetenues, nonVersees, types }, loading, reload: load } = useApi(`/api/fiscal/retenues?annee=${new Date().getFullYear()}`, d => ({
    retenues: (d.data?.items||[]) as Retenue[], total: (d.data?.pagination?.total||0) as number,
    totalRetenues: (d.data?.totalRetenues||0) as number, nonVersees: (d.data?.nonVersees||0) as number,
    types: (d.data?.typesDisponibles||[]) as TypeInfo[],
  }), { retenues: [] as Retenue[], total: 0, totalRetenues: 0, nonVersees: 0, types: [] as TypeInfo[] });

  // Simulation en temps réel
  const selectedType = types.find(t => t.key === form.type);
  const simulatedRetenue = form.montantBrut > 0 && selectedType ? Math.round(form.montantBrut * selectedType.taux) : 0;
  const simulatedNet = form.montantBrut - simulatedRetenue;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    const res = await apiSend("POST", "/api/fiscal/retenues", form);
    if (res.ok) { setModalOpen(false); load(); }
    setSaving(false);
  }

  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));

  const columns: Column<Retenue>[] = [
    { key:"beneficiaire", label:"Bénéficiaire" },
    { key:"type", label:"Nature", render:(v)=><span className="text-xs text-ink2">{TYPE_LABELS[String(v)]||String(v)}</span> },
    { key:"montantBrut", label:"Brut (FCFA)", className:"text-right font-mono", render:(v)=>Number(v).toLocaleString("fr-FR") },
    { key:"montantRetenue", label:"Retenue (FCFA)", className:"text-right font-mono font-bold text-section", render:(v)=>Number(v).toLocaleString("fr-FR") },
    { key:"montantNet", label:"Net versé (FCFA)", className:"text-right font-mono", render:(v)=>Number(v).toLocaleString("fr-FR") },
    { key:"article", label:"Base légale", className:"text-xs text-ink2" },
    { key:"date", label:"Date", render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR") },
    { key:"isPaid", label:"Versé DGI", render:(v)=>v ? <span className="text-xs bg-pos-50 text-pos px-2 py-0.5 rounded-full">Versé</span> : <span className="text-xs bg-neg-50 text-neg px-2 py-0.5 rounded-full">En attente</span> },
  ];

  return (
    <div className="space-y-5">
      <ScreenTabs group="fiscalite" />
      <div>
        <div className="flex items-center gap-2 text-xs text-ink2 mb-2">
          <a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span>Retenues à la source</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Retenues à la source</h1>
            <p className="text-sm text-ink2">CGI Niger — Marchés, prestations, loyers, dividendes…</p>
          </div>
          <button onClick={()=>setModalOpen(true)} className={buttonClass("primary", "md")}>+ Enregistrer une retenue</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl border border-line p-4"><p className="text-xs text-ink2">Total retenues {new Date().getFullYear()}</p><p className="text-xl font-bold font-mono text-section mt-1">{totalRetenues.toLocaleString("fr-FR")} FCFA</p></div>
        <div className={`rounded-xl border p-4 ${nonVersees>0?"bg-neg-50 border-neg/25":"bg-surface border-line"}`}><p className="text-xs text-ink2">Non versées à DGI</p><p className={`text-xl font-bold font-mono mt-1 ${nonVersees>0?"text-neg":"text-pos"}`}>{nonVersees.toLocaleString("fr-FR")} FCFA</p></div>
        <div className="bg-surface rounded-xl border border-line p-4"><p className="text-xs text-ink2">Nombre de retenues</p><p className="text-xl font-bold mt-1">{total}</p></div>
      </div>

      <DataTable columns={columns} data={retenues} loading={loading} keyExtractor={r=>r._id} emptyMessage="Aucune retenue à la source enregistrée"/>
      <SufferedWithholdings />

      <Modal open={modalOpen} onClose={()=>setModalOpen(false)} title="Enregistrer une retenue à la source" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <FormField label="Nature de la retenue" required>
            <select className={selectCls} value={form.type} onChange={e=>u("type",e.target.value)}>
              {types.map(t=><option key={t.key} value={t.key}>{t.description} — {Math.round(t.taux*100)}%</option>)}
            </select>
          </FormField>
          {selectedType && <div className="p-3 bg-surface2 rounded-xl text-xs text-ink2">Base légale : <strong>{selectedType.article}</strong> · Taux : <strong>{Math.round(selectedType.taux*100)}%</strong></div>}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Bénéficiaire (nom/raison sociale)" required>
              <input className={inputCls} value={form.beneficiaire} onChange={e=>u("beneficiaire",e.target.value)} required/>
            </FormField>
            <FormField label="NIF du bénéficiaire">
              <input className={inputCls} value={form.nifBeneficiaire} onChange={e=>u("nifBeneficiaire",e.target.value)} placeholder="Optionnel"/>
            </FormField>
          </div>
          <FormField label="Montant brut (FCFA)" required>
            <input type="number" className={inputCls} value={form.montantBrut} onChange={e=>u("montantBrut",Number(e.target.value))} min={0} required/>
          </FormField>
          <FormField label="Compte qui paie le net (facultatif)" hint="Laissez vide si le règlement du fournisseur est saisi dans Achats : seule la retenue est alors constatée.">
            <TreasuryAccountSelect value={form.treasuryAccountId} onChange={v=>u("treasuryAccountId",v)} autoSelect={false} />
          </FormField>
          {simulatedRetenue > 0 && (
            <div className="bg-warn-50 border border-warn/25 rounded-xl p-3 grid grid-cols-3 text-xs text-center">
              <div><p className="font-bold text-warn">{simulatedRetenue.toLocaleString("fr-FR")} FCFA</p><p className="text-warn mt-0.5">Retenue à verser à DGI</p></div>
              <div><p className="font-bold text-pos">{simulatedNet.toLocaleString("fr-FR")} FCFA</p><p className="text-pos mt-0.5">Net à verser au bénéficiaire</p></div>
              <div><p className="font-bold text-ink">{form.montantBrut.toLocaleString("fr-FR")} FCFA</p><p className="text-ink2 mt-0.5">Montant brut total</p></div>
            </div>
          )}
          <FormField label="Référence (facture, marché…)">
            <input className={inputCls} value={form.reference} onChange={e=>u("reference",e.target.value)}/>
          </FormField>
          <div className="flex justify-end gap-3 pt-3 border-t border-line">
            <button type="button" onClick={()=>setModalOpen(false)} className={buttonClass("secondary", "md")}>Annuler</button>
            <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>{saving?"Enregistrement…":"Enregistrer + Écriture comptable"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
