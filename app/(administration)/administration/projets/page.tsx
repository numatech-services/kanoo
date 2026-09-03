import { redirect } from "next/navigation";

/**
 * Module unifié : cet écran dupliquait une implémentation identique à
 * un littéral près. Il redirige vers l'écran unique, dont le
 * vocabulaire s'adapte au profil du tenant (voir lib/vocabulary.ts).
 *
 * La redirection est conservée plutôt que la page supprimée : les liens
 * envoyés par notification et les favoris des utilisateurs pointent
 * encore ici.
 */
export default function Page() {
  redirect("/projects");
}
