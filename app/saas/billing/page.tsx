"use client";
import { useState, useEffect } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
interface BillingRow { _id:string; name:string; plan:string; subscriptionStatus:string; trialEndsAt?:string; subscriptionEndsAt?:string; }
export default function BillingPage() {
  const [tenants, setTenants] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/superadmin/tenants?limit=50&status=trial", {credentials:"include"}).then(r=>r.json()).then(d=>setTenants(d.data?.items||[])).finally(()=>setLoading(false));
  },[]);
  const columns: Column<BillingRow>[] = [
    { key:"name", label:"Organisation" },
    { key:"plan", label:"Plan", className:"text-xs text-cedar font-mono" },
    { key:"subscriptionStatus", label:"Statut", render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v==="active"?"bg-green-100 text-green-700":v==="trial"?"bg-amber-100 text-amber-700":"bg-red-100 text-red-600"}`}>{String(v)}</span> },
    { key:"trialEndsAt", label:"Fin essai", render:(v)=>v?new Date(String(v)).toLocaleDateString("fr-FR"):"—" },
    { key:"subscriptionEndsAt", label:"Fin abonnement", render:(v)=>v?new Date(String(v)).toLocaleDateString("fr-FR"):"—" },
    { key:"_id", label:"Actions", render:(_v,row)=>(
      <div className="flex gap-1">
        <button className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">Activer</button>
        <button className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600">Suspendre</button>
      </div>
    )},
  ];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">Facturation & Abonnements</h1>
      <div className="grid grid-cols-3 gap-4">
        {[{l:"Périodes d'essai",v:tenants.filter(t=>t.subscriptionStatus==="trial").length,c:"bg-amber-50 text-amber-700"},{l:"Actifs",v:tenants.filter(t=>t.subscriptionStatus==="active").length,c:"bg-green-50 text-green-700"},{l:"Suspendus",v:tenants.filter(t=>t.subscriptionStatus==="suspended").length,c:"bg-red-50 text-red-700"}].map(k=>(
          <div key={k.l} className="bg-white rounded-xl border border-clay/20 p-4"><p className="text-xs text-moss">{k.l}</p><p className={`text-3xl font-bold mt-1 ${k.c.split(" ")[1]}`}>{k.v}</p></div>
        ))}
      </div>
      <DataTable columns={columns} data={tenants} loading={loading} keyExtractor={t=>t._id} emptyMessage="Aucun tenant" />
    </div>
  );
}
