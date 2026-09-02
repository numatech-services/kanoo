"use client";
import { useState, useEffect } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
interface Ticket { _id:string; subject:string; priority:string; status:string; userId:string; createdAt:string; }
export default function SupportPage() {
  const [mounted, setMounted] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { setMounted(true); fetch("/api/support/tickets?limit=50",{credentials:"include"}).then(r=>r.json()).then(d=>setTickets(d.data?.items||[])).finally(()=>setLoading(false)); },[]);
  const PRIO:Record<string,string> = {low:"bg-gray-100 text-gray-600",medium:"bg-blue-100 text-blue-700",high:"bg-amber-100 text-amber-700",critical:"bg-red-100 text-red-700"};
  const columns: Column<Ticket>[] = [
    { key:"subject", label:"Sujet" },
    { key:"priority", label:"Priorité", render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIO[String(v)]||""}`}>{String(v)}</span> },
    { key:"status", label:"Statut", render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full ${v==="open"?"bg-green-100 text-green-700":v==="resolved"?"bg-gray-100 text-gray-500":"bg-amber-100 text-amber-700"}`}>{String(v)}</span> },
    { key:"createdAt", label:"Date", render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR") },
    { key:"_id", label:"", render:()=><button className="px-2 py-1 bg-cedar text-white text-xs rounded">Traiter</button> },
  ];
  if (!mounted) return null;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">Tickets support</h1>
      <DataTable columns={columns} data={tickets} loading={loading} keyExtractor={t=>t._id} emptyMessage="Aucun ticket" />
    </div>
  );
}
