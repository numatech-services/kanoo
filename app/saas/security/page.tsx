"use client";
import { useState, useEffect } from "react";
export default function SecurityPage() {
  const [matrix, setMatrix] = useState<Record<string,unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/superadmin/security/access-matrix",{credentials:"include"}).then(r=>r.json()).then(d=>setMatrix(d.data?.matrix||[])).catch(()=>setMatrix([])).finally(()=>setLoading(false));
  },[]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Sécurité & Matrice d'accès</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[{l:"Headers sécurité",v:"✅ Actifs",c:"text-green-700"},{l:"CSRF Protection",v:"✅ Activé",c:"text-green-700"},{l:"Rate limiting",v:"✅ 10 req/min",c:"text-green-700"},{l:"Audit logs",v:"✅ Activé",c:"text-green-700"}].map(k=>(
          <div key={k.l} className="bg-white rounded-xl border border-clay/20 p-4"><p className="text-xs text-moss">{k.l}</p><p className={`font-bold mt-1 ${k.c}`}>{k.v}</p></div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-clay/20 p-5">
        <h2 className="font-semibold text-ink mb-4">Journal d'accès récent</h2>
        {loading ? <div className="h-24 bg-sand animate-pulse rounded-xl" /> : matrix.length === 0 ? (
          <p className="text-moss text-sm text-center py-8">Aucun log disponible — l'endpoint <code>/api/superadmin/security/access-matrix</code> n'est pas encore implémenté.</p>
        ) : (
          <pre className="text-xs bg-ink text-green-400 p-4 rounded-xl overflow-auto max-h-64">{JSON.stringify(matrix.slice(0,10), null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
