import { Suspense } from "react";
import { StatCards } from "@/components/pme/StatCards";
import { RecentInvoices } from "@/components/pme/RecentInvoices";
import { RecentDeliveries } from "@/components/pme/RecentDeliveries";
import { CashflowChart } from "@/components/pme/CashflowChart";
import { AlertsPanel } from "@/components/shared/AlertsPanel";
import { UpcomingEvents } from "@/components/shared/UpcomingEvents";

export const metadata = { title: "Tableau de bord" };

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Tableau de bord</h1>

      {/* KPI Cards */}
      <Suspense fallback={<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{[...Array(4)].map((_,i)=><div key={i} className="h-24 bg-white rounded-xl border border-clay/20 animate-pulse"/>)}</div>}>
        <StatCards />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Graphique trésorerie */}
        <div className="lg:col-span-2">
          <Suspense fallback={<div className="h-64 bg-white rounded-xl border border-clay/20 animate-pulse" />}>
            <CashflowChart />
          </Suspense>
        </div>

        {/* Alertes + Prochaines activités + Bons de livraison */}
        <div className="space-y-4">
          <Suspense fallback={<div className="h-48 bg-white rounded-xl border border-clay/20 animate-pulse" />}>
            <AlertsPanel />
          </Suspense>
          <UpcomingEvents />
          <Suspense fallback={<div className="h-48 bg-white rounded-xl border border-clay/20 animate-pulse" />}>
            <RecentDeliveries />
          </Suspense>
        </div>
      </div>

      {/* Factures récentes */}
      <Suspense fallback={<div className="h-48 bg-white rounded-xl border border-clay/20 animate-pulse" />}>
        <RecentInvoices />
      </Suspense>
    </div>
  );
}
