/**
 * Points d'accroche Next.js :
 *  - register : au démarrage du serveur, le fuseau de l'application
 *    (lib/timezone.ts) avant toute requête ;
 *  - onRequestError : les erreurs de rendu serveur (pages, layouts, actions)
 *    rejoignent le journal des erreurs, avec le digest affiché à l'utilisateur
 *    sur la page d'erreur.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureProcessTimezone } = await import("@/lib/timezone");
  ensureProcessTimezone();
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/lib/error-log");
  const e = err as Error & { digest?: string };
  await recordError({
    source: "render",
    message: `${e?.name ?? "Error"}: ${e?.message ?? String(err)} (${context.routeType} ${context.routePath})`,
    stack: e?.stack,
    url: request.path,
    ref: e?.digest,
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined,
  });
}
