// Server Component — lit directement la DB (pas de fetch)
import { connectDB } from "@/lib/db";
import { getServerAuth } from "@/lib/server-auth";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { EmployeeModel } from "@/models/Employee";
import { KpiCard } from "@/components/ui/KpiCard";
import { fullXof } from "@/components/ui/charts/geometry";
import { TrendingUp, AlertTriangle, CreditCard, Users } from "lucide-react";

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

async function getStats(): Promise<Stats | null> {
  try {
    const auth = await getServerAuth();
    if (!auth) return null;

    await connectDB();

    const tf = { tenantId: auth.tenantId };
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfTrend = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [invoicesStats, overdueCount, paymentsThisMonth, paymentsPrevMonth,
           activeEmployees, paymentsByMonth, invoicesByMonth] = await Promise.all([
      InvoiceModel.aggregate([
        { $match: { ...tf, issueDate: { $gte: startOfYear }, status: { $ne: "cancelled" } } },
        { $group: { _id: null, total: { $sum: "$totalTTC" } } },
      ]),
      InvoiceModel.countDocuments({
        ...tf, status: { $in: ["sent", "partial"] }, dueDate: { $lt: now },
      }),
      PaymentModel.aggregate([
        { $match: { ...tf, date: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      // Le mois précédent sert de base de comparaison : sans lui, la carte
      // afficherait une variation inventée plutôt qu'aucune variation.
      PaymentModel.aggregate([
        { $match: { ...tf, date: { $gte: startOfPrevMonth, $lt: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      EmployeeModel.countDocuments({ ...tf, isActive: true }),
      PaymentModel.aggregate([
        { $match: { ...tf, date: { $gte: startOfTrend } } },
        { $group: { _id: { y: { $year: "$date" }, m: { $month: "$date" } }, total: { $sum: "$amount" } } },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]),
      InvoiceModel.aggregate([
        { $match: { ...tf, issueDate: { $gte: startOfYear }, status: { $ne: "cancelled" } } },
        { $group: { _id: { m: { $month: "$issueDate" } }, total: { $sum: "$totalTTC" } } },
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
  const stats = await getStats();

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
      <KpiCard
        label="Chiffre d'affaires — exercice"
        value={stats.caTotal}
        format={fullXof}
        icon={<TrendingUp size={17} />}
        trend={stats.invoiceTrend}
        href="/invoices"
        hint="Factures émises depuis le 1er janvier"
      />
      <KpiCard
        label="Impayés en retard"
        value={stats.overdue}
        icon={<AlertTriangle size={17} />}
        tone={stats.overdue > 0 ? "neg" : "pos"}
        href="/invoices?overdue=true"
        hint={stats.overdue > 0 ? "Échéance dépassée" : "Aucun retard"}
      />
      <KpiCard
        label="Encaissé ce mois"
        value={stats.encaisseMonth}
        format={fullXof}
        icon={<CreditCard size={17} />}
        tone="info"
        delta={delta}
        deltaLabel="vs mois précédent"
        trend={stats.paymentTrend}
        href="/payments"
        hint="Pas d'encaissement le mois dernier"
      />
      <KpiCard
        label="Collaborateurs actifs"
        value={stats.employees}
        icon={<Users size={17} />}
        tone="section"
        href="/employees"
        hint="Contrats en cours"
      />
    </div>
  );
}
