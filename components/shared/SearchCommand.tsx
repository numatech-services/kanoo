"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  label: string;
  href: string;
  type: "client" | "invoice" | "employee" | "supplier" | "page";
  meta?: string;
}

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Ctrl+K or Cmd+K to open
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQuery(""); setResults([]); setSelected(0); }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const [clients, invoices] = await Promise.all([
          fetch(`/api/clients?search=${encodeURIComponent(query)}&limit=5`, { credentials: "include" }).then(r => r.json()),
          fetch(`/api/invoices?search=${encodeURIComponent(query)}&limit=5`, { credentials: "include" }).then(r => r.json()),
        ]);
        const r: SearchResult[] = [
          ...(clients.data?.items || []).map((c: { _id: string; name: string; code: string }) => ({ label: c.name, href: `/clients/${c._id}`, type: "client" as const, meta: c.code })),
          ...(invoices.data?.items || []).map((i: { _id: string; number: string; totalTTC: number }) => ({ label: i.number, href: `/invoices/${i._id}`, type: "invoice" as const, meta: `${i.totalTTC.toLocaleString("fr-FR")} XOF` })),
        ];
        setResults(r);
        setSelected(0);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && results[selected]) { router.push(results[selected].href); setOpen(false); }
  }

  const TYPE_ICONS: Record<string, string> = { client: "👥", invoice: "🧾", employee: "👤", supplier: "🏭", page: "📄" };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-clay/20">
          <span className="text-moss">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Rechercher clients, factures, employés…"
            className="flex-1 text-sm text-ink placeholder:text-moss focus:outline-none bg-transparent"
          />
          {loading && <span className="text-xs text-moss animate-pulse">Recherche…</span>}
          <kbd className="text-xs bg-sand px-2 py-0.5 rounded border border-clay/30 text-moss">Esc</kbd>
        </div>
        {results.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-2">
            {results.map((r, i) => (
              <li key={r.href}>
                <button
                  onClick={() => { router.push(r.href); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === selected ? "bg-sand" : "hover:bg-sand/50"}`}
                >
                  <span>{TYPE_ICONS[r.type] || "📄"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{r.label}</p>
                    {r.meta && <p className="text-xs text-moss">{r.meta}</p>}
                  </div>
                  <span className="text-xs text-moss bg-clay/20 px-1.5 py-0.5 rounded capitalize">{r.type}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query && !loading && results.length === 0 && (
          <div className="px-4 py-8 text-center text-moss text-sm">Aucun résultat pour "{query}"</div>
        )}
        {!query && (
          <div className="px-4 py-4 flex flex-wrap gap-2">
            {[["Clients", "/clients"], ["Factures", "/invoices"], ["Employés", "/employees"], ["Fournisseurs", "/suppliers"]].map(([l, h]) => (
              <button key={h} onClick={() => { router.push(h); setOpen(false); }} className="px-3 py-1.5 bg-sand border border-clay/20 rounded-lg text-xs text-moss hover:border-cedar hover:text-cedar transition-colors">
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
