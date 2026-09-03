import Link from "next/link";
import {
  Check, ArrowRight, Ticket, QrCode, ScanLine, Store, HeartHandshake, Landmark,
  BellRing, Scale, ReceiptText, ShieldCheck, WifiOff,
} from "lucide-react";

export const metadata = {
  title: "Kanoo — Gestion tout-en-un pour le Niger",
  description: "Facturation certifiée DGI, comptabilité OHADA, paie CNSS/IR, trésorerie et rapprochement bancaire, relances clients, notes de frais et billetterie. Une plateforme, trois métiers — PME, associations et administrations au Niger.",
};

/**
 * Les trois espaces, montrés plutôt que décrits.
 *
 * Chaque carte porte `data-space` : elle se rend donc dans la palette, les
 * formes et le rythme réels de son espace. Le visiteur ne lit pas que le
 * produit s'adapte à son métier — il le voit, avant même de créer un compte.
 */
const PROFILES = [
  {
    space: "pme" as const,
    Icon: Store,
    tag: "PME & commerces",
    title: "Vendez, facturez, encaissez.",
    signature: "Ambre, angles francs, tempo court.",
    items: [
      "Facturation conforme DGI — TVA 19 %, retenues, droit de timbre",
      "Certification SECeF : socle prêt, portail e-SECeF opérationnel",
      "Comptabilité OHADA / SYSCOHADA, écritures générées",
      "Trésorerie réelle et rapprochement bancaire par import de relevé",
      "Relances clients graduées, du rappel avant échéance à la mise en demeure",
      "Encaissement Orange, Moov & Airtel Money",
    ],
  },
  {
    space: "association" as const,
    Icon: HeartHandshake,
    tag: "Associations & ONG",
    title: "Membres, dons, assemblées.",
    signature: "Acacia, formes rondes, mouvement calme.",
    items: [
      "Adhérents, cotisations et reçus émis automatiquement",
      "Dons multi-devises et rapports par bailleur",
      "Assemblées générales, convocations, procès-verbaux",
      "Activités et billetterie, avec pointage par QR même hors réseau",
      "Suivi budgétaire par projet et par financement",
      "Portail adhérent : chacun retrouve ses reçus sans écrire au trésorier",
    ],
  },
  {
    space: "administration" as const,
    Icon: Landmark,
    tag: "Administrations",
    title: "Budget, marchés, mandats.",
    signature: "Indigo, filets nets, sobriété du registre.",
    items: [
      "Chaîne budgétaire complète : engagement, mandatement, paiement",
      "Marchés publics — seuils, commissions, procès-verbaux",
      "Portail fournisseur pour le dépôt d'offres",
      "Personnel et paie des agents",
      "Recettes et régies",
      "Journal d'audit sur chaque acte, exportable",
    ],
  },
];

/**
 * Ce que le produit fait, vérifiable en trente jours d'essai.
 *
 * Les témoignages nominatifs qui figuraient ici étaient inventés — noms,
 * fonctions, organisations et chiffres. Publier un avis fabriqué comme s'il
 * était authentique trompe le visiteur, et se retourne contre l'éditeur le
 * jour où quelqu'un cherche à joindre la personne citée. La place leur reste
 * ouverte : il suffira de la remplir avec de vrais clients, cités avec leur
 * accord.
 */
const PROOFS = [
  {
    Icon: WifiOff,
    title: "Conçu pour un réseau qui flanche",
    body: "La saisie continue hors connexion et se rejoue à la reconnexion. Une action en attente est annoncée comme telle, jamais comme synchronisée.",
  },
  {
    Icon: ShieldCheck,
    title: "Ce qui est annoncé est effectif",
    body: "Protection CSRF vérifiée à chaque mutation, révocation de session immédiate, journal d'audit, et plus de quatre cents contrôles automatisés à chaque livraison.",
  },
  {
    Icon: Scale,
    title: "Les soldes se calculent",
    body: "Solde de trésorerie, solde client, restant dû : dérivés des mouvements, jamais d'un nombre saisi une fois. Un chiffre affiché est un chiffre qu'on peut refaire.",
  },
];

const NEW_MODULES = [
  { Icon: BellRing, label: "Relances clients", href: "/fonctionnalites#relances" },
  { Icon: Scale, label: "Rapprochement bancaire", href: "/fonctionnalites#tresorerie" },
  { Icon: ReceiptText, label: "Notes de frais", href: "/fonctionnalites#frais" },
];

