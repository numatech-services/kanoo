// Server Component — lit la base directement.
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { getServerAccess } from "@/lib/server-auth";
import type { TokenPayload } from "@/lib/auth";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { ClientModel } from "@/models/Client";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import Link from "next/link";
import { compactXof } from "@/components/ui/charts/geometry";
import { Send, Plus, ArrowRight, Store, CreditCard, Megaphone, CalendarClock } from "lucide-react";

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
async function getHero(auth: TokenPayload): Promise<Hero | null> {
  try {
    await connectDB();

    // ObjectId, pas la chaîne du jeton : un pipeline aggregate ne caste
    // pas, et un tenantId en chaîne n'y matche aucun document.
    const tf = { tenantId: new Types.ObjectId(auth.tenantId) };
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

/**
 * Accueil d'un rôle qui n'a pas accès à la trésorerie commerciale (gestionnaire
 * The Spot, opérateur ISIC…) : on ne lui montre ni chiffre d'affaires ni
 * créances, mais des raccourcis vers les modules qu'il peut réellement ouvrir.
 */
async function NeutralHero({ auth, can }: { auth: TokenPayload; can: (r: string) => boolean }) {
  await connectDB();
  const user = await UserModel.findById(auth.userId).select("firstName").lean<{ firstName?: string } | null>().catch(() => null);
  const heure = new Date().getHours();
  const salut = heure < 12 ? "Bonjour" : heure < 18 ? "Bon après-midi" : "Bonsoir";
  const shortcuts = [
    { ok: can("comptoir"), href: "/comptoir", label: "Comptoir (The Spot)", icon: <Store size={16} /> },
    { ok: can("isic"), href: "/isic", label: "Cartes ISIC", icon: <CreditCard size={16} /> },
    { ok: can("appels"), href: "/appels", label: "Appels à candidatures", icon: <Megaphone size={16} /> },
    { ok: true, href: "/agenda", label: "Mon agenda", icon: <CalendarClock size={16} /> },
  ].filter(x => x.ok);
  return (
    <div className="rounded-3xl border border-line bg-section-soft/40 p-7 sm:p-9">
      <p className="text-[11px] font-bold uppercase tracking-widest text-section">{salut}{user?.firstName ? `, ${user.firstName}` : ""}</p>
      <h1 className="mt-2.5 text-3xl sm:text-4xl font-black text-ink leading-[1.06] tracking-tight">Votre espace de travail</h1>
      <p className="mt-3 text-sm text-ink2 max-w-xl">Accédez directement aux modules qui vous sont confiés.</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {shortcuts.map((x, i) => (
          <Link key={x.href} href={x.href}
            className={i === 0
              ? "px-5 h-11 rounded-xl bg-section text-white text-sm font-semibold inline-flex items-center gap-2 hover:brightness-95 shadow-sm"
              : "px-5 h-11 rounded-xl border border-line2 bg-surface text-sm font-semibold text-ink inline-flex items-center gap-2 hover:bg-surface2"}>
            {x.icon} {x.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export async function DashboardHero() {
  const access = await getServerAccess();
  if (!access) return null;
  // Le bandeau résume factures et encaissements : sans ces deux droits, accueil neutre.
  if (!access.can("invoices") || !access.can("payments")) {
    return <NeutralHero auth={access.auth} can={access.can} />;
  }
  const hero = await getHero(access.auth);
  if (!hero) return null;

  const now = new Date();
  const heure = now.getHours();
  const salut = heure < 12 ? "Bonjour" : heure < 18 ? "Bon après-midi" : "Bonsoir";
  const firstName = hero.userName.split(" ")[0];

  const overdue = hero.overdueCount > 0;
  const headline = overdue ? "à reprendre en main." : "sous contrôle.";
  const message = overdue
    ? `${compactXof(hero.overdueAmount)} en retard chez ${hero.overdueCount} client${hero.overdueCount > 1 ? "s" : ""}.` +
      (hero.restantDu > 0 ? ` Au total, ${compactXof(hero.restantDu)} restent à encaisser — une relance récupère l'essentiel.` : "")
    : hero.restantDu > 0
      ? `${compactXof(hero.restantDu)} restent à encaisser ce mois, rien en retard. Vous êtes à jour.`
      : `Encaissé ${compactXof(hero.encaisseMois)} en ${MOIS(now)}. Aucune créance en attente.`;

  return (
    <div className="rounded-3xl border border-line bg-section-soft/40 p-7 sm:p-9">
      <p className="text-[11px] font-bold uppercase tracking-widest text-section">{salut}, {firstName}</p>
      <h1 className="mt-2.5 text-3xl sm:text-4xl font-black text-ink leading-[1.06] tracking-tight">
        Votre trésorerie,<br /><span className="text-section">{headline}</span>
      </h1>
      <p className="mt-3 text-sm text-ink2 max-w-xl">{message}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {overdue && (
          <Link href="/relances" className="px-5 h-11 rounded-xl bg-section text-white text-sm font-semibold inline-flex items-center gap-2 hover:brightness-95 shadow-sm">
            <Send size={16} /> Relancer les retards
          </Link>
        )}
        <Link href="/invoices/new" className="px-5 h-11 rounded-xl border border-line2 bg-surface text-sm font-semibold text-ink inline-flex items-center gap-2 hover:bg-surface2">
          <Plus size={16} /> Nouvelle facture
        </Link>
        <Link href="/payments" className="text-sm font-medium text-ink2 hover:text-ink inline-flex items-center gap-1">
          Voir les encaissements <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
