"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

// Interfaces pour la clarté du code
interface Expense { 
  _id: string; 
  label: string; 
  category: string; 
  amount: number; 
  frequency: string; 
  nextDueDate: string; 
  treasuryAccountId: { label: string } | null; 
  isActive: boolean; 
}

interface TreasuryAccount {
  _id: string;
  label: string;
}

const CATEGORIES = ["loyer", "electricite", "eau", "internet", "telephone", "assurance", "abonnement", "salaire", "prestation", "maintenance", "fourniture", "transport", "autre"];
const FREQUENCIES = [["monthly", "Mensuelle"], ["quarterly", "Trimestrielle"], ["annual", "Annuelle"], ["weekly", "Hebdomadaire"], ["daily", "Quotidienne"]];

export default function RecurringExpensesPage() {
  // 1. Déclarations des hooks (Toujours au sommet du composant)
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<TreasuryAccount[]>([]); // Initialisé par défaut en tableau vide
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [form, setForm] = useState({
    label: "",
    category: "loyer",
    amount: 0,
    frequency: "monthly",
    startDate: new Date().toISOString().slice(0, 10),
    accountCode: "622000",
    treasuryAccountId: ""
  });

  const LIMIT = 20;

  // 2. Fonctions de chargement
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recurring-expenses?page=${page}&limit=${LIMIT}&isActive=true`, { credentials: "include" });
      const d = await res.json();
      setItems(d.data?.items || []);
      setTotal(d.data?.pagination?.total || 0);
      setMonthlyTotal(d.data?.monthlyTotal || 0);
    } catch (err) {
      console.error("Erreur chargement dépenses:", err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/treasury-accounts", { credentials: "include" });
      const d = await res.json();
      // On s'assure de toujours stocker un tableau pour éviter l'erreur .map()
      const rawData = d?.data || d;
      setAccounts(Array.isArray(rawData) ? rawData : []);
    } catch (err) {
      console.error("Erreur comptes trésorerie:", err);
      setAccounts([]);
    }
  }, []);

  // 3. Effets
  useEffect(() => {
    setMounted(true);
    load();
    loadAccounts();
  }, [load, loadAccounts]);

  // 4. Handlers
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const payload = { ...form };
    // Nettoyage de l'ID optionnel pour éviter les erreurs CastError MongoDB
    if (!payload.treasuryAccountId) delete (payload as any).treasuryAccountId;

    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const res = await fetch("/api/recurring-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setModalOpen(false);
        load();
        setForm(p => ({ ...p, label: "", amount: 0, treasuryAccountId: "" }));
      }
    } catch (err) {
      console.error("Erreur création:", err);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  const updateField = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));

  const columns: Column<Expense>[] = [
    { key: "label", label: "Libellé" },
    { key: "category", label: "Catégorie", render: (v) => <span className="text-xs bg-clay/10 text-moss px-2 py-0.5 rounded border border-clay/20 capitalize">{String(v)}</span> },
    { key: "amount", label: "Montant (XOF)", className: "text-right font-mono font-bold", render: (v) => Number(v).toLocaleString("fr-FR") },
    { key: "frequency", label: "Fréquence", render: (v) => FREQUENCIES.find(f => f[0] === v)?.[1] || String(v) },
    { key: "nextDueDate", label: "Échéance", render: (v) => new Date(String(v)).toLocaleDateString("fr-FR") },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink uppercase tracking-tighter">Dépenses récurrentes</h1>
          <p className="text-sm text-moss">Total estimé : <strong className="text-cedar">{monthlyTotal.toLocaleString("fr-FR")} XOF/mois</strong></p>
        </div>
        <button onClick={() => setModalOpen(true)} className="px-5 py-2.5 bg-cedar text-white rounded-xl text-sm font-bold shadow-md hover:bg-ink transition-all">
          + Nouvelle dépense
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-clay/20 shadow-sm overflow-hidden">
        <DataTable columns={columns} data={items} loading={loading} keyExtractor={e => e._id} emptyMessage="Aucune dépense planifiée" />
      </div>
      
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle dépense récurrente" size="lg">
        <form onSubmit={handleCreate} className="space-y-4 pt-4">
          <FormField label="Libellé" required>
            <input className={inputCls} value={form.label} onChange={e => updateField("label", e.target.value)} required />
          </FormField>
          
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Catégorie">
              <select className={selectCls} value={form.category} onChange={e => updateField("category", e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Fréquence" required>
              <select className={selectCls} value={form.frequency} onChange={e => updateField("frequency", e.target.value)}>
                {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Montant (XOF)" required>
              <input type="number" className={inputCls} value={form.amount} onChange={e => updateField("amount", Number(e.target.value))} required />
            </FormField>
            <FormField label="Date de début" required>
              <input type="date" className={inputCls} value={form.startDate} onChange={e => updateField("startDate", e.target.value)} required />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Compte de Trésorerie">
              <select className={selectCls} value={form.treasuryAccountId} onChange={e => updateField("treasuryAccountId", e.target.value)}>
                <option value="">-- Sélectionner (Optionnel) --</option>
                {/* Sécurité renforcée : vérification que accounts est un tableau avant .map */}
                {Array.isArray(accounts) && accounts.map(acc => (
                  <option key={acc._id} value={acc._id}>{acc.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Code OHADA">
              <input className={inputCls} value={form.accountCode} onChange={e => updateField("accountCode", e.target.value)} />
            </FormField>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-bold text-moss">Annuler</button>
            <button type="submit" disabled={saving} className="px-8 py-2.5 bg-cedar text-white rounded-xl text-sm font-bold disabled:opacity-50">
              {saving ? "Enregistrement..." : "Créer l'échéance"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}