import { NextRequest } from "next/server";
import { withAuth, ok, forbidden } from "@/lib/api-helpers";
import { isUsableSecret, TokenPayload } from "@/lib/auth";
import { AuditLogModel } from "@/models/AuditLog";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/security/posture
 *
 * Renvoie l'état **mesuré** des protections, pas une liste de voyants écrite en
 * dur. La page qui l'affichait annonçait « CSRF Protection ✅ Activé » alors que
 * plus aucune route ne vérifiait le jeton : un tableau de bord de sécurité qui
 * se trompe est pire que pas de tableau de bord.
 *
 * Chaque contrôle rapporte ce qu'il a réellement pu observer à l'exécution.
 * Ce qui n'est pas observable n'est pas affiché.
 */

type Level = "ok" | "warn" | "critical";

interface Control {
  key: string;
  label: string;
  level: Level;
  value: string;
  detail: string;
}

function secretControl(key: string, label: string, required: boolean): Control {
  const raw = process.env[key];
  if (!raw) {
    return {
      key, label,
      level: required ? "critical" : "warn",
      value: "Non défini",
      detail: required
        ? "Secret obligatoire absent — l'authentification échouera en production."
        : "Non défini : une valeur dérivée est utilisée. Définir un secret propre isole cette surface.",
    };
  }
  if (!isUsableSecret(raw)) {
    return {
      key, label, level: "critical", value: "Non conforme",
      detail: raw.length < 32
        ? `Trop court (${raw.length} caractères, minimum 32).`
        : "Laissé à sa valeur d'exemple. Générer : openssl rand -hex 32",
    };
  }
  return { key, label, level: "ok", value: "Configuré", detail: `${raw.length} caractères, valeur propre.` };
}

export const GET = withAuth("*", "read", async (_req: NextRequest, auth: TokenPayload) => {
  if (auth.role !== "superadmin") return forbidden();

  const isProd = process.env.NODE_ENV === "production";
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  // Preuve que la journalisation d'audit écrit vraiment : on compte des lignes.
  const [auditLast24h, loginFailures] = await Promise.all([
    AuditLogModel.countDocuments({ createdAt: { $gte: since } }),
    AuditLogModel.countDocuments({ createdAt: { $gte: since }, action: "LOGIN_FAILED" }),
  ]);

  const controls: Control[] = [
    secretControl("JWT_SECRET", "Secret de session", true),
    secretControl("PORTAL_JWT_SECRET", "Secret des portails", false),
    secretControl("FIELD_ENCRYPTION_KEY", "Chiffrement au repos", false),
    secretControl("TICKET_SECRET", "Signature des billets", false),
    {
      key: "cookies",
      label: "Cookies sécurisés",
      level: isProd ? "ok" : "warn",
      value: isProd ? "secure + httpOnly" : "httpOnly seul",
      detail: isProd
        ? "L'indicateur secure est posé : les cookies ne partent que sur HTTPS."
        : "NODE_ENV n'est pas « production » : l'indicateur secure est désactivé pour permettre le développement en HTTP.",
    },
    {
      key: "transactions",
      label: "Transactions MongoDB",
      level: process.env.MONGO_NO_TRANSACTIONS === "true" ? "critical" : "ok",
      value: process.env.MONGO_NO_TRANSACTIONS === "true" ? "Désactivées" : "Actives",
      detail: process.env.MONGO_NO_TRANSACTIONS === "true"
        ? "MONGO_NO_TRANSACTIONS=true : facture et écriture comptable ne sont plus créées de façon atomique. À réserver au développement sans replica set."
        : "Les écritures liées (facture + écriture comptable) sont atomiques.",
    },
    {
      key: "audit",
      label: "Journal d'audit",
      level: auditLast24h > 0 ? "ok" : "warn",
      value: `${auditLast24h} entrées / 24 h`,
      detail: auditLast24h > 0
        ? `Dont ${loginFailures} échec(s) de connexion.`
        : "Aucune entrée sur les dernières 24 heures — normal sur une instance inactive, à vérifier sinon.",
    },
  ];

  const worst: Level = controls.some(c => c.level === "critical")
    ? "critical"
    : controls.some(c => c.level === "warn") ? "warn" : "ok";

  return ok({ controls, worst, checkedAt: new Date().toISOString() });
});
