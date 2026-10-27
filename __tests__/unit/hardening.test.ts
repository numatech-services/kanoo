/**
 * Non-régression des corrections issues de l'audit du commit b151dfa.
 *
 * Chaque bloc décrit le défaut d'origine et verrouille le comportement attendu :
 * un test qui repasserait au rouge ici signale le retour d'un bug déjà payé.
 */

import { NextRequest } from "next/server";
import { verifyCsrf, CSRF_COOKIE, CSRF_HEADER } from "@/lib/csrf";
import { isUsableSecret, PLACEHOLDER_SECRET_PREFIX } from "@/lib/auth";
import { canPerformAction, canAccessResource, ROLE_PERMISSIONS } from "@/lib/role-resources";
import { sanitizeBody } from "@/lib/api-helpers";
import {
  calculerITS, calculerPrimeAnciennete, calculerAmortissementLineaire,
} from "@/lib/niger-fiscal";
import { calculerBulletinDePaie } from "@/lib/payslip-calc";
import { generateAccessCode, hashAccessCode, verifyAccessCode } from "@/lib/portal-auth";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import type { UserRole } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// Constat 01 — la protection CSRF était annoncée mais aucune route ne
// vérifiait le jeton.
// ─────────────────────────────────────────────────────────────────────────────

function request(
  method: string,
  opts: { cookie?: string; header?: string; bearer?: string } = {}
): NextRequest {
  const headers = new Headers();
  if (opts.header) headers.set(CSRF_HEADER, opts.header);
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);
  if (opts.cookie) headers.set("cookie", `${CSRF_COOKIE}=${opts.cookie}`);
  return new NextRequest("https://kanoo.test/api/invoices", { method, headers });
}

