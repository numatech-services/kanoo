"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
interface Tenant { _id:string; name:string; type:string; plan:string; subscriptionStatus:string; email?:string; phone?:string; address?:string; nif?:string; createdAt:string; trialEndsAt?:string; activatedAt?:string; }
export default function TenantDetailPage() {
  const params = useParams();
  const [tenant, setTenant] = useState<Tenant|null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/superadmin/tenants/${params.id}`,{credentials:"include"}).then(r=>r.json()).then(d=>setTenant(d.data)).finally(()=>setLoading(false));
  },[params.id]);
  if (loading) return <div className="p-6"><div className="h-32 bg-white rounded-xl animate-pulse" /></div>;
  if (!tenant) return <div className="p-6 text-moss">Organisation introuvable</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><Link href="/saas/tenants" className="text-xs text-moss hover:text-ink">← Organisations</Link><h1 className="text-2xl font-bold text-ink mt-1">{tenant.name}</h1></div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600">Suspendre</button>
          <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Activer</button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-4">Informations</h2>
          {([["Type",tenant.type],["Plan",tenant.plan],["Statut",tenant.subscriptionStatus],["Email",tenant.email||"—"],["Téléphone",tenant.phone||"—"],["NIF",tenant.nif||"—"],["Créé le",new Date(tenant.createdAt).toLocaleDateString("fr-FR")]] as [string,string][]).map(([k,v])=>(
            <div key={k} className="flex justify-between py-2 border-b border-clay/10 last:border-0 text-sm"><span className="text-moss">{k}</span><span className="text-ink font-medium capitalize">{v}</span></div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-4">Abonnement</h2>
          {([["Période d'essai jusqu'au",tenant.trialEndsAt?new Date(tenant.trialEndsAt).toLocaleDateString("fr-FR"):"—"],["Activé le",tenant.activatedAt?new Date(tenant.activatedAt).toLocaleDateString("fr-FR"):"—"]] as [string,string][]).map(([k,v])=>(
            <div key={k} className="flex justify-between py-2 border-b border-clay/10 last:border-0 text-sm"><span className="text-moss">{k}</span><span className="text-ink font-medium">{v}</span></div>
          ))}
          <div className="mt-4 pt-4 border-t border-clay/20">
            <p className="text-xs text-moss mb-2">Changer de plan</p>
            <select className="w-full px-3 py-2 border border-clay/30 rounded-lg text-sm"><option>starter</option><option>pro</option><option>enterprise</option><option>asso_basic</option><option>asso_pro</option><option>admin</option></select>
          </div>
        </div>
      </div>
    </div>
  );
}
