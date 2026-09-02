"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

interface PortailData {
  member: { firstName:string; lastName:string; code:string; membershipType:string; status:string; joinDate:string; };
  cotisations: Array<{ year:number; amount:number; paidAt?:string; receiptNumber:string; }>;
  cotisationsPaid: number;
  cotisationsPending: number;
  assemblees: Array<{ _id:string; title:string; type:string; date:string; location:string; }>;
}

export default function PortailAdherentPage() {
  const [data, setData] = useState<PortailData|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/portail/adherent", { credentials:"include" })
      .then(r => r.json())
      .then(d => {
        if (d.success) setData(d.data);
        else setError(d.error || "Session expirée");
      })
      .catch(() => setError("Connexion impossible"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-4">{[1,2,3].map(i=><div key={i} className="h-24 bg-white rounded-xl animate-pulse border border-clay/20"/>)}</div>;

  if (error) return (
    <div className="text-center py-20">
      <p className="text-2xl mb-4">🔒</p>
      <h1 className="text-xl font-bold text-ink mb-2">Accès requis</h1>
      <p className="text-moss mb-6">{error}</p>
      <Link href="/portail/adherent/connexion" className="px-6 py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink">Se connecter</Link>
    </div>
  );

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="bg-cedar text-white rounded-2xl p-6">
        <p className="text-white/60 text-sm">Espace adhérent</p>
        <h1 className="text-2xl font-bold mt-1">{data.member.firstName} {data.member.lastName}</h1>
        <p className="text-white/70 text-sm mt-0.5">{data.member.code} · {data.member.membershipType}</p>
        <div className="flex gap-3 mt-4">
          <Link href="/portail/adherent/cotisations" className="px-4 py-2 bg-white/15 rounded-lg text-sm hover:bg-white/25 transition-colors">Mes cotisations</Link>
          <Link href="/portail/adherent/documents" className="px-4 py-2 bg-white/15 rounded-lg text-sm hover:bg-white/25 transition-colors">Documents</Link>
        </div>
      </div>

      {/* Cotisations */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <p className="text-xs text-moss uppercase font-semibold mb-1">Cotisations payées</p>
          <p className="text-3xl font-bold text-green-700">{data.cotisationsPaid}</p>
        </div>
        <div className={`rounded-xl border p-5 ${data.cotisationsPending>0?"bg-amber-50 border-amber-200":"bg-white border-clay/20"}`}>
          <p className="text-xs text-moss uppercase font-semibold mb-1">En attente</p>
          <p className={`text-3xl font-bold ${data.cotisationsPending>0?"text-amber-600":"text-green-700"}`}>{data.cotisationsPending}</p>
        </div>
      </div>

      {/* Dernières cotisations */}
      <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
        <div className="px-5 py-4 border-b border-clay/10 flex justify-between items-center">
          <h2 className="font-semibold text-ink">Historique des cotisations</h2>
          <Link href="/portail/adherent/cotisations" className="text-xs text-cedar hover:underline">Voir tout →</Link>
        </div>
        {data.cotisations.slice(0,5).map(c => (
          <div key={c.receiptNumber} className="flex items-center justify-between px-5 py-3 border-b border-clay/10 last:border-0 text-sm">
            <div><p className="font-medium text-ink">Cotisation {c.year}</p><p className="text-xs text-moss font-mono">{c.receiptNumber}</p></div>
            <div className="text-right">
              <p className="font-mono font-bold">{c.amount.toLocaleString("fr-FR")} XOF</p>
              {c.paidAt
                ? <span className="text-xs text-green-700">✅ Payée le {new Date(c.paidAt).toLocaleDateString("fr-FR")}</span>
                : <span className="text-xs text-amber-600">⏳ En attente</span>
              }
            </div>
          </div>
        ))}
        {data.cotisations.length === 0 && <p className="text-moss text-center text-sm py-6">Aucune cotisation enregistrée</p>}
      </div>

      {/* Prochaines assemblées */}
      {data.assemblees.length > 0 && (
        <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
          <h2 className="font-semibold text-ink px-5 py-4 border-b border-clay/10">Prochaines assemblées</h2>
          {data.assemblees.map(a => (
            <div key={a._id} className="px-5 py-3 border-b border-clay/10 last:border-0">
              <p className="font-medium text-ink text-sm">{a.title}</p>
              <p className="text-xs text-moss mt-0.5">{new Date(a.date).toLocaleDateString("fr-FR")} · {a.location}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
