import { Suspense } from "react";
import { QuotesPanel } from "@/components/home/QuotesPanel";
import { DashboardHero } from "@/components/pme/DashboardHero";
import { DailyBrief } from "@/components/pme/DailyBrief";
import { UpcomingAgenda } from "@/components/agenda/UpcomingAgenda";
import { UpcomingEvents } from "@/components/shared/UpcomingEvents";
import { HomeHero } from "@/components/home/HomeHero";
import { KpiRow } from "@/components/home/KpiRow";
import { TreasuryPanel } from "@/components/home/TreasuryPanel";
import { ReceivablesDonut } from "@/components/home/ReceivablesDonut";
import { InvoicesPanel } from "@/components/home/InvoicesPanel";
import { UpcomingPanel, RemindersPanel } from "@/components/home/AgendaPanels";
import { ObjectiveGauge, QuickActions, AssistantPanel, RememberPanel } from "@/components/home/SideColumn";
import { getServerAccess } from "@/lib/server-auth";
import { loadDashboard } from "@/lib/dashboard-home";

export const metadata = { title: "Tableau de bord" };
export const dynamic = "force-dynamic";

/**
 * Tableau de bord (charte v5). Pour les rôles qui suivent factures et
 * encaissements : bandeau, indicateurs, trésorerie, créances, factures,
 * échéances, relances, objectif, actions rapides, assistant. Pour les autres
 * (comptoir, ISIC, accueil…) : l'accueil neutre et leurs raccourcis.
 */
export default async function DashboardPage() {
  const access = await getServerAccess();
  if (!access) return null;
  if (!access.can("invoices") || !access.can("payments")) {
    return (
      <div className="space-y-6">
        <Suspense fallback={<div className="h-44 bg-surface rounded-[24px] border border-line animate-pulse" />}><DashboardHero /></Suspense>
        <Suspense fallback={<div className="h-40 bg-surface rounded-[22px] border border-line animate-pulse" />}><DailyBrief /></Suspense>
        <div className="grid lg:grid-cols-2 gap-6"><UpcomingAgenda agendaHref="/agenda" /><UpcomingEvents /></div>
      </div>
    );
  }

  const d = await loadDashboard(access.auth, access.can);
  const suggestions = [
    d.receivables?.clients[0]?.clientId ? `Combien me doit ${d.receivables.clients[0].name} ?` : "Combien reste à encaisser ?",
    "Quelles factures sont en retard ?",
    "Résume mes brouillons",
  ];
  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-[22px] items-start pb-2">
      <div className="flex flex-col gap-[22px] min-w-0">
        {d.hero && <HomeHero g={d.greeting} hero={d.hero} />}
        <KpiRow k={d.kpis} />
        {(d.treasury || d.receivables) && (
          <div className={`grid gap-[22px] ${d.treasury && d.receivables ? "lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]" : ""}`}>
            {d.treasury && <TreasuryPanel t={d.treasury} />}
            {d.receivables && <ReceivablesDonut r={d.receivables} />}
          </div>
        )}
        {d.invoices && <InvoicesPanel inv={d.invoices} />}
        {(d.upcoming || d.reminders) && (
          <div className="grid md:grid-cols-2 gap-[22px]">
            {d.upcoming && <UpcomingPanel items={d.upcoming} />}
            {d.reminders && <RemindersPanel r={d.reminders} />}
          </div>
        )}
      </div>
      <aside className="flex flex-col gap-[22px] min-w-0" aria-label="Pilotage">
        {d.objective && <ObjectiveGauge o={d.objective} month={d.greeting.month} />}
        {d.quotes && <QuotesPanel q={d.quotes} />}
        <QuickActions can={{ invoice: access.can("invoices", "create"), quote: access.can("devis", "create"), payment: access.can("payments", "create"), client: access.can("clients", "create") }} />
        <AssistantPanel suggestions={suggestions} />
        <RememberPanel items={d.brief} />
      </aside>
    </div>
  );
}
