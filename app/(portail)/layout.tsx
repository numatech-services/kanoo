import Link from "next/link";
export default function PortailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-sand flex flex-col">
      <nav className="bg-white border-b border-clay/20 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold text-cedar">Kanoo</Link>
        <span className="text-sm text-moss">Espace extérieur</span>
      </nav>
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">{children}</main>
      <footer className="border-t border-clay/20 px-6 py-4 text-center text-xs text-moss">© Kanoo · Niamey, Niger</footer>
    </div>
  );
}
