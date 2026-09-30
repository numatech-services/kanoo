"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Link2, Unlink } from "lucide-react";
import { selectCls } from "@/components/ui/FormField";

interface Row { entryId: string; date: string; reference: string; label: string; account: string; debit: number; credit: number; thirdParty: string | null; thirdPartyId: string | null; isLettered: boolean; letterRef: string | null }
const fmt = (n: number) => n.toLocaleString("fr-FR");
async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }

/** Lettrage : rapprocher factures et règlements d'un compte de tiers, par sélection. */
export default function LettragePage() {
  const [account, setAccount] = useState("411");
  const [state, setState] = useState<"open" | "lettered">("open");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [party, setParty] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const d = await fetch(`/api/accounting-entries/lettrage?account=${account}&state=${state}`, { credentials: "include" }).then(r => r.json()).catch(() => null);
    setRows(d?.data ?? []); setSelected(new Set());
  }, [account, state]);
  useEffect(() => { load(); }, [load]);

  const parties = useMemo(() => [...new Map(rows.filter(r => r.thirdPartyId).map(r => [r.thirdPartyId!, r.thirdParty ?? "?"])).entries()], [rows]);
  const visible = rows.filter(r => !party || r.thirdPartyId === party);
  const sel = rows.filter(r => selected.has(r.entryId));
  const sumD = sel.reduce((s, r) => s + r.debit, 0), sumC = sel.reduce((s, r) => s + r.credit, 0);
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function letter() {
    const res = await fetch("/api/accounting-entries/lettrage", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, body: JSON.stringify({ entryIds: [...selected], account }) });
    const d = await res.json().catch(() => ({}));
    setMsg({ ok: res.ok, text: res.ok ? d.data.message : d.error });
    if (res.ok) load();
  }
  async function unletter(ref: string) {
    if (!confirm(`Délettrer ${ref} ?`)) return;
    const res = await fetch(`/api/accounting-entries/lettrage?ref=${encodeURIComponent(ref)}`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": await csrf() } });
    const d = await res.json().catch(() => ({}));
    setMsg({ ok: res.ok, text: res.ok ? d.data.message : d.error });
    if (res.ok) load();
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/accounting" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Comptabilité</Link>
        <h1 className="text-2xl font-bold text-ink mt-1">Lettrage</h1>
        <p className="text-sm text-ink2">Cochez les factures et les règlements d&apos;un même tiers : quand débits et crédits s&apos;équilibrent, lettrez-les.</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <select className={`${selectCls} w-auto`} value={account} onChange={e => setAccount(e.target.value)} aria-label="Compte">
          <option value="411">411 — Clients</option><option value="401">401 — Fournisseurs</option><option value="421">421 — Personnel</option>
          <option value="422">422 — Notes de frais</option><option value="43">43 — Organismes sociaux</option><option value="44">44 — État</option><option value="47">47 — Divers</option>
        </select>
        <select className={`${selectCls} w-auto`} value={state} onChange={e => setState(e.target.value as "open" | "lettered")} aria-label="État">
          <option value="open">Non lettrées</option><option value="lettered">Lettrées</option>
        </select>
        {parties.length > 0 && (
          <select className={`${selectCls} w-auto`} value={party} onChange={e => setParty(e.target.value)} aria-label="Tiers">
            <option value="">Tous les tiers</option>{parties.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        )}
      </div>
      {msg && <p className={`p-3 rounded-lg text-sm ${msg.ok ? "bg-pos-50 text-pos" : "bg-neg-50 text-neg"}`}>{msg.text}</p>}
      {state === "open" && (
        <div className="sticky top-0 z-10 bg-surface rounded-xl border border-line p-3 flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm">{selected.size} sélectionnée(s) · Débit <b className="font-mono">{fmt(sumD)}</b> · Crédit <b className="font-mono">{fmt(sumC)}</b> · Écart <b className={`font-mono ${sumD === sumC ? "text-pos" : "text-neg"}`}>{fmt(sumD - sumC)}</b></p>
          <button onClick={letter} disabled={selected.size < 2 || sumD !== sumC} className="px-4 h-9 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold disabled:opacity-50"><Link2 size={15} /> Lettrer</button>
        </div>
      )}
      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left">{state === "open" && <th />}<th>Date</th><th>Pièce</th><th>Libellé</th><th>Tiers</th><th className="text-right">Débit</th><th className="text-right">Crédit</th>{state === "lettered" && <th>Lettrage</th>}</tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={8} className="text-center text-ink3 py-8">Aucune ligne</td></tr>}
            {visible.map((r, i) => (
              <tr key={`${r.entryId}-${i}`} className={`border-t border-line ${selected.has(r.entryId) ? "bg-section-soft/40" : ""}`}>
                {state === "open" && <td><input type="checkbox" className="accent-section" checked={selected.has(r.entryId)} onChange={() => toggle(r.entryId)} aria-label={`Sélectionner ${r.reference}`} /></td>}
                <td className="text-xs whitespace-nowrap">{new Date(r.date).toLocaleDateString("fr-FR")}</td>
                <td className="font-mono text-xs">{r.reference}</td>
                <td className="text-xs">{r.label}</td>
                <td className="text-xs">{r.thirdParty ?? "—"}</td>
                <td className="text-right font-mono">{r.debit ? fmt(r.debit) : ""}</td>
                <td className="text-right font-mono">{r.credit ? fmt(r.credit) : ""}</td>
                {state === "lettered" && <td className="text-xs"><span className="font-mono">{r.letterRef}</span>{r.letterRef && <button onClick={() => unletter(r.letterRef!)} className="ml-2 text-ink3 hover:text-neg" title="Délettrer"><Unlink size={13} /></button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
