import { getServerTenantType } from "@/lib/server-auth";
import { projectVocabulary } from "@/lib/vocabulary";
import { ProjectDetail } from "@/components/projects/ProjectDetail";

export default async function ProjectDetailPage() {
  const profile = await getServerTenantType();
  return <ProjectDetail vocabulary={projectVocabulary(profile)} />;
}
