"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, Mail, FileText, Receipt, Banknote } from "lucide-react";
import { BarChart } from "@/components/ui/charts/BarChart";
import { Pill, Avatar } from "@/components/ui/Primitives";
import { fullXof, compactXof } from "@/components/ui/charts/geometry";
import { KIND_LABEL, type Statement, type StatementKind } from "@/lib/statement";

import { buttonClass } from "@/components/ui/button-class";
import { useApi } from "@/lib/use-api";
interface Payload {
  client: { name: string; code?: string; email?: string; nif?: string; address?: string };
  statement: Statement;
  summary: string;
}

const KIND_ICON: Record<StatementKind, typeof FileText> = {
  invoice: FileText,
  credit_note: Receipt,
  payment: Banknote,
};

const KIND_TONE: Record<StatementKind, "info" | "warn" | "pos"> = {
  invoice: "info",
  credit_note: "warn",
  payment: "pos",
};

function firstOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

export default function RelevePage() {
  const { id } = useParams();
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const releve = useApi<Payload | null>(
    `/api/clients/${id}/releve?from=${from}&to=${to}`, d => (d.success ? d.data : null), null,
  );
  const { loading, error } = releve;
  // Une lecture en échec garde le dernier relevé affiché (avec le message d'erreur).
  const [lastData, setLastData] = useState<Payload | null>(null);
  if (releve.data && releve.data !== lastData) setLastData(releve.data);
  const data = releve.data ?? lastData;

  if (loading && !data) return <div className="h-96 surface-card animate-pulse" />;
  if (!data) {
    return <p className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
      {error || "Relevé indisponible."}
    </p>;
  }

  const { client, statement, summary } = data;
  const t = statement.totals;
  const pdfUrl = `/api/clients/${id}/releve/pdf?from=${from}&to=${to}`;

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <Link href={`/clients/${id}`} className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
            <ArrowLeft size={13} /> Fiche client
          </Link>
          <h1 className="page-title mt-1 flex items-center gap-2">
            <Avatar name={client.name} /> Relevé — {client.name}
          </h1>
          <p className="text-sm text-ink2">
            La suite des mouvements qui mènent au solde. Un solde sans son chemin ne se
            conteste pas&nbsp;: il se subit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={pdfUrl}
            className={buttonClass("secondary", "md")}>
            <Download size={15} /> PDF
          </a>
          {client.email && (
            <a href={`mailto:${client.email}?subject=${encodeURIComponent(`Relevé de compte au ${new Date(to).toLocaleDateString("fr-FR")}`)}&body=${encodeURIComponent(summary)}`}
              className={buttonClass("primary", "md")}>
              <Mail size={15} /> Envoyer
            </a>
          )}
        </div>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      {/* La phrase avant les colonnes. */}
      <p className={`px-4 py-3 rounded-xl text-sm border ${
        t.overdueAmount > 0
          ? "bg-warn-50 border-warn/25 text-warn"
          : t.closingBalance > 0
            ? "bg-info-50 border-info/25 text-info"
            : "bg-pos-50 border-pos/25 text-pos"
      }`}>
        {summary}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink2">
          Du
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="ml-2 h-9 px-2 rounded-lg border border-line2 bg-surface text-sm text-ink" />
        </label>
        <label className="text-xs text-ink2">
          au
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="ml-2 h-9 px-2 rounded-lg border border-line2 bg-surface text-sm text-ink" />
        </label>
        <button onClick={() => { setFrom(firstOfYear()); setTo(new Date().toISOString().slice(0, 10)); }}
          className="fchip">Exercice en cours</button>
      </div>

      <div className="strip" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <div>
          <p className="text-xs text-ink2">Solde à l&apos;ouverture</p>
          <p className="text-lg font-bold text-ink num mt-0.5">{fullXof(t.openingBalance)}</p>
        </div>
        <div>
          <p className="text-xs text-ink2">Facturé sur la période</p>
          <p className="text-lg font-bold text-ink num mt-0.5">{fullXof(t.invoiced)}</p>
        </div>
        <div>
          <p className="text-xs text-ink2">Réglé et crédité</p>
          <p className="text-lg font-bold text-pos num mt-0.5">{fullXof(t.paid + t.credited)}</p>
          {t.credited > 0 && (
            <p className="text-[11px] text-ink3">dont {fullXof(t.credited)} d&apos;avoirs</p>
          )}
        </div>
        <div>
          <p className="text-xs text-ink2">Solde à la clôture</p>
          <p className={`text-lg font-bold num mt-0.5 ${
            t.closingBalance > 0 ? "text-ink" : "text-pos"
          }`}>{fullXof(t.closingBalance)}</p>
          {t.overdueAmount > 0 && (
            <p className="text-[11px] text-neg">dont {fullXof(t.overdueAmount)} échus</p>
          )}
        </div>
      </div>

      <section className="surface-card overflow-hidden">
        <div className="p-5 pb-3">
          <h2 className="font-semibold text-ink">Mouvements</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-dense min-w-[48rem]">
            <thead>
              <tr>
                <th>Date</th><th>Nature</th><th>Référence</th>
                <th className="text-right">Débit</th><th className="text-right">Crédit</th>
                <th className="text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-semibold">
                <td className="text-ink2 whitespace-nowrap">{new Date(from).toLocaleDateString("fr-FR")}</td>
                <td colSpan={4} className="text-ink2">Solde à l&apos;ouverture</td>
                <td className="num text-right text-ink">{fullXof(t.openingBalance)}</td>
              </tr>

              {statement.rows.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-ink3">
                  Aucun mouvement sur cette période.
                </td></tr>
              )}

              {statement.rows.map(row => {
                const Icon = KIND_ICON[row.kind];
                return (
                  <tr key={String(row._id)}>
                    <td className="text-ink2 whitespace-nowrap">
                      {new Date(row.date).toLocaleDateString("fr-FR")}
                    </td>
                    <td>
                      <Pill tone={KIND_TONE[row.kind]} icon={<Icon size={11} />}>
                        {KIND_LABEL[row.kind]}
                      </Pill>
                    </td>
                    <td className="text-ink">
                      {row.reference}
                      {row.daysPastDue > 0 && (
                        <span className="ml-2 text-[11px] text-neg num">
                          échue depuis {row.daysPastDue} j
                        </span>
                      )}
                    </td>
                    <td className="num text-right text-ink">
                      {row.amount > 0 ? fullXof(row.amount) : ""}
                    </td>
                    <td className="num text-right text-pos">
                      {row.amount < 0 ? fullXof(-row.amount) : ""}
                    </td>
                    <td className="num text-right font-medium text-ink">{fullXof(row.balance)}</td>
                  </tr>
                );
              })}

              <tr className="font-semibold border-t-2 border-line2">
                <td className="text-ink2 whitespace-nowrap">{new Date(to).toLocaleDateString("fr-FR")}</td>
                <td colSpan={2} className="text-ink">Solde à la clôture</td>
                <td className="num text-right text-ink">{fullXof(t.invoiced)}</td>
                <td className="num text-right text-pos">{fullXof(t.paid + t.credited)}</td>
                <td className="num text-right text-ink">{fullXof(t.closingBalance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {t.closingBalance > 0 && statement.aging.some(a => a.amount > 0) && (
        <section className="surface-card p-5">
          <h2 className="font-semibold text-ink">Ancienneté du solde</h2>
          <p className="text-xs text-ink2 mt-0.5 mb-4">
            Lue pièce par pièce, jamais sur le total&nbsp;: deux millions dont un depuis six
            mois n&apos;est pas deux millions depuis huit jours.
          </p>
          <BarChart
            labels={statement.aging.map(a => a.label)}
            series={[{ label: "Restant dû", values: statement.aging.map(a => a.amount) }]}
            formatValue={compactXof}
            height={170}
            emptyMessage="Aucune pièce ouverte."
          />
        </section>
      )}
    </div>
  );
}