export default function HomePage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pt-14 pb-10 grid lg:grid-cols-[1.05fr_.95fr] gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent-700 bg-accent-50 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> Fait au Niger, pour l&apos;Afrique francophone
          </span>
          <h1 className="font-display font-semibold text-ink leading-[1.03] tracking-tight mt-5 text-[clamp(2.4rem,6vw,4rem)]">
            Gérez tout,<br />de la <em className="not-italic text-accent font-medium italic">caisse</em> au <em className="not-italic text-accent font-medium italic">bilan</em>.
          </h1>
          <p className="text-ink2 text-lg mt-5 max-w-[46ch]">
            Facturation, comptabilité OHADA, paie, trésorerie et mobile money — plus la
            billetterie d&apos;événements. Une seule plateforme, pensée pour le terrain,
            même quand le réseau flanche.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-7">
            <Link href="/souscrire" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-accent text-white font-semibold hover:bg-accent-600 transition-colors shadow-[0_10px_24px_-8px_rgba(194,98,14,.65)]">
              Démarrer gratuitement <ArrowRight size={17} />
            </Link>
            <Link href="/demo" className="inline-flex items-center h-12 px-6 rounded-full border border-line2 text-ink font-semibold hover:bg-surface2 transition-colors">
              Voir une démo
            </Link>
            <span className="text-sm text-ink3">30 jours · sans carte</span>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-4 mt-10 pt-7 border-t border-line">
            {[
              ["19 %", "TVA & fiscalité DGI intégrées"],
              ["3", "Orange · Moov · Airtel Money"],
              ["OHADA", "Compta & exports normés"],
            ].map(([n, l]) => (
              <div key={l}>
                <div className="font-display font-semibold text-2xl text-ink">{n}</div>
                <div className="text-xs text-ink2 mt-0.5 max-w-[18ch]">{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Aperçu produit */}
        <div className="relative rounded-2xl border border-line bg-surface shadow-soft overflow-hidden">
          <div className="h-11 bg-surface2 border-b border-line flex items-center px-4 gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-line2" />
            <span className="w-2.5 h-2.5 rounded-full bg-line2" />
            <span className="w-2.5 h-2.5 rounded-full bg-line2" />
          </div>
          <div className="p-5">
            <p className="font-display font-semibold">Tableau de bord</p>
            <p className="text-xs text-ink2 mb-4">Exemple · août 2026</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl border border-line bg-bg p-3">
                <p className="text-[11px] text-ink2 font-medium">Trésorerie</p>
                <p className="font-display text-lg font-semibold mt-1 num">14 820 000 <span className="text-xs text-ink3">F</span></p>
              </div>
              <div className="rounded-xl border border-line bg-bg p-3">
                <p className="text-[11px] text-ink2 font-medium">CA du mois</p>
                <p className="font-display text-lg font-semibold mt-1 num">6 145 000 <span className="text-xs text-ink3">F</span></p>
              </div>
            </div>
            {[
              ["F-2026-0192 · Sahel Béton", "Payée", true],
              ["F-2026-0191 · ETS Kané", "En retard", false],
              ["F-2026-0189 · Gani Transit", "Payée", true],
            ].map(([label, state, good]) => (
              <div key={String(label)} className="flex items-center justify-between py-2.5 border-b border-line last:border-0 text-[13px]">
                <span className="text-ink">{label}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  good ? "bg-acacia-50 text-acacia" : "bg-neg-50 text-neg"
                }`}>{state}</span>
              </div>
            ))}
          </div>
          <div className="absolute right-0 bottom-5 bg-accent text-white font-display italic text-sm pl-4 pr-4 py-1.5 rounded-l-full shadow">
            écritures auto ✦
          </div>
        </div>
      </section>

      {/* ── Nouveautés ────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-6 flex items-center gap-3 flex-wrap text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink3">Récemment livré</span>
        {NEW_MODULES.map(({ Icon, label, href }) => (
          <Link key={label} href={href}
            className="inline-flex items-center gap-2 bg-surface border border-line rounded-full px-3.5 py-1.5 font-semibold text-ink hover:border-accent transition-colors">
            <Icon size={14} className="text-accent" />{label}
          </Link>
        ))}
      </section>

      {/* ── Trois métiers, montrés ────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-14">
        <div className="max-w-2xl">
          <h2 className="font-display font-semibold text-ink text-[clamp(1.8rem,4vw,2.6rem)] tracking-tight">
            Un socle, trois identités.
          </h2>
          <p className="text-ink2 mt-3">
            Chaque métier retrouve ses fonctions — et son apparence. Les trois cartes
            ci-dessous sont rendues avec les couleurs, les formes et le rythme réels de
            leur espace dans l&apos;application. Ce n&apos;est pas une illustration.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5 mt-9">
          {PROFILES.map(({ space, Icon, tag, title, signature, items }) => (
            // `data-space` fait basculer la carte dans l'identité de son espace :
            // palette, rayon des angles, ombre ou filet. Le style vient des
            // mêmes tokens que l'application, sans duplication.
            <div key={space} data-space={space}
              className="surface-card p-6 bg-bg">
              <span className="chip chip-solid mb-4"><Icon size={18} /></span>
              <span className="block text-xs font-bold uppercase tracking-wider text-section">{tag}</span>
              <h3 className="font-display font-semibold text-xl text-ink mt-1.5 mb-1">{title}</h3>
              <p className="text-[11px] text-ink3 mb-4 italic">{signature}</p>
              <ul className="space-y-2.5">
                {items.map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-ink2">
                    <span className="w-4 h-4 rounded-full bg-section-soft text-section grid place-items-center flex-none mt-0.5">
                      <Check size={11} strokeWidth={3} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Billetterie ───────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-6">
        <div className="rounded-2xl bg-[#17130E] text-[#F5EEE1] overflow-hidden grid lg:grid-cols-2 gap-8 items-center p-8 sm:p-12">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E9A45C] bg-white/5 px-3 py-1.5 rounded-full">
              Activités &amp; billetterie
            </span>
            <h2 className="font-display font-semibold text-[clamp(1.8rem,4vw,2.6rem)] leading-tight mt-4">
              De l&apos;invitation au <em className="text-[#E9A45C] italic">pointage</em>.
            </h2>
            <p className="text-[#cabfac] mt-3 max-w-[46ch]">
              Créez un événement, vendez des billets en mobile money, envoyez le billet par
              courriel et WhatsApp, puis scannez les entrées au QR — même sans réseau, la
              porte d&apos;une salle de fête étant rarement couverte.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              {[[<Ticket size={15} key="t" />, "Billets & paiement"],
                [<QrCode size={15} key="q" />, "QR signé"],
                [<ScanLine size={15} key="s" />, "Scan hors-ligne"]].map(([icon, label], i) => (
                <span key={i} className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3.5 py-1.5 text-sm font-semibold">
                  {icon}{label}
                </span>
              ))}
            </div>
            <Link href="/fonctionnalites#associations" className="inline-flex items-center gap-2 mt-7 text-[#E9A45C] font-semibold hover:underline">
              En savoir plus <ArrowRight size={16} />
            </Link>
          </div>
          <div className="rounded-xl bg-[#1E1913] border border-white/10 p-6 grid place-items-center">
            <div className="w-40 h-40 rounded-lg bg-[#F5EEE1] grid place-items-center">
              <QrCode size={116} className="text-[#17130E]" />
            </div>
            <p className="text-xs text-[#8b8069] mt-3">Billet nominatif · code de secours</p>
          </div>
        </div>
      </section>

      {/* ── Ce que nous engageons ─────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-14">
        <div className="max-w-2xl mb-9">
          <h2 className="font-display font-semibold text-ink text-[clamp(1.8rem,4vw,2.6rem)] tracking-tight">
            Ce que vous pouvez vérifier.
          </h2>
          <p className="text-ink2 mt-3">
            Pas de témoignage à notre convenance&nbsp;: trente jours d&apos;essai, et vous
            jugez sur pièces.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {PROOFS.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-6">
              <span className="w-10 h-10 rounded-xl bg-accent-50 text-accent-700 grid place-items-center mb-4">
                <Icon size={19} />
              </span>
              <h3 className="font-display font-semibold text-ink text-lg leading-snug">{title}</h3>
              <p className="text-sm text-ink2 mt-2 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Appel ─────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pb-16">
        <div className="rounded-2xl border border-line bg-surface2 p-10 text-center">
          <h2 className="font-display font-semibold text-ink text-[clamp(1.8rem,4vw,2.6rem)]">
            Prêt à simplifier votre gestion ?
          </h2>
          <p className="text-ink2 mt-3">
            30 jours d&apos;essai gratuit, sans carte bancaire. Configuration en moins de
            dix minutes.
          </p>
          <div className="flex justify-center gap-3 mt-6 flex-wrap">
            <Link href="/souscrire" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-accent text-white font-semibold hover:bg-accent-600 transition-colors">
              Créer mon compte <ArrowRight size={17} />
            </Link>
            <Link href="/contact" className="inline-flex items-center h-12 px-6 rounded-full border border-line2 text-ink font-semibold hover:bg-surface transition-colors">
              Parler à l&apos;équipe
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
