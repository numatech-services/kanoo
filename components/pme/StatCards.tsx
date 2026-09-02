// Server Component — lit directement la DB (pas de fetch)
import { connectDB } from "@/lib/db";
import { getServerAuth } from "@/lib/server-auth";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { EmployeeModel } from "@/models/Employee";
import Link from "next/link";

async function getStats() {
  try {
    const auth = await getServerAuth();
    if (!auth) return null;

    await connectDB();

    const tf = { tenantId: auth.tenantId };
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [invoicesStats, overdueCount, paymentsThisMonth, activeEmployees] = await Promise.all([
      InvoiceModel.aggregate([
        { $match: { ...tf, issueDate: { $gte: startOfYear }, status: { $ne: "cancelled" } } },
        { $group: { _id: null, total: { $sum: "$totalTTC" }, paid: { $sum: "$paidAmount" }, count: { $sum: 1 } } },
      ]),
      InvoiceModel.countDocuments({
        ...tf,
        status: { $in: ["sent", "partial"] },
        dueDate: { $lt: now },
      }),
      PaymentModel.aggregate([
        { $match: { ...tf, date: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      EmployeeModel.countDocuments({ ...tf, isActive: true }),
    ]);

    const s = invoicesStats[0] || { total: 0, paid: 0, count: 0 };
    const encaisse = paymentsThisMonth[0]?.total || 0;

    return {
      caTotal: s.total,
      overdue: overdueCount,
      encaisseMonth: encaisse,
      employees: activeEmployees,
    };
  } catch {
    return null;
  }
}

export async function StatCards() {
  const stats = await getStats();

  const fmt = (n: number) => n.toLocaleString("fr-FR") + " XOF";

  const cards = [
    {
      label: "CA (année en cours)",
      value: stats ? fmt(stats.caTotal) : "—",
      icon: "📈",
      color: "bg-green-50 text-green-700",
      href: "/invoices",
    },
    {
      label: "Impayés en retard",
      value: stats ? String(stats.overdue) : "—",
      icon: "⚠️",
      color: "bg-red-50 text-red-700",
      href: "/invoices?overdue=true",
    },
    {
      label: "Encaissé ce mois",
      value: stats ? fmt(stats.encaisseMonth) : "—",
      icon: "💳",
      color: "bg-blue-50 text-blue-700",
      href: "/payments",
    },
    {
      label: "Employés actifs",
      value: stats ? String(stats.employees) : "—",
      icon: "👥",
      color: "bg-purple-50 text-purple-700",
      href: "/employees",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Link key={card.label} href={card.href} className="bg-white rounded-xl border border-clay/20 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-moss font-medium uppercase tracking-wide">{card.label}</p>
              <p className="text-2xl font-bold text-ink mt-1">{card.value}</p>
            </div>
            <span className={`text-2xl p-2 rounded-lg ${card.color}`}>{card.icon}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
