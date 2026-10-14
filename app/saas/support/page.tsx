"use client";
import { useState, useEffect } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { buttonClass } from "@/components/ui/button-class";
interface Ticket { _id:string; subject:string; priority:string; status:string; userId:string; createdAt:string; }
export default function SupportPage() {
  const [mounted, setMounted] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { setMounted(true); fetch("/api/support/tickets?limit=50",{credentials:"include"}).then(r=>r.json()).then(d=>setTickets(d.data?.items||[])).finally(()=>setLoading(false)); },[]);
  const PRIO:Record<string,string> = {low:"bg-surface2 text-ink2",medium:"bg-info-50 text-info",high:"bg-warn-50 text-warn",critical:"bg-neg-50 text-neg"};
  const columns: Column<Ticket>[] = [
    { key:"subject", label:"Sujet" },
    { key:"priority", label:"Priorité", render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIO[String(v)]||""}`}>{String(v)}</span> },
    { key:"status", label:"Statut", render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full ${v==="open"?"bg-pos-50 text-pos":v==="resolved"?"bg-surface2 text-ink3":"bg-warn-50 text-warn"}`}>{String(v)}</span> },
    { key:"createdAt", label:"Date", render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR") },
    { key:"_id", label:"", render:()=><button className={buttonClass("primary", "sm")}>Traiter</button> },
  ];
  if (!mounted) return null;
  return (
    <div className="space-y-5">
      <h1 className="page-title">Tickets support</h1>
      <DataTable columns={columns} data={tickets} loading={loading} keyExtractor={t=>t._id} emptyMessage="Aucun ticket" />
    </div>
  );
}
