import Link from "next/link";
export default function PortailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface2 flex flex-col">
      <nav className="bg-surface border-b border-line px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold text-section">Kanoo</Link>
        <span className="text-sm text-ink2">Espace extérieur</span>
      </nav>
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">{children}</main>
      <footer className="border-t border-line px-6 py-4 text-center text-xs text-ink2">© Kanoo · Niamey, Niger</footer>
    </div>
  );
}
