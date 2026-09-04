"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload, Database, Check, AlertTriangle, Loader2 } from "lucide-react";

interface Entity { key: string; label: string; canExport: boolean; canImport: boolean; importable: boolean; columns: string[] }
interface ImportResult { total: number; created: number; updated: number; failed: number; errors: { line: number; message: string }[] }

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then((r) => r.json());
  return csrfToken as string;
}

export default function DataPage() {
  const [catalog, setCatalog] = useState<Entity[] | null>(null);

  useEffect(() => {
    fetch("/api/data/catalog", { credentials: "include" })
      .then((r) => r.json()).then((d) => setCatalog(d.success ? d.data : [])).catch(() => setCatalog([]));
  }, []);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Database size={22} /> Import / Export</h1>
        <p className="text-sm text-ink2">
          Exportez vos données en CSV (ouvrable dans Excel), ou importez-en depuis un fichier CSV.
          Vous ne voyez que ce que votre rôle autorise.
        </p>
      </div>

      {catalog === null ? (
        <div className="h-64 surface-card animate-pulse" />
      ) : (
        <div className="space-y-3">
          {catalog.filter((e) => e.canExport || e.canImport).map((e) => (
            <EntityRow key={e.key} entity={e} />
          ))}
          {catalog.every((e) => !e.canExport && !e.canImport) && (
            <p className="surface-card p-6 text-center text-sm text-ink2">Aucune donnée exportable ou importable pour votre rôle.</p>
          )}
        </div>
      )}
    </div>
  );
}

function EntityRow({ entity }: { entity: Entity }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function runImport(file: File) {
    setBusy(true); setResult(null); setError(null);
    try {
      const text = await file.text();
      const res = await fetch(`/api/data/${entity.key}/import`, {
        method: "POST",
        headers: { "Content-Type": "text/csv", "x-csrf-token": await csrf() },
        credentials: "include",
        body: text,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Import refusé");
      setResult(d.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="surface-card p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{entity.label}</p>
          <p className="text-[11px] text-ink3 truncate">Colonnes : {entity.columns.join(", ")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {entity.canExport && (
            <a href={`/api/data/${entity.key}/export`}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
              <Download size={15} /> Exporter
            </a>
          )}
          {entity.canImport ? (
            <>
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Importer
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => e.target.files?.[0] && runImport(e.target.files[0])} />
            </>
          ) : entity.importable ? null : (
            <span className="text-[11px] text-ink3">Export seul</span>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
        </p>
      )}
      {result && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-surface2 border border-line text-sm space-y-1">
          <p className="flex items-center gap-2 text-ink">
            <Check size={15} className="text-pos" />
            {result.created} créé{result.created > 1 ? "s" : ""}, {result.updated} mis à jour
            {result.failed > 0 && <span className="text-neg">, {result.failed} en erreur</span>}
            <span className="text-ink3">sur {result.total}</span>
          </p>
          {result.errors.length > 0 && (
            <ul className="text-xs text-neg list-disc pl-5">
              {result.errors.slice(0, 8).map((er, i) => <li key={i}>Ligne {er.line} : {er.message}</li>)}
              {result.errors.length > 8 && <li>…</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
