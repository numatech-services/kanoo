import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

// CONFIGURATION DES VIEWPORTS (Pour supprimer les warnings ⚠ dans tes logs)
export const viewport = {
  themeColor: "#0F172A", // Remplace par la couleur de ta marque (ex: Cedar ou Ink)
  width: "device-width",
  initialScale: 1,
};

export default function SaasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-sand overflow-hidden">
      {/* Barre latérale fixe */}
      <Sidebar profile="superadmin" />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Barre supérieure */}
        <TopBar />

        {/* Zone de contenu principal */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* On enveloppe children pour stabiliser l'hydratation */}
          <div className="h-full w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}