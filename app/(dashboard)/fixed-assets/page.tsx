"use client";
import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

interface DepreciationEntry { year: number; annuity: number; cumulative: number; netValue: number; posted: boolean; }
interface FixedAsset {
  _id: string; code: string; name: string; category: string;
  acquisitionDate: string; acquisitionCost: number; currentNetValue: number;
  depreciationMethod: string; usefulLifeYears: number; status: string;
  depreciationSchedule: DepreciationEntry[];
}

const CAT_LABELS: Record<string,string> = {
  building:"Immeuble", equipment:"Matériel & outillage", vehicle:"Véhicule",
  furniture:"Mobilier", computer:"Informatique", software:"Logiciel", land:"Terrain", other:"Autre"
};
const CAT_LIFE: Record<string,number> = { building:20, equipment:10, vehicle:5, furniture:10, computer:3, software:3, land:0, other:5 };

export default function FixedAssetsPage() {
  const [mounted, setMounted] = useState(false);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [stats, setStats] = useState<{ totalAcquisitionCost?: number; totalNetValue?: number; count?: number }>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [postingYear, setPostingYear] = useState<number | null>(null);
  const [form, setForm] = useState({
    code: "", name: "", category: "equipment", acquisitionDate: new Date().toISOString().slice(0,10),
    acquisitionCost: 0, residualValue: 0, depreciationMethod: "linear",
    usefulLifeYears: 5, supplier: "", location: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/fixed-assets", { credentials: "include" });
    const d = await res.json();
    setAssets(d.data?.items || []);
    setStats(d.data?.stats || {});
    setLoading(false);
  }, []);
  useEffect(() => { setMounted(true); load(); }, [load]);

  if (!mounted) return null;

  const u = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));
  const selectedAsset = detailId ? assets.find(a => a._id === detailId) : null;
  const currentYear = new Date().getFullYear();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/fixed-assets", {
      method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include", body: JSON.stringify(form),
    });
    if (res.ok) { setModalOpen(false); load(); }
    setSaving(false);
  }

  async function handlePostDepreciation(assetId: string, year: number) {
    setPostingYear(year);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    await fetch(`/api/fixed-assets/${assetId}/depreciation`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include", body: JSON.stringify({ year }),
    });
    setPostingYear(null);
    load();
  }

  const totalDepreciation = (stats.totalAcquisitionCost || 0) - (stats.totalNetValue || 0);
  const depRate = stats.totalAcquisitionCost ? Math.round((totalDepreciation / stats.totalAcquisitionCost) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Immobilisations</h1>
          <p className="text-sm text-ink2">Plan d'amortissement OHADA · Méthode linéaire et dégressive</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="px-4 py-2 bg-section text-white rounded-lg text-sm font-medium hover:brightness-95">+ Nouvelle immobilisation</button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl border border-line p-4"><p className="text-xs text-ink2">Valeur d'acquisition</p><p className="text-xl font-bold font-mono text-ink mt-1">{((stats.totalAcquisitionCost||0)/1_000_000).toFixed(1)}M XOF</p></div>
        <div className="bg-surface rounded-xl border border-line p-4"><p className="text-xs text-ink2">Valeur nette comptable</p><p className="text-xl font-bold font-mono text-pos mt-1">{((stats.totalNetValue||0)/1_000_000).toFixed(1)}M XOF</p></div>
        <div className="bg-surface rounded-xl border border-line p-4"><p className="text-xs text-ink2">Amortissements cumulés</p><p className="text-xl font-bold font-mono text-warn mt-1">{(totalDepreciation/1_000_000).toFixed(1)}M XOF</p><div className="mt-2 h-1.5 bg-surface2 rounded-full"><div className="h-1.5 bg-warn rounded-full" style={{width:`${depRate}%`}}/></div></div>
        <div className="bg-surface rounded-xl border border-line p-4"><p className="text-xs text-ink2">Immobilisations actives</p><p className="text-xl font-bold text-ink mt-1">{stats.count || 0}</p></div>
      </div>

      {loading ? <div className="h-48 bg-surface rounded-xl animate-pulse border border-line"/> : (
        <div className="bg-surface rounded-xl border border-line overflow-hidden">
          <div className="px-5 py-3 border-b border-line flex justify-between items-center">
            <p className="font-semibold text-ink text-sm">Liste des immobilisations</p>
          </div>
          <table className="w-full border-collapse text-sm" style={{tableLayout:"fixed"}}>
            <thead><tr className="bg-surface2 text-left"><th className="px-4 py-2 text-xs text-ink2 font-medium uppercase w-24">Code</th><th className="px-3 py-2 text-xs text-ink2 font-medium uppercase">Désignation</th><th className="px-3 py-2 text-xs text-ink2 font-medium uppercase w-24">Catégorie</th><th className="px-3 py-2 text-xs text-ink2 font-medium uppercase text-right w-32">V. acq. (XOF)</th><th className="px-3 py-2 text-xs text-ink2 font-medium uppercase text-right w-28">VNC</th><th className="px-3 py-2 text-xs text-ink2 font-medium uppercase w-20">Statut</th></tr></thead>
            <tbody>
              {assets.length === 0 && <tr><td colSpan={6} className="text-center text-ink2 py-10">Aucune immobilisation enregistrée</td></tr>}
              {assets.map(a => (
                <tr key={a._id} className="border-t border-line hover:bg-surface2/50 cursor-pointer" onClick={() => setDetailId(detailId === a._id ? null : a._id)}>
                  <td className="px-4 py-3 font-mono text-xs text-section">{a.code}</td>
                  <td className="px-3 py-3 font-medium text-ink truncate">{a.name}</td>
                  <td className="px-3 py-3 text-xs text-ink2">{CAT_LABELS[a.category]||a.category}</td>
                  <td className="px-3 py-3 text-right font-mono">{a.acquisitionCost.toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-3 text-right font-mono font-medium">{(a.currentNetValue||a.acquisitionCost).toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${a.status==="active"?"bg-pos-50 text-pos":a.status==="fully_depreciated"?"bg-surface2 text-ink3":"bg-neg-50 text-neg"}`}>{a.status==="active"?"Actif":a.status==="fully_depreciated"?"Amorti":"Cédé"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Plan d'amortissement inline */}
      {selectedAsset && (
        <div className="bg-surface rounded-xl border border-line overflow-hidden">
          <div className="px-5 py-3 border-b border-line bg-surface2 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-ink text-sm">{selectedAsset.name} — Plan d'amortissement ({selectedAsset.depreciationMethod === "linear" ? "Linéaire" : "Dégressif"})</p>
              <p className="text-xs text-ink2">{selectedAsset.acquisitionCost.toLocaleString("fr-FR")} XOF · {selectedAsset.usefulLifeYears} ans</p>
            </div>
            <div className="flex gap-2">
              <button onClick={async () => {
                const name = await promptDialog({ title: "Modifier l'immobilisation", label: "Désignation", defaultValue: selectedAsset.name, required: true }); if (!name) return;
                const location = await promptDialog({ title: "Modifier l'immobilisation", label: "Emplacement / affectation", defaultValue: (selectedAsset as { location?: string }).location ?? "" }) ?? undefined;
                const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
                const res = await fetch(`/api/fixed-assets/${selectedAsset._id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ name, location }) });
                if (res.ok) load(); else showToast("Modification impossible", "error");
              }} className="px-3 h-8 rounded-lg border border-line2 text-xs hover:bg-surface">Modifier</button>
              {selectedAsset.status !== "disposed" && <button onClick={async () => {
                const sale = await confirmDialog({ title: "Cession (vente) ou mise au rebut ?", message: "Une vente demande un prix de cession ; une mise au rebut sort le bien sans prix.", confirmLabel: "Vente", cancelLabel: "Mise au rebut" });
                const price = sale ? Number(await promptDialog({ title: "Prix de cession", label: "Prix de cession (XOF)", defaultValue: "0", type: "number" })) || 0 : 0;
                if (!await confirmDialog({ title: `Sortir « ${selectedAsset.name} » de l'actif ?`, message: "L'écriture de sortie sera passée.", danger: true, confirmLabel: "Sortir de l'actif" })) return;
                const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
                const res = await fetch(`/api/fixed-assets/${selectedAsset._id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ action: "dispose", reason: sale ? "sale" : "scrap", price }) });
                const d = await res.json().catch(() => ({}));
                if (res.ok) load(); else showToast(d.error || "Sortie impossible", "error");
              }} className="px-3 h-8 rounded-lg border border-neg/25 text-neg text-xs hover:bg-neg-50">Céder / mettre au rebut</button>}
            </div>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead><tr className="bg-surface2/50"><th className="px-4 py-2 text-xs text-ink2 font-medium text-left">Année</th><th className="px-4 py-2 text-xs text-ink2 font-medium text-right">Dotation</th><th className="px-4 py-2 text-xs text-ink2 font-medium text-right">Cumul</th><th className="px-4 py-2 text-xs text-ink2 font-medium text-right">VNC</th><th className="px-4 py-2 text-xs text-ink2 font-medium text-center w-36">Action</th></tr></thead>
            <tbody>
              {selectedAsset.depreciationSchedule.map(entry => (
                <tr key={entry.year} className={`border-t border-line ${entry.year === currentYear ? "bg-info-50/40" : ""}`}>
                  <td className="px-4 py-2.5 font-medium">{entry.year}{entry.year === currentYear && <span className="ml-2 text-xs bg-info-50 text-info px-1.5 py-0.5 rounded">En cours</span>}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{entry.annuity.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-warn">{entry.cumulative.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-medium">{entry.netValue.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-2.5 text-center">
                    {entry.posted
                      ? <span className="text-xs text-pos">✅ Comptabilisé</span>
                      : entry.year <= currentYear
                      ? <button onClick={() => handlePostDepreciation(selectedAsset._id, entry.year)} disabled={postingYear === entry.year}
                          className="text-xs bg-section text-white px-3 py-1 rounded-lg hover:brightness-95 disabled:opacity-60">
                          {postingYear === entry.year ? "…" : "Passer l'écriture"}
                        </button>
                      : <span className="text-xs text-ink2">Non échu</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle immobilisation" size="xl">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Code" required><input className={inputCls} value={form.code} onChange={e=>u("code",e.target.value.toUpperCase())} required/></FormField>
            <FormField label="Désignation" required><input className={inputCls} value={form.name} onChange={e=>u("name",e.target.value)} required/></FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Catégorie" required>
              <select className={selectCls} value={form.category} onChange={e=>{ u("category",e.target.value); u("usefulLifeYears",CAT_LIFE[e.target.value]||5); }}>
                {Object.entries(CAT_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <FormField label="Date d'acquisition" required><input type="date" className={inputCls} value={form.acquisitionDate} onChange={e=>u("acquisitionDate",e.target.value)} required/></FormField>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Valeur d'acquisition (XOF)" required><input type="number" className={inputCls} value={form.acquisitionCost} onChange={e=>u("acquisitionCost",Number(e.target.value))} min={0} required/></FormField>
            <FormField label="Valeur résiduelle (XOF)"><input type="number" className={inputCls} value={form.residualValue} onChange={e=>u("residualValue",Number(e.target.value))} min={0}/></FormField>
            <FormField label="Durée de vie (ans)"><input type="number" className={inputCls} value={form.usefulLifeYears} onChange={e=>u("usefulLifeYears",Number(e.target.value))} min={1} max={50}/></FormField>
          </div>
          <FormField label="Méthode d'amortissement">
            <select className={selectCls} value={form.depreciationMethod} onChange={e=>u("depreciationMethod",e.target.value)}>
              <option value="linear">Linéaire (taux constant)</option>
              <option value="degressive">Dégressif (taux accéléré)</option>
              <option value="none">Non amortissable (ex: terrain)</option>
            </select>
          </FormField>
          {form.depreciationMethod !== "none" && form.usefulLifeYears > 0 && form.acquisitionCost > 0 && (
            <div className="p-3 bg-surface2 rounded-xl text-xs text-ink2">
              Dotation annuelle estimée : <strong className="text-ink font-mono">{Math.round((form.acquisitionCost - form.residualValue) / form.usefulLifeYears).toLocaleString("fr-FR")} XOF/an</strong>
              {" "}· Taux : <strong>{(100 / form.usefulLifeYears).toFixed(1)}%</strong>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Fournisseur"><input className={inputCls} value={form.supplier} onChange={e=>u("supplier",e.target.value)}/></FormField>
            <FormField label="Localisation"><input className={inputCls} value={form.location} onChange={e=>u("location",e.target.value)}/></FormField>
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-line">
            <button type="button" onClick={()=>setModalOpen(false)} className="px-4 py-2 border border-line rounded-xl text-sm text-ink2 hover:bg-surface2">Annuler</button>
            <button type="submit" disabled={saving} className="px-6 py-2 bg-section text-white rounded-xl text-sm font-medium hover:brightness-95 disabled:opacity-60">{saving?"Création…":"Créer + plan d'amortissement"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
