import { toLevels } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Types } from "mongoose";
import { connectDB } from "./db";
import { errorName } from "./errors";
import { getTokenFromRequest, verifyToken, TokenPayload } from "./auth";
import { rolesCanPerform, effectiveRoles } from "./role-resources";
import { verifyCsrf, CSRF_MESSAGES } from "./csrf";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { IdempotencyRecordModel } from "@/models/IdempotencyRecord";
import { UserRole } from "@/types";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
export function created<T>(data: T) {
  return NextResponse.json({ success: true, data }, { status: 201 });
}
export function noContent() {
  return new NextResponse(null, { status: 204 });
}
export function badRequest(message: string, errors?: Record<string, string>) {
  return NextResponse.json({ success: false, error: message, errors }, { status: 400 });
}
export function unauthorized(message = "Non authentifié") {
  return NextResponse.json({ success: false, error: message }, { status: 401 });
}
export function forbidden(message = "Accès interdit") {
  return NextResponse.json({ success: false, error: message }, { status: 403 });
}
export function notFound(message = "Ressource introuvable") {
  return NextResponse.json({ success: false, error: message }, { status: 404 });
}
export function conflict(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 409 });
}
export function paymentRequired(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 402 });
}

/**
 * Réponse 500. Le détail est journalisé côté serveur et remplacé par un
 * identifiant côté client : un message Mongo brut expose les noms de
 * collections, les contraintes et parfois des chemins de fichiers.
 */
export function serverError(error: unknown) {
  // Un identifiant malformé dans l'URL (CastError Mongoose) n'est pas une
  // panne : c'est une ressource qui ne peut pas exister. Le classer en 500
  // pollue les journaux d'« erreurs internes » qui n'en sont pas, et rend un
  // identifiant de référence à l'utilisateur pour une faute de frappe.
  if (errorName(error) === "CastError") {
    return notFound("Ressource introuvable (identifiant invalide).");
  }
  // Une ValidationError Mongoose vient d'un corps de requête invalide (un type
  // qui ne cadre pas, un champ requis absent), pas d'une panne du serveur : elle
  // se rend en 400, avec la liste des champs fautifs, plutôt qu'en 500 avec une
  // référence d'incident pour ce qui est une faute de saisie de l'appelant.
  if (errorName(error) === "ValidationError") {
    const fields = Object.keys((error as { errors?: Record<string, unknown> }).errors ?? {});
    return badRequest(
      fields.length > 0
        ? `Champs invalides : ${fields.join(", ")}.`
        : "Données invalides."
    );
  }
  // Un corps de requête que `req.json()` n'arrive pas à analyser lève une
  // SyntaxError : c'est un envoi malformé de l'appelant, pas une panne. Sans ce
  // classement, chaque route qui appelle `await req.json()` sans filet répondait
  // 500 avec une référence d'incident — et une pile dans les journaux — pour un
  // simple JSON mal formé. On le rend en 400, une fois pour les 174 routes.
  if (error instanceof SyntaxError) {
    return badRequest("Corps de requête illisible : JSON attendu.");
  }
  // Refus métier levé au fond d'une transaction : message utilisateur, 400.
  if (errorName(error) === "BusinessRuleError") {
    return badRequest(error instanceof Error ? error.message : "Opération refusée.");
  }

  const ref = crypto.randomBytes(6).toString("hex");
  console.error(`[API Error ${ref}]`, error);
  // Journal des erreurs (écran super-administrateur, résumé quotidien) — sans
  // attendre : la réponse à l'utilisateur ne dépend pas de l'écriture du journal.
  void import("@/lib/error-log").then(({ recordError }) => recordError({
    source: "api",
    message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ref,
  })).catch(() => undefined);
  return NextResponse.json(
    {
      success: false,
      error: "Une erreur interne est survenue. Communiquez cette référence au support.",
      reference: ref,
    },
    { status: 500 }
  );
}

export interface PaginationParams { page: number; limit: number; skip: number; }

export function getPagination(req: NextRequest): PaginationParams {
  const url = new URL(req.url);
  const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
  const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 20;
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * `extra` porte les agrégats calculés par la route (totaux, cumuls). Plusieurs
 * routes en passaient déjà un quatrième argument que la signature ignorait :
 * les totaux étaient calculés puis jetés en silence, et l'écran affichait des
 * cases vides.
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  { page, limit }: PaginationParams,
  extra?: Record<string, unknown>
) {
  return ok({
    items: data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    ...extra,
  });
}

export function getAuthContext(req: NextRequest): TokenPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try { return verifyToken(token); } catch { return null; }
}

export type RouteContext = { params: Promise<Record<string, string>> | Record<string, string> };

