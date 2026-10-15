import { SidebarWrapper } from "@/components/layout/SidebarWrapper";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { PageGuard } from "@/components/layout/PageGuard";
import { TopBar } from "@/components/layout/TopBar";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { SupportButton } from "@/components/shared/SupportButton";
import { SectionScope, type SpaceKey } from "@/components/layout/SectionScope";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { IdleTimeout } from "@/components/shared/IdleTimeout";
import type { ProfileType } from "@/components/layout/Sidebar";

/**
 * Coque commune des trois espaces (charte v5) : sur grand écran, l'application
 * tient dans une carte arrondie posée sur un fond à halos ; sur téléphone, la
 * carte occupe tout l'écran et le menu devient un tiroir.
 */
export function AppShell({ space, profile, home, children }: { space: SpaceKey; profile: ProfileType; home: string; children: React.ReactNode }) {
  return (
    <SectionScope space={space}>
      <div className="app-page h-screen overflow-hidden lg:p-5 xl:p-6">
        <div className="app-shell flex h-full overflow-hidden max-w-[1600px] mx-auto">
          <SidebarWrapper />
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <TopBar />
            <main className="flex-1 overflow-y-auto px-4 sm:px-7 pt-3 pb-24 lg:pb-8">
              <PageGuard>{children}</PageGuard>
            </main>
          </div>
        </div>
        <CommandPalette profile={profile} />
        <MobileTabBar home={home} />
        <OfflineBanner />
        <SupportButton />
        <IdleTimeout />
      </div>
    </SectionScope>
  );
}
