import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { EasypayNetworkFactModel, EasypayNetworkDayModel, EasypayNetworkEventModel } from "@/models/EasypayNetwork";
import { ApiKeyModel } from "@/models/ApiKey";
import { NETWORK_SITE } from "@/lib/easypay-network";

export const dynamic = "force-dynamic";

type F = { kind: string; objectId: string; businessDate: string; state: string; agentRef?: string; partnerId?: string; partnerName?: string; partnerType?: string; objectType?: string;
  amount: number; chargeAmount: number; commissionAmount: number; partnerAmount: number; toSettleAmount: number };

/** GET ?month=AAAA-MM — synthèse de la liaison réseau EasyPay (agents, partenaires, bilans du jour). Gérant et comptabilité. */
export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!hasFinanceAccess(auth)) return forbidden("Réservé au gérant et à la comptabilité.");
  await connectDB();
  const month = new URL(req.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest("Mois invalide (AAAA-MM).");
  const tid = new Types.ObjectId(auth.tenantId);
  const end = `${month}-31`;
  const [facts, agentRows, partnerDue, days, key, first] = await Promise.all([
    EasypayNetworkFactModel.find({ tenantId: tid, businessDate: { $regex: `^${month}` } }).select("-eventIds").lean<F[]>(),
    // Encours des agents jusqu'à la fin du mois, calculés par la base (état actuel des rapprochements).
    EasypayNetworkFactModel.aggregate<{ _id: string; topups: number; remittances: number; pending: number }>([
      { $match: { tenantId: tid, kind: { $in: ["agent_topup", "agent_remittance"] }, businessDate: { $lte: end }, agentRef: { $type: "string", $ne: "" } } },
      { $group: { _id: "$agentRef",
        topups: { $sum: { $cond: [{ $eq: ["$kind", "agent_topup"] }, "$amount", 0] } },
        remittances: { $sum: { $cond: [{ $eq: ["$kind", "agent_remittance"] }, "$amount", 0] } },
        pending: { $sum: { $cond: [{ $and: [{ $eq: ["$kind", "agent_remittance"] }, { $ne: ["$state", "reconciled"] }] }, "$amount", 0] } } } },
    ]),
    EasypayNetworkFactModel.aggregate<{ _id: string; toSettle: number }>([
      { $match: { tenantId: tid, kind: "partner_earning", businessDate: { $lte: end }, toSettleAmount: { $gt: 0 } } },
      { $group: { _id: "$partnerId", toSettle: { $sum: "$toSettleAmount" } } },
    ]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bilan du jour tel que reçu (contrat §13.7)
    EasypayNetworkDayModel.find({ tenantId: tid, businessDate: { $regex: `^${month}` } }).sort({ businessDate: 1 }).select("businessDate revision matches data").lean<Array<{ businessDate: string; revision: number; matches?: boolean | null; data?: Record<string, any> }>>(),
    ApiKeyModel.findOne({ tenantId: tid, easypaySite: NETWORK_SITE, isActive: true, deskId: { $exists: false } }).select("_id name handshakeAt lastSequence lastUsedAt").lean<{ _id: Types.ObjectId; name: string; handshakeAt?: Date; lastSequence?: number; lastUsedAt?: Date } | null>(),
    EasypayNetworkFactModel.findOne({ tenantId: tid }).sort({ businessDate: 1 }).select("businessDate").lean<{ businessDate: string } | null>(),
  ]);
  const of = (k: string) => facts.filter(f => f.kind === k);
  const sum = (xs: F[], f: keyof F) => xs.reduce((t, x) => t + (Number(x[f]) || 0), 0);
  const topups = of("agent_topup"), rem = of("agent_remittance"), earn = of("partner_earning"), pay = of("partner_payout");

  const partners = new Map<string, { partnerId: string; name: string; type: string; base: number; commission: number; partnerPart: number; payouts: number; toSettle: number }>();
  const P = (id: string, f?: F) => { const k = id || "?"; const p = partners.get(k) ?? { partnerId: k, name: f?.partnerName || k, type: f?.partnerType || "", base: 0, commission: 0, partnerPart: 0, payouts: 0, toSettle: 0 }; partners.set(k, p); return p; };
  for (const f of earn) { const p = P(f.partnerId ?? "", f); p.base += f.amount; p.commission += f.commissionAmount; p.partnerPart += f.partnerAmount; }
  for (const f of pay) P(f.partnerId ?? "", f).payouts += f.amount;
  for (const r of partnerDue) { const known = partners.get(r._id); if (known) known.toSettle = r.toSettle; else P(r._id).toSettle = r.toSettle; }

  // Rapprochement par Kanoo : faits reçus de chaque jour comparés au bilan du jour d'EasyPay.
  const byDay = (k: string, d: string) => facts.filter(f => f.kind === k && f.businessDate === d);
  const dayChecks = days.map(d => {
    const b = d.data ?? {};
    const pairs: Array<[string, number, number, number, number]> = [
      ["recharges d'agents", byDay("agent_topup", d.businessDate).length, Number(b.agent_topups?.topups_count ?? 0), sum(byDay("agent_topup", d.businessDate), "amount"), Number(b.agent_topups?.amount ?? 0)],
      ["versements d'agents", byDay("agent_remittance", d.businessDate).length, Number(b.agent_remittances?.remittances_count ?? 0), sum(byDay("agent_remittance", d.businessDate), "amount"), Number(b.agent_remittances?.amount ?? 0)],
      ["commissions partenaires", byDay("partner_earning", d.businessDate).length, Number(b.partner_earnings?.earnings_count ?? 0), sum(byDay("partner_earning", d.businessDate), "amount"), Number(b.partner_earnings?.base_amount ?? 0)],
      ["reversements", byDay("partner_payout", d.businessDate).length, Number(b.partner_payouts?.payouts_count ?? 0), sum(byDay("partner_payout", d.businessDate), "amount"), Number(b.partner_payouts?.amount ?? 0)],
    ];
    const gaps = pairs.filter(([, kc, ec, ka, ea]) => kc !== ec || ka !== ea).map(([label, kc, ec, ka, ea]) => `${label} : Kanoo ${kc} / ${ka} F, EasyPay ${ec} / ${ea} F`);
    return { businessDate: d.businessDate, revision: d.revision, matches: d.matches ?? null, kanooMatches: gaps.length === 0, gaps };
  });
  // Rangs manquants dans la file reçue (événements mis de côté chez EasyPay, ou perdus).
  let missingSequences = 0;
  if (key?.lastSequence) {
    const seen = await EasypayNetworkEventModel.distinct("sequence", { tenantId: tid, keyId: key._id });
    missingSequences = Math.max(0, key.lastSequence - seen.length);
  }
  const last = [...days].reverse().find(d => Array.isArray(d.data?.partner_balances));
  return ok({
    month, firstFactDate: first?.businessDate ?? null, missingSequences,
    link: key ? { name: key.name, handshakeAt: key.handshakeAt ?? null, lastSequence: key.lastSequence ?? 0, lastUsedAt: key.lastUsedAt ?? null } : null,
    agentTopups: { count: topups.length, amount: sum(topups, "amount"), charges: sum(topups, "chargeAmount"), commissions: sum(topups, "commissionAmount") },
    agentRemittances: { count: rem.length, amount: sum(rem, "amount"), reconciled: sum(rem.filter(r => r.state === "reconciled"), "amount"), pendingCount: rem.filter(r => r.state !== "reconciled").length },
    partnerEarnings: { count: earn.length, base: sum(earn, "amount"), commission: sum(earn, "commissionAmount"), partnerPart: sum(earn, "partnerAmount") },
    partnerPayouts: { count: pay.length, amount: sum(pay, "amount") },
    agents: agentRows.map(a => ({ agentRef: a._id, topups: a.topups, remittances: a.remittances, pending: a.pending, outstanding: a.topups - a.remittances })).sort((a, b) => b.outstanding - a.outstanding),
    partners: [...partners.values()].sort((a, b) => b.commission - a.commission),
    partnerBalances: last?.data?.partner_balances ?? [],
    days: dayChecks,
  });
});
