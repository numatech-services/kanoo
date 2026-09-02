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
  keyExtractor = (row: any) => row?._id || row?.id || Math.random().toString(36).substr(2, 9),
}: DataTableProps<T>) {
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
      <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 border-b border-clay/10 animate-pulse bg-sand/40" />
        ))}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-clay/20 bg-sand/50">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`px-4 py-3 text-left text-xs font-semibold text-moss uppercase tracking-wide ${
                    col.sortable ? "cursor-pointer hover:text-ink select-none" : ""
                  } ${col.className || ""}`}
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
                <td colSpan={columns.length} className="text-center text-moss py-12">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row, index) => (
                <tr
                  key={keyExtractor(row) || index}
                  className={`border-b border-clay/10 last:border-0 ${
                    onRowClick ? "cursor-pointer hover:bg-sand/40 transition-colors" : ""
                  }`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => {
                    const val = (row as Record<string, unknown>)[String(col.key)];
                    return (
                      <td key={String(col.key)} className={`px-4 py-3 text-ink ${col.className || ""}`}>
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