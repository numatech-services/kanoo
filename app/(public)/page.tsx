import Link from "next/link";
import { Check, ArrowRight, Ticket, QrCode, ScanLine } from "lucide-react";

export const metadata = {
  title: "Kanoo — Gestion tout-en-un pour le Niger",
  description: "Facturation, comptabilité OHADA, paie CNSS/IR, caisse, mobile money et billetterie d'événements. Une seule plateforme, pensée pour le terrain — PME, associations, ONG et administrations au Niger.",
};

const PROFILES = [
  {
    id: "pme", tag: "PME & commerces", title: "Vendez, facturez, encaissez.",
    items: [
      "Facturation conforme DGI (TVA 19 %, retenues, timbre)",
      "Caisse tactile → facture + stock + écriture automatiques",
      "Comptabilité OHADA / SYSCOHADA préchargée",
      "Encaissement Orange, Moov & Airtel Money",
      "Paie CNSS 3,6 %/16,4 % & IR, bulletins",
    ],
  },
  {
    id: "associations", tag: "Associations / ONG", title: "Membres, dons, événements.",
    items: [
      "Adhérents, cotisations & reçus automatiques",
      "Dons multi-devises et rapports bailleurs (AFD, UE, USAID)",
      "Assemblées générales, PV, convocations",
      "Activités & billetterie avec check-in QR",
      "Suivi budgétaire par projet",
    ],
  },
  {
    id: "administrations", tag: "Administrations", title: "Budget, marchés, mandats.",
    items: [
      "Budget public : engagement → mandatement → paiement",
      "Marchés publics conformes (seuils, commissions)",
      "Portail fournisseur (dépôt d'offres en ligne)",
      "Personnel & paie des agents",
      "Recettes et services citoyens",
    ],
  },
];

