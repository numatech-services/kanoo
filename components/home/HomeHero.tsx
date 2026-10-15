import Link from "next/link";
import { Send, Plus, MessageCircle } from "lucide-react";
import { compactXof } from "@/components/ui/charts/geometry";
import type { HomeData } from "@/lib/dashboard-home";

/**
 * Bandeau d'accueil (charte v5) : la phrase qui dit où en est l'argent, et le
 * geste qui s'impose. À droite, la touche manuscrite de la maquette.
 */
export function HomeHero({ g, hero }: { g: HomeData["greeting"]; hero: NonNullable<HomeData["hero"]> }) {
  const late = hero.overdueCount > 0;
  const text = late
    ? `${compactXof(hero.overdueAmount)} FCFA sont en retard chez ${hero.overdueClients} client${hero.overdueClients > 1 ? "s" : ""}. Une relance, et vous récupérez l'essentiel de ce qui vous est dû.`
    : hero.outstanding > 0
      ? `${compactXof(hero.outstanding)} FCFA restent à encaisser sur ${hero.outstandingCount} facture${hero.outstandingCount > 1 ? "s" : ""}, rien en retard. Vous êtes à jour.`
      : "Aucune créance en attente : toutes vos factures émises sont réglées.";
  return (
    <section className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] rounded-[24px] border border-line overflow-hidden min-h-[230px] bg-gradient-to-br from-[rgb(238_246_255)] to-[rgb(231_237_255)] dark:from-surface dark:to-surface2">
      <div className="px-7 py-7 sm:px-8 flex flex-col gap-3 justify-center">
        <p className="text-xs font-bold tracking-[0.12em] uppercase text-ink3">{g.salut}{g.firstName ? `, ${g.firstName}` : ""}</p>
        <h1 className="text-[30px] sm:text-[36px] leading-[1.08] font-extrabold tracking-[-0.035em] text-ink">
          Votre trésorerie,<br /><span className="text-grad-brand">{late ? "à reprendre en main." : "sous contrôle."}</span>
        </h1>
        <p className="max-w-[440px] text-[14.5px] leading-relaxed text-ink2">{text}</p>
        <div className="flex gap-2.5 flex-wrap mt-1">
          {late && (
            <Link href="/relances" className="h-11 px-5 rounded-full grad-brand grad-brand-glow text-sm font-semibold inline-flex items-center gap-2 hover:brightness-105">
              <MessageCircle size={17} /> Relancer les retards
            </Link>
          )}
          <Link href="/invoices/new" className="h-11 px-5 rounded-full bg-surface border border-line2 text-sm font-semibold text-ink inline-flex items-center gap-2 hover:bg-surface2">
            <Plus size={17} /> Nouvelle facture
          </Link>
          {!late && hero.outstanding > 0 && (
            <Link href="/invoices?status=sent" className="h-11 px-4 rounded-full text-sm font-semibold text-accent inline-flex items-center gap-1.5 hover:underline">
              <Send size={15} /> Factures à encaisser
            </Link>
          )}
        </div>
      </div>
      {/* Panneau décoratif : la maquette y prévoit une photo ; à défaut, la devise. */}
      <div className="hidden lg:block relative border-l border-dashed border-accent/25 overflow-hidden" aria-hidden>
        <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full bg-[rgb(0_130_235)]/15 blur-2xl" />
        <div className="absolute right-16 bottom-0 w-64 h-40 rounded-full bg-[rgb(110_68_188)]/15 blur-2xl" />
        <svg viewBox="0 0 300 200" className="absolute inset-x-6 bottom-6 h-[60%] w-[calc(100%-3rem)] opacity-70">
          <path d="M0 170 C40 160 60 120 100 128 S160 70 200 84 S260 30 300 20" fill="none" stroke="url(#hg)" strokeWidth="4" strokeLinecap="round" />
          <defs><linearGradient id="hg" x1="0" x2="1"><stop offset="0" stopColor="rgb(0 130 235)" /><stop offset="1" stopColor="rgb(110 68 188)" /></linearGradient></defs>
        </svg>
        <p className="absolute left-8 top-8 font-hand text-[30px] leading-[1.05] text-accent -rotate-3">Chaque franc<br />compte.</p>
      </div>
    </section>
  );
}
