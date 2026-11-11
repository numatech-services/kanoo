"use client";
import { useState } from "react";
import { Network } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { formatMoney } from "@/lib/format";

type R = {
  month: string; link: { name: string; handshakeAt: string | null; lastSequence: number; lastUsedAt: string | null } | null;
  agentTopups: { count: number; amount: number; charges: number; commissions: number };
  agentRemittances: { count: number; amount: number; reconciled: number; pendingCount: number };
  partnerEarnings: { count: number; base: number; commission: number; partnerPart: number };
  partnerPayouts: { count: number; amount: number };
  agents: Array<{ agentRef: string; topups: number; remittances: number; pending: number; outstanding: number }>;
  partners: Array<{ partnerId: string; name: string; type: string; base: number; commission: number; partnerPart: number; payouts: number; toSettle: number }>;
  partnerBalances: Array<{ partner?: { name?: string; type?: string }; due_to_date_amount?: number; paid_to_date_amount?: number; left_to_pay_amount?: number }>;
  days: Array<{ businessDate: string; revision: number; matches: boolean | null; kanooMatches: boolean; gaps: string[] }>;
  firstFactDate: string | null; missingSequences: number;
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="surface-card p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">{label}</p><p className="text-xl font-bold mt-1">{value}</p>{sub && <p className="text-[11px] text-ink3 mt-0.5">{sub}</p>}</div>;
}