describe("CSRF — double soumission de cookie", () => {
  it("accepte une mutation dont l'en-tête correspond au cookie", () => {
    expect(verifyCsrf(request("POST", { cookie: "abc123", header: "abc123" }))).toBe("ok");
  });

  it("refuse une mutation sans en-tête, même avec le cookie", () => {
    expect(verifyCsrf(request("POST", { cookie: "abc123" }))).toBe("missing_header");
  });

  it("refuse une mutation dont l'en-tête ne correspond pas", () => {
    expect(verifyCsrf(request("POST", { cookie: "abc123", header: "autre" }))).toBe("mismatch");
  });

  it("refuse une mutation sans cookie de session de sécurité", () => {
    expect(verifyCsrf(request("POST", { header: "abc123" }))).toBe("missing_cookie");
  });

  it("laisse passer les méthodes sans effet de bord", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(verifyCsrf(request(method))).toBe("ok");
    }
  });

  it("exempte les appels par jeton d'API : ils n'utilisent pas les cookies", () => {
    expect(verifyCsrf(request("POST", { bearer: "cle-api" }))).toBe("ok");
  });

  it("ne se laisse pas approuver par un en-tête plus court que le cookie", () => {
    expect(verifyCsrf(request("POST", { cookie: "abcdef", header: "abc" }))).toBe("mismatch");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constat 05 — la sentinelle du code (« …MIN_32_CHARS ») ne correspondait pas
// à la valeur de .env.example (« …MINIMUM_32_CHARS_LONG ») : la valeur publiée
// dans le dépôt passait le contrôle.
// ─────────────────────────────────────────────────────────────────────────────

describe("Secrets — refus des valeurs d'exemple", () => {
  it("refuse l'ancienne sentinelle du code", () => {
    expect(isUsableSecret("CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS")).toBe(false);
  });

  it("refuse la sentinelle de .env.example, qui passait auparavant", () => {
    expect(isUsableSecret("CHANGE_ME_IN_PRODUCTION_MINIMUM_32_CHARS_LONG")).toBe(false);
  });

  it("refuse toute variante du motif, quelle que soit sa suite", () => {
    expect(isUsableSecret(`${PLACEHOLDER_SECRET_PREFIX}_n_importe_quoi_de_plus_de_32_car`)).toBe(false);
  });

  it("refuse un secret trop court", () => {
    expect(isUsableSecret("trop-court")).toBe(false);
  });

  it("refuse un secret absent", () => {
    expect(isUsableSecret(undefined)).toBe(false);
  });

  it("accepte un secret réel", () => {
    expect(isUsableSecret("f3a9c1e7b2d84f60a5c3e9017b4d6f28")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constat 07 — chef_projet_transversal était absent de la table consultée, et
// le renommage marches → publicTenders n'avait été fait que pour pme_admin.
// ─────────────────────────────────────────────────────────────────────────────

describe("Rôles et permissions", () => {
  it("chef_projet_transversal est enregistré et opérationnel", () => {
    expect(ROLE_PERMISSIONS.chef_projet_transversal).toBeDefined();
    expect(canPerformAction("chef_projet_transversal", "projects", "create")).toBe(true);
    expect(canPerformAction("chef_projet_transversal", "documents", "update")).toBe(true);
  });

  it("chef_projet_transversal reste tenu à l'écart des finances", () => {
    expect(canPerformAction("chef_projet_transversal", "invoices", "read")).toBe(false);
    expect(canPerformAction("chef_projet_transversal", "payslips", "read")).toBe(false);
    expect(canPerformAction("chef_projet_transversal", "accountingEntries", "read")).toBe(false);
  });

  it("tous les rôles PME accèdent aux marchés sous le nom que les routes exigent", () => {
    const roles: UserRole[] = [
      "pme_admin", "pme_manager", "pme_purchases", "pme_project_manager",
      "pme_approver", "pme_viewer",
    ];
    for (const role of roles) {
      expect(canPerformAction(role, "publicTenders", "read")).toBe(true);
    }
  });

  it("plus aucun rôle ne déclare l'ancien nom 'marches'", () => {
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      expect(permissions).not.toHaveProperty("marches");
    }
  });

  it("allowedResources restreint et n'accorde jamais", () => {
    // Un pme_viewer ne devient pas administrateur parce qu'on lui a listé la
    // ressource : la liste ne peut que réduire ce que le rôle permet déjà.
    expect(canPerformAction("pme_viewer", "users", "delete", ["users", "*"])).toBe(false);
    // Et elle réduit bien à l'intérieur du rôle.
    expect(canPerformAction("pme_admin", "invoices", "read", ["clients"])).toBe(false);
    expect(canPerformAction("pme_admin", "clients", "read", ["clients"])).toBe(true);
  });

  it("les deux fonctions de contrôle répondent la même chose", () => {
    // L'interface se fiait à canAccessResource, l'API à canPerformAction :
    // l'une acceptait allowedResources comme une autorisation, l'autre l'ignorait.
    expect(canAccessResource("pme_viewer", "users", ["users"]))
      .toBe(canPerformAction("pme_viewer", "users", "read", ["users"]));
  });

  it("superadmin passe partout", () => {
    expect(canPerformAction("superadmin", "n_importe_quoi", "delete")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constat 12 — le corps de la requête partait tel quel dans findOneAndUpdate.
// ─────────────────────────────────────────────────────────────────────────────

describe("sanitizeBody", () => {
  it("retire tenantId : sinon un enregistrement change d'organisation", () => {
    const clean = sanitizeBody({ name: "Client", tenantId: "autre-organisation" });
    expect(clean).toEqual({ name: "Client" });
  });

  it("retire les champs jamais modifiables par un client", () => {
    const clean = sanitizeBody({
      name: "X", _id: "1", __v: 3, createdBy: "u1", createdAt: new Date(), updatedAt: new Date(),
    });
    expect(clean).toEqual({ name: "X" });
  });

  it("retire les opérateurs Mongo glissés dans le corps", () => {
    const clean = sanitizeBody({ name: "X", $set: { tenantId: "autre" }, $where: "1==1" });
    expect(clean).toEqual({ name: "X" });
  });

  it("retire en plus les champs dérivés que la route désigne", () => {
    const clean = sanitizeBody({ name: "X", totalTTC: 999 }, ["totalTTC"]);
    expect(clean).toEqual({ name: "X" });
  });

  it("ne modifie pas l'objet d'origine", () => {
    const body = { name: "X", tenantId: "t1" };
    sanitizeBody(body);
    expect(body.tenantId).toBe("t1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constat 10 — l'ancienneté se calculait à la date du jour.
// ─────────────────────────────────────────────────────────────────────────────

describe("Prime d'ancienneté — appréciée à la période de paie", () => {
  const entree = new Date("2019-03-15");

  it("un bulletin d'une période passée garde son montant", () => {
    const janvier2024 = calculerPrimeAnciennete(300_000, entree, new Date("2024-01-31"));
    const rejoue = calculerPrimeAnciennete(300_000, entree, new Date("2024-01-31"));
    expect(rejoue).toEqual(janvier2024);
  });

  it("le montant dépend de la période, pas de la date de génération", () => {
    const debut = calculerPrimeAnciennete(300_000, entree, new Date("2021-01-31"));
    const plusTard = calculerPrimeAnciennete(300_000, entree, new Date("2026-01-31"));
    expect(plusTard.annees).toBeGreaterThan(debut.annees);
    expect(plusTard.montant).toBeGreaterThan(debut.montant);
  });

  it("le moteur de paie transmet la période au calcul d'ancienneté", () => {
    const commun = {
      grossSalary: 300_000,
      startDate: entree,
      employeeType: "employee" as const,
      includeCnss: true, includeIr: true, includeSeniority: true,
    };
    const janvier = calculerBulletinDePaie({ ...commun, periodEnd: new Date("2021-01-31") });
    const bienPlusTard = calculerBulletinDePaie({ ...commun, periodEnd: new Date("2026-01-31") });
    expect(bienPlusTard.seniority.montant).toBeGreaterThan(janvier.seniority.montant);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ITS — barème par tranches : continu, jamais négatif, retenu par le moteur.
// (L'ancien barème avait des bornes disjointes, 35 000 puis 35 001 : une base
// non entière ressortait à zéro.)
// ─────────────────────────────────────────────────────────────────────────────

describe("Impôt sur les traitements et salaires", () => {
  const MAI_2026 = new Date(2026, 4, 31);
  const its = (brut: number) => calculerITS({ revenuBrut: brut, remunerationPrincipale: brut, retraite: Math.round(brut * 0.0525) }, MAI_2026).impot;

  it("le barème reste continu : 1 000 FCFA de plus ne coûte jamais plus de 350 FCFA", () => {
    for (let brut = 0; brut <= 2_000_000; brut += 7_919) {
      expect(its(brut + 1_000) - its(brut)).toBeLessThanOrEqual(350);
      expect(its(brut + 1_000)).toBeGreaterThanOrEqual(its(brut));
    }
  });

  it("n'est jamais négatif", () => {
    for (const base of [0, 1, 25_000, 25_001.5, 50_000, 120_000, 900_000]) {
      expect(its(base)).toBeGreaterThanOrEqual(0);
    }
  });

  it("est retenu par le moteur de paie", () => {
    const bulletin = calculerBulletinDePaie({
      grossSalary: 400_000,
      startDate: new Date("2020-01-01"),
      employeeType: "employee",
      includeCnss: true, includeIr: true, includeSeniority: false,
      periodEnd: new Date(2026, 0, 31),
    });
    expect(bulletin.ir).toBeGreaterThan(0);
    expect(bulletin.netAPayer).toBe(bulletin.grossTotal - bulletin.cnssEmployee - bulletin.ir);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constat 16 — l'amortissement comptait une annuité pleine l'année
// d'acquisition, quelle que soit la date de mise en service.
// ─────────────────────────────────────────────────────────────────────────────

describe("Amortissement — prorata temporis", () => {
  it("une mise en service en octobre ne dote que trois douzièmes", () => {
    const plan = calculerAmortissementLineaire(1_200_000, 0, 5, 2025, new Date("2025-10-01"));
    // Annuité pleine = 240 000 ; trois mois = 60 000.
    expect(plan[0].annuity).toBe(60_000);
    expect(plan[1].annuity).toBe(240_000);
  });

  it("le plan s'étend d'un exercice pour absorber le reliquat", () => {
    const plan = calculerAmortissementLineaire(1_200_000, 0, 5, 2025, new Date("2025-10-01"));
    expect(plan).toHaveLength(6);
    expect(plan[5].year).toBe(2030);
  });

  it("le cumul solde exactement la base amortissable", () => {
    const plan = calculerAmortissementLineaire(1_000_000, 100_000, 4, 2025, new Date("2025-07-15"));
    expect(plan.at(-1)!.cumulative).toBe(900_000);
    expect(plan.at(-1)!.netValue).toBe(100_000);
  });

  it("une mise en service en janvier reste une annuité pleine", () => {
    const plan = calculerAmortissementLineaire(1_200_000, 0, 5, 2025, new Date("2025-01-10"));
    expect(plan).toHaveLength(5);
    expect(plan[0].annuity).toBe(240_000);
  });

  it("sans date de mise en service, le comportement d'origine est conservé", () => {
    const plan = calculerAmortissementLineaire(1_000_000, 0, 5, 2025);
    expect(plan).toHaveLength(5);
    expect(plan[0].annuity).toBe(200_000);
  });

  it("une durée nulle (terrain) ne produit aucun plan", () => {
    expect(calculerAmortissementLineaire(5_000_000, 0, 0, 2025)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constat 04 — code d'accès à six chiffres tiré de Math.random, stocké en clair.
// ─────────────────────────────────────────────────────────────────────────────

describe("Codes d'accès aux portails", () => {
  it("fait huit chiffres : l'espace passe de 10⁶ à 10⁸", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateAccessCode()).toMatch(/^\d{8}$/);
    }
  });

  it("ne se répète pas sur un petit tirage", () => {
    const codes = new Set(Array.from({ length: 200 }, generateAccessCode));
    expect(codes.size).toBeGreaterThan(190);
  });

  it("valide un code contre son empreinte", async () => {
    const code = generateAccessCode();
    const hash = await hashAccessCode(code);
    expect(hash).not.toContain(code);
    await expect(verifyAccessCode(code, hash)).resolves.toEqual({ valid: true, needsUpgrade: false });
  });

  it("refuse un code erroné", async () => {
    const hash = await hashAccessCode("12345678");
    await expect(verifyAccessCode("87654321", hash)).resolves.toEqual({ valid: false, needsUpgrade: false });
  });

  it("accepte un code hérité en clair, et signale qu'il faut le migrer", async () => {
    await expect(verifyAccessCode("123456", undefined, "123456"))
      .resolves.toEqual({ valid: true, needsUpgrade: true });
  });

  it("refuse quand ni empreinte ni code hérité n'existent", async () => {
    await expect(verifyAccessCode("123456")).resolves.toEqual({ valid: false, needsUpgrade: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constat 15 — compteur en mémoire jamais purgé, et absent des routes
// sensibles autres que la connexion.
// ─────────────────────────────────────────────────────────────────────────────

describe("Limitation de débit", () => {
  beforeEach(() => {
    resetRateLimit("test", "cle");
    resetRateLimit("autre", "cle");
  });

  it("laisse passer jusqu'au plafond puis refuse", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("test", "cle", 3, 60_000).allowed).toBe(true);
    }
    const refus = rateLimit("test", "cle", 3, 60_000);
    expect(refus.allowed).toBe(false);
    expect(refus.retryAfter).toBeGreaterThan(0);
  });

  it("isole les familles de limite entre elles", () => {
    rateLimit("test", "cle", 1, 60_000);
    expect(rateLimit("test", "cle", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("autre", "cle", 1, 60_000).allowed).toBe(true);
  });

  it("rend son quota après une authentification réussie", () => {
    rateLimit("test", "cle", 1, 60_000);
    expect(rateLimit("test", "cle", 1, 60_000).allowed).toBe(false);
    resetRateLimit("test", "cle");
    expect(rateLimit("test", "cle", 1, 60_000).allowed).toBe(true);
  });

  it("rouvre la fenêtre une fois le délai écoulé", () => {
    rateLimit("test", "cle", 1, 1);
    const apres = Date.now() + 10;
    jest.spyOn(Date, "now").mockReturnValue(apres);
    expect(rateLimit("test", "cle", 1, 1).allowed).toBe(true);
    jest.spyOn(Date, "now").mockRestore();
  });
});
