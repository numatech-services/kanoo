/**
 * Lecture d'une erreur capturée.
 *
 * Avec `strict`, la variable d'un `catch` est de type `unknown` : c'est correct,
 * puisque JavaScript autorise à lancer n'importe quelle valeur. Le dépôt
 * contournait la contrainte en écrivant `catch (error: any)` — 23 fois — ce qui
 * redonne l'accès à `.message` sans garantir qu'il existe, et fait planter le
 * gestionnaire d'erreur lui-même quand la valeur lancée n'est pas une Error.
 */

export function errorMessage(error: unknown, fallback = "Une erreur est survenue."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  // Erreur d'API sérialisée : { error: "…" } ou { message: "…" }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return fallback;
}

/**
 * Nom d'une erreur, quand elle en porte un. Sert à reconnaître les erreurs
 * Mongoose (`CastError`, `ValidationError`) sans revenir à `any`.
 */
export function errorName(error: unknown): string | null {
  if (error instanceof Error) return error.name;
  if (error && typeof error === "object") {
    const name = (error as Record<string, unknown>).name;
    if (typeof name === "string") return name;
  }
  return null;
}
