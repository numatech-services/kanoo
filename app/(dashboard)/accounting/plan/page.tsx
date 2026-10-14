"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";
import { inputCls, selectCls } from "@/components/ui/FormField";
import { ACCOUNT_CLASS_LABEL } from "@/lib/syscohada";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { csrfToken as getCsrfToken, apiJson } from "@/lib/api-client";
interface Account { _id: string; code: string; label: string; accountClass: string; isActive: boolean; used: boolean }

/** Plan comptable : SYSCOHADA par défaut, comptes et sous-comptes ajoutés par l'organisation. */
export default function LedgerPlanPage() {
  const me = useMe();
  const canEdit = meCanDo(me, "ledgerAccounts", "update");
  const canCreate = meCanDo(me, "ledgerAccounts", "create");
  const canDelete = meCanDo(me, "ledgerAccounts", "delete");
  const [items, setItems] = useState<Account[]>([]);
  const [cls, setCls] = useState("");
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [add, setAdd] = useState({ code: "", label: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ all: String(showInactive) });
    if (cls) p.set("class", cls);
    if (q.trim()) p.set("q", q.trim());
    const d = await apiJson(`/api/ledger-accounts?${p}`).catch(() => null);
    setItems(d?.data ?? []);
  }, [cls, q, showInactive]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await getCsrfToken() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? null : { ok: false, text: d.error || "Opération refusée" });
    if (res.ok) load();
    return res.ok;
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <ScreenTabs group="accounting" />
      <div>
        <Link href="/accounting" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Comptabilité</Link>
        <h1 className="page-title mt-1">Plan comptable</h1>
        <p className="text-sm text-ink2">SYSCOHADA révisé. Les saisies manuelles n&apos;acceptent que les comptes actifs de ce plan.</p>
      </div>
      {msg && <p className="p-3 rounded-lg text-sm bg-neg-50 text-neg">{msg.text}</p>}
      {canCreate && (
        <form onSubmit={async e => { e.preventDefault(); if (await call("/api/ledger-accounts", "POST", add)) setAdd({ code: "", label: "" }); }} className="bg-surface rounded-xl border border-line p-4 flex gap-2 flex-wrap items-end">
          <label className="block"><span className="block text-xs text-ink2 mb-1">Numéro</span><input className={`${inputCls} w-36`} value={add.code} onChange={e => setAdd(a => ({ ...a, code: e.target.value.replace(/\D/g, "") }))} placeholder="Ex. 521100" /></label>
          <label className="block flex-1 min-w-[14rem]"><span className="block text-xs text-ink2 mb-1">Intitulé</span><input className={inputCls} value={add.label} onChange={e => setAdd(a => ({ ...a, label: e.target.value }))} placeholder="Ex. Banque BIA Niger" /></label>
          <button type="submit" className={buttonClass("primary", "md")}><Plus size={15} /> Ajouter</button>
        </form>
      )}
      <div className="flex gap-2 flex-wrap items-center">
        <label className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className={`${inputCls} pl-9`} placeholder="Numéro ou intitulé" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <select className={`${selectCls} w-auto`} value={cls} onChange={e => setCls(e.target.value)} aria-label="Classe">
          <option value="">Toutes les classes</option>{Object.entries(ACCOUNT_CLASS_LABEL).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink2"><input type="checkbox" className="accent-section" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Inactifs</label>
      </div>
      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left"><th className="w-28">Compte</th><th>Intitulé</th><th>Classe</th><th>Usage</th><th /></tr></thead>
          <tbody>
            {items.map(a => (
              <tr key={a._id} className={`border-t border-line ${a.isActive ? "" : "opacity-50"}`}>
                <td className="font-mono">{a.code}</td>
                <td>{canEdit ? (
                  <input defaultValue={a.label} className="w-full bg-transparent border-b border-transparent focus:border-line2 outline-none text-sm"
                    onBlur={e => e.target.value.trim() && e.target.value !== a.label && call(`/api/ledger-accounts/${a._id}`, "PATCH", { label: e.target.value })} aria-label={`Intitulé ${a.code}`} />
                ) : a.label}</td>
                <td className="text-xs text-ink2">{ACCOUNT_CLASS_LABEL[a.accountClass] ?? a.accountClass}</td>
                <td className="text-xs">{a.used ? <span className="text-pos">mouvementé</span> : <span className="text-ink3">—</span>}</td>
                <td className="text-right whitespace-nowrap">
                  {canEdit && <button onClick={() => call(`/api/ledger-accounts/${a._id}`, "PATCH", { isActive: !a.isActive })} className="px-2 h-7 rounded-md border border-line2 text-xs hover:bg-surface2">{a.isActive ? "Désactiver" : "Réactiver"}</button>}
                  {canDelete && !a.used && <button onClick={async () => { if (await confirmDialog({ title: `Supprimer le compte ${a.code} ?`, danger: true })) call(`/api/ledger-accounts/${a._id}`, "DELETE"); }} className="ml-1 p-1 text-ink3 hover:text-neg" title="Supprimer"><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
