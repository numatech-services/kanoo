"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ClientForm } from "@/components/pme/ClientForm";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface Client { _id:string; code:string; name:string; type:string; nif?:string; phone?:string; email?:string; address?:string; currentBalance:number; creditLimit:number; paymentTermDays:number; isActive:boolean; notes?:string; }
interface Invoice { _id:string; number:string; totalTTC:number; paidAmount:number; status:string; issueDate:string; dueDate:string; }

export default function ClientDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [client, setClient] = useState<Client|null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/clients/${id}`,{credentials:"include"}).then(r=>r.json()).then(d=>setClient(d.data));
    fetch(`/api/invoices?clientId=${id}&limit=10`,{credentials:"include"}).then(r=>r.json()).then(d=>setInvoices(d.data?.items||[]));
  },[id]);

  async function handleSave(data: Record<string, unknown>) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch(`/api/clients/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json","x-csrf-token":csrfToken}, credentials:"include", body: JSON.stringify(data) });
    const d = await res.json(); if (res.ok) { setClient(d.data); setEditOpen(false); }
  }

  if (!client) return <div className="p-6"><div className="h-48 bg-white rounded-xl animate-pulse border border-clay/20" /></div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div><a href="/clients" className="text-xs text-moss hover:text-ink">← Clients</a><h1 className="text-2xl font-bold text-ink mt-1">{client.name}</h1><p className="text-moss text-sm">{client.code} · {client.type === "company" ? "Entreprise" : "Particulier"}</p></div>
        <div className="flex gap-2 mt-2">
          <button onClick={()=>setEditOpen(true)} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Modifier</button>
          <a href={`/invoices/new?clientId=${id}`} className="px-4 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink">+ Facture</a>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-4">Informations</h2>
          {([["NIF",client.nif||"—"],["Email",client.email||"—"],["Téléphone",client.phone||"—"],["Adresse",client.address||"—"],["Statut",""]] as [string,string][]).map(([k,v])=>(
            <div key={k} className="flex justify-between py-2 border-b border-clay/10 last:border-0 text-sm">
              <span className="text-moss">{k}</span>
              {k==="Statut" ? <StatusBadge status={client.isActive?"active":"inactive"}/> : <span className="text-ink">{v}</span>}
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-4">Conditions commerciales</h2>
          {([["Solde actuel",`${client.currentBalance.toLocaleString("fr-FR")} XOF`],["Limite de crédit",`${client.creditLimit.toLocaleString("fr-FR")} XOF`],["Délai de paiement",`${client.paymentTermDays} jours`]] as [string,string][]).map(([k,v])=>(
            <div key={k} className="flex justify-between py-2 border-b border-clay/10 last:border-0 text-sm"><span className="text-moss">{k}</span><span className="font-mono font-medium text-ink">{v}</span></div>
          ))}
        </div>
      </div>
      {invoices.length > 0 && (
        <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
          <div className="flex justify-between items-center px-5 py-4 border-b border-clay/10"><h2 className="font-semibold text-ink">Factures récentes</h2><a href={`/invoices?clientId=${id}`} className="text-xs text-cedar hover:underline">Voir tout</a></div>
          <table className="w-full text-sm">
            <thead><tr className="bg-sand/50">{["N° Facture","Date","Montant TTC","Statut"].map(h=><th key={h} className="px-4 py-2 text-left text-xs font-semibold text-moss uppercase">{h}</th>)}</tr></thead>
            <tbody>{invoices.map(inv=><tr key={inv._id} className="border-t border-clay/10 hover:bg-sand/30 cursor-pointer" onClick={()=>router.push(`/invoices/${inv._id}`)}>
              <td className="px-4 py-3 font-mono text-cedar">{inv.number}</td>
              <td className="px-4 py-3 text-moss">{new Date(inv.issueDate).toLocaleDateString("fr-FR")}</td>
              <td className="px-4 py-3 font-mono text-right">{inv.totalTTC.toLocaleString("fr-FR")} XOF</td>
              <td className="px-4 py-3"><StatusBadge status={inv.status}/></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <Modal open={editOpen} onClose={()=>setEditOpen(false)} title={`Modifier — ${client.name}`} size="lg">
        <ClientForm initial={client} onSave={handleSave} onCancel={()=>setEditOpen(false)} />
      </Modal>
    </div>
  );
}
