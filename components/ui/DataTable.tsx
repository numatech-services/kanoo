"use client";

import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

import { useState } from "react";

export interface Column<T> {
  key: keyof T | string;
  label: string;
  render?: (value: unknown, row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  /**
   * Sur téléphone, la liste devient des cartes : « title » est l'en-tête de la
   * carte (par défaut la première colonne), « hide » n'y figure pas,
   * « actions » va en pied de carte (par défaut une colonne sans titre ou
   * nommée actions) ; les autres s'affichent « libellé : valeur ».
   */
  mobile?: "title" | "hide" | "actions";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  keyExtractor?: (row: T) => string; 
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  emptyMessage = "Aucun résultat",
  onRowClick,
  keyExtractor,
}: DataTableProps<T>) {
  /**
   * Clé de ligne. Le repli était `Math.random()` : React recevait une clé
   * différente à chaque rendu, démontait puis remontait toute la table, et
   * faisait perdre le focus et la position de défilement. L'index de ligne est
   * un repli stable — imparfait en cas de réordonnancement, mais honnête.
   */
  const rowKey = (row: T, index: number): string => {
    if (keyExtractor) return keyExtractor(row);
    const record = row as unknown as Record<string, unknown>;
    const id = record?._id ?? record?.id;
    return id != null ? String(id) : `row-${index}`;
  };

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // --- SÉCURITÉ CRITIQUE : On force data à être un tableau ---
  const safeData = Array.isArray(data) ? data : [];

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = sortKey
    ? [...safeData].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey];
        const bv = (b as Record<string, unknown>)[sortKey];
        const cmp = String(av ?? "").localeCompare(String(bv ?? ""), "fr", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      })
    : safeData;

  if (loading) {
    return (
      <div className="surface-card overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 border-b border-line last:border-0 animate-pulse bg-surface2/50" />
        ))}
      </div>
    );
  }

  const cell = (col: Column<T>, row: T) => {
    const val = (row as Record<string, unknown>)[String(col.key)];
    return col.render ? col.render(val, row) : String(val ?? "—");
  };
  // La première colonne fait le titre de la carte, sauf si une autre le demande.
  const explicitTitle = columns.some(c => c.mobile === "title");
  const roleOf = (col: Column<T>, i: number): "title" | "hide" | "actions" | "field" =>
    col.mobile ?? (i === 0 && !explicitTitle ? "title" : !col.label || String(col.key) === "actions" ? "actions" : "field");
  const titleCol = columns.find((c, i) => roleOf(c, i) === "title");

  return (
    <>
    {/* Téléphone : des cartes, montant et statut visibles sans défiler de côté. */}
    <ul className="sm:hidden space-y-2" aria-label="Liste">
      {sorted.length === 0 ? (
        <li className="surface-card text-center py-10 text-sm text-ink2">{emptyMessage}</li>
      ) : sorted.map((row, index) => (
        <li key={rowKey(row, index)}
          className={`surface-card p-3 space-y-1.5 ${onRowClick ? "cursor-pointer active:bg-surface2" : ""}`}
          {...(onRowClick ? { role: "button", tabIndex: 0, onClick: () => onRowClick(row), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } } } : {})}>
          {titleCol && <div className="font-semibold text-ink break-words">{cell(titleCol, row)}</div>}
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            {columns.map((col, i) => roleOf(col, i) === "field" && (
              <div key={String(col.key)} className="contents">
                <dt className="text-ink3 text-xs self-center">{col.label}</dt>
                <dd className="text-ink text-right min-w-0 break-words">{cell(col, row)}</dd>
              </div>
            ))}
          </dl>
          {columns.some((c, i) => roleOf(c, i) === "actions") && (
            <div className="flex flex-wrap justify-end gap-2 pt-1" onClick={e => e.stopPropagation()}>
              {columns.map((col, i) => roleOf(col, i) === "actions" && <span key={String(col.key)}>{cell(col, row)}</span>)}
            </div>
          )}
        </li>
      ))}
    </ul>
    <div className="surface-card overflow-hidden hidden sm:block">
      <div className="overflow-x-auto">
        {/* Densité et styles d'en-tête portés par .table-dense : une seule
            définition pour les 31 écrans qui passent par ce composant. */}
        <table className="table-dense">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  scope="col"
                  aria-sort={col.sortable ? (sortKey === String(col.key) ? (sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
                  // L'en-tête garde la police du texte : la chasse fixe est pour les numéros, pas pour leurs titres.
                  className={`${col.sortable ? "select-none" : ""} ${(col.className || "").replace(/\bfont-mono\b/g, "")}`}
                >
                  {/* Un vrai bouton : atteignable au clavier et annoncé (le <th onClick> ne l'était pas). */}
                  {col.sortable ? (
                    <button type="button" onClick={() => handleSort(String(col.key))} className="flex items-center gap-1 hover:text-ink">
                      {col.label}
                      {/* Le chevron reste visible, en gris, sur toute colonne
                          triable : sans lui, rien n'indique qu'un en-tête est
                          cliquable avant d'avoir cliqué. */}
                      {sortKey === String(col.key)
                        ? (sortDir === "asc"
                            ? <ChevronUp size={13} className="text-section shrink-0" />
                            : <ChevronDown size={13} className="text-section shrink-0" />)
                        : <ChevronsUpDown size={12} className="text-ink3/50 shrink-0" />}
                    </button>
                  ) : <span className="flex items-center gap-1">{col.label}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* sorted est maintenant garanti d'être un tableau (safeData) */}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-14">
                  <p className="text-sm text-ink2">{emptyMessage}</p>
                </td>
              </tr>
            ) : (
              sorted.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  className={onRowClick ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-section/40" : ""}
                  onClick={() => onRowClick?.(row)}
                  // Ligne cliquable atteignable au clavier, comme les cartes sur téléphone.
                  {...(onRowClick ? { tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } } } : {})}
                >
                  {columns.map((col) => {
                    const val = (row as Record<string, unknown>)[String(col.key)];
                    return (
                      <td key={String(col.key)} className={`text-ink ${/whitespace-normal/.test(col.className || "") ? "" : "whitespace-nowrap"} ${col.className || ""}`}>
                        {col.render ? col.render(val, row) : String(val ?? "—")}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}