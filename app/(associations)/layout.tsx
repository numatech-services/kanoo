import { SidebarWrapper } from "@/components/layout/SidebarWrapper";
import { TopBar } from "@/components/layout/TopBar";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { SupportButton } from "@/components/shared/SupportButton";
import { SectionScope } from "@/components/layout/SectionScope";
import { CommandPalette } from "@/components/shared/CommandPalette";

export default function AssociationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SectionScope>
    <div className="flex h-screen overflow-hidden bg-sand">
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
    </div>
    </SectionScope>
  );
}
