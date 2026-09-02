import { getServerTenantType } from "@/lib/server-auth";
import { Sidebar } from "./Sidebar";

export async function SidebarWrapper() {
  const profile = await getServerTenantType();
  return <Sidebar profile={profile} />;
}
