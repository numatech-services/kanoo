import { SidebarWrapper } from "@/components/layout/SidebarWrapper";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { PageGuard } from "@/components/layout/PageGuard";
import { TopBar } from "@/components/layout/TopBar";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { SupportButton } from "@/components/shared/SupportButton";
import { SectionScope } from "@/components/layout/SectionScope";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { IdleTimeout } from "@/components/shared/IdleTimeout";
import { getServerTenantType } from "@/lib/server-auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Les écrans partagés (projets, messages, utilisateurs…) servent aussi les
  // associations et les administrations : la palette suit leur menu, pas celui
  // d'une entreprise.
  const profile = await getServerTenantType();
  return (
    <SectionScope space="pme">
    <div className="flex h-screen overflow-hidden bg-surface2">
      <SidebarWrapper />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 lg:pb-6">
            <PageGuard>{children}</PageGuard>
        </main>
      </div>
      <CommandPalette profile={profile} />
      <MobileTabBar home="/dashboard" />
      <OfflineBanner />
      <SupportButton />
      <IdleTimeout />
    </div>
    </SectionScope>
  );
}
