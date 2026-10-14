"use client";

import { useEffect, useState } from "react";
import { Camera, Send, Download, ShieldCheck, AlertTriangle, CheckCircle2, Settings2 } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { compressPhoto, collectPhotos } from "@/components/isic/image";

import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken, apiJson, apiSend } from "@/lib/api-client";
async function send<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await getCsrfToken() }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Opération refusée");
  return d.data as T;
}

interface Check {
  count: number; newCards: number; renewals: number; withPhoto: number; ready: number; errors: number; warnings: number;
  renewalCodeMissing: boolean; renewalCode: string;
  students: Array<{ _id: string; fullName: string; matricule?: string; schoolName: string; issues: Array<{ level: "error" | "warning"; message: string }> }>;
}

export function EnvoiIsic({ year, schools, onChanged }: { year: string; schools: string[]; onChanged: () => void }) {
  // ── Réglage : code des renouvellements ────────────────────────────────────
  const [renewalCode, setRenewalCode] = useState("");
  const [codeSaved, setCodeSaved] = useState("");
  useEffect(() => {
    apiJson("/api/isic/registry/settings")
      .then(d => { setRenewalCode(d.data?.renewalRequestType ?? ""); setCodeSaved(d.data?.renewalRequestType ?? ""); }).catch(() => {});
  }, []);
  async function saveCode() {
    try { const r = await send<{ renewalRequestType: string }>("/api/isic/registry/settings", "PATCH", { renewalRequestType: renewalCode }); setCodeSaved(r.renewalRequestType); setRenewalCode(r.renewalRequestType); }
    catch (e) { showToast(e instanceof Error ? e.message : "Enregistrement impossible", "error"); }
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  const [photoSchool, setPhotoSchool] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [photoReport, setPhotoReport] = useState<null | { attached: number; unknown: string[]; ambiguous: string[]; failed: string[] }>(null);
  async function importPhotos(files: File[]) {
    setPhotoReport(null);
    let items: Array<{ name: string; blob: Blob }>;
    try { items = await collectPhotos(files); } catch { showToast("Archive illisible.", "error"); return; }
    if (!items.length) { showToast("Aucune photo (JPEG/PNG) trouvée.", "warning"); return; }
    const report = { attached: 0, unknown: [] as string[], ambiguous: [] as string[], failed: [] as string[] };
    setProgress({ done: 0, total: items.length });
    let next = 0, done = 0;
    const worker = async () => {
      while (next < items.length) {
        const it = items[next++];
        try {
          const dataUri = await compressPhoto(it.blob);
          const res = await apiSend("POST", "/api/isic/registry/photos", { fileName: it.name, schoolName: photoSchool || undefined, dataUri });
          const d = res.data;
          if (!res.ok) report.failed.push(`${it.name} — ${d.error || "refusée"}`);
          else if (d.data?.status === "attached") report.attached++;
          else if (d.data?.status === "ambiguous") report.ambiguous.push(it.name);
          else report.unknown.push(it.name);
        } catch { report.failed.push(`${it.name} — image illisible`); }
        setProgress({ done: ++done, total: items.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setProgress(null);
    setPhotoReport(report);
    onChanged();
  }

  // ── Préparation de l'envoi ────────────────────────────────────────────────
  const [school, setSchool] = useState("");
  const [scope, setScope] = useState<"new" | "renewal" | "all">("new");
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const qs = (format: string) => new URLSearchParams({ year, scope, format, ...(school ? { school } : {}) }).toString();
  async function runCheck() {
    setChecking(true);
    try {
      const r = await apiJson(`/api/isic/registry/submission?${qs("check")}`);
      if (!r.success) throw new Error(r.error || "Contrôle impossible");
      setCheck(r.data);
    } catch (e) { showToast(e instanceof Error ? e.message : "Contrôle impossible", "error"); } finally { setChecking(false); }
  }
  useEffect(() => { setCheck(null); }, [year, school, scope]);

  const blocked = !check || check.count === 0 || check.renewalCodeMissing;

  return (
    <div className="space-y-5">
      {/* 1. Photos */}
      <section className="surface-card p-4 space-y-3">
        <h3 className="font-semibold text-ink inline-flex items-center gap-2"><Camera size={17} /> 1. Photos des étudiants</h3>
        <p className="text-sm text-ink2">
          Déposez le zip de photos (comme « 2025-2026-DOCTORANT.zip ») ou des images. Chaque photo est rattachée à l&apos;étudiant dont le
          <b> Personal ID</b> correspond au nom du fichier (<span className="font-mono">25175.jpg</span>), puis compressée automatiquement.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Établissement" hint="Utile seulement si deux établissements ont le même Personal ID">
            <select className={selectCls} value={photoSchool} onChange={e => setPhotoSchool(e.target.value)}>
              <option value="">Tous</option>
              {schools.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
          <label className={`inline-flex items-center gap-2 px-4 h-10 rounded-lg bg-section text-white text-sm font-semibold cursor-pointer ${progress ? "opacity-50 pointer-events-none" : ""}`}>
            <Camera size={15} /> {progress ? `Import ${progress.done}/${progress.total}…` : "Importer des photos (zip ou images)"}
            <input type="file" multiple accept=".zip,image/jpeg,image/png" className="hidden"
              onChange={e => { const fl = Array.from(e.target.files ?? []); e.target.value = ""; if (fl.length) importPhotos(fl); }} />
          </label>
        </div>
        {progress && <div className="h-2 rounded bg-surface2 overflow-hidden"><div className="h-full bg-section transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>}
        {photoReport && (
          <div className="rounded-lg border border-line p-3 text-sm space-y-1">
            <p><b className="text-pos">{photoReport.attached}</b> photo(s) rattachée(s).</p>
            {photoReport.unknown.length > 0 && <p className="text-warn">Aucun étudiant avec ce Personal ID ({photoReport.unknown.length}) : <span className="font-mono text-xs">{photoReport.unknown.join(", ")}</span></p>}
            {photoReport.ambiguous.length > 0 && <p className="text-warn">Personal ID présent dans plusieurs établissements — choisissez l&apos;établissement ({photoReport.ambiguous.length}) : <span className="font-mono text-xs">{photoReport.ambiguous.join(", ")}</span></p>}
            {photoReport.failed.length > 0 && <p className="text-neg">Échecs : <span className="text-xs">{photoReport.failed.join(" · ")}</span></p>}
          </div>
        )}
      </section>

      {/* 2. Contrôle + fichier */}
      <section className="surface-card p-4 space-y-3">
        <h3 className="font-semibold text-ink inline-flex items-center gap-2"><Send size={17} /> 2. Préparer l&apos;envoi à ISIC — {year}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Établissement">
            <select className={selectCls} value={school} onChange={e => setSchool(e.target.value)}>
              <option value="">Tous</option>
              {schools.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Cartes">
            <select className={selectCls} value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
              <option value="new">Nouvelles cartes (sans numéro)</option>
              <option value="renewal">Renouvellements (avec numéro)</option>
              <option value="all">Les deux</option>
            </select>
          </FormField>
          <button onClick={runCheck} disabled={checking} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-section/40 text-section text-sm font-semibold hover:bg-section/5 disabled:opacity-50">
            <ShieldCheck size={15} /> {checking ? "Contrôle…" : "Contrôler"}
          </button>
        </div>

        {check && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Pill tone="info">{check.count} étudiant(s)</Pill>
              <Pill tone="mute">{check.newCards} nouvelle(s) carte(s)</Pill>
              <Pill tone="mute">{check.renewals} renouvellement(s)</Pill>
              <Pill tone={check.withPhoto === check.count ? "pos" : "warn"}>{check.withPhoto}/{check.count} avec photo</Pill>
              <Pill tone={check.errors ? "neg" : "pos"}>{check.errors} erreur(s)</Pill>
              <Pill tone={check.warnings ? "warn" : "pos"}>{check.warnings} avertissement(s)</Pill>
            </div>
            {check.count === 0 && <p className="text-sm text-ink2">Aucun étudiant couvert en {year} pour ces critères.</p>}
            {check.renewalCodeMissing && (
              <p className="px-3 py-2 rounded-lg bg-warn-50 border border-warn/25 text-sm text-warn inline-flex items-center gap-2">
                <AlertTriangle size={15} /> Des renouvellements sont inclus : renseignez le code ISIC des renouvellements ci-dessous.
              </p>
            )}
            {check.students.length === 0 && check.count > 0 ? (
              <p className="text-sm text-pos font-semibold inline-flex items-center gap-2"><CheckCircle2 size={15} /> Tout est complet : prêt pour ISIC.</p>
            ) : check.students.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
                <div className="overflow-x-auto">
                <table className="table-dense">
                  <thead><tr><th>Étudiant</th><th>Personal ID</th><th>À corriger</th></tr></thead>
                  <tbody>
                    {check.students.map(s => (
                      <tr key={s._id}>
                        <td className="text-ink">{s.fullName}<div className="text-[11px] text-ink3">{s.schoolName}</div></td>
                        <td className="font-mono text-xs">{s.matricule || "—"}</td>
                        <td className="text-xs space-y-0.5">
                          {s.issues.map((i, k) => <div key={k} className={i.level === "error" ? "text-neg" : "text-warn"}>{i.level === "error" ? "●" : "○"} {i.message}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a href={blocked ? undefined : `/api/isic/registry/submission?${qs("zip")}`} aria-disabled={blocked}
                className={`inline-flex items-center gap-2 px-4 h-10 rounded-lg bg-section text-white text-sm font-semibold ${blocked ? "opacity-40 pointer-events-none" : "hover:brightness-95"}`}>
                <Download size={15} /> Paquet complet (Excel + photos)
              </a>
              <a href={blocked ? undefined : `/api/isic/registry/submission?${qs("xlsx")}`} aria-disabled={blocked}
                className={`inline-flex items-center gap-2 px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 ${blocked ? "opacity-40 pointer-events-none" : "hover:bg-surface2"}`}>
                <Download size={15} /> Fichier Excel seul
              </a>
              {check.errors > 0 && !blocked && <span className="text-xs text-warn">Des erreurs subsistent : ISIC risque de refuser ces cartes. Corrigez-les ou envoyez en connaissance de cause.</span>}
            </div>
          </div>
        )}
      </section>

      {/* 3. Réglage */}
      <section className="surface-card p-4 space-y-2">
        <h3 className="font-semibold text-ink inline-flex items-center gap-2"><Settings2 size={17} /> Code ISIC des renouvellements</h3>
        <p className="text-sm text-ink2">Valeur de la colonne « Request Type » pour un étudiant qui garde son numéro (les nouvelles cartes utilisent <span className="font-mono">NEW_CARD</span>).</p>
        <div className="flex items-end gap-3">
          <FormField label="Request Type (renouvellement)">
            <input className={`${inputCls} font-mono uppercase`} value={renewalCode} onChange={e => setRenewalCode(e.target.value)} placeholder="À confirmer auprès d'ISIC" />
          </FormField>
          <button onClick={saveCode} disabled={renewalCode.trim().toUpperCase() === codeSaved} className={buttonClass("primary", "md")}>Enregistrer</button>
        </div>
      </section>
    </div>
  );
}
