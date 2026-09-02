"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Repeat, TrendingUp, Wallet, Layers, AlertTriangle, ArrowRight, Landmark,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AreaChart } from "@/components/ui/charts/AreaChart";
import { BarChart } from "@/components/ui/charts/BarChart";
import { DonutChart } from "@/components/ui/charts/DonutChart";
import { compactXof, fullXof } from "@/components/ui/charts/geometry";

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jui", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

interface Reconciliation {
  purchaseId: string;
  purchaseRef: string;
  productName: string;
  supplier: string | null;
  endDate: string;
  quantityBought: number;
  quantitySold: number;
  quantityRemaining: number;
  fillRate: number;
  cost: number;
  revenue: number;
  margin: number;
  marginRate: number;
  unitCost: number;
  averageUnitPrice: number;
  saleCount: number;
  overSold: boolean;
  overrunningSales: string[];
  unbilledSales: string[];
}

interface Alert {
  level: "critical" | "warning" | "info";
  kind: string;
  message: string;
  reference: string;
  daysLeft?: number;
}

interface Payload {
  year: number;
  totals: {
    cost: number; revenue: number; margin: number; marginRate: number;
    bought: number; sold: number; fillRate: number;
    purchaseCount: number; saleCount: number;
  };
  reconciliations: Reconciliation[];
  months: Array<{ month: number; cost: number; revenue: number }>;
  alerts: Alert[];
  tax: {
    vatCollected: number; vatRecoverable: number; vatDue: number;
    withholdingPaid: number; withholdingSuffered: number;
    grossMargin: number; estimatedCorporateTax: number; marginAfterTax: number;
  };
  unattachedSales: Array<{ reference: string; totalHT: number }>;
}

const ALERT_STYLE: Record<Alert["level"], string> = {
  critical: "bg-neg-50 border-neg/25 text-neg",
  warning: "bg-warn-50 border-warn/25 text-warn",
  info: "bg-info-50 border-info/25 text-info",
};

