"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "next/navigation"; // Import correct pour Next.js 14+

interface Employee { _id: string; firstName: string; lastName: string; code: string; }
interface Payslip { _id: string; employeeId: { firstName: string; lastName: string; code: string } | string; month: number; year: number; grossSalary: number; cnssEmployee: number; cnssEmployer: number; netSalary: number; isPaid: boolean; }

const MONTHS = ["","Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

export default function PayslipsPage() {
  const router = useRouter(); // ✅ CORRECT : Au sommet du composant
  const [mounted, setMounted] = useState(false);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0); 
  const [page, setPage] = useState(1); 
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  
  const [genForm, setGenForm] = useState({ 
    employeeId: "", 
    month: new Date().getMonth() + 1, 
    year: new Date().getFullYear(), 
    grossSalary: 0, 
    otherDeductions: 0 
  });
  
  const [saving, setSaving] = useState(false); 
  const [genError, setGenError] = useState("");
  const LIMIT = 20;

  // Chargement des données
  const loadPayslips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      const res = await fetch(`/api/payslips?${params}`, { credentials: "include" });
      const d = await res.json(); 
      setPayslips(d.data?.items || []); 
      setTotal(d.data?.pagination?.total || 0);
    } catch (err) {
      console.error("Erreur chargement bulletins", err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadEmployees = async () => {
    try {
      const res = await fetch("/api/employees?limit=500", { credentials: "include" });
      const d = await res.json();
      setEmployees(d.data?.items || []);
    } catch (err) {
      console.error("Erreur chargement employés", err);
    }
  };

  useEffect(() => { 
    setMounted(true); 
    loadPayslips(); 
    loadEmployees();
  }, [loadPayslips]);

  const columns: Column<Payslip>[] = [
    { 
      key: "employeeId", 
      label: "Employé", 
      render: (v, row) => {
        const name = typeof v === "object" && v 
          ? `${(v as any).firstName} ${(v as any).lastName}` 
          : "—";
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/payslips/${row._id}`);
            }}
            className="text-cedar font-bold hover:underline text-left"
          >
            {name}
          </button>
        );
      } 
    },
    { key: "month", label: "Période", render: (v, row) => `${MONTHS[Number(v)]} ${row.year}` },
    { key: "grossSalary", label: "Brut (XOF)", className: "text-right font-mono", render: (v) => Number(v).toLocaleString("fr-FR") },
    { key: "cnssEmployee", label: "CNSS salarié", className: "text-right font-mono text-amber-700", render: (v) => `-${Number(v).toLocaleString("fr-FR")}` },
    { key: "cnssEmployer", label: "CNSS patronal", className: "text-right font-mono text-red-600", render: (v) => Number(v).toLocaleString("fr-FR") },
    { key: "netSalary", label: "Net (XOF)", className: "text-right font-mono font-bold text-green-700", render: (v) => Number(v).toLocaleString("fr-FR") },
    { 
      key: "isPaid", 
      label: "Payé", 
      render: (v, row) => (
        <button 
          onClick={() => router.push(`/payslips/${row._id}`)}
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${v ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}
        >
          {v ? "Oui" : "Non"}
        </button>
      ) 
    },
  ];

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault(); 
    if (!genForm.employeeId) return setGenError("Veuillez choisir un employé");
    setGenError(""); setSaving(true);
    try {
      const csrfRes = await fetch("/api/auth/csrf"); 
      const { csrfToken } = await csrfRes.json();
      const res = await fetch("/api/payslips", { 
        method: "POST", 
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, 
        credentials: "include", 
        body: JSON.stringify(genForm) 
      });
      if (!res.ok) { 
        const d = await res.json();
        setGenError(d.error || "Erreur lors de la génération"); 
        setSaving(false); return; 
      }
      setModalOpen(false); loadPayslips();
      setGenForm(p => ({ ...p, employeeId: "", grossSalary: 0 }));
    } catch { setGenError("Erreur réseau"); } finally { setSaving(false); }
  }

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Bulletins de paie</h1>
        <button onClick={() => setModalOpen(true)} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">
          + Générer un bulletin
        </button>
      </div>
      <div className="bg-white rounded-xl border border-clay/20 shadow-sm overflow-hidden">
        <DataTable columns={columns} data={payslips} loading={loading} keyExtractor={(p) => p._id} emptyMessage="Aucun bulletin généré" />
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau bulletin" size="md">
        <form onSubmit={handleGenerate} className="space-y-4">
          {genError && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">{genError}</div>}
          <label className="block text-xs font-medium text-moss">Sélectionner l'Employé *</label>
          <select 
            className="w-full px-3 py-2 border rounded-lg text-sm" 
            value={genForm.employeeId} 
            onChange={(e) => setGenForm(p=>({...p, employeeId: e.target.value}))} 
            required
          >
            <option value="">-- Choisir --</option>
            {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-4">
            <select className="px-3 py-2 border rounded-lg text-sm" value={genForm.month} onChange={(e) => setGenForm(p=>({...p, month: Number(e.target.value)}))}>
              {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" className="px-3 py-2 border rounded-lg text-sm" value={genForm.year} onChange={(e) => setGenForm(p=>({...p, year: Number(e.target.value)}))} />
          </div>
          <button type="submit" disabled={saving} className="w-full py-2 bg-cedar text-white rounded-lg text-sm font-bold">
            {saving ? "Génération..." : "Générer le bulletin"}
          </button>
        </form>
      </Modal>
    </div>
  );
}