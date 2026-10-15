import { AppShell } from "@/components/layout/AppShell";
import { getServerTenantType } from "@/lib/server-auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Les écrans partagés (projets, messages, utilisateurs…) servent aussi les
  // associations et les administrations : la palette suit leur menu, pas celui
  // d'une entreprise.
  const profile = await getServerTenantType();
  return <AppShell space="pme" profile={profile} home="/dashboard">{children}</AppShell>;
}
