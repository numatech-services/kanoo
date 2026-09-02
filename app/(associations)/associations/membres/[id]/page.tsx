"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Member {
  _id: string; code: string; firstName: string; lastName: string;
  email?: string; phone?: string; membershipType: string; status: string; joinDate: string;
}
interface CodeStatus { hasCode: boolean; generatedAt?: string; sentAt?: string; }

const STATUS_COLORS: Record<string,string> = {
  active:"bg-green-100 text-green-700", inactive:"bg-gray-100 text-gray-500",
  suspended:"bg-amber-100 text-amber-700", expelled:"bg-red-100 text-red-600"
};
const STATUS_FR: Record<string,string> = { active:"Actif", inactive:"Inactif", suspended:"Suspendu", expelled:"Exclu" };

export default function MembreDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [member, setMember] = useState<Member|null>(null);
  const [codeStatus, setCodeStatus] = useState<CodeStatus|null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeResult, setCodeResult] = useState<{code:string;sentSMS:boolean;sentEmail:boolean}|null>(null);

  const load = useCallback(async () => {
    const [mRes, cRes] = await Promise.all([
      fetch(`/api/membres/${id}`, { credentials:"include" }),
      fetch(`/api/membres/${id}/access-code`, { credentials:"include" }),
    ]);
    const [mData, cData] = await Promise.all([mRes.json(), cRes.json()]);
    setMember(mData.data);
    setCodeStatus(cData.data);
    setLoading(false);
  }, [id]);
  useEffect(() => { setMounted(true); load(); }, [load]);

  async function handleGenerateCode() {
    setSendingCode(true); setCodeResult(null);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch(`/api/membres/${id}/access-code`, {
      method:"POST", headers:{"Content-Type":"application/json","x-csrf-token":csrfToken}, credentials:"include"
    });
    const d = await res.json();
    if (res.ok) { setCodeResult(d.data); load(); }
    setSendingCode(false);
  }

  if (!mounted) return null;
  if (loading) return <div className="space-y-4"><div className="h-8 w-48 bg-sand animate-pulse rounded-lg"/><div className="h-64 bg-white rounded-xl animate-pulse border border-clay/20"/></div>;
  if (!member) return <div className="text-moss p-6">Adhérent introuvable</div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <Link href="/associations/membres" className="text-xs text-moss hover:text-ink">← Adhérents</Link>
        <h1 className="text-2xl font-bold text-ink mt-1">{member.firstName} {member.lastName}</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="font-mono text-xs text-moss">{member.code}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[member.status]||""}`}>{STATUS_FR[member.status]||member.status}</span>
        </div>
      </div>

      {/* Informations */}
      <div className="bg-white rounded-xl border border-clay/20 p-5">
        <h2 className="font-semibold text-ink text-sm mb-4">Informations</h2>
        <dl className="space-y-2.5 text-sm">
          {[
            ["Type d'adhésion", member.membershipType],
            ["Date d'adhésion", new Date(member.joinDate).toLocaleDateString("fr-FR")],
            ["Email", member.email || "—"],
            ["Téléphone", member.phone || "—"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-1.5 border-b border-clay/10 last:border-0">
              <dt className="text-moss">{label}</dt>
              <dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Code d'accès portail */}
      <div className="bg-white rounded-xl border border-clay/20 p-5">
        <h2 className="font-semibold text-ink text-sm mb-1">Code d'accès — Portail adhérent</h2>
        <p className="text-xs text-moss mb-4">
          Permet à l'adhérent de se connecter sur <code className="bg-sand px-1 rounded">/portail/adherent</code> avec son email et ce code.
        </p>

        {codeStatus?.hasCode ? (
          <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl mb-3">
            <div>
              <p className="text-sm font-medium text-green-800">✅ Code actif</p>
              {codeStatus.generatedAt && <p className="text-xs text-green-600">Généré le {new Date(codeStatus.generatedAt).toLocaleDateString("fr-FR")}</p>}
              {codeStatus.sentAt && <p className="text-xs text-green-600">Envoyé le {new Date(codeStatus.sentAt).toLocaleDateString("fr-FR")}</p>}
            </div>
            <button onClick={handleGenerateCode} disabled={sendingCode}
              className="text-xs border border-green-300 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-100 disabled:opacity-60">
              {sendingCode ? "Génération…" : "Régénérer"}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-xl mb-3">
            <div>
              <p className="text-sm font-medium text-amber-800">⚠ Aucun code généré</p>
              <p className="text-xs text-amber-600">L'adhérent ne peut pas encore accéder au portail</p>
            </div>
            <button onClick={handleGenerateCode} disabled={sendingCode}
              className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-60">
              {sendingCode ? "Génération…" : "Générer le code"}
            </button>
          </div>
        )}

        {codeResult && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-sm font-semibold text-blue-800 mb-2">Code généré :</p>
            <div className="flex items-center gap-3 mb-3">
              <span className="font-mono text-2xl font-bold text-blue-900 tracking-widest bg-white px-4 py-2 rounded-lg border border-blue-200">{codeResult.code}</span>
              <button onClick={() => navigator.clipboard?.writeText(codeResult.code)}
                className="text-xs text-blue-600 hover:underline">Copier</button>
            </div>
            <div className="flex gap-4 text-xs">
              <span className={codeResult.sentSMS ? "text-green-700" : "text-gray-400"}>
                {codeResult.sentSMS ? "✅" : "○"} SMS {!member.phone && "(pas de téléphone)"}
              </span>
              <span className={codeResult.sentEmail ? "text-green-700" : "text-gray-400"}>
                {codeResult.sentEmail ? "✅" : "○"} Email {!member.email && "(pas d'email)"}
              </span>
            </div>
            <p className="text-xs text-blue-600 mt-2">Ce code ne sera plus affiché. Conservez-le si vous devez le communiquer manuellement.</p>
          </div>
        )}

        {!member.phone && !member.email && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            ⚠ Aucun email ni téléphone enregistré — le code ne pourra pas être envoyé automatiquement.
          </p>
        )}
      </div>
    </div>
  );
}
