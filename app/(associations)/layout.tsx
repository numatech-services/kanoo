import { AppShell } from "@/components/layout/AppShell";

export default function AssociationsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell space="association" profile="association" home="/associations/dashboard">{children}</AppShell>;
}
