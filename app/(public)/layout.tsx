import Link from "next/link";

const NAV = [
  ["Fonctionnalités", "/fonctionnalites"],
  ["Tarifs", "/tarifs"],
  ["Démo", "/demo"],
  ["Contact", "/contact"],
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      {/* Navigation */}
      <header className="sticky top-0 z-40 bg-bg/85 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 font-display font-semibold text-lg tracking-tight">
            <span className="w-8 h-8 rounded-lg bg-[#17130E] text-[#F5EEE1] grid place-items-center -rotate-3">K</span>
            Kanoo
          </Link>
          <nav className="hidden md:flex items-center gap-6 ml-2">
            {NAV.map(([l, h]) => (
              <Link key={h} href={h} className="text-sm font-medium text-ink2 hover:text-ink transition-colors">{l}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-ink2 hover:text-ink transition-colors hidden sm:block">Connexion</Link>
            <Link href="/souscrire" className="inline-flex items-center h-9 px-4 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent-600 transition-colors shadow-[0_6px_16px_-6px_rgba(194,98,14,.6)]">
              Essai gratuit
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="mt-auto bg-[#17130E] text-[#cabfac]">
        <div className="max-w-6xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 text-[#F5EEE1] font-display font-semibold text-lg mb-3">
              <span className="w-8 h-8 rounded-lg bg-accent text-white grid place-items-center -rotate-3">K</span> Kanoo
            </div>
            <p className="text-sm leading-relaxed max-w-[34ch]">Gestion tout-en-un pour PME, associations, ONG et administrations — pensée pour le Niger et l'Afrique francophone.</p>
          </div>
          <div>
            <p className="text-[#F5EEE1] font-semibold mb-3 text-xs uppercase tracking-wider">Produit</p>
            <div className="space-y-2">
              {[["Fonctionnalités", "/fonctionnalites"], ["Tarifs", "/tarifs"], ["Démo", "/demo"]].map(([l, h]) => (
                <Link key={h} href={h} className="block text-sm hover:text-[#F5EEE1] transition-colors">{l}</Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[#F5EEE1] font-semibold mb-3 text-xs uppercase tracking-wider">Profils</p>
            <div className="space-y-2">
              {[["PME & commerces", "/fonctionnalites#pme"], ["Associations / ONG", "/fonctionnalites#associations"], ["Administrations", "/fonctionnalites#administrations"]].map(([l, h]) => (
                <Link key={h} href={h} className="block text-sm hover:text-[#F5EEE1] transition-colors">{l}</Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[#F5EEE1] font-semibold mb-3 text-xs uppercase tracking-wider">Société</p>
            <div className="space-y-2">
              {[["À propos", "/a-propos"], ["Contact", "/contact"], ["Confidentialité", "/confidentialite"], ["Connexion", "/login"]].map(([l, h]) => (
                <Link key={h} href={h} className="block text-sm hover:text-[#F5EEE1] transition-colors">{l}</Link>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-[#8b8069]">© {year} Kanoo — Numatech Services · Niamey, Niger</div>
        </div>
      </footer>
    </div>
  );
}
