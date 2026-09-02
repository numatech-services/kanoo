"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { EmployeeForm } from "@/components/pme/EmployeeForm";

interface Employee { _id:string; code:string; firstName:string; lastName:string; position:string; department?:string; employeeType:string; contractNature:string; grossSalary:number; indemnity:number; startDate:string; contractEndDate?:string; isActive:boolean; }

const TYPE_LABELS: Record<string,string> = { employee:"Agent", intern:"Stagiaire", freelance:"Prestataire" };
const TYPE_COLORS: Record<string,string> = { employee:"bg-blue-100 text-blue-700", intern:"bg-amber-100 text-amber-700", freelance:"bg-purple-100 text-purple-700" };

export default function PersonnelAdminPage() {
  const [mounted, setMounted] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [alertCount, setAlertCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false); const [editing, setEditing] = useState<Employee|null>(null);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/employees?page=${page}&limit=${LIMIT}`, { credentials:"include" });
    const d = await res.json();
    setEmployees(d.data?.items||[]); setTotal(d.data?.pagination?.total||0); setAlertCount(d.data?.alertCount||0);
    setLoading(false);
  }, [page]);
  useEffect(() => { setMounted(true); load(); }, [load]);

  // Remplace ta fonction handleSave actuelle (lignes 33 à 38) par celle-ci :

  async function handleSave(data: any) { // On utilise 'any' ici
    try {
      const url = editing ? `/api/employees/${editing._id}` : "/api/employees";
      const csrfRes = await fetch("/api/auth/csrf"); 
      const { csrfToken } = await csrfRes.json();
      
      const res = await fetch(url, { 
        method: editing ? "PATCH" : "POST", 
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken
        }, 
        credentials: "include", 
        body: JSON.stringify(data) 
      });

      if (res.ok) {
        setModalOpen(false); 
        setEditing(null); 
        load();
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Une erreur est survenue");
      }
    } catch (error) {
      console.error("Erreur lors de la sauvegarde:", error);
      alert("Erreur de connexion au serveur");
    }
  }

  if (!mounted) return null;

  const columns: Column<Employee>[] = [
    { key:"code", label:"Code", className:"font-mono text-xs w-20" },
    { key:"lastName", label:"Nom", sortable:true, render:(_v,r) => <Link href={`/administration/personnel/${r._id}`} className="hover:underline font-medium">{r.firstName} {r.lastName}</Link> },
    { key:"employeeType", label:"Type", render:(v) => <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[String(v)]||""}`}>{TYPE_LABELS[String(v)]||String(v)}</span> },
    { key:"position", label:"Poste" },
    { key:"grossSalary", label:"Rémunération (XOF)", className:"text-right font-mono", render:(v,r) => r.employeeType==="employee" ? Number(v).toLocaleString("fr-FR") : r.indemnity.toLocaleString("fr-FR") },
    { key:"contractEndDate", label:"Fin de contrat", render:(v) => {
      if (!v) return <span className="text-moss text-xs">CDI</span>;
      const expiring = new Date(String(v)) <= new Date(Date.now() + 30*86400000);
      return <span className={expiring?"text-amber-600 font-semibold text-sm":"text-moss text-sm"}>{new Date(String(v)).toLocaleDateString("fr-FR")}{expiring?" ⚠":""}</span>;
    }},
    { key:"isActive", label:"", render:(v) => <StatusBadge status={v?"active":"inactive"}/> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Gestion du personnel</h1>
          <p className="text-sm text-moss mt-0.5">{total} agent{total>1?"s":""} · Commune de Dosso</p>
        </div>
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Nouveau collaborateur</button>
      </div>

      {alertCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <span className="text-amber-600">⚠</span>
          <p className="text-sm text-amber-800">{alertCount} contrat{alertCount>1?"s":""} expire{alertCount===1?"":"nt"} dans les 30 prochains jours.</p>
        </div>
      )}

      <DataTable columns={columns} data={employees} loading={loading} keyExtractor={e=>e._id} emptyMessage="Aucun agent enregistré" onRowClick={e=>{setEditing(e);setModalOpen(true);}}/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={editing?`${editing.firstName} ${editing.lastName}`:"Nouveau collaborateur"} size="xl">
        <EmployeeForm initial={editing||undefined} onSave={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); }}/>
      </Modal>
    </div>
  );
}