export default function AbonnementsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [chart, setChart] = useState<"flux" | "marge">("flux");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/abonnements/rapprochement?year=${year}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setData(d.data);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="h-9 w-64 bg-surface2 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 bg-surface rounded-xl border border-line animate-pulse" />)}
        </div>
        <div className="h-72 bg-surface rounded-xl border border-line animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
        Impossible de charger le portefeuille : {error}
      </div>
    );
  }
  if (!data) return null;

  const { totals, tax, months, reconciliations, alerts } = data;
  const labels = MONTHS;
  const criticalCount = alerts.filter(a => a.level === "critical").length;

  const marginByMonth = months.map(m => m.revenue - m.cost);
  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      {/* ── En-tête ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-xl bg-section-soft text-section flex items-center justify-center">
              <Repeat size={17} />
            </span>
            <h1 className="text-2xl font-bold text-ink">Abonnements</h1>
          </div>
          <p className="text-sm text-ink2 mt-1">
            {totals.purchaseCount} contrat(s) souscrit(s) · {totals.saleCount} revente(s) ·{" "}
            {totals.sold}/{totals.bought} licences placées
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Exercice"
            segments={[
              { value: String(currentYear - 1), label: String(currentYear - 1) },
              { value: String(currentYear), label: String(currentYear) },
              { value: String(currentYear + 1), label: String(currentYear + 1) },
            ]}
            value={String(year)}
            onChange={v => setYear(Number(v))}
            size="sm"
          />
          <Link href="/abonnements/achats"
            className="px-3 h-9 inline-flex items-center rounded-lg border border-line2 text-sm font-medium text-ink2 hover:bg-surface2">
            Contrats souscrits
          </Link>
          <Link href="/abonnements/reventes"
            className="px-3 h-9 inline-flex items-center rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
            Reventes
          </Link>
        </div>
      </div>

      {/* ── Indicateurs ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Chiffre d'affaires abonnements"
          value={totals.revenue}
          format={fullXof}
          icon={<TrendingUp size={17} />}
          trend={months.map(m => m.revenue)}
          hint={`Étalé sur ${year}`}
        />
        <KpiCard
          label="Coût des contrats"
          value={totals.cost}
          format={fullXof}
          icon={<Wallet size={17} />}
          tone="warn"
          trend={months.map(m => m.cost)}
          hint="Achat, retenues et frais bancaires inclus"
        />
        <KpiCard
          label="Marge brute"
          value={totals.margin}
          format={fullXof}
          icon={<Layers size={17} />}
          tone={totals.margin >= 0 ? "pos" : "neg"}
          trend={marginByMonth}
          hint={`${totals.marginRate} % du chiffre d'affaires`}
        />
        <KpiCard
          label="Alertes à traiter"
          value={alerts.length}
          icon={<AlertTriangle size={17} />}
          tone={criticalCount > 0 ? "neg" : alerts.length > 0 ? "warn" : "pos"}
          hint={criticalCount > 0 ? `dont ${criticalCount} critique(s)` : "Aucune urgence"}
        />
      </div>

      {/* ── Alertes ───────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <section className="bg-surface rounded-xl border border-line p-5">
          <h2 className="text-sm font-bold text-ink mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-warn" />
            Échéances et écarts
          </h2>
          <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {alerts.slice(0, 20).map((a, i) => (
              <li key={`${a.kind}-${a.reference}-${i}`}
                className={`text-sm px-3 py-2 rounded-lg border ${ALERT_STYLE[a.level]}`}>
                <span className="font-mono text-xs opacity-70 mr-2">{a.reference}</span>
                {a.message}
              </li>
            ))}
          </ul>
          {alerts.length > 20 && (
            <p className="text-xs text-ink3 mt-2">
              {alerts.length - 20} alerte(s) supplémentaire(s) non affichée(s).
            </p>
          )}
        </section>
      )}

      {/* ── Graphiques ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="bg-surface rounded-xl border border-line p-5 lg:col-span-2 rise rise-2">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-ink">
                {chart === "flux" ? "Produits et charges" : "Marge mensuelle"}
              </h2>
              <p className="text-xs text-ink2">
                Étalement au prorata des jours couverts — {year}
              </p>
            </div>
            <SegmentedControl
              ariaLabel="Type de graphique"
              segments={[
                { value: "flux", label: "Produits / charges" },
                { value: "marge", label: "Marge" },
              ]}
              value={chart}
              onChange={v => setChart(v as "flux" | "marge")}
              size="sm"
            />
          </div>

          {chart === "flux" ? (
            <AreaChart
              labels={labels}
              series={[
                { label: "Revenus", values: months.map(m => m.revenue) },
                { label: "Coûts", values: months.map(m => m.cost), color: "rgb(var(--c-warn))" },
              ]}
              height={260}
            />
          ) : (
            <BarChart
              labels={labels}
              series={[{ label: "Marge", values: marginByMonth }]}
              height={260}
            />
          )}
        </section>

        <section className="bg-surface rounded-xl border border-line p-5 rise rise-3">
          <h2 className="font-semibold text-ink mb-1">Marge par contrat</h2>
          <p className="text-xs text-ink2 mb-4">Contrats dégageant une marge positive</p>
          <DonutChart
            centerLabel="Marge totale"
            slices={reconciliations
              .filter(r => r.margin > 0)
              .sort((a, b) => b.margin - a.margin)
              .slice(0, 6)
              .map(r => ({ label: r.productName, value: r.margin }))}
            emptyMessage="Aucun contrat en marge positive"
          />
        </section>
      </div>

      {/* ── Rapprochement ─────────────────────────────────────────────── */}
      <section className="bg-surface rounded-xl border border-line overflow-hidden rise rise-4">
        <div className="p-5 pb-3">
          <h2 className="font-semibold text-ink">Rapprochement achat / revente</h2>
          <p className="text-xs text-ink2 mt-0.5">
            Ce qui est acquis, ce qui est placé, et ce qu'il reste à vendre sur chaque contrat.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="table-dense min-w-[52rem]">
            <thead>
              <tr>
                {["Contrat", "Fournisseur", "Placement", "Coût", "Revenu", "Marge", "Échéance"].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reconciliations.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-ink3">
                    Aucun contrat souscrit.{" "}
                    <Link href="/abonnements/achats" className="text-section font-medium underline">
                      En créer un
                    </Link>
                  </td>
                </tr>
              )}
              {reconciliations.map(r => (
                <tr key={r.purchaseId}>
                  <td>
                    <p className="font-medium text-ink">{r.productName}</p>
                    <p className="font-mono text-[11px] text-ink3">{r.purchaseRef}</p>
                  </td>
                  <td className="text-ink2">{r.supplier || "—"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded-full bg-line overflow-hidden shrink-0">
                        <div
                          className={`h-full rounded-full ${r.overSold ? "bg-neg" : "bg-section"}`}
                          style={{ width: `${Math.min(100, r.fillRate)}%` }}
                        />
                      </div>
                      <span className={`num text-xs ${r.overSold ? "text-neg font-semibold" : "text-ink2"}`}>
                        {r.quantitySold}/{r.quantityBought}
                      </span>
                    </div>
                  </td>
                  <td className="num text-ink2">{compactXof(r.cost)}</td>
                  <td className="num text-ink2">{compactXof(r.revenue)}</td>
                  <td>
                    <span className={`num font-semibold ${r.margin >= 0 ? "text-pos" : "text-neg"}`}>
                      {compactXof(r.margin)}
                    </span>
                    <span className="text-[11px] text-ink3 ml-1 num">({r.marginRate} %)</span>
                  </td>
                  <td className="text-ink2 whitespace-nowrap">
                    {new Date(r.endDate).toLocaleDateString("fr-FR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Charges fiscales ──────────────────────────────────────────── */}
      <section className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink flex items-center gap-2">
          <Landmark size={16} className="text-section" />
          Charges fiscales du portefeuille
        </h2>
        <p className="text-xs text-ink2 mt-0.5 mb-4">
          Calculées sur les contrats et reventes enregistrés. Elles n&apos;emportent
          aucune déclaration&nbsp;: seule la comptabilité fait foi.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "TVA collectée", value: tax.vatCollected, hint: "Sur les reventes" },
            { label: "TVA déductible", value: tax.vatRecoverable, hint: "Supportée à l'achat" },
            { label: "TVA à reverser", value: tax.vatDue, hint: tax.vatDue < 0 ? "Crédit reportable" : "Solde dû" },
            { label: "Retenues opérées", value: tax.withholdingPaid, hint: "Fournisseurs étrangers" },
          ].map(item => (
            <div key={item.label} className="rounded-lg border border-line p-3">
              <p className="text-xs text-ink2">{item.label}</p>
              <p className="text-lg font-bold text-ink num mt-1">{fullXof(item.value)}</p>
              <p className="text-[11px] text-ink3 mt-0.5">{item.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg bg-section-soft border border-section/20 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-ink2">Marge brute</p>
              <p className="text-xl font-bold text-ink num">{fullXof(tax.grossMargin)}</p>
            </div>
            <div>
              <p className="text-xs text-ink2">IS estimé (30 %)</p>
              <p className="text-xl font-bold text-ink num">{fullXof(tax.estimatedCorporateTax)}</p>
            </div>
            <div>
              <p className="text-xs text-ink2">Marge après IS</p>
              <p className="text-xl font-bold text-ink num">{fullXof(tax.marginAfterTax)}</p>
            </div>
          </div>
          <p className="text-[11px] text-ink2 mt-3 leading-relaxed">
            <strong>Estimation.</strong> L&apos;impôt sur les sociétés porte sur le résultat
            fiscal de l&apos;entreprise entière, après toutes charges et retraitements, et
            comporte un minimum forfaitaire. Ce chiffre isole la contribution de
            l&apos;activité d&apos;abonnements pour arbitrer une politique de prix — il ne
            remplace pas la liasse fiscale.
          </p>
        </div>
      </section>

      {data.unattachedSales.length > 0 && (
        <section className="bg-surface rounded-xl border border-warn/30 p-5">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <AlertTriangle size={15} className="text-warn" />
            {data.unattachedSales.length} revente(s) sans contrat amont
          </h2>
          <p className="text-xs text-ink2 mt-1">
            Leur marge est comptée comme totale faute de coût connu. Rattacher un
            contrat souscrit, ou vérifier qu&apos;il s&apos;agit bien d&apos;une prestation propre.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {data.unattachedSales.map(s => (
              <span key={s.reference} className="font-mono text-xs px-2 py-1 rounded bg-warn-50 text-warn">
                {s.reference}
              </span>
            ))}
          </div>
          <Link href="/abonnements/reventes"
            className="inline-flex items-center gap-1 text-sm text-section font-medium mt-3 hover:underline">
            Ouvrir les reventes <ArrowRight size={14} />
          </Link>
        </section>
      )}
    </div>
  );
}