/** Liaison réseau EasyPay : recharges et versements des agents, commissions et reversements des partenaires. */
export default function EasypayReseauPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const res = useApi<R | null>(`/api/easypay-reseau?month=${month}`, d => d?.data ?? null, null);
  const r = res.data;
  const bad = r?.days.filter(d => d.matches === false || !d.kanooMatches) ?? [];
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title inline-flex items-center gap-2"><Network size={22} /> EasyPay réseau</h1>
          <p className="text-sm text-ink2">Ce qu&apos;EasyPay envoie hors restaurants (contrat 1.1). Suivi de gestion : les écritures comptables restent à définir avec la comptable.</p>
        </div>
        <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="h-10 px-3 rounded-xl border border-line2 text-sm" aria-label="Mois" />
      </div>
      {!r ? (res.error ? <div className="surface-card p-4 text-sm text-neg">{res.error}</div> : <div className="surface-card h-40 animate-pulse" />) : (
        <>
          <div className="surface-card p-3 text-sm text-ink2">
            {r.link ? `Liaison « ${r.link.name} » : poignée de main ${r.link.handshakeAt ? `le ${new Date(r.link.handshakeAt).toLocaleString("fr-FR")}` : "non faite"}, dernier rang reçu ${r.link.lastSequence}.`
              : "Liaison réseau non établie : créez une clé avec le droit « easypay:network » et transmettez l'adresse …/api/v1/easypay et la clé à l'exploitant d'EasyPay."}
            {r.firstFactDate && <span> Premier fait reçu le {r.firstFactDate} : avant, l&apos;historique est incomplet tant que la période n&apos;a pas été renvoyée.</span>}
            {r.missingSequences > 0 && <span className="text-neg"> {r.missingSequences} rang(s) de la file jamais reçu(s) : demandez le renvoi à l&apos;exploitant d&apos;EasyPay.</span>}
            {bad.length > 0 && <span className="text-neg"> {bad.length} bilan(s) du jour non rapproché(s) : {bad.map(d => d.businessDate).join(", ")}.</span>}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Recharges par les agents" value={formatMoney(r.agentTopups.amount)} sub={`${r.agentTopups.count} recharge(s) ; frais ${formatMoney(r.agentTopups.charges)} ; commissions agents ${formatMoney(r.agentTopups.commissions)}`} />
            <Tile label="Versements des agents" value={formatMoney(r.agentRemittances.amount)} sub={`${r.agentRemittances.count} versement(s), ${r.agentRemittances.pendingCount} non rapproché(s)`} />
            <Tile label="Commissions EasyPay (partenaires)" value={formatMoney(r.partnerEarnings.commission)} sub={`sur ${formatMoney(r.partnerEarnings.base)} de commandes ; part des partenaires ${formatMoney(r.partnerEarnings.partnerPart)}`} />
            <Tile label="Reversements aux partenaires" value={formatMoney(r.partnerPayouts.amount)} sub={`${r.partnerPayouts.count} virement(s) (assureurs, télécom)`} />
          </div>
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="surface-card overflow-x-auto">
              <h2 className="font-semibold px-5 py-3 border-b border-line">Encours des agents (cumul jusqu&apos;à fin de mois, rapprochements à ce jour)</h2>
              <table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink2"><th className="px-5 py-2">Agent (pseudonyme)</th><th className="px-3 py-2 text-right">Recharges</th><th className="px-3 py-2 text-right">Versé</th><th className="px-3 py-2 text-right">Encours</th></tr></thead>
                <tbody>{r.agents.map(a => <tr key={a.agentRef} className="border-t border-line"><td className="px-5 py-2 font-mono text-xs">{a.agentRef}</td><td className="px-3 py-2 text-right">{formatMoney(a.topups)}</td><td className="px-3 py-2 text-right">{formatMoney(a.remittances)}{a.pending ? <span className="block text-[11px] text-warn">{formatMoney(a.pending)} à rapprocher</span> : null}</td><td className={`px-3 py-2 text-right font-semibold ${a.outstanding > 0 ? "text-warn" : ""}`}>{formatMoney(a.outstanding)}</td></tr>)}
                  {!r.agents.length && <tr><td colSpan={4} className="px-5 py-3 text-ink3">Aucune recharge d&apos;agent.</td></tr>}</tbody></table>
              <p className="text-[11px] text-ink3 px-5 py-2">Recharges − versements ; les retraits payés par un agent ne sont pas transmis : l&apos;encours réel peut être plus bas.</p>
            </div>
            <div className="surface-card overflow-x-auto">
              <h2 className="font-semibold px-5 py-3 border-b border-line">Partenaires du mois</h2>
              <table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink2"><th className="px-5 py-2">Partenaire</th><th className="px-3 py-2 text-right">Commission</th><th className="px-3 py-2 text-right">Part partenaire</th><th className="px-3 py-2 text-right">Reste dû à ce jour</th><th className="px-3 py-2 text-right">Reversé</th></tr></thead>
                <tbody>{r.partners.map(p => <tr key={p.partnerId} className="border-t border-line"><td className="px-5 py-2">{p.name}<span className="block text-[11px] text-ink3">{p.type}</span></td><td className="px-3 py-2 text-right">{formatMoney(p.commission)}</td><td className="px-3 py-2 text-right">{formatMoney(p.partnerPart)}</td><td className="px-3 py-2 text-right">{formatMoney(p.toSettle)}</td><td className="px-3 py-2 text-right">{formatMoney(p.payouts)}</td></tr>)}
                  {!r.partners.length && <tr><td colSpan={5} className="px-5 py-3 text-ink3">Aucune commission ni reversement.</td></tr>}</tbody></table>
            </div>
          </div>
          {r.partnerBalances.length > 0 && (
            <div className="surface-card overflow-x-auto">
              <h2 className="font-semibold px-5 py-3 border-b border-line">Assureurs et opérateur télécom (dernier bilan du mois)</h2>
              <table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink2"><th className="px-5 py-2">Partenaire</th><th className="px-3 py-2 text-right">Dû à date</th><th className="px-3 py-2 text-right">Versé</th><th className="px-3 py-2 text-right">Reste à verser</th></tr></thead>
                <tbody>{r.partnerBalances.map((b, i) => <tr key={i} className="border-t border-line"><td className="px-5 py-2">{b.partner?.name ?? "?"}</td><td className="px-3 py-2 text-right">{formatMoney(b.due_to_date_amount ?? 0)}</td><td className="px-3 py-2 text-right">{formatMoney(b.paid_to_date_amount ?? 0)}</td><td className="px-3 py-2 text-right font-semibold">{formatMoney(b.left_to_pay_amount ?? 0)}</td></tr>)}</tbody></table>
            </div>
          )}
          <div className="surface-card p-4 text-sm"><h2 className="font-semibold mb-2">Bilans du jour reçus</h2>
            {r.days.length ? <div className="flex flex-wrap gap-2">{r.days.map(d => <span key={d.businessDate} title={d.gaps.join("\n")} className={`text-xs px-2 py-1 rounded-full ${d.matches === false || !d.kanooMatches ? "bg-neg-50 text-neg" : "bg-pos-50 text-pos"}`}>{d.businessDate.slice(8)} (rév. {d.revision}){d.matches === false ? " — écart EasyPay" : ""}{!d.kanooMatches ? " — écart Kanoo" : ""}</span>)}</div> : <p className="text-ink3">Aucun bilan reçu ce mois.</p>}
            {r.days.some(d => !d.kanooMatches) && <ul className="mt-2 text-xs text-neg list-disc pl-5">{r.days.filter(d => !d.kanooMatches).flatMap(d => d.gaps.map(g => <li key={d.businessDate + g}>{d.businessDate} — {g}</li>))}</ul>}
          </div>
        </>
      )}
    </div>
  );
}
