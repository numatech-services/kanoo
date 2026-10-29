"use client";
import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { apiSend } from "@/lib/api-client";
import { PageLoading } from "@/components/ui/PageState";
interface Member {
  _id: string; code: string; firstName: string; lastName: string;
  email?: string; phone?: string; membershipType: string; status: string; joinDate: string;
}
interface CodeStatus { hasCode: boolean; generatedAt?: string; sentAt?: string; }

const STATUS_COLORS: Record<string,string> = {
  active:"bg-pos-50 text-pos", inactive:"bg-surface2 text-ink3",
  suspended:"bg-warn-50 text-warn", expelled:"bg-neg-50 text-neg"
};
const STATUS_FR: Record<string,string> = { active:"Actif", inactive:"Inactif", suspended:"Suspendu", expelled:"Exclu" };

// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};

export default function MembreDetailPage() {
  const { id } = useParams();
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [member, setMember] = useState<Member|null>(null);
  const [codeStatus, setCodeStatus] = useState<CodeStatus|null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeResult, setCodeResult] = useState<{code:string;sentSMS:boolean;sentEmail:boolean}|null>(null);

  // Relecture sans repasser par le squelette : l'état n'est mis à jour qu'à l'arrivée des réponses.
  const load = useCallback(() => Promise.all([
    fetch(`/api/membres/${id}`, { credentials:"include" }),
    fetch(`/api/membres/${id}/access-code`, { credentials:"include" }),
  ])
    .then(([mRes, cRes]) => Promise.all([mRes.json(), cRes.json()]))
    .then(([mData, cData]) => {
      setMember(mData.data);
      setCodeStatus(cData.data);
      setLoading(false);
    }), [id]);
  useEffect(() => { load(); }, [load]);

  async function handleGenerateCode() {
    setSendingCode(true); setCodeResult(null);
    const res = await apiSend("POST", `/api/membres/${id}/access-code`);
    const d = res.data;
    if (res.ok) { setCodeResult(d.data); load(); }
    setSendingCode(false);
  }

  if (!mounted) return <PageLoading />;
  if (loading) return <div className="space-y-4"><div className="h-8 w-48 bg-surface2 animate-pulse rounded-lg"/><div className="h-64 bg-surface rounded-xl animate-pulse border border-line"/></div>;
  if (!member) return <div className="text-ink2 p-6">Adhérent introuvable</div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <Link href="/associations/membres" className="text-xs text-ink2 hover:text-ink">← Adhérents</Link>
        <h1 className="page-title mt-1">{member.firstName} {member.lastName}</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="font-mono text-xs text-ink2">{member.code}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[member.status]||""}`}>{STATUS_FR[member.status]||member.status}</span>
        </div>
      </div>

      {/* Informations */}
      <div className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink text-sm mb-4">Informations</h2>
        <dl className="space-y-2.5 text-sm">
          {[
            ["Type d'adhésion", member.membershipType],
            ["Date d'adhésion", new Date(member.joinDate).toLocaleDateString("fr-FR")],
            ["Email", member.email || "—"],
            ["Téléphone", member.phone || "—"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-1.5 border-b border-line last:border-0">
              <dt className="text-ink2">{label}</dt>
              <dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Code d'accès portail */}
      <div className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink text-sm mb-1">Code d'accès — Portail adhérent</h2>
        <p className="text-xs text-ink2 mb-4">
          Permet à l'adhérent de se connecter sur <code className="bg-surface2 px-1 rounded">/portail/adherent</code> avec son email et ce code.
        </p>

        {codeStatus?.hasCode ? (
          <div className="flex items-center justify-between p-3 bg-pos-50 border border-pos/25 rounded-xl mb-3">
            <div>
              <p className="text-sm font-medium text-pos">Code actif</p>
              {codeStatus.generatedAt && <p className="text-xs text-pos">Généré le {new Date(codeStatus.generatedAt).toLocaleDateString("fr-FR")}</p>}
              {codeStatus.sentAt && <p className="text-xs text-pos">Envoyé le {new Date(codeStatus.sentAt).toLocaleDateString("fr-FR")}</p>}
            </div>
            <button onClick={handleGenerateCode} disabled={sendingCode}
              className="text-xs border border-pos/25 text-pos px-3 py-1.5 rounded-lg hover:bg-pos-50 disabled:opacity-60">
              {sendingCode ? "Génération…" : "Régénérer"}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 bg-warn-50 border border-warn/25 rounded-xl mb-3">
            <div>
              <p className="text-sm font-medium text-warn">Aucun code généré</p>
              <p className="text-xs text-warn">L'adhérent ne peut pas encore accéder au portail</p>
            </div>
            <button onClick={handleGenerateCode} disabled={sendingCode}
              className="text-xs bg-warn text-onink px-3 py-1.5 rounded-lg hover:bg-warn disabled:opacity-60">
              {sendingCode ? "Génération…" : "Générer le code"}
            </button>
          </div>
        )}

        {codeResult && (
          <div className="p-4 bg-info-50 border border-info/25 rounded-xl">
            <p className="text-sm font-semibold text-info mb-2">Code généré :</p>
            <div className="flex items-center gap-3 mb-3">
              <span className="font-mono text-2xl font-bold text-info tracking-widest bg-surface px-4 py-2 rounded-lg border border-info/25">{codeResult.code}</span>
              <button onClick={() => navigator.clipboard?.writeText(codeResult.code)}
                className="text-xs text-info hover:underline">Copier</button>
            </div>
            <div className="flex gap-4 text-xs">
              <span className={codeResult.sentSMS ? "text-pos" : "text-ink3"}>
                SMS : {codeResult.sentSMS ? "envoyé" : "non envoyé"} {!member.phone && "(pas de téléphone)"}
              </span>
              <span className={codeResult.sentEmail ? "text-pos" : "text-ink3"}>
                E-mail : {codeResult.sentEmail ? "envoyé" : "non envoyé"} {!member.email && "(pas d'e-mail)"}
              </span>
            </div>
            <p className="text-xs text-info mt-2">Ce code ne sera plus affiché. Conservez-le si vous devez le communiquer manuellement.</p>
          </div>
        )}

        {!member.phone && !member.email && (
          <p className="text-xs text-warn bg-warn-50 border border-warn/25 rounded-lg px-3 py-2 mt-2">
            Aucun email ni téléphone enregistré — le code ne pourra pas être envoyé automatiquement.
          </p>
        )}
      </div>
    </div>
  );
}