// Résout params (Next.js 15 les rend async, 14 synchrones)
export async function resolveParams(ctx: RouteContext): Promise<Record<string, string>> {
  if (!ctx?.params) return {};
  return ctx.params instanceof Promise ? await ctx.params : ctx.params;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Résultat de la revalidation du porteur du jeton contre la base. */
type SecurityCheck =
  | { ok: true; auth: TokenPayload }
  | { ok: false; response: NextResponse };

/**
 * Revalide le jeton contre l'état courant de la base.
 *
 * Principe : **le jeton prouve l'identité, la base décide des droits.** Le rôle,
 * les ressources autorisées et l'état de l'abonnement sont relus à chaque
 * requête plutôt que lus dans la charge utile du JWT — sans quoi rétrograder un
 * utilisateur ou suspendre une organisation resterait sans effet jusqu'à
 * l'expiration du jeton, et le rafraîchissement automatique reconduirait
 * indéfiniment les anciens droits.
 *
 * Coût : deux lectures indexées par requête, sur la connexion déjà ouverte.
 * C'est le prix d'une révocation qui révoque vraiment.
 */
export async function revalidate(auth: TokenPayload): Promise<SecurityCheck> {
  const user = await UserModel.findById(auth.userId)
    .select("sessionVersion isActive role roles roleLevels siteIds accessUntil allowedResources tenantId")
    .lean<{
      sessionVersion?: number;
      isActive?: boolean;
      role?: UserRole;
      roles?: UserRole[];
      roleLevels?: Record<string, string>;
      siteIds?: Array<{ toString(): string }>;
      accessUntil?: Date;
      allowedResources?: string[];
      tenantId?: { toString(): string };
    } | null>();

  if (!user) return { ok: false, response: unauthorized("Compte introuvable") };
  if (!user.isActive) return { ok: false, response: unauthorized("Compte désactivé") };
  // Stagiaire : l'accès s'arrête de lui-même à la date de fin de stage.
  if (user.accessUntil && new Date(user.accessUntil).getTime() < Date.now()) {
    return { ok: false, response: unauthorized("Accès expiré (fin de stage). Contactez le gérant.") };
  }
  // Niveaux par rôle et sites The Spot relus en base, comme les rôles.
  const roleLevels = toLevels(user.roleLevels);
  const siteIds = (user.siteIds ?? []).map(String);

  // Révocation : toute session émise avant le dernier incrément est refusée.
  // Un jeton sans sessionVersion date d'avant cette protection — il est refusé
  // aussi, ce qui force une reconnexion propre.
  const current = user.sessionVersion ?? 1;
  if ((auth.sessionVersion ?? 0) < current) {
    return { ok: false, response: unauthorized("Session révoquée. Reconnectez-vous.") };
  }

  // Le tenant du jeton doit rester celui de l'utilisateur en base.
  if (user.tenantId && user.tenantId.toString() !== auth.tenantId) {
    return { ok: false, response: unauthorized("Session incohérente. Reconnectez-vous.") };
  }

  const role = user.role ?? auth.role;
  // Rôles cumulés recalculés depuis la base : un rôle retiré à un collaborateur
  // prend effet immédiatement, comme pour le rôle principal.
  const roles = effectiveRoles(role, user.roles);

  if (role !== "superadmin") {
    const tenant = await TenantModel.findById(auth.tenantId)
      .select("subscriptionStatus type planModules")
      .lean<{ subscriptionStatus?: string; type?: string; planModules?: string[] } | null>();

    if (!tenant) return { ok: false, response: unauthorized("Organisation introuvable") };

    if (tenant.subscriptionStatus === "pending_activation") {
      return { ok: false, response: unauthorized("Compte non activé. Utilisez le lien reçu par e-mail.") };
    }
    if (tenant.subscriptionStatus === "suspended" || tenant.subscriptionStatus === "cancelled") {
      return {
        ok: false,
        response: paymentRequired("Abonnement inactif. Contactez le support."),
      };
    }

    return {
      ok: true,
      auth: {
        ...auth,
        role,
        roles,
        roleLevels,
        siteIds,
        allowedResources: user.allowedResources,
        subscriptionStatus: (tenant.subscriptionStatus as TokenPayload["subscriptionStatus"]) ?? auth.subscriptionStatus,
        planModules: tenant.planModules ?? auth.planModules,
        tenantType: (tenant.type as TokenPayload["tenantType"]) ?? auth.tenantType,
      },
    };
  }

  return { ok: true, auth: { ...auth, role, roles, roleLevels, siteIds, allowedResources: user.allowedResources } };
}

/**
 * Erreur transitoire de transaction (conflit d'écriture, création de
 * collection concurrente) : la transaction a été annulée, rien n'est écrit.
 * La requête est rejouée en entier — les documents sont relus, jamais repris
 * d'un état en mémoire — deux fois au plus.
 */
function isTransient(err: unknown): boolean {
  const e = err as { hasErrorLabel?: (l: string) => boolean; errorLabels?: string[]; code?: number };
  return !!(e?.hasErrorLabel?.("TransientTransactionError") || e?.errorLabels?.includes("TransientTransactionError") || e?.code === 112);
}
async function runWithTransientRetry(req: NextRequest, run: (r: NextRequest) => Promise<NextResponse>): Promise<NextResponse> {
  if (!MUTATING_METHODS.has(req.method)) return run(req);
  const copies = [req.clone(), req.clone()];
  let current = req;
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(current);
    } catch (err) {
      if (!isTransient(err) || attempt >= copies.length) throw err;
      current = copies[attempt] as NextRequest;
      await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

/**
 * Même contrôle que withAuth (jeton → revalidation en base → RBAC), pour une
 * route qui ne peut pas être enveloppée (flux PDF, réponse en Promise…).
 * Une lecture seule : pas de CSRF à vérifier.
 */
export async function authorize(
  req: NextRequest,
  resource: string,
  action: "create" | "read" | "update" | "delete",
): Promise<SecurityCheck> {
  const tokenAuth = getAuthContext(req);
  if (!tokenAuth) return { ok: false, response: unauthorized() };
  await connectDB();
  const check = await revalidate(tokenAuth);
  if (!check.ok) return check;
  const auth = check.auth;
  const authRoles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
  if (!rolesCanPerform(authRoles, resource, action, auth.allowedResources, auth.roleLevels)) {
    return { ok: false, response: forbidden(`Action '${action}' sur '${resource}' non autorisée pour ${authRoles.join(", ")}`) };
  }
  return check;
}

/** Empreinte d'une requête, pour détecter la réutilisation d'une clé d'idempotence. */
function fingerprint(method: string, url: string, body: string): string {
  return crypto.createHash("sha256").update(`${method} ${url} ${body}`).digest("hex");
}

/**
 * withAuth — enveloppe unique de toutes les routes API.
 *
 * Enchaîne : authentification → CSRF → revalidation en base → RBAC →
 * idempotence → connexion DB → délégation au gestionnaire.
 */
export function withAuth(
  resource: string,
  action: "create" | "read" | "update" | "delete",
  handler: (req: NextRequest, auth: TokenPayload, params: Record<string, string>) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx: RouteContext = { params: {} }): Promise<NextResponse> => {
    const tokenAuth = getAuthContext(req);
    if (!tokenAuth) return unauthorized();

    // CSRF avant tout travail : inutile d'ouvrir une connexion pour refuser.
    const verdict = verifyCsrf(req);
    if (verdict !== "ok") return forbidden(CSRF_MESSAGES[verdict]);

    try {
      await connectDB();

      const check = await revalidate(tokenAuth);
      if (!check.ok) return check.response;
      const auth = check.auth;

      const authRoles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
      if (!rolesCanPerform(authRoles, resource, action, auth.allowedResources, auth.roleLevels)) {
        return forbidden(`Action '${action}' sur '${resource}' non autorisée pour ${authRoles.join(", ")}`);
      }

      const params = await resolveParams(ctx);

      // ── Idempotence ───────────────────────────────────────────────────────
      // Facultative : une requête sans clé se comporte comme avant. Le rejeu
      // hors-ligne, lui, en fournit systématiquement une.
      const key = req.headers.get("idempotency-key");
      if (!key || !MUTATING_METHODS.has(req.method)) {
        return await runWithTransientRetry(req, r => handler(r, auth, params));
      }

      const rawBody = await req.clone().text().catch(() => "");
      const print = fingerprint(req.method, new URL(req.url).pathname, rawBody);

      const existing = await IdempotencyRecordModel.findOne({
        tenantId: auth.tenantId, userId: auth.userId, key,
      }).lean<{ fingerprint: string; state: string; status?: number; body?: unknown } | null>();

      if (existing) {
        if (existing.fingerprint !== print) {
          return conflict("Cette clé d'idempotence a déjà servi pour une requête différente.");
        }
        if (existing.state === "in_flight") {
          // La première tentative court encore. Rejouer maintenant créerait le
          // doublon qu'on cherche à éviter : le client doit réessayer.
          return NextResponse.json(
            { success: false, error: "Requête identique en cours de traitement." },
            { status: 409, headers: { "Retry-After": "2" } }
          );
        }
        return NextResponse.json(existing.body, { status: existing.status ?? 200 });
      }

      try {
        await IdempotencyRecordModel.create({
          tenantId: auth.tenantId, userId: auth.userId, key, fingerprint: print, state: "in_flight",
        });
      } catch {
        // Course entre deux rejeux : l'index unique a tranché, l'autre gagne.
        return NextResponse.json(
          { success: false, error: "Requête identique en cours de traitement." },
          { status: 409, headers: { "Retry-After": "2" } }
        );
      }

      let response: NextResponse;
      try {
        response = await runWithTransientRetry(req, r => handler(r, auth, params));
      } catch (err) {
        // L'échec ne doit pas être mémorisé : le client doit pouvoir réessayer.
        await IdempotencyRecordModel.deleteOne({ tenantId: auth.tenantId, userId: auth.userId, key });
        throw err;
      }

      // Seuls les succès sont mémorisés. Une validation refusée doit pouvoir
      // être rejouée après correction, avec la même clé.
      if (response.status >= 200 && response.status < 300) {
        const payload = await response.clone().json().catch(() => null);
        await IdempotencyRecordModel.updateOne(
          { tenantId: auth.tenantId, userId: auth.userId, key },
          { $set: { state: "done", status: response.status, body: payload } }
        );
      } else {
        await IdempotencyRecordModel.deleteOne({ tenantId: auth.tenantId, userId: auth.userId, key });
      }

      return response;
    } catch (err) {
      return serverError(err);
    }
  };
}

/**
 * Filtre d'isolation par organisation.
 *
 * Renvoie un **ObjectId**, pas une chaîne. C'est capital pour les pipelines
 * `aggregate` : `find` et `countDocuments` castent tout seuls une chaîne en
 * ObjectId (Mongoose caste la requête), mais un pipeline d'agrégation part tel
 * quel vers MongoDB, qui exige une correspondance de type stricte. Avec une
 * chaîne, tout `$match: { tenantId }` renvoyait **vide** — chaque statistique,
 * rapport et graphique affichait donc zéro en production, en silence.
 *
 * L'ObjectId reste valide pour `find`/`countDocuments`/`updateOne`, si bien
 * qu'un seul type couvre tous les usages.
 */
export function tenantFilter(auth: TokenPayload): { tenantId: Types.ObjectId } {
  return { tenantId: new Types.ObjectId(auth.tenantId) };
}

/**
 * Portée « factures de vente », à l'exclusion des avoirs.
 *
 * Les avoirs vivent dans la même collection que les factures — même
 * numérotation, même PDF, même certification. Le revers de ce choix est
 * qu'**une somme de chiffre d'affaires qui ne filtre pas sur `documentType`
 * compte les avoirs en positif**, et gonfle donc le CA au lieu de le réduire.
 *
 * Toute agrégation de produits passe par cet helper. Un test structurel
 * (`__tests__/unit/route-contracts.test.ts`) refuse toute nouvelle somme de
 * `totalTTC` qui l'oublierait.
 */
export function salesScope(auth: TokenPayload): Record<string, unknown> {
  return { tenantId: auth.tenantId, documentType: { $ne: "credit_note" } };
}

/** Portée « avoirs » seuls, à retrancher du chiffre d'affaires. */
export function creditNoteScope(auth: TokenPayload): Record<string, unknown> {
  return { tenantId: auth.tenantId, documentType: "credit_note" };
}

export function requireFields(body: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = body[field];
    if (value === undefined || value === null || value === "") {
      return `Le champ '${field}' est obligatoire`;
    }
  }
  return null;
}

/**
 * Champs qu'aucune requête cliente ne peut écrire, quelle que soit la route.
 * `tenantId` en tête : le laisser passer permettrait de déplacer un
 * enregistrement vers une autre organisation, en contournant le filtre de
 * lecture qui, lui, est bien en place.
 */
const NEVER_WRITABLE = [
  "_id", "__v", "tenantId", "createdBy", "createdAt", "updatedAt",
];

/**
 * Retire d'un corps de requête les champs jamais modifiables, plus ceux que la
 * route juge dérivés. À appeler avant tout `findOneAndUpdate(filtre, body)`.
 */
export function sanitizeBody(
  body: Record<string, unknown>,
  alsoStrip: string[] = []
): Record<string, unknown> {
  const clean = { ...body };
  for (const field of [...NEVER_WRITABLE, ...alsoStrip]) delete clean[field];
  // Un opérateur Mongo dans le corps ($set, $inc, $where…) contournerait le
  // filtrage ci-dessus.
  for (const field of Object.keys(clean)) {
    if (field.startsWith("$")) delete clean[field];
  }
  return clean;
}
