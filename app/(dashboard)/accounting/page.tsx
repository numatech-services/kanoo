"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation"; 
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";

interface Entry { 
  _id: string; 
  journalCode: string; 
  entryDate: string; 
  reference: string; 
  label: string; 
  isLettered: boolean; 
  lines: Array<{accountCode: string; accountLabel: string; debit: number; credit: number}>; 
}

const JOURNALS = ["", "AC", "VT", "BQ", "CA", "OD", "AN", "EX"];
const JOURNAL_LABELS: Record<string, string> = { 
  AC: "Achats", VT: "Ventes", BQ: "Banque", CA: "Caisse", 
  OD: "Opérations Div.", AN: "À-nouveaux", EX: "Extourne" 
};

export default function AccountingPage() {
  const router = useRouter(); 
  const [mounted, setMounted] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0); 
  const [page, setPage] = useState(1); 
  const [loading, setLoading] = useState(true);
  const [journal, setJournal] = useState(""); 
  const [from, setFrom] = useState(""); 
  const [to, setTo] = useState("");
  const [lettered, setLettered] = useState(""); 
  const LIMIT = 30;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (journal) params.set("journal", journal);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (lettered) params.set("lettered", lettered);
    
    try {
      const res = await fetch(`/api/accounting-entries?${params}`, { credentials: "include" });
      const d = await res.json(); 
      setEntries(d.data?.items || []); 
      setTotal(d.data?.pagination?.total || 0);
    } catch (error) {
      console.error("Erreur de chargement des écritures:", error);
    } finally {
      setLoading(false);
    }
  }, [page, journal, from, to, lettered]);

  useEffect(() => { 
    setMounted(true); 
    load(); 
  }, [load]);

  if (!mounted) return null;

  const columns: Column<Entry>[] = [
    { 
      key: "entryDate", 
      label: "Date", 
      render: (v) => <span className="text-sm text-moss">{new Date(String(v)).toLocaleDateString("fr-FR")}</span> 
    },
    { 
      key: "journalCode", 
      label: "Journal", 
      render: (v) => <span className="font-mono text-xs bg-clay/20 px-2 py-0.5 rounded font-semibold">{String(v)}</span> 
    },
    { key: "reference", label: "Référence", className: "font-mono text-xs text-cedar" },
    { key: "label", label: "Libellé" },
    { 
      key: "lines", 
      label: "Débit (XOF)", 
      className: "text-right font-mono", 
      render: (v) => { 
        const lines = v as Entry["lines"]; 
        return (lines.reduce((s,l) => s + (l.debit || 0), 0)).toLocaleString("fr-FR"); 
      } 
    },
    { 
      key: "lines", 
      label: "Crédit (XOF)", 
      className: "text-right font-mono", 
      render: (v) => { 
        const lines = v as Entry["lines"]; 
        return (lines.reduce((s,l) => s + (l.credit || 0), 0)).toLocaleString("fr-FR"); 
      } 
    },
    { 
      key: "isLettered", 
      label: "Lettré", 
      render: (v) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${v ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {v ? "Oui" : "Non"}
        </span>
      ) 
    },
  ];

  const inp = "px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Comptabilité</h1>
          <p className="text-sm text-moss mt-0.5">{total} écriture{total > 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <Link 
            href="/accounting/lettrage" 
            className="px-4 py-2 border border-cedar text-cedar rounded-lg text-sm hover:bg-cedar hover:text-white transition-colors"
          >
            Lettrage
          </Link>
          <button 
            type="button"
            onClick={() => router.push("/accounting/new")} 
            className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors"
          >
            + Saisie manuelle
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select 
          value={journal} 
          onChange={(e) => { setJournal(e.target.value); setPage(1); }} 
          className={inp}
        >
          <option value="">Tous les journaux</option>
          {JOURNALS.slice(1).map(j => <option key={j} value={j}>{j} — {JOURNAL_LABELS[j]}</option>)}
        </select>
        <input 
          type="date" 
          value={from} 
          onChange={(e) => { setFrom(e.target.value); setPage(1); }} 
          className={inp} 
          title="Du" 
        />
        <input 
          type="date" 
          value={to} 
          onChange={(e) => { setTo(e.target.value); setPage(1); }} 
          className={inp} 
          title="Au" 
        />
        <select 
          value={lettered} 
          onChange={(e) => { setLettered(e.target.value); setPage(1); }} 
          className={inp}
        >
          <option value="">Toutes les écritures</option>
          <option value="false">Non lettrées</option>
          <option value="true">Lettrées</option>
        </select>
      </div>

      <DataTable 
        columns={columns} 
        data={entries} 
        loading={loading} 
        keyExtractor={(e) => e._id} 
        emptyMessage="Aucune écriture comptable" 
      />
      
      <Pagination 
        page={page} 
        totalPages={Math.ceil(total / LIMIT)} 
        total={total} 
        limit={LIMIT} 
        onPage={setPage} 
      />
    </div>
  );
}