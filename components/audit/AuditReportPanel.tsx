"use client";
import { useState } from "react";
import { ShieldCheck, ShieldAlert, Lock } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { apiSend, apiJson } from "@/lib/api-client";
import { useMe } from "@/lib/useMe";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import type { AuditReport } from "@/lib/audit-report";

const TONE: Record<string, string> = { Critique: "bg-neg-50 text-neg", Majeur: "bg-warn-50 text-warn", "À vérifier": "bg-info-50 text-info" };
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

/** Rapport d'audit du mois : intégrité (sceaux), constats, revue des droits. */
export function AuditReportPanel() {
  const [period, setPeriod] = useState(prevMonth());
  const [y, m] = period.split("-").map(Number);
  const [live, setLive] = useState(false);
  type Shown = AuditReport & { snapshot?: { hash: string; generatedAt: string } | null; live?: boolean };
  const res = useApi<Shown | null>(`/api/audit/report?year=${y}&month=${m}${live ? "&live=1" : ""}`, d => d?.data ?? null, null);
  const [anchor, setAnchor] = useState({ kind: "entries", seq: "", hash: "" });
  const [anchorResult, setAnchorResult] = useState<string | null>(null);
  async function checkAnchor() {
    const q = new URLSearchParams({ kind: anchor.kind, seq: anchor.seq.trim(), hash: anchor.hash.trim() });
    const out = await apiJson(`/api/audit/seal?${q}`, { quiet: true });
    if (out?.success === false) { setAnchorResult(out.error || "Vérification impossible."); return; }
    const d = out?.data;
    setAnchorResult(!d?.found ? "Aucun sceau sous ce numéro : la chaîne a été raccourcie ou refaite." : d.match ? "Empreinte identique : la chaîne n'a pas été refaite depuis." : "Empreinte DIFFÉRENTE : la chaîne a été refaite depuis. À examiner.");
  }
  const r = res.data;
  const me = useMe();
  const isAdmin = hasTenantAdminRole(me.user ?? {});
  const [busy, setBusy] = useState(false);

  async function sealNow() {
    setBusy(true);
    const out = await apiSend("POST", "/api/audit/seal", {});
    setBusy(false);
    if (!out.ok) { showToast(out.data?.error || "Scellement refusé.", "error"); return; }
    showToast(`${(out.data?.data?.entries ?? 0) + (out.data?.data?.audit ?? 0)} pièce(s) scellée(s).`, "success");
    res.reload?.();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <label className="text-sm text-ink2">Mois
          <input type="month" value={period} max={new Date().toISOString().slice(0, 7)} onChange={e => { if (e.target.value) { setPeriod(e.target.value); setLive(false); } }} className="block mt-1 px-3 py-2 border border-line rounded-lg text-sm" />
        </label>
        {isAdmin && <button disabled={busy} onClick={sealNow} className={buttonClass("secondary", "sm")}><Lock size={13} /> Sceller maintenant</button>}
      </div>
      {!r ? (res.error ? <div className="surface-card p-4 text-sm text-neg">{res.error}</div> : <div className="surface-card h-40 animate-pulse" />) : (
        <>
          <div className="surface-card p-3 text-sm flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink2">{r.snapshot && !r.live ? `Rapport figé le ${new Date(r.snapshot.generatedAt).toLocaleString("fr-FR")} — empreinte ${r.snapshot.hash.slice(0, 16)}…` : `Calculé le ${new Date(r.generatedAt).toLocaleString("fr-FR")}${r.snapshot ? " (un rapport figé existe pour ce mois)" : ""}`}</span>
            <button onClick={() => setLive(v => !v)} className={buttonClass("secondary", "sm")}>{live ? "Revoir le rapport figé" : "Recalculer à ce jour"}</button>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {(["Critique", "Majeur", "À vérifier"] as const).map(s => (
              <div key={s} className="surface-card p-4"><p className="text-[11px] font-semibold uppercase text-ink2">{s}</p><p className={`text-2xl font-bold ${r.counts[s] && s !== "À vérifier" ? (s === "Critique" ? "text-neg" : "text-warn") : "text-ink"}`}>{r.counts[s]}</p></div>
            ))}
          </div>

          <div className="surface-card p-5">
            <h2 className="font-semibold text-ink mb-3">Intégrité</h2>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              {r.integrity.map(c => {
                const broken = c.problems.some(p => p.type !== "modified" || !p.traced);
                return (
                  <div key={c.kind} className="space-y-1">
                    <p className="font-medium inline-flex items-center gap-1.5">{broken ? <ShieldAlert size={15} className="text-neg" /> : <ShieldCheck size={15} className="text-pos" />}{c.kind === "entries" ? "Écritures comptables" : "Journal d'audit"}</p>
                    <p className="text-ink2">{c.items} pièce(s) dans {c.seals} sceau(x){c.archived ? `, ${c.archived} reprise(s) archivée(s)` : ""} ; {c.unsealed} en attente de scellement.</p>
                    <p className="text-ink2">{c.problems.length ? `${c.problems.length} anomalie(s) détectée(s).` : "Aucune altération détectée."}</p>
                    {c.lastHash && <p className="text-[11px] text-ink3 break-all">Sceau n° {c.lastSeq} — empreinte : <span className="font-mono">{c.lastHash}</span></p>}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-ink3 mt-3">Chaque jour, les nouvelles pièces sont empreintées et la chaîne signée par le serveur. Le rapport mensuel envoie le numéro et l&apos;empreinte du dernier sceau par courriel : conservez-les, ils prouvent l&apos;état des comptes à cette date.</p>
            <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
              <select value={anchor.kind} onChange={e => setAnchor({ ...anchor, kind: e.target.value })} className="px-2 py-2 border border-line rounded-lg" aria-label="Chaîne"><option value="entries">Écritures</option><option value="audit">Journal</option></select>
              <input value={anchor.seq} onChange={e => setAnchor({ ...anchor, seq: e.target.value })} placeholder="N° du sceau" className="w-28 px-2 py-2 border border-line rounded-lg" />
              <input value={anchor.hash} onChange={e => setAnchor({ ...anchor, hash: e.target.value })} placeholder="Empreinte notée (64 caractères)" className="flex-1 min-w-[200px] px-2 py-2 border border-line rounded-lg font-mono text-xs" />
              <button onClick={checkAnchor} className={buttonClass("secondary", "sm")}>Comparer</button>
            </div>
            {anchorResult && <p className="text-sm mt-2">{anchorResult}</p>}
          </div>

          <div className="surface-card overflow-hidden">
            <h2 className="font-semibold text-ink px-5 py-3 border-b border-line">Constats</h2>
            {!r.findings.length ? <p className="px-5 py-4 text-sm text-ink2">Aucun constat sur la période.</p> : (
              <ul className="divide-y divide-line">
                {r.findings.map((f, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <div className="flex items-center gap-2 flex-wrap"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TONE[f.severity]}`}>{f.severity}</span><span className="font-medium">{f.check}</span><span className="text-ink3">({f.count})</span></div>
                    <p className="text-ink2 mt-1">{f.detail}</p>
                    {!!f.items?.length && <ul className="mt-1 text-xs text-ink3 list-disc pl-5">{f.items.map((it, k) => <li key={k} className="break-all">{it}</li>)}</ul>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="surface-card p-5 space-y-1">
              <h2 className="font-semibold text-ink mb-2">Activité du mois</h2>
              <p>{r.entries.created} écriture(s), dont {r.entries.manual} saisie(s) à la main et {r.entries.reversals} extourne(s).</p>
              <p>{r.activity.deletions} suppression(s), {r.activity.entryUpdates} modification(s) d&apos;écriture, {r.activity.exports} export(s), {r.activity.lockChanges} changement(s) de verrou de période, {r.activity.roleChanges} changement(s) de compte ou de rôle.</p>
              <p>{r.activity.failedLogins} connexion(s) échouée(s).</p>
            </div>
            <div className="surface-card p-5 space-y-1">
              <h2 className="font-semibold text-ink mb-2">Droits d&apos;accès</h2>
              <p>{r.users.active} compte(s) actif(s) sur {r.users.total}, dont {r.users.admins} administrateur(s).</p>
              <p>{r.users.dormant} inactif(s) depuis plus de 90 jours, {r.users.neverLogged} jamais connecté(s).</p>
              <p>{r.users.adminsWithout2fa} administrateur(s) sans double authentification, {r.users.expiredInterns} accès temporaire(s) échu(s).</p>
              <p>{r.users.apiKeys} clé(s) d&apos;API active(s){r.users.keys.length ? " : " + r.users.keys.map(k => `${k.name}${k.lastUsedAt ? ` (utilisée le ${new Date(k.lastUsedAt).toLocaleDateString("fr-FR")})` : " (jamais utilisée)"}`).join(", ") : ""}.</p>
            </div>
          </div>

          <div className="surface-card overflow-x-auto">
            <h2 className="font-semibold text-ink px-5 py-3 border-b border-line">Revue des comptes</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink2 text-xs"><th className="px-5 py-2">Utilisateur</th><th className="px-3 py-2">Rôles</th><th className="px-3 py-2">Statut</th><th className="px-3 py-2">Double auth.</th><th className="px-3 py-2">Dernière connexion</th></tr></thead>
              <tbody>
                {r.users.list.map(u => (
                  <tr key={u.email} className="border-t border-line">
                    <td className="px-5 py-2"><p>{u.name || u.email}</p><p className="text-xs text-ink3">{u.email}</p></td>
                    <td className="px-3 py-2 text-xs">{u.roles.join(", ")}</td>
                    <td className="px-3 py-2 text-xs">{u.active ? "Actif" : "Désactivé"}</td>
                    <td className="px-3 py-2 text-xs">{u.twoFactor ? "Oui" : "Non"}</td>
                    <td className="px-3 py-2 text-xs">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("fr-FR") : "Jamais"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
