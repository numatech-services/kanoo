import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-sand flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-8xl font-bold text-cedar/20 select-none">404</p>
        <h1 className="text-2xl font-bold text-ink mt-4">Page introuvable</h1>
        <p className="text-moss mt-3 leading-relaxed">
          Cette page n'existe pas ou a été déplacée.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Link
            href="/dashboard"
            className="px-6 py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink transition-colors"
          >
            Tableau de bord
          </Link>
          <Link
            href="/"
            className="px-6 py-3 border border-clay/30 text-moss rounded-xl font-medium hover:bg-white transition-colors"
          >
            Accueil
          </Link>
        </div>
        <p className="text-xs text-moss/60 mt-8">Kanoo · Niamey, Niger</p>
      </div>
    </div>
  );
}
