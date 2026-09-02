import Link from "next/link";
import { Scale, Cloud, Smartphone, ArrowRight } from "lucide-react";

export const metadata = {
  title: "À propos | Kanoo",
  description: "Kanoo, la plateforme de gestion conçue au Niger, pour le Niger — DGI, CNSS, OHADA et Code des Marchés Publics intégrés nativement.",
};

const VALUES = [
  { flag: true, title: "Fait au Niger", desc: "Conçu à Niamey, avec des utilisateurs nigériens." },
  { icon: <Scale size={18} />, title: "Conformité réglementaire", desc: "DGI, CNSS, OHADA, Code des Marchés 2017." },
  { icon: <Cloud size={18} />, title: "SaaS multi-organisations", desc: "Données isolées, sécurisées, accessibles partout." },
  { icon: <Smartphone size={18} />, title: "Mobile-first", desc: "Optimisé pour les réseaux à faible débit." },
];

export default function AProposPage() {
  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-6 py-16">
      <div className="max-w-2xl">
        <span className="text-xs font-bold uppercase tracking-wider text-accent-700 bg-accent-50 px-3 py-1.5 rounded-full">Notre mission</span>
        <h1 className="font-display font-semibold text-ink text-[clamp(2rem,5vw,3rem)] tracking-tight mt-5">
          La gestion, <em className="text-accent italic">à la portée</em> de toutes les organisations.
        </h1>
        <p className="text-ink2 text-lg mt-4">Rendre la gestion accessible, conforme et efficace pour les PME, associations, ONG et administrations du Niger et de l'Afrique francophone.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-10 items-start mt-14">
        <div>
          <h2 className="font-display font-semibold text-ink text-2xl">Pourquoi Kanoo ?</h2>
          <div className="space-y-4 text-ink2 mt-4 leading-relaxed">
            <p>Les solutions de gestion du marché sont souvent trop complexes et coûteuses pour les organisations locales, ou inadaptées aux spécificités réglementaires du Niger.</p>
            <p>Kanoo a été conçu <b className="text-ink">depuis le Niger, pour le Niger</b> — avec les règles DGI, CNSS, OHADA et le Code des Marchés Publics intégrés nativement, et une caisse et un mobile money pensés pour le terrain.</p>
          </div>
        </div>
        <div className="space-y-3">
          {VALUES.map((v) => (
            <div key={v.title} className="flex items-start gap-4 bg-surface rounded-xl border border-line p-4">
              <span className="w-10 h-10 rounded-lg bg-accent-50 text-accent-700 grid place-items-center flex-none text-lg">
                {v.flag ? "🇳🇪" : v.icon}
              </span>
              <div><p className="font-semibold text-ink text-sm">{v.title}</p><p className="text-ink2 text-xs mt-0.5">{v.desc}</p></div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center bg-surface2 rounded-2xl p-10 mt-16">
        <h3 className="font-display font-semibold text-ink text-2xl">Rejoignez l'aventure</h3>
        <p className="text-ink2 mt-2">Essayez Kanoo gratuitement pendant 30 jours.</p>
        <Link href="/souscrire" className="inline-flex items-center gap-2 mt-5 h-12 px-6 rounded-full bg-accent text-white font-semibold hover:bg-accent-600 transition-colors">
          Commencer maintenant <ArrowRight size={17} />
        </Link>
      </div>
    </div>
  );
}
