"use client";

import { useState } from "react";

export interface Column<T> {
  key: keyof T | string;
  label: string;
  render?: (value: unknown, row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
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

  return (
    <div className="surface-card overflow-hidden">
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
                  className={`${col.sortable ? "cursor-pointer hover:text-ink select-none" : ""} ${col.className || ""}`}
                  onClick={() => col.sortable && handleSort(String(col.key))}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === String(col.key) && (
                      <span>{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* sorted est maintenant garanti d'être un tableau (safeData) */}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center text-ink2 py-12">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  className={onRowClick ? "cursor-pointer" : ""}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => {
                    const val = (row as Record<string, unknown>)[String(col.key)];
                    return (
                      <td key={String(col.key)} className={`text-ink ${col.className || ""}`}>
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
  );
}