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
  status?: string;
  treasuryAccountId?: { name?: string } | null;
}

export default function PaymentsPage() {
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      const res = await fetch(`/api/payments?${params}`, { credentials: "include" });
      if (!res.ok) {
        // On rend l'échec visible plutôt que d'afficher une page vide qui donne
        // l'impression que « rien ne s'ouvre » : accès refusé, session expirée…
        const d = await res.json().catch(() => ({}));
        setError(res.status === 403
          ? "Votre profil n'a pas accès aux paiements. Demandez le droit « Paiements » à un administrateur."
          : (d.error || "Impossible de charger les paiements. Réessayez."));
        setItems([]); setTotal(0);
        return;
      }
      const d = await res.json();
      setItems(d.data?.items || []);
      setTotal(d.data?.pagination?.total || 0);
    } catch {
      setError("Connexion impossible au serveur des paiements. Vérifiez votre réseau puis réessayez.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    setMounted(true);
    load();
  }, [load]);

  async function confirmPayment(id: string) {
    if (!confirm("Marquer ce paiement comme encaissé ? Il soldera la facture et impactera la comptabilité et la trésorerie.")) return;
    const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
    const res = await fetch(`/api/payments/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ status: "effective" }),
    });
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); alert(d.error || "Confirmation impossible."); }
  }

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
        return name ? name : <span className="text-ink2">—</span>;
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
      className: "font-mono font-bold text-pos text-right",
      render: (v) => `${Number(v).toLocaleString("fr-FR")} XOF` 
    },
    {
      key: "treasuryAccountId",
      label: "Compte",
      render: (v: any) => v?.name ? <span className="text-ink">{v.name}</span> : <span className="text-ink2 italic text-xs">Non imputé</span>
    },
    {
      key: "status",
      label: "État",
      render: (v, record: any) => v === "pending"
        ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-warn-50 text-warn border border-warn/25">En attente</span>
            <button onClick={() => confirmPayment(record._id)}
              className="text-[11px] font-semibold text-pos hover:underline">Marquer encaissé</button>
          </div>
        )
        : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-pos-50 text-pos border border-pos/25">Encaissé</span>
    },
    {
      key: "reference",
      label: "Réf / N° Chèque",
      render: (v) => v ? String(v) : <span className="text-ink2 italic text-xs">Aucune</span>
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Historique des Paiements</h1>
          <p className="text-sm text-ink2 mt-0.5">
            {total} encaissement{total > 1 ? "s" : ""} enregistré{total > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
          <span>{error}</span>
          <button onClick={load} className="shrink-0 px-3 h-8 rounded-lg border border-neg/40 text-neg text-xs font-semibold hover:bg-neg/10">
            Réessayer
          </button>
        </div>
      )}

      <div className="bg-surface rounded-2xl border border-line overflow-hidden shadow-sm">
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