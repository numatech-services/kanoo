"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { EmployeeForm } from "@/components/pme/EmployeeForm";

interface Employee {
  _id:string; code:string; firstName:string; lastName:string; position:string; department?:string;
  employeeType:string; contractNature:string;
  grossSalary:number; indemnity:number; indemnityPeriod:string;
  startDate:string; contractEndDate?:string; isActive:boolean;
}

const TYPE_LABELS: Record<string,string> = { employee:"Employé", intern:"Stagiaire", freelance:"Freelance" };
const TYPE_COLORS: Record<string,string> = { employee:"bg-blue-100 text-blue-700", intern:"bg-amber-100 text-amber-700", freelance:"bg-purple-100 text-purple-700" };
const CONTRACT_LABELS: Record<string,string> = { cdi:"CDI", cdd:"CDD", stage:"Stage", freelance:"Freelance", consultant:"Consultant" };

export default function EmployeesPage() {
  const [mounted, setMounted] = useState(false);
  const [employees,setEmployees]=useState<Employee[]>([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(1); const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState(""); const [searchInput,setSearchInput]=useState(""); const [employeeType,setEmployeeType]=useState("");
  const [alertCount,setAlertCount]=useState(0);
  const [modalOpen,setModalOpen]=useState(false); const [editing,setEditing]=useState<Employee|null>(null);
  const LIMIT=20;

  useEffect(()=>{const t=setTimeout(()=>{setSearch(searchInput);setPage(1);},400);return()=>clearTimeout(t);},[searchInput]);

  const load=useCallback(async()=>{
    setLoading(true);
    const params=new URLSearchParams({page:String(page),limit:String(LIMIT)});
    if(search) params.set("search",search);
    if(employeeType) params.set("employeeType",employeeType);
    const res=await fetch(`/api/employees?${params}`,{credentials:"include"});
    const d=await res.json(); setEmployees(d.data?.items||[]); setTotal(d.data?.pagination?.total||0); setAlertCount(d.data?.alertCount||0); setLoading(false);
  },[page,search,employeeType]);
  useEffect(()=>{setMounted(true);load();},[load]);

  async function handleSave(data: Record<string, unknown>) {
    const url = editing ? `/api/employees/${editing._id}` : "/api/employees";
    const csrfRes=await fetch("/api/auth/csrf"); const {csrfToken}=await csrfRes.json();
    const res=await fetch(url,{method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json","x-csrf-token":csrfToken},credentials:"include",body:JSON.stringify(data)});
    if(!res.ok){
      const d=await res.json().catch(()=>({}));
      // Remonter l'erreur au formulaire (il l'affiche) au lieu de fermer en silence.
      throw new Error((d as {error?:string}).error||"Enregistrement impossible");
    }
    setModalOpen(false); setEditing(null); await load();
  }

  const isExpiringSoon = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d > new Date() && d <= new Date(Date.now() + 30 * 86400000);
  };

  const columns: Column<Employee>[] = [
    {key:"code",label:"Code",className:"font-mono text-xs w-20"},
    {key:"lastName",label:"Nom complet",sortable:true,render:(_v,r)=><Link href={`/employees/${r._id}`} className="hover:underline font-medium">{r.firstName} {r.lastName}</Link>},
    {key:"employeeType",label:"Type",render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[String(v)]||""}`}>{TYPE_LABELS[String(v)]||String(v)}</span>},
    {key:"contractNature",label:"Contrat",render:(v)=><span className="text-xs text-moss">{CONTRACT_LABELS[String(v)]||String(v)}</span>},
    {key:"position",label:"Poste",sortable:true},
    {key:"grossSalary",label:"Rémunération (XOF)",className:"text-right font-mono",render:(v,r)=>{
      const amount = r.employeeType==="employee" ? r.grossSalary : r.indemnity;
      const label = r.employeeType==="employee" ? "brut" : r.indemnityPeriod==="monthly"?"mois":r.indemnityPeriod;
      return amount>0?`${amount.toLocaleString("fr-FR")} / ${label}`:"—";
    }},
    {key:"contractEndDate",label:"Fin de contrat",render:(v)=>{
      if(!v) return <span className="text-moss text-xs">CDI / Sans fin</span>;
      const expiring = isExpiringSoon(String(v));
      return <span className={`text-sm ${expiring?"text-amber-600 font-semibold":"text-moss"}`}>{new Date(String(v)).toLocaleDateString("fr-FR")}{expiring?" ⚠":""}</span>;
    }},
    {key:"isActive",label:"",render:(v)=><StatusBadge status={v?"active":"inactive"}/>},
  ];

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Ressources humaines</h1>
          <p className="text-sm text-moss mt-0.5">{total} collaborateur{total>1?"s":""}</p>
        </div>
        <button onClick={()=>{setEditing(null);setModalOpen(true);}} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Nouveau collaborateur</button>
      </div>

      {alertCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <span className="text-amber-600 font-bold">⚠</span>
          <p className="text-sm text-amber-800">{alertCount} contrat{alertCount>1?"s":""} expire{alertCount===1?"":"nt"} dans les 30 prochains jours.</p>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <input type="text" placeholder="Rechercher…" value={searchInput} onChange={e=>setSearchInput(e.target.value)} className="px-3 py-2 border border-clay/30 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-cedar/30"/>
        <select value={employeeType} onChange={e=>{setEmployeeType(e.target.value);setPage(1);}} className="px-3 py-2 border border-clay/30 rounded-lg text-sm">
          <option value="">Tous les types</option>
          <option value="employee">Employés</option>
          <option value="intern">Stagiaires</option>
          <option value="freelance">Freelances</option>
        </select>
      </div>

      <DataTable columns={columns} data={employees} loading={loading} keyExtractor={e=>e._id} emptyMessage="Aucun collaborateur" onRowClick={e=>{setEditing(e);setModalOpen(true);}}/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>

      <Modal open={modalOpen} onClose={()=>{setModalOpen(false);setEditing(null);}} title={editing?`${editing.firstName} ${editing.lastName}`:"Nouveau collaborateur"} size="xl">
        <EmployeeForm initial={editing||undefined} onSave={handleSave} onCancel={()=>{setModalOpen(false);setEditing(null);}}/>
      </Modal>
    </div>
  );
}
