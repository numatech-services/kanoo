import { Suspense } from "react";
import { StatCards } from "@/components/pme/StatCards";
import { RecentInvoices } from "@/components/pme/RecentInvoices";
import { RecentDeliveries } from "@/components/pme/RecentDeliveries";
import { CashflowChart } from "@/components/pme/CashflowChart";
import { AlertsPanel } from "@/components/shared/AlertsPanel";
import { DashboardHero } from "@/components/pme/DashboardHero";
import { DailyBrief } from "@/components/pme/DailyBrief";
import { UpcomingEvents } from "@/components/shared/UpcomingEvents";
import { UpcomingAgenda } from "@/components/agenda/UpcomingAgenda";
import { getServerAccess } from "@/lib/server-auth";

export const metadata = { title: "Tableau de bord" };

export default async function DashboardPage() {
  // Le graphique de trésorerie lit la comptabilité : masqué pour qui n'y a pas accès.
  const canCashflow = (await getServerAccess())?.can("accountingEntries") ?? false;
  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="h-44 bg-surface rounded-2xl border border-line animate-pulse" />}>
        <DashboardHero />
      </Suspense>

      <Suspense fallback={<div className="h-40 bg-surface rounded-2xl border border-line animate-pulse" />}>
        <DailyBrief />
      </Suspense>

      {/* KPI Cards */}
      <Suspense fallback={<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{[...Array(4)].map((_,i)=><div key={i} className="h-28 bg-surface rounded-xl border border-line animate-pulse"/>)}</div>}>
        <StatCards />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Graphique trésorerie */}
        {canCashflow && (
          <div className="lg:col-span-2">
            <Suspense fallback={<div className="h-72 bg-surface rounded-xl border border-line animate-pulse" />}>
              <CashflowChart />
            </Suspense>
          </div>
        )}

        {/* Alertes + Prochaines activités + Bons de livraison */}
        <div className="space-y-4">
          <Suspense fallback={<div className="h-48 bg-surface rounded-xl border border-line animate-pulse" />}>
            <AlertsPanel />
          </Suspense>
          <UpcomingAgenda agendaHref="/agenda" />
          <UpcomingEvents />
          <Suspense fallback={<div className="h-48 bg-surface rounded-xl border border-line animate-pulse" />}>
            <RecentDeliveries />
          </Suspense>
        </div>
      </div>

      {/* Factures récentes */}
      <Suspense fallback={<div className="h-48 bg-surface rounded-xl border border-line animate-pulse" />}>
        <RecentInvoices />
      </Suspense>
    </div>
  );
}
