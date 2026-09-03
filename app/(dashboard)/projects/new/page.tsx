import { getServerTenantType } from "@/lib/server-auth";
import { projectVocabulary } from "@/lib/vocabulary";
import { NewProjectForm } from "@/components/projects/NewProjectForm";

export const metadata = { title: "Nouveau projet" };

export default async function NewProjectPage() {
  const profile = await getServerTenantType();
  return <NewProjectForm vocabulary={projectVocabulary(profile)} />;
}
