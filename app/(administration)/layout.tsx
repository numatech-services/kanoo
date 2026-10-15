import { AppShell } from "@/components/layout/AppShell";

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  return <AppShell space="administration" profile="administration" home="/administration/dashboard">{children}</AppShell>;
}
