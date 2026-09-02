"use client";

import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";

interface Payment {
  _id: string;
  invoiceId: { 
    number: string; 
    clientId?: { name: string } 
  } | null;
  amount: number;
  method: string;
  date: string;
  reference?: string;
}

export default function PaymentsPage() {
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      const res = await fetch(`/api/payments?${params}`, { credentials: "include" });
      const d = await res.json();
      
      setItems(d.data?.items || []);
      setTotal(d.data?.pagination?.total || 0);
    } catch (error) {
      console.error("Erreur chargement paiements:", error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    setMounted(true);
    load();
  }, [load]);

  if (!mounted) return null;

  const columns: Column<Payment>[] = [
    { 
      key: "date", 
      label: "Date", 
      render: (v) => new Date(String(v)).toLocaleDateString("fr-FR") 
    },
    { 
      key: "invoiceId", 
      label: "N° Facture", 
      render: (v) => (v && typeof v === "object") ? (v as any).number : "—" 
    },
    { 
      key: "clientId", 
      label: "Client", 
      className: "font-medium text-ink",
      // On va chercher le nom dans invoiceId -> clientId -> name
      render: (_, record: any) => {
        const name = record.invoiceId?.clientId?.name;
        return name ? name : <span className="text-moss">—</span>;
      }
    },
    { 
      key: "method", 
      label: "Méthode", 
      render: (v) => {
        const methodes: Record<string, string> = {
          "cash": "Espèces",
          "bank_transfer": "Virement",
          "check": "Chèque",
          "orange_money": "OM / Moov",
          "card": "Carte Bancaire"
        };
        return methodes[String(v).toLowerCase()] || String(v);
      }
    },
    { 
      key: "amount", 
      label: "Montant", 
      className: "font-mono font-bold text-green-700 text-right",
      render: (v) => `${Number(v).toLocaleString("fr-FR")} XOF` 
    },
    { 
      key: "reference", 
      label: "Réf / N° Chèque", 
      render: (v) => v ? String(v) : <span className="text-moss italic text-xs">Aucune</span> 
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Historique des Paiements</h1>
          <p className="text-sm text-moss mt-0.5">
            {total} encaissement{total > 1 ? "s" : ""} enregistré{total > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-clay/20 overflow-hidden shadow-sm">
        <DataTable 
          columns={columns} 
          data={items} 
          loading={loading} 
          keyExtractor={(d) => d._id} 
          emptyMessage="Aucun paiement trouvé dans l'historique"
        />
      </div>

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