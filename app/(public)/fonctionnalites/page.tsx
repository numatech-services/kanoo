import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonClass } from "@/components/ui/button-class";
export const metadata = {
  title: "Fonctionnalités | Kanoo",
  description: "Facturation DGI, comptabilité OHADA, paie CNSS/IR, caisse, mobile money, marchés publics, adhérents, dons et billetterie d'événements — par profil.",
};

const SECTIONS = [
  {
    id: "pme", space: "pme", tag: "PME & commerces", title: "Piloter une entreprise, de la vente au bilan.",
    groups: [
      { h: "Ventes & facturation", items: ["Devis, factures et avoirs conformes DGI — TVA 19 %, retenues, droit de timbre", "Certification SECeF : socle en place, portail e-SECeF utilisable dès aujourd'hui", "Caisse : vente, facture, mouvement de stock et écriture, d'un seul geste"] },
      { h: "Encaissement & trésorerie", items: ["Solde de trésorerie calculé, jamais saisi : ouverture plus mouvements", "Rapprochement bancaire par import de relevé, appariements proposés et validés à la main", "Orange, Moov et Airtel Money, rapprochés en comptabilité"] },
      { h: "Recouvrement", items: ["Relances graduées, du rappel avant échéance à la mise en demeure", "La mise en demeure attend toujours une validation humaine", "Relevé de compte client, à l'écran et en PDF, avec balance âgée"] },
      { h: "Finance & paie", items: ["Comptabilité OHADA / SYSCOHADA, journaux automatiques", "Notes de frais, justificatif photographié au comptoir", "Bulletins de paie, CNSS 3,6 %/16,4 %, IR, déclarations prêtes"] },
    ],
  },
  {
    id: "associations", space: "association", tag: "Associations & ONG", title: "Animer une communauté et rendre des comptes.",
    groups: [
      { h: "Membres & dons", items: ["Adhérents, cotisations, reçus fiscaux automatiques", "Dons multi-devises (FCFA/EUR/USD), reçus bailleurs", "Rapports par campagne et par projet"] },
      { h: "Gouvernance", items: ["Assemblées générales, conseils, PV", "Convocations email / SMS, calcul de quorum", "Rapports bailleurs (AFD, UE, USAID)"] },
      { h: "Activités & billetterie", items: ["Événements : billets, jauge, tarifs multiples", "Paiement mobile money, billet par courriel et WhatsApp", "Pointage au QR, présences en temps réel, même sans réseau"] },
      { h: "Pièces & justificatifs", items: ["Contrats et conventions de financement rattachés à leur dossier", "Notes de frais des animateurs, justificatif photographié", "Aucun document en accès libre : chaque téléchargement est contrôlé"] },
    ],
  },
  {
    id: "administrations", space: "administration", tag: "Administrations", title: "Exécuter un budget public, en toute traçabilité.",
    groups: [
      { h: "Budget & dépense", items: ["Chapitres budgétaires, contrôle de crédit bloquant", "Circuit engagement → mandatement → paiement", "Comptabilité publique"] },
      { h: "Marchés publics", items: ["Appels d'offres ouverts/restreints selon seuils", "Commissions d'ouverture et d'évaluation", "Portail fournisseur : dépôt d'offres en ligne"] },
      { h: "Personnel & recettes", items: ["Gestion des agents, paie, CNSS", "Recettes publiques et taxes", "Services citoyens (permis, actes)"] },
      { h: "Traçabilité", items: ["Journal d'audit sur chaque acte, horodaté et exportable", "Pièces jointes rattachées aux marchés et aux mandats", "Droits par rôle : ordonnateur, comptable, contrôleur"] },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pt-14 pb-8">
        <span className="text-xs font-bold uppercase tracking-wider text-accent-700 bg-accent-50 px-3 py-1.5 rounded-full">Fonctionnalités</span>
        <h1 className="font-display font-semibold text-ink leading-[1.05] tracking-tight mt-5 text-[clamp(2.2rem,5vw,3.4rem)] max-w-[18ch]">
          Tout ce qu'il faut, <em className="text-accent italic">rien de superflu</em>.
        </h1>
        <p className="text-ink2 text-lg mt-4 max-w-[52ch]">Une plateforme unique qui s'adapte à votre profil. Voici, en détail, ce que Kanoo fait pour chacun.</p>
        <nav className="flex flex-wrap gap-2 mt-6">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={buttonClass("secondary", "md")}>{s.tag}</a>
          ))}
        </nav>
      </section>

      {SECTIONS.map((s, i) => (
        // `data-space` rend chaque section dans l'identité réelle de son
        // espace : le visiteur voit la couleur et les formes qu'il retrouvera.
        <section key={s.id} id={s.id} data-space={s.space}
          className={`py-14 scroll-mt-20 ${i % 2 === 1 ? "bg-surface2" : "bg-bg"}`}>
          <div className="max-w-6xl mx-auto px-5 sm:px-6">
            <div className="max-w-2xl">
              <span className="text-xs font-bold uppercase tracking-wider text-section">{s.tag}</span>
              <h2 className="font-display font-semibold text-ink text-[clamp(1.6rem,3.5vw,2.3rem)] tracking-tight mt-2">{s.title}</h2>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5 mt-8">
              {s.groups.map((g) => (
                <div key={g.h} className="surface-card p-6">
                  <h3 className="font-display font-semibold text-lg text-ink mb-3">{g.h}</h3>
                  <ul className="space-y-2.5">
                    {g.items.map((it) => (
                      <li key={it} className="flex items-start gap-2.5 text-sm text-ink2">
                        <span className="w-1.5 h-1.5 rounded-full bg-section mt-2 flex-none" />{it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* Ancres visées depuis la page d'accueil : un lien qui ne mène nulle
          part est pire qu'une absence de lien. */}
      <span id="relances" className="block scroll-mt-20" />
      <span id="tresorerie" className="block scroll-mt-20" />
      <span id="frais" className="block scroll-mt-20" />

      <section className="max-w-6xl mx-auto px-5 sm:px-6 py-16 text-center">
        <h2 className="font-display font-semibold text-ink text-[clamp(1.7rem,4vw,2.4rem)]">Voir Kanoo sur vos propres données.</h2>
        <div className="flex justify-center gap-3 mt-6">
          <Link href="/souscrire" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-accent text-white font-semibold hover:bg-accent-600 transition-colors">Essai gratuit <ArrowRight size={17} /></Link>
          <Link href="/tarifs" className={buttonClass("secondary", "md")}>Voir les tarifs</Link>
        </div>
      </section>
    </>
  );
}
