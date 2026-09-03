/**
 * Contrôles structurels sur les routes de l'API.
 *
 * Ces règles ne se vérifient pas au type-checking : elles portent sur des
 * conventions que `withAuth` impose à ses appelants. Deux routes les avaient
 * enfreintes sans que rien ne l'attrape — l'une répondait 404 sur toutes ses
 * méthodes, l'autre ne remontait jamais aucun enregistrement.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { errorMessage, errorName } from "@/lib/errors";

const ROOT = join(__dirname, "..", "..");

function routeFiles(): string[] {
  return execSync("find app/api -name route.ts", { cwd: ROOT, encoding: "utf-8" })
    .trim().split("\n").filter(Boolean);
}

/**
 * Retire commentaires et littéraux de chaîne : les motifs recherchés sont des
 * constructions de code, pas du texte. Sans cela, un commentaire décrivant le
 * bug corrigé déclencherait le test qui vérifie son absence.
 */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // commentaires de bloc
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 "); // commentaires de ligne
}

const files = routeFiles().map(path => ({
  path,
  src: stripNonCode(readFileSync(join(ROOT, path), "utf-8")),
}));

describe("Conventions des routes API", () => {
  it("trouve bien les fichiers de route", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("aucun gestionnaire ne lit les paramètres via un objet `context`", () => {
    // `withAuth` passe les paramètres DÉJÀ RÉSOLUS en troisième argument.
    // `app/api/contracts/[id]` lisait `context.params.id` sur cet objet :
    // l'identifiant valait toujours undefined et les trois méthodes de la route
    // répondaient 404, quelle que soit la requête.
    const offenders = files
      .filter(f => /context\??\.params/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("l'argument d'authentification n'est jamais typé `any`", () => {
    // `auth: any` avait masqué l'usage de `auth.id` et `auth.name`, qui
    // n'existent pas sur le jeton : les messages partaient sans expéditeur.
    const offenders = files
      .filter(f => /auth:\s*any\b/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("aucun gestionnaire n'inverse `auth` et les paramètres de route", () => {
    // `app/api/budget/mandatements` déclarait (req, { params }, auth) : `auth`
    // recevait les paramètres, et le filtre de tenant partait avec un
    // tenantId indéfini.
    const offenders = files
      .filter(f => /async\s*\(\s*\w+:\s*NextRequest\s*,\s*\{\s*params\s*\}/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("les mises à jour ne recopient pas le corps brut de la requête", () => {
    // Sans filtrage, un client peut écrire tenantId et déplacer un
    // enregistrement vers une autre organisation.
    const offenders = files
      .filter(f => /findOneAndUpdate\([^)]*,\s*body\s*,/.test(f.src)
                || /findByIdAndUpdate\([^)]*,\s*body\s*,/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("aucune route ne renvoie le message d'erreur interne au client", () => {
    // `error.message` en réponse expose noms de collections et contraintes.
    const offenders = files
      .filter(f => /NextResponse\.json\(\s*\{\s*error:\s*\w+\.message/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("toute somme de chiffre d'affaires tient compte des avoirs", () => {
    // Les avoirs vivent dans la collection des factures avec des montants
    // POSITIFS : une agrégation qui somme totalTTC sans les distinguer les
    // compte en plus au lieu de les retrancher, et gonfle le CA.
    // Une somme est conforme si, dans le même fichier, elle s'accompagne soit
    // d'un filtre documentType, soit d'un signe calculé.
    const offenders = files
      .filter(f => /\$sum:\s*"\$totalTTC"/.test(f.src))
      .filter(f => !/documentType/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("aucun décompte d'impayés ne compte les avoirs", () => {
    // Un avoir n'attend aucun règlement : le compter comme « en retard »
    // ferait apparaître une créance qui n'existe pas.
    const offenders = files
      .filter(f => /status:\s*\{\s*\$in:\s*\["sent",\s*"partial"\]/.test(f.src))
      .filter(f => !/documentType/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("aucune référence de document n'est tirée de Math.random", () => {
    // Une quittance ou un engagement porte une référence qui doit rester unique
    // et non devinable ; Math.random ne garantit ni l'un ni l'autre.
    const offenders = files
      .filter(f => /Math\.random\(\)/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("Modules transverses", () => {
  const screens = execSync(
    "find app -name 'page.tsx' -not -path '*/node_modules/*'",
    { cwd: ROOT, encoding: "utf-8" }
  ).trim().split("\n").filter(Boolean);

  /** Un écran qui ne fait que rediriger n'est pas une implémentation. */
  function isRedirect(path: string): boolean {
    return /redirect\(/.test(readFileSync(join(ROOT, path), "utf-8"));
  }

  it("un seul écran par module transverse", () => {
    // Les portails externes sont hors périmètre : ils s'adressent à des
    // adhérents et des fournisseurs qui n'ont pas de compte applicatif, avec
    // leur propre authentification et un sous-ensemble de données. Ce n'est
    // pas une duplication, c'est un autre produit.
    const internal = screens.filter(p => !p.includes("(portail)"));
    // Projets, documents et personnel partagent un modèle et une route API.
    // Les dupliquer par profil coûtait 1 239 lignes en triple et trois
    // endroits où corriger le même défaut. Le vocabulaire vit désormais dans
    // lib/vocabulary.ts et l'écran est unique.
    const modules: Array<[string, RegExp]> = [
      ["projets", /projets?\/page\.tsx$/],
      ["documents", /documents\/page\.tsx$/],
      ["personnel", /(personnel|employees)\/page\.tsx$/],
    ];

    for (const [name, pattern] of modules) {
      const implementations = internal
        .filter(p => pattern.test(p))
        .filter(p => !isRedirect(p));
      expect({ module: name, implementations }).toEqual({ module: name, implementations: [implementations[0]] });
    }
  });

  it("les anciennes routes redirigent au lieu de disparaître", () => {
    // Des notifications déjà envoyées et des favoris pointent encore dessus.
    const legacy = [
      "app/(associations)/associations/projets/page.tsx",
      "app/(administration)/administration/projets/page.tsx",
      "app/(administration)/administration/personnel/page.tsx",
      "app/(associations)/associations/documents/page.tsx",
    ];
    for (const path of legacy) {
      expect(isRedirect(path)).toBe(true);
    }
  });
});

describe("Cohérence du thème", () => {
  const PALETTE = "red|rose|green|emerald|amber|orange|yellow|blue|indigo|sky|gray|slate|zinc|neutral|purple|violet";

  function screenFiles(): string[] {
    return execSync(
      "find app components -name '*.tsx' -not -path '*/node_modules/*'",
      { cwd: ROOT, encoding: "utf-8" }
    ).trim().split("\n").filter(Boolean);
  }

  const screens = screenFiles().map(path => ({
    path,
    src: readFileSync(join(ROOT, path), "utf-8"),
  }));

  it("aucune couleur Tailwind brute dans l'application", () => {
    // Les tokens du thème basculent en mode sombre via des variables CSS ;
    // `bg-red-50` ou `text-green-700` sont des valeurs figées qui restent
    // claires sur fond sombre. Une seule suffit à trouer l'écran.
    const offenders = screens
      .filter(f => !f.path.startsWith("app/(public)"))   // vitrine : clair assumé
      .filter(f => new RegExp(`\\b(bg|text|border)-(${PALETTE})-[0-9]{2,3}\\b`).test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("aucun fond blanc opaque hors vitrine", () => {
    // `bg-white/20` est un voile sur fond coloré : légitime. `bg-white` seul
    // est une surface qui ne bascule pas.
    const offenders = screens
      .filter(f => !f.path.startsWith("app/(public)"))
      .filter(f => /\bbg-white\b(?!\/)/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("Lecture des erreurs capturées", () => {
  it("lit le message d'une Error", () => {
    expect(errorMessage(new Error("échec de connexion"))).toBe("échec de connexion");
  });

  it("accepte une chaîne lancée telle quelle", () => {
    expect(errorMessage("panne réseau")).toBe("panne réseau");
  });

  it("lit une réponse d'API sérialisée", () => {
    expect(errorMessage({ error: "Client introuvable" })).toBe("Client introuvable");
    expect(errorMessage({ message: "Champ obligatoire" })).toBe("Champ obligatoire");
  });

  it("retombe sur un message par défaut plutôt que de lever", () => {
    // `catch (e: any)` puis `e.message` plantait le gestionnaire d'erreur
    // lui-même quand la valeur lancée n'était pas une Error.
    expect(errorMessage(null)).toBe("Une erreur est survenue.");
    expect(errorMessage(undefined)).toBe("Une erreur est survenue.");
    expect(errorMessage(42)).toBe("Une erreur est survenue.");
    expect(errorMessage({})).toBe("Une erreur est survenue.");
  });

  it("respecte le message de repli fourni", () => {
    expect(errorMessage(null, "Chargement impossible.")).toBe("Chargement impossible.");
  });

  it("reconnaît le nom d'une erreur Mongoose", () => {
    const cast = new Error("bad id");
    cast.name = "CastError";
    expect(errorName(cast)).toBe("CastError");
    expect(errorName({ name: "ValidationError" })).toBe("ValidationError");
    expect(errorName("texte")).toBeNull();
    expect(errorName(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Le solde de trésorerie est calculé, jamais stocké.
//
// `TreasuryAccount.balance` était un nombre saisi à la création qu'aucune route
// ne mettait à jour : l'écran affichait un solde figé pendant des mois. La
// correction ne tient que si personne ne réintroduit une écriture dessus —
// c'est très exactement le réflexe qu'on a en voulant « corriger le solde ».
// ─────────────────────────────────────────────────────────────────────────────

describe("Trésorerie — le solde ne s'écrit pas", () => {
  const treasuryWrites = files.filter(f =>
    /TreasuryAccountModel\s*\.\s*(updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|bulkWrite)/.test(f.src)
    || /TreasuryAccountModel[\s\S]{0,200}\$inc[\s\S]{0,60}balance/.test(f.src)
  );

  it("aucune route ne met à jour un compte de trésorerie par incrément de solde", () => {
    const offenders = treasuryWrites.filter(f => /balance/.test(f.src));
    expect(offenders.map(f => f.path)).toEqual([]);
  });

  it("la liste des comptes recalcule le solde à partir des mouvements", () => {
    const listRoute = files.find(f => f.path === "app/api/treasury-accounts/route.ts");
    expect(listRoute).toBeDefined();
    expect(listRoute!.src).toMatch(/TreasuryMovementModel\.aggregate/);
    expect(listRoute!.src).toMatch(/openingBalance/);
  });

  it("un règlement imputé à un compte crée un mouvement dans la même transaction", () => {
    const payments = files.find(f => f.path === "app/api/payments/route.ts");
    expect(payments).toBeDefined();
    expect(payments!.src).toMatch(/TreasuryMovementModel\.create/);
    // `session` prouve que le mouvement participe à la transaction du paiement :
    // un règlement enregistré sans son mouvement produirait un écart permanent.
    expect(payments!.src).toMatch(/TreasuryMovementModel\.create[\s\S]{0,800}session/);
  });

  it("l'appariement refuse deux montants différents", () => {
    const match = files.find(f => f.path.endsWith("treasury-accounts/[id]/match/route.ts"));
    expect(match).toBeDefined();
    expect(match!.src).toMatch(/movement\.amount\s*!==\s*line\.amount/);
  });

  it("l'import de relevé s'appuie sur une empreinte d'unicité, pas sur un SELECT préalable", () => {
    const importRoute = files.find(f => f.path.endsWith("treasury-accounts/[id]/import/route.ts"));
    expect(importRoute).toBeDefined();
    expect(importRoute!.src).toMatch(/lineFingerprint/);
    expect(importRoute!.src).toMatch(/ordered:\s*false/);
    expect(importRoute!.src).not.toMatch(/BankStatementLineModel\.findOne/);
  });
});
