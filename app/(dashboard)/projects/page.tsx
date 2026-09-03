import { getServerTenantType } from "@/lib/server-auth";
import { projectVocabulary } from "@/lib/vocabulary";
import { ProjectsBoard } from "@/components/projects/ProjectsBoard";

export const metadata = { title: "Projets" };

/**
 * Le profil du tenant est lu côté serveur, depuis le jeton : pas d'appel
 * réseau supplémentaire, et aucun clignotement de vocabulaire au chargement.
 */
export default async function ProjectsPage() {
  const profile = await getServerTenantType();
  return <ProjectsBoard vocabulary={projectVocabulary(profile)} />;
}
