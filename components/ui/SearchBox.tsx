"use client";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Champ de recherche des listes : la recherche part 300 ms après la dernière
 * frappe (pas une requête par lettre). Numéro, libellés, nom ou code du tiers.
 */
export function SearchBox({ onSearch, placeholder = "Rechercher…", className = "" }: { onSearch: (q: string) => void; placeholder?: string; className?: string }) {
  const [value, setValue] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onSearch);
  useEffect(() => { cb.current = onSearch; }, [onSearch]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const change = (v: string) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => cb.current(v.trim()), 300);
  };
  return (
    <label className={`relative block ${className}`}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none" />
      <input type="search" value={value} onChange={e => change(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="w-full h-10 pl-9 pr-8 rounded-lg border border-line2 bg-surface text-sm text-ink focus:outline-none focus:border-section" />
      {value && <button type="button" onClick={() => change("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink3 hover:text-ink" aria-label="Effacer"><X size={13} /></button>}
    </label>
  );
}
