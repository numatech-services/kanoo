"use client";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}

export function Pagination({ page, totalPages, total, limit, onPage }: PaginationProps) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <nav aria-label="Pagination" className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-4">
      <p className="text-sm text-ink2">
        {from}–{to} sur {total} résultats
      </p>
      <div className="flex items-center gap-1">
        <button
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          className="px-3 py-1.5 rounded-lg text-sm border border-line hover:bg-surface2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Préc.
        </button>
        <span className="sm:hidden px-2 text-sm text-ink2">{page}/{totalPages}</span>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="px-2 text-ink2">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              aria-current={p === page ? "page" : undefined}
              // Téléphone : « Préc. 3/12 Suiv. » au lieu de neuf boutons qui débordent.
              className={`hidden sm:inline-grid place-items-center w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                p === page
                  ? "bg-section text-onink"
                  : "border border-line hover:bg-surface2 text-ink"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          disabled={page === totalPages}
          onClick={() => onPage(page + 1)}
          className="px-3 py-1.5 rounded-lg text-sm border border-line hover:bg-surface2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Suiv. →
        </button>
      </div>
    </nav>
  );
}
