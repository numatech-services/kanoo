"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface BudgetChapter {
  _id: string;
  code: string;
  label: string;
  level: string;
  allocatedAmount: number;
  engagedAmount: number;
  mandatedAmount: number;
  paidAmount: number;
  children?: BudgetChapter[];
}

function formatXOF(n: number) {
  return n.toLocaleString("fr-FR") + " XOF";
}

function taux(num: number, denom: number) {
  if (!denom) return 0;
  return Math.round((num / denom) * 100);
}

function ChapterRow({ chapter, depth = 0 }: { chapter: BudgetChapter; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = chapter.children && chapter.children.length > 0;
  const tauxEngagement = taux(chapter.engagedAmount, chapter.allocatedAmount);
  const available = chapter.allocatedAmount - chapter.engagedAmount;
  const isOverEngaged = available < 0;

  return (
    <>
      <tr className={`border-b border-clay/10 hover:bg-sand/30 transition-colors ${depth === 0 ? "bg-sand/20 font-semibold" : ""}`}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren && (
              <button onClick={() => setExpanded(!expanded)} className="text-moss hover:text-ink w-5 h-5 flex items-center justify-center text-xs">
                {expanded ? "▼" : "▶"}
              </button>
            )}
            {!hasChildren && <span className="w-5" />}
            <span className="font-mono text-xs bg-clay/20 px-1.5 py-0.5 rounded">{chapter.code}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm">{chapter.label}</td>
        <td className="px-4 py-3 text-right font-mono text-sm">{formatXOF(chapter.allocatedAmount)}</td>
        <td className="px-4 py-3 text-right font-mono text-sm text-amber-700">{formatXOF(chapter.engagedAmount)}</td>
        <td className="px-4 py-3 text-right">
          <span className={`font-mono text-sm ${isOverEngaged ? "text-red-600 font-bold" : "text-green-700"}`}>
            {formatXOF(available)}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm text-moss">{formatXOF(chapter.paidAmount)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-clay/20 rounded-full w-20">
              <div
                className={`h-2 rounded-full transition-all ${tauxEngagement > 90 ? "bg-red-400" : tauxEngagement > 70 ? "bg-amber-400" : "bg-green-400"}`}
                style={{ width: `${Math.min(100, tauxEngagement)}%` }}
              />
            </div>
            <span className="text-xs text-moss w-8">{tauxEngagement}%</span>
          </div>
        </td>
      </tr>
      {expanded && hasChildren && chapter.children?.map((child) => (
        <ChapterRow key={child._id} chapter={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function BudgetPage() {
  const [data, setData] = useState<{ year: number; tree: BudgetChapter[]; totals: { allocated: number; engaged: number; paid: number } } | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/budget?year=${year}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [year]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Budget — Exercice {year}</h1>
          <p className="text-sm text-moss mt-0.5">Structure budgétaire et exécution</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 border border-clay/30 rounded-lg text-sm"
          >
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Link
            href="/administration/budget/new"
            className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors"
          >
            + Nouveau chapitre
          </Link>
        </div>
      </div>

      {/* Résumé */}
      {data && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Budget total alloué", value: data.totals.allocated, color: "text-ink" },
            { label: "Engagements", value: data.totals.engaged, color: "text-amber-700" },
            { label: "Disponible", value: data.totals.allocated - data.totals.engaged, color: data.totals.allocated - data.totals.engaged < 0 ? "text-red-600" : "text-green-700" },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-xl border border-clay/20 p-5">
              <p className="text-xs text-moss font-medium uppercase tracking-wide">{item.label}</p>
              <p className={`text-xl font-bold mt-1 font-mono ${item.color}`}>{formatXOF(item.value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-clay/20 bg-sand/50">
                {["Code", "Intitulé", "Alloué", "Engagé", "Disponible", "Payé", "Taux engagement"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-moss uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-sand animate-pulse rounded" /></td></tr>
                ))
              ) : !data?.tree?.length ? (
                <tr><td colSpan={7} className="text-center text-moss py-12">Aucun chapitre budgétaire pour {year}</td></tr>
              ) : (
                data.tree.map((chapter) => <ChapterRow key={chapter._id} chapter={chapter} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}