const TESTIMONIALS = [
  { name: "Moussa Diallo", role: "DG, Numalex SARL — Niamey", quote: "En 3 mois, on a divisé par 4 le temps passé sur la facturation et les déclarations TVA." },
  { name: "Fatima Idrissa", role: "Trésorière, ONG Sahel Vert", quote: "Le check-in par QR à notre AG a changé la vie des bénévoles : plus de listes papier." },
  { name: "Ali Abdou", role: "DAF, Mairie de Dosso", quote: "Le circuit engagement → mandatement est enfin clair et traçable de bout en bout." },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pt-14 pb-10 grid lg:grid-cols-[1.05fr_.95fr] gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent-700 bg-accent-50 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> Fait au Niger, pour l'Afrique francophone
          </span>
          <h1 className="font-display font-semibold text-ink leading-[1.03] tracking-tight mt-5 text-[clamp(2.4rem,6vw,4rem)]">
            Gérez tout,<br />de la <em className="not-italic text-accent font-medium italic">caisse</em> au <em className="not-italic text-accent font-medium italic">bilan</em>.
          </h1>
          <p className="text-ink2 text-lg mt-5 max-w-[46ch]">
            Facturation, comptabilité OHADA, paie, caisse et mobile money — plus la billetterie d'événements. Une seule plateforme, pensée pour le terrain, même quand le réseau flanche.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-7">
            <Link href="/souscrire" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-accent text-white font-semibold hover:bg-accent-600 transition-colors shadow-[0_10px_24px_-8px_rgba(194,98,14,.65)]">
              Démarrer gratuitement <ArrowRight size={17} />
            </Link>
            <Link href="/demo" className="inline-flex items-center h-12 px-6 rounded-full border border-line2 text-ink font-semibold hover:bg-surface2 transition-colors">Voir une démo</Link>
            <span className="text-sm text-ink3">30 jours · sans carte</span>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-4 mt-10 pt-7 border-t border-line">
            {[["19 %", "TVA & fiscalité DGI intégrées"], ["3", "Orange · Moov · Airtel Money"], ["OHADA", "Compta & exports normés"]].map(([n, l]) => (
              <div key={l}><div className="font-display font-semibold text-2xl text-ink">{n}</div><div className="text-xs text-ink2 mt-0.5 max-w-[18ch]">{l}</div></div>
            ))}
          </div>
        </div>

        {/* Aperçu produit */}
        <div className="relative rounded-2xl border border-line bg-surface shadow-soft overflow-hidden">
          <div className="h-11 bg-surface2 border-b border-line flex items-center px-4 gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-line2" /><span className="w-2.5 h-2.5 rounded-full bg-line2" /><span className="w-2.5 h-2.5 rounded-full bg-line2" />
          </div>
          <div className="p-5">
            <p className="font-display font-semibold">Tableau de bord</p>
            <p className="text-xs text-ink2 mb-4">Sahel BTP · août 2026</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl border border-line bg-bg p-3"><p className="text-[11px] text-ink2 font-medium">Trésorerie</p><p className="font-display text-lg font-semibold mt-1 num">14 820 000 <span className="text-xs text-ink3">F</span></p></div>
              <div className="rounded-xl border border-line bg-bg p-3"><p className="text-[11px] text-ink2 font-medium">CA du mois</p><p className="font-display text-lg font-semibold mt-1 num">6 145 000 <span className="text-xs text-ink3">F</span></p></div>
            </div>
            {[["F-2026-0192 · Sahel Béton", "Payée", "acacia"], ["F-2026-0191 · ETS Kané", "En retard", "neg"], ["F-2026-0189 · Gani Transit", "Payée", "acacia"]].map(([t, s, c]) => (
              <div key={t} className="flex items-center justify-between py-2.5 border-b border-line last:border-0 text-[13px]">
                <span className="text-ink">{t}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c === "acacia" ? "bg-acacia-50 text-acacia" : "bg-neg-50 text-neg"}`}>{s}</span>
              </div>
            ))}
          </div>
          <div className="absolute right-0 bottom-5 bg-accent text-white font-display italic text-sm pl-4 pr-4 py-1.5 rounded-l-full shadow">écritures auto ✦</div>
        </div>
      </section>

      {/* Sectors */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-6 flex items-center gap-3 flex-wrap text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink3">Pensé pour</span>
        {["Commerces & PME", "Associations & ONG", "Administrations", "Artisans & coopératives"].map((s) => (
          <span key={s} className="inline-flex items-center gap-2 bg-surface border border-line rounded-full px-3.5 py-1.5 font-semibold text-ink">{s}</span>
        ))}
      </section>

      {/* Features by profile */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-14">
        <div className="max-w-2xl">
          <h2 className="font-display font-semibold text-ink text-[clamp(1.8rem,4vw,2.6rem)] tracking-tight">Un socle, trois métiers.</h2>
          <p className="text-ink2 mt-3">Chaque profil retrouve ses spécificités — sans jamais changer d'outil.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5 mt-9">
          {PROFILES.map((p) => (
            <div key={p.id} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-accent-700">{p.tag}</span>
              <h3 className="font-display font-semibold text-xl text-ink mt-2 mb-4">{p.title}</h3>
              <ul className="space-y-2.5">
                {p.items.map((it) => (
                  <li key={it} className="flex items-start gap-2.5 text-sm text-ink">
                    <span className="w-4 h-4 rounded-full bg-acacia-50 text-acacia grid place-items-center flex-none mt-0.5"><Check size={11} /></span>
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Activités & billetterie highlight */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-6">
        <div className="rounded-2xl bg-[#17130E] text-[#F5EEE1] overflow-hidden grid lg:grid-cols-2 gap-8 items-center p-8 sm:p-12">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E9A45C] bg-white/5 px-3 py-1.5 rounded-full">Nouveau — Activités & billetterie</span>
            <h2 className="font-display font-semibold text-[clamp(1.8rem,4vw,2.6rem)] leading-tight mt-4">De l'invitation au <em className="text-[#E9A45C] italic">check-in</em>.</h2>
            <p className="text-[#cabfac] mt-3 max-w-[46ch]">Créez un événement, vendez des billets en mobile money, envoyez le billet par email et WhatsApp, puis scannez les entrées au QR — même hors connexion.</p>
            <div className="flex flex-wrap gap-3 mt-6">
              {[[<Ticket size={15} key="t" />, "Billets & paiement"], [<QrCode size={15} key="q" />, "QR signé"], [<ScanLine size={15} key="s" />, "Scan hors-ligne"]].map(([ic, l], i) => (
                <span key={i} className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3.5 py-1.5 text-sm font-semibold">{ic}{l}</span>
              ))}
            </div>
            <Link href="/fonctionnalites#associations" className="inline-flex items-center gap-2 mt-7 text-[#E9A45C] font-semibold hover:underline">En savoir plus <ArrowRight size={16} /></Link>
          </div>
          <div className="rounded-xl bg-[#1E1913] border border-white/10 p-6 grid place-items-center">
            <div className="w-40 h-40 rounded-lg bg-[#F5EEE1] grid place-items-center">
              <QrCode size={116} className="text-[#17130E]" />
            </div>
            <p className="text-xs text-[#8b8069] mt-3">Billet nominatif · code de secours</p>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-14">
        <div className="grid md:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="rounded-2xl border border-line bg-surface p-6">
              <blockquote className="font-display text-ink text-lg leading-snug">« {t.quote} »</blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-accent-50 text-accent-700 grid place-items-center font-display font-semibold">{t.name[0]}</span>
                <span className="text-sm"><b className="font-semibold text-ink">{t.name}</b><br /><span className="text-ink2 text-xs">{t.role}</span></span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pb-16">
        <div className="rounded-2xl border border-line bg-surface2 p-10 text-center">
          <h2 className="font-display font-semibold text-ink text-[clamp(1.8rem,4vw,2.6rem)]">Prêt à simplifier votre gestion ?</h2>
          <p className="text-ink2 mt-3">30 jours d'essai gratuit, sans carte bancaire. Configuration en moins de 10 minutes.</p>
          <div className="flex justify-center gap-3 mt-6">
            <Link href="/souscrire" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-accent text-white font-semibold hover:bg-accent-600 transition-colors">Créer mon compte <ArrowRight size={17} /></Link>
            <Link href="/contact" className="inline-flex items-center h-12 px-6 rounded-full border border-line2 text-ink font-semibold hover:bg-surface transition-colors">Parler à l'équipe</Link>
          </div>
        </div>
      </section>
    </>
  );
}
