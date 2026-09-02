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

  it("aucune référence de document n'est tirée de Math.random", () => {
    // Une quittance ou un engagement porte une référence qui doit rester unique
    // et non devinable ; Math.random ne garantit ni l'un ni l'autre.
    const offenders = files
      .filter(f => /Math\.random\(\)/.test(f.src))
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
