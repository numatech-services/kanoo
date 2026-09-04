import { SidebarWrapper } from "@/components/layout/SidebarWrapper";
import { TopBar } from "@/components/layout/TopBar";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { SupportButton } from "@/components/shared/SupportButton";
import { SectionScope } from "@/components/layout/SectionScope";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { IdleTimeout } from "@/components/shared/IdleTimeout";

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <SectionScope space="administration">
    <div className="flex h-screen overflow-hidden bg-surface2">
      <SidebarWrapper />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
            {children}
        </main>
      </div>
      <CommandPalette />
      <OfflineBanner />
      <SupportButton />
      <IdleTimeout />
    </div>
    </SectionScope>
  );
}
