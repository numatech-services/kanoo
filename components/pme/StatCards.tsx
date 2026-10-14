// Server Component — lit directement la DB (pas de fetch)
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { getServerAccess } from "@/lib/server-auth";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { EmployeeModel } from "@/models/Employee";
import { KpiCard } from "@/components/ui/KpiCard";
import { TrendingUp, AlertTriangle, CreditCard, Users } from "lucide-react";

import { BOOKED_INVOICE_MATCH } from "@/lib/payments";
interface Stats {
  caTotal: number;
  overdue: number;
  encaisseMonth: number;
  encaissePrevMonth: number;
  employees: number;
  /** Encaissements des six derniers mois, du plus ancien au plus récent. */
  paymentTrend: number[];
  /** Facturation mensuelle de l'exercice, pour la micro-courbe du CA. */
  invoiceTrend: number[];
}

interface Allowed { invoices: boolean; payments: boolean; employees: boolean }

async function getStats(allowed: Allowed, tenantId: string): Promise<Stats | null> {
  try {

    await connectDB();

    // ObjectId, pas la chaîne du jeton : un pipeline aggregate ne caste
    // pas, et un tenantId en chaîne n'y matche aucun document.
    const tf = { tenantId: new Types.ObjectId(tenantId) };
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfTrend = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [invoicesStats, overdueCount, paymentsThisMonth, paymentsPrevMonth,
           activeEmployees, paymentsByMonth, invoicesByMonth] = await Promise.all([
      // CA net des avoirs : un avoir vit dans la même collection avec des
      // montants positifs, il faut donc lui donner son signe.
      // Chaque requête n'est lancée que si le rôle peut lire la donnée : on ne
      // calcule pas ce qu'on n'affichera pas.
      !allowed.invoices ? [] : InvoiceModel.aggregate([
        { $match: { ...tf, issueDate: { $gte: startOfYear }, ...BOOKED_INVOICE_MATCH } },
        { $addFields: { sign: { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] } } },
        { $group: { _id: null, total: { $sum: { $multiply: ["$totalTTC", "$sign"] } } } },
      ]),
      !allowed.invoices ? 0 : InvoiceModel.countDocuments({
        ...tf, documentType: { $ne: "credit_note" },
        // Même définition que la liste « En retard » et la pastille du menu.
        status: { $in: ["sent", "partial", "overdue"] }, dueDate: { $lt: now },
      }),
      !allowed.payments ? [] : PaymentModel.aggregate([
        { $match: { ...tf, date: { $gte: startOfMonth }, status: { $nin: ["pending", "cancelled"] } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      // Le mois précédent sert de base de comparaison : sans lui, la carte
      // afficherait une variation inventée plutôt qu'aucune variation.
      !allowed.payments ? [] : PaymentModel.aggregate([
        { $match: { ...tf, date: { $gte: startOfPrevMonth, $lt: startOfMonth }, status: { $nin: ["pending", "cancelled"] } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      !allowed.employees ? 0 : EmployeeModel.countDocuments({ ...tf, isActive: true }),
      !allowed.payments ? [] : PaymentModel.aggregate([
        { $match: { ...tf, date: { $gte: startOfTrend } } },
        { $group: { _id: { y: { $year: "$date" }, m: { $month: "$date" } }, total: { $sum: "$amount" } } },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]),
      !allowed.invoices ? [] : InvoiceModel.aggregate([
        { $match: { ...tf, issueDate: { $gte: startOfYear }, ...BOOKED_INVOICE_MATCH } },
        { $addFields: { sign: { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] } } },
        { $group: {
          _id: { m: { $month: "$issueDate" } },
          total: { $sum: { $multiply: ["$totalTTC", "$sign"] } },
        } },
        { $sort: { "_id.m": 1 } },
      ]),
    ]);

    // Les mois sans mouvement doivent valoir zéro et non disparaître : une
    // courbe qui saute un mois creux décrit une tendance qui n'existe pas.
    const trend: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const found = (paymentsByMonth as Array<{ _id: { y: number; m: number }; total: number }>)
        .find(x => x._id.y === d.getFullYear() && x._id.m === d.getMonth() + 1);
      trend.push(found?.total ?? 0);
    }

    const invoiceTrend = Array.from({ length: now.getMonth() + 1 }, (_, i) => {
      const found = (invoicesByMonth as Array<{ _id: { m: number }; total: number }>)
        .find(x => x._id.m === i + 1);
      return found?.total ?? 0;
    });

    return {
      caTotal: invoicesStats[0]?.total || 0,
      overdue: overdueCount,
      encaisseMonth: paymentsThisMonth[0]?.total || 0,
      encaissePrevMonth: paymentsPrevMonth[0]?.total || 0,
      employees: activeEmployees,
      paymentTrend: trend,
      invoiceTrend,
    };
  } catch {
    return null;
  }
}

export async function StatCards() {
  const access = await getServerAccess();
  if (!access) return null;
  const allowed: Allowed = {
    invoices: access.can("invoices"), payments: access.can("payments"), employees: access.can("employees"),
  };
  // Rôle sans aucune de ces données (gestionnaire The Spot, opérateur ISIC…) :
  // pas de bloc du tout plutôt que des cartes vides ou, pire, des chiffres.
  if (!allowed.invoices && !allowed.payments && !allowed.employees) return null;
  const stats = await getStats(allowed, access.auth.tenantId);

  if (!stats) {
    return (
      <div className="p-4 bg-warn-50 border border-warn/25 rounded-xl text-sm text-warn">
        Indicateurs indisponibles. Aucun chiffre n&apos;est affiché plutôt qu&apos;une valeur par défaut.
      </div>
    );
  }

  // La variation n'est calculée que si le mois précédent a un montant : une
  // division par zéro produirait un « +100 % » qui ne veut rien dire.
  const delta = stats.encaissePrevMonth > 0
    ? ((stats.encaisseMonth - stats.encaissePrevMonth) / stats.encaissePrevMonth) * 100
    : undefined;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {allowed.invoices && <KpiCard
        label="Chiffre d'affaires — exercice"
        value={stats.caTotal}
        format="xof"
        icon={<TrendingUp size={17} />}
        tone="revenue"
        trend={stats.invoiceTrend}
        href="/invoices"
        hint="Factures émises depuis le 1er janvier"
      />}
      {allowed.invoices && <KpiCard
        label="Impayés en retard"
        value={stats.overdue}
        icon={<AlertTriangle size={17} />}
        tone={stats.overdue > 0 ? "neg" : "pos"}
        href="/invoices?overdue=true"
        hint={stats.overdue > 0 ? "Échéance dépassée" : "Aucun retard"}
      />}
      {allowed.payments && <KpiCard
        label="Encaissé ce mois"
        value={stats.encaisseMonth}
        format="xof"
        icon={<CreditCard size={17} />}
        tone="margin"
        delta={delta}
        deltaLabel="vs mois précédent"
        trend={stats.paymentTrend}
        href="/payments"
        hint="Pas d'encaissement le mois dernier"
      />}
      {allowed.employees && <KpiCard
        label="Collaborateurs actifs"
        value={stats.employees}
        icon={<Users size={17} />}
        tone="parties"
        href="/employees"
        hint="Contrats en cours"
      />}
    </div>
  );
}
