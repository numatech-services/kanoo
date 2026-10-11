import { redirect } from "next/navigation";

// Ancienne adresse de la numérotation : l'écran lisait un format que l'API ne
// renvoie plus. Les deux pages coexistaient ; seule /settings/numbering reste.
export default function NumerotationRedirect() {
  redirect("/settings/numbering");
}
