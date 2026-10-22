"use client";

import { useState } from "react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button-class";
import { formatMoney } from "@/lib/format";
import { useApi } from "@/lib/use-api";
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
      <tr className={`border-b border-line hover:bg-surface2/30 transition-colors ${depth === 0 ? "bg-surface2/20 font-semibold" : ""}`}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren && (
              <button onClick={() => setExpanded(!expanded)} className="text-ink2 hover:text-ink w-5 h-5 flex items-center justify-center text-xs">
                {expanded ? "▼" : "▶"}
              </button>
            )}
            {!hasChildren && <span className="w-5" />}
            <span className="font-mono text-xs bg-surface2 px-1.5 py-0.5 rounded">{chapter.code}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm">{chapter.label}</td>
        <td className="px-4 py-3 text-right font-mono text-sm">{formatMoney(chapter.allocatedAmount)}</td>
        <td className="px-4 py-3 text-right font-mono text-sm text-warn">{formatMoney(chapter.engagedAmount)}</td>
        <td className="px-4 py-3 text-right">
          <span className={`font-mono text-sm ${isOverEngaged ? "text-neg font-bold" : "text-pos"}`}>
            {formatMoney(available)}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm text-ink2">{formatMoney(chapter.paidAmount)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-surface2 rounded-full w-20">
              <div
                className={`h-2 rounded-full transition-all ${tauxEngagement > 90 ? "bg-neg" : tauxEngagement > 70 ? "bg-warn" : "bg-pos"}`}
                style={{ width: `${Math.min(100, tauxEngagement)}%` }}
              />
            </div>
            <span className="text-xs text-ink2 w-8">{tauxEngagement}%</span>
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
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading } = useApi<{ year: number; tree: BudgetChapter[]; totals: { allocated: number; engaged: number; paid: number } } | null>(
    `/api/budget?year=${year}`,
    (d) => d.data ?? null,
    null,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Budget — Exercice {year}</h1>
          <p className="text-sm text-ink2 mt-0.5">Structure budgétaire et exécution</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 border border-line rounded-lg text-sm"
          >
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Link
            href="/administration/budget/new"
            className={buttonClass("primary", "md")}
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
            { label: "Engagements", value: data.totals.engaged, color: "text-warn" },
            { label: "Disponible", value: data.totals.allocated - data.totals.engaged, color: data.totals.allocated - data.totals.engaged < 0 ? "text-neg" : "text-pos" },
          ].map((item) => (
            <div key={item.label} className="bg-surface rounded-xl border border-line p-5">
              <p className="text-xs text-ink2 font-medium uppercase tracking-wide">{item.label}</p>
              <p className={`text-xl font-bold mt-1 font-mono ${item.color}`}>{formatMoney(item.value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-dense">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                {["Code", "Intitulé", "Alloué", "Engagé", "Disponible", "Payé", "Taux engagement"].map((h) => (
                  <th key={h} >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-surface2 animate-pulse rounded" /></td></tr>
                ))
              ) : !data?.tree?.length ? (
                <tr><td colSpan={7} className="text-center text-ink2 py-12">Aucun chapitre budgétaire pour {year}</td></tr>
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