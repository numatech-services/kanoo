// Server Component — lit la base directement.
import { connectDB } from "@/lib/db";
import { getServerAuth } from "@/lib/server-auth";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { ClientModel } from "@/models/Client";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { ImpactBand, Avatar } from "@/components/ui/Primitives";
import { compactXof } from "@/components/ui/charts/geometry";
import { Sparkles } from "lucide-react";

interface Hero {
  userName: string;
  tenantName: string;
  clientCount: number;
  encaisseMois: number;
  restantDu: number;
  overdueCount: number;
  overdueAmount: number;
  facturesMois: number;
}

/**
 * Le bandeau de tête.
 *
 * Il ne répète pas les indicateurs qui suivent : il répond aux trois questions
 * qu'on se pose en ouvrant l'application le matin — combien est rentré, combien
 * manque, et qu'est-ce qui traîne. Chaque chiffre porte la phrase qui dit ce
 * qu'il signifie ; un nombre seul se retient mal et s'interprète de travers.
 */
async function getHero(): Promise<Hero | null> {
  try {
    const auth = await getServerAuth();
    if (!auth) return null;
    await connectDB();

    const tf = { tenantId: auth.tenantId };
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [user, tenant, clients, encaisse, outstanding, overdue, facturesMois] = await Promise.all([
      UserModel.findById(auth.userId).select("firstName lastName").lean<{ firstName?: string; lastName?: string } | null>(),
      TenantModel.findById(auth.tenantId).select("name").lean<{ name?: string } | null>(),
      ClientModel.countDocuments({ ...tf, isActive: true }),
      PaymentModel.aggregate([
        { $match: { ...tf, date: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      // Restant dû : le TTC diminué des règlements *et* des avoirs. Omettre
      // les avoirs gonfle la créance d'un montant déjà crédité au client.
      InvoiceModel.aggregate([
        { $match: { ...tf, documentType: { $ne: "credit_note" }, status: { $in: ["sent", "partial", "overdue"] } } },
        { $group: { _id: null, total: {
          $sum: { $subtract: ["$totalTTC", { $add: ["$paidAmount", { $ifNull: ["$creditedAmount", 0] }] }] },
        } } },
      ]),
      InvoiceModel.aggregate([
        { $match: {
          ...tf, documentType: { $ne: "credit_note" },
          status: { $in: ["sent", "partial", "overdue"] }, dueDate: { $lt: now },
        } },
        { $group: { _id: null, count: { $sum: 1 }, total: {
          $sum: { $subtract: ["$totalTTC", { $add: ["$paidAmount", { $ifNull: ["$creditedAmount", 0] }] }] },
        } } },
      ]),
      InvoiceModel.countDocuments({
        ...tf, documentType: "invoice", issueDate: { $gte: startOfMonth }, status: { $ne: "cancelled" },
      }),
    ]);

    return {
      userName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || auth.email,
      tenantName: tenant?.name || "Votre organisation",
      clientCount: clients,
      encaisseMois: encaisse[0]?.total || 0,
      restantDu: Math.max(0, outstanding[0]?.total || 0),
      overdueCount: overdue[0]?.count || 0,
      overdueAmount: Math.max(0, overdue[0]?.total || 0),
      facturesMois,
    };
  } catch {
    return null;
  }
}

const MOIS = (d: Date) => d.toLocaleDateString("fr-FR", { month: "long" });

export async function DashboardHero() {
  const hero = await getHero();
  if (!hero) return null;

  const now = new Date();
  const heure = now.getHours();
  const salut = heure < 12 ? "Bonjour" : heure < 18 ? "Bon après-midi" : "Bonsoir";

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Avatar name={hero.userName} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink truncate">
            {salut}, {hero.userName.split(" ")[0]}
          </h1>
          <p className="text-sm text-ink2 truncate">
            {hero.tenantName} · {hero.clientCount} client{hero.clientCount > 1 ? "s" : ""} ·{" "}
            {now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
      </header>

      <ImpactBand
        title="Où en est la trésorerie"
        icon={<Sparkles size={15} />}
        items={[
          {
            value: compactXof(hero.encaisseMois),
            caption: `Encaissé en ${MOIS(now)}, sur ${hero.facturesMois} facture${hero.facturesMois > 1 ? "s" : ""} émise${hero.facturesMois > 1 ? "s" : ""}`,
            href: "/payments",
          },
          {
            value: compactXof(hero.restantDu),
            caption: "Facturé et pas encore réglé, avoirs déduits",
            href: "/invoices",
          },
          {
            value: String(hero.overdueCount),
            unit: hero.overdueCount > 1 ? "factures" : "facture",
            caption: hero.overdueCount === 0
              ? "Aucune échéance dépassée à ce jour"
              : `En retard, soit ${compactXof(hero.overdueAmount)} à réclamer`,
            href: "/relances",
          },
          {
            value: hero.restantDu > 0
              ? `${Math.round((hero.overdueAmount / hero.restantDu) * 100)} %`
              : "—",
            caption: hero.restantDu > 0
              ? "Part de la créance déjà en retard — au-delà de 30 %, la relance devient urgente"
              : "Rien en attente : aucune part de créance à surveiller",
            href: "/relances",
          },
        ]}
      />
    </div>
  );
}
