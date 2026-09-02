"use client";
import { useState, useEffect } from "react";

interface Account { _id: string; type: string; label: string; balance: number; currency: string; isActive: boolean; }

const TYPE_ICONS: Record<string, string> = { bank: "🏦", cash: "💵", mobile_money: "📱" };
const TYPE_LABELS: Record<string, string> = { bank: "Banque", cash: "Caisse", mobile_money: "Mobile Money" };

export default function TreasuryPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [newAccount, setNewAccount] = useState({ label: "", type: "bank", balance: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/treasury-accounts", { credentials: "include" })
      .then(r => r.json()).then(d => setAccounts(d.data?.items || [])).finally(() => setLoading(false));
  }, []);

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/treasury-accounts", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify(newAccount) });
    const d = await res.json();
    if (res.ok) { setAccounts(a => [...a, d.data]); setModalOpen(false); }
    setSaving(false);
  }

  const inp = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const lbl = "block text-xs font-medium text-moss mb-1";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Trésorerie</h1><p className="text-sm text-moss mt-0.5">Solde total : <span className={`font-bold ${totalBalance >= 0 ? "text-green-700" : "text-red-600"}`}>{totalBalance.toLocaleString("fr-FR")} XOF</span></p></div>
        <button onClick={() => setModalOpen(true)} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors">+ Nouveau compte</button>
      </div>

      {loading ? <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[...Array(3)].map((_,i) => <div key={i} className="h-32 bg-white rounded-xl border border-clay/20 animate-pulse" />)}</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map(a => (
            <div key={a._id} className="bg-white rounded-xl border border-clay/20 p-5">
              <div className="flex items-start justify-between mb-3">
                <span className="text-2xl">{TYPE_ICONS[a.type] || "💰"}</span>
                <span className="text-xs text-moss bg-sand px-2 py-0.5 rounded-full">{TYPE_LABELS[a.type] || a.type}</span>
              </div>
              <p className="font-semibold text-ink">{a.label}</p>
              <p className={`text-2xl font-bold mt-2 font-mono ${a.balance >= 0 ? "text-green-700" : "text-red-600"}`}>{a.balance.toLocaleString("fr-FR")} <span className="text-sm font-normal text-moss">XOF</span></p>
            </div>
          ))}
          {accounts.length === 0 && <div className="col-span-3 text-center text-moss py-12">Aucun compte de trésorerie configuré</div>}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-ink mb-4">Nouveau compte</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div><label className={lbl}>Libellé *</label><input className={inp} value={newAccount.label} onChange={e => setNewAccount(p=>({...p,label:e.target.value}))} required /></div>
              <div><label className={lbl}>Type</label><select className={inp} value={newAccount.type} onChange={e => setNewAccount(p=>({...p,type:e.target.value}))}><option value="bank">Banque</option><option value="cash">Caisse</option><option value="mobile_money">Mobile Money</option></select></div>
              <div><label className={lbl}>Solde initial (XOF)</label><input type="number" className={inp} value={newAccount.balance} onChange={e => setNewAccount(p=>({...p,balance:Number(e.target.value)}))} /></div>
              <div className="flex justify-end gap-3 pt-2 border-t border-clay/20">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm border border-clay/30 rounded-lg text-moss hover:bg-sand">Annuler</button>
                <button type="submit" disabled={saving} className="px-5 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"Création…":"Créer"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
