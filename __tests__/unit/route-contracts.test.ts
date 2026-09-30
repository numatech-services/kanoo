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

describe("Cloisonnement — aucune route ne contourne le contrôle des droits", () => {
  // Routes volontairement hors withAuth : publiques, authentification, propres
  // données de l'utilisateur, API par clé, webhooks signés, cron à secret.
  const OPEN = [
    /^app\/api\/(health|demo-requests|cron|webhooks)\//,
    /^app\/api\/public\//, /^app\/api\/portail\//, /^app\/api\/v1\//,
    /^app\/api\/auth\//, /^app\/api\/me\//,
  ];

  it("toute route passe par withAuth ou authorize, sauf les exceptions listées", () => {
    const naked = files
      .filter(f => !OPEN.some(re => re.test(f.path)))
      .filter(f => !/\bwithAuth\(|\bauthorize\(|\bwithSuperAdmin\(|\bwithTenantAdmin\(/.test(f.src))
      .map(f => f.path);
    expect(naked).toEqual([]);
  });

  it("les exports comptables et déclarations exigent le droit correspondant", () => {
    const need: Record<string, string> = {
      "app/api/exports/generic/route.ts": "accountingEntries",
      "app/api/exports/ohada/route.ts": "accountingEntries",
      "app/api/exports/sage/route.ts": "accountingEntries",
      "app/api/reports/dgi-cnss/route.ts": "payslips",
      "app/api/reports/dgi-tva/route.ts": "fiscalDeclarations",
      "app/api/reports/dgi-pdf/route.ts": "fiscalDeclarations",
      "app/api/invoices/[id]/pdf/route.ts": "invoices",
    };
    for (const [path, res] of Object.entries(need)) {
      const src = readFileSync(join(ROOT, path), "utf-8");
      expect(src).toContain(`authorize(req, "${res}", "read")`);
    }
  });

  it("les requêtes lean sur les comptes n'exposent jamais les secrets", () => {
    for (const f of files) expect(f.src).not.toMatch(/UserModel[\s\S]{0,120}\.select\("-passwordHash"\)\s*\.lean/);
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
    // Les effets comptables (dont le mouvement de trésorerie) sont factorisés
    // dans lib/payments.ts et appelés par la route dans withTransaction.
    const effects = readFileSync(join(ROOT, "lib/payments.ts"), "utf-8");
    expect(effects).toMatch(/TreasuryMovementModel\.create/);
    // `session` prouve que le mouvement participe à la transaction du paiement :
    // un règlement enregistré sans son mouvement produirait un écart permanent.
    expect(effects).toMatch(/TreasuryMovementModel\.create[\s\S]{0,800}session/);

    const payments = files.find(f => f.path === "app/api/payments/route.ts");
    expect(payments).toBeDefined();
    // La route applique les effets dans la transaction (session) du paiement.
    expect(payments!.src).toMatch(/withTransaction[\s\S]{0,600}applyPaymentEffects[\s\S]{0,120}session/);
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

// ─────────────────────────────────────────────────────────────────────────────
// Relances — les garde-fous qui protègent la relation client.
//
// Ce module est le seul du produit qui écrit à des tiers. Une régression ici ne
// se voit pas dans les logs : elle se voit dans les réponses des clients, trois
// semaines plus tard.
// ─────────────────────────────────────────────────────────────────────────────

describe("Relances — ce qui ne doit jamais partir tout seul", () => {
  const settingsRoute = files.find(f => f.path === "app/api/relances/parametres/route.ts");
  const runRoute = files.find(f => f.path === "app/api/relances/executer/route.ts");
  const manualRoute = files.find(f => f.path.endsWith("invoices/[id]/relance/route.ts"));

  it("expose les trois routes du module", () => {
    expect(settingsRoute).toBeDefined();
    expect(runRoute).toBeDefined();
    expect(manualRoute).toBeDefined();
  });

  it("force la validation humaine sur une mise en demeure, quoi que dise l'appelant", () => {
    // Le formulaire peut proposer la case ; l'API ne doit pas laisser un appel
    // direct installer un courrier juridique expédié par un cron.
    expect(settingsRoute!.src).toMatch(/tone === "formal_notice" \? true/);
  });

  it("n'exécute une étape à validation que si elle est nommément approuvée", () => {
    expect(runRoute!.src).toMatch(/needsApproval && !approved\.has/);
  });

  it("refuse d'exécuter quand le module est désactivé", () => {
    expect(runRoute!.src).toMatch(/settings\.enabled/);
  });

  it("journalise avant d'envoyer — c'est l'index d'unicité qui empêche le doublon", () => {
    const sender = stripNonCode(
      readFileSync(join(ROOT, "lib/dunning-send.ts"), "utf-8")
    );
    const logAt = sender.indexOf("DunningLogModel.create");
    const sendAt = sender.indexOf("sendEmail(");
    expect(logAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(-1);
    expect(logAt).toBeLessThan(sendAt);
    // Un doublon n'est pas une erreur : c'est le garde-fou qui joue.
    expect(sender).toMatch(/code === 11000/);
  });

  it("scelle l'unicité (organisation, facture, étape) dans le modèle", () => {
    const model = readFileSync(join(ROOT, "models/DunningLog.ts"), "utf-8");
    expect(model).toMatch(/tenantId: 1, invoiceId: 1, stepIndex: 1 \}, \{ unique: true \}/);
  });

  it("laisse les relances désactivées par défaut", () => {
    const model = readFileSync(join(ROOT, "models/DunningSettings.ts"), "utf-8");
    expect(model).toMatch(/enabled: \{ type: Boolean, default: false \}/);
  });

  it("refuse de relancer un avoir, un brouillon ou une facture soldée, même à la main", () => {
    for (const pattern of [/documentType === "credit_note"/, /status === "draft"/, /outstanding <= 0/]) {
      expect(manualRoute!.src).toMatch(pattern);
    }
  });

  it("réserve les index négatifs aux envois manuels, pour ne pas consommer le barème", () => {
    expect(manualRoute!.src).toMatch(/stepIndex: -\(manualCount \+ 1\)/);
  });

  it("fait tourner le job de nuit sur le même moteur que l'écran", () => {
    // Les tâches planifiées vivent dans lib/cron-jobs.ts (partagé entre le
    // scheduler VPS et l'endpoint /api/cron) ; c'est là que se lit l'invariant.
    const jobs = stripNonCode(readFileSync(join(ROOT, "lib/cron-jobs.ts"), "utf-8"));
    expect(jobs).toMatch(/planForTenant/);
    // Le cron n'envoie jamais une étape à validation.
    expect(jobs).toMatch(/action\.needsApproval/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Un seul vocabulaire de couleur.
//
// `cedar` pointait sur l'accent global : cent quarante-deux boutons primaires
// gardaient la même teinte quelle que soit la section, et la couleur par onglet
// — la première demande de la refonte — ne se voyait nulle part.
// ─────────────────────────────────────────────────────────────────────────────

describe("Cohérence du vocabulaire de couleur", () => {
  const LEGACY = /\b(?:bg|text|border|ring|from|to|divide|accent|shadow|hover:bg|hover:text)-(?:cedar|moss|clay|sand)\b/;

  function uiFiles(): string[] {
    return execSync("find app components -name '*.tsx'", { cwd: ROOT, encoding: "utf-8" })
      .trim().split("\n").filter(Boolean);
  }

  it("n'emploie plus les alias historiques", () => {
    const offenders = uiFiles().filter(path =>
      LEGACY.test(readFileSync(join(ROOT, path), "utf-8"))
    );
    expect(offenders).toEqual([]);
  });

  it("ne les expose plus dans le thème, pour qu'ils ne reviennent pas", () => {
    const config = readFileSync(join(ROOT, "tailwind.config.ts"), "utf-8");
    for (const alias of ["sand:", "clay:", "cedar:", "moss:"]) {
      expect(config).not.toContain(alias);
    }
  });

  it("fait suivre la teinte de section aux boutons primaires", () => {
    // Un bouton plein qui ne prend ni l'accent de section ni une couleur
    // sémantique est un bouton dont la couleur ne dit rien.
    const primaries = uiFiles().filter(path => {
      const src = readFileSync(join(ROOT, path), "utf-8");
      return /bg-section\b/.test(src);
    });
    expect(primaries.length).toBeGreaterThan(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trois espaces, trois identités.
//
// L'identité tient entièrement dans des variables : si un bloc `[data-space]`
// venait à passer AVANT une redéclaration `:root` des mêmes variables, il
// serait écrasé silencieusement — même spécificité, l'ordre décide. Rien ne
// planterait ; l'espace perdrait simplement sa forme et son tempo.
// ─────────────────────────────────────────────────────────────────────────────

describe("Identité des trois espaces", () => {
  const css = readFileSync(join(ROOT, "styles/globals.css"), "utf-8");
  const SPACES = ["pme", "association", "administration"];

  it("déclare les trois espaces", () => {
    for (const space of SPACES) {
      expect(css).toContain(`[data-space="${space}"]`);
    }
  });

  it("donne à chacun sa forme, son tempo et sa densité", () => {
    for (const space of SPACES) {
      const start = css.indexOf(`[data-space="${space}"] {`);
      expect(start).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      for (const token of ["--r-lg", "--t-quick", "--e-out", "--gutter", "--c-chrome"]) {
        expect(block).toContain(token);
      }
    }
  });

  it("place les espaces après toute redéclaration :root des mêmes variables", () => {
    // À spécificité égale, c'est l'ordre du fichier qui tranche.
    const lastRootRadius = css.lastIndexOf("  --r-lg:");
    const firstSpace = css.indexOf('[data-space="pme"]');
    expect(firstSpace).toBeGreaterThan(lastRootRadius);
  });

  it("fait déclarer son espace à chacune des trois coques", () => {
    const layouts: Array<[string, string]> = [
      ["app/(dashboard)/layout.tsx", "pme"],
      ["app/(associations)/layout.tsx", "association"],
      ["app/(administration)/layout.tsx", "administration"],
    ];
    for (const [path, space] of layouts) {
      expect(readFileSync(join(ROOT, path), "utf-8")).toContain(`space="${space}"`);
    }
  });

  it("n'écrit plus le fond de la barre latérale en dur", () => {
    const sidebar = readFileSync(join(ROOT, "components/layout/Sidebar.tsx"), "utf-8");
    expect(sidebar).toContain("bg-chrome");
    expect(sidebar).not.toMatch(/bg-\[#[0-9a-fA-F]{6}\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pièces jointes — les octets ne sortent que par une porte gardée.
//
// L'implémentation d'origine écrivait dans `public/uploads/`, que Next sert en
// statique sans autorisation : un bulletin de paie, un contrat, un
// justificatif devenaient lisibles par quiconque connaissait l'URL — et une
// URL fuit par un courriel transféré ou un en-tête Referer.
// ─────────────────────────────────────────────────────────────────────────────

describe("Pièces jointes — stockage et accès", () => {
  it("n'écrit plus rien sous public/", () => {
    const offenders = files.filter(f => /public["'\s,\]]*[,\s]*["']uploads/.test(f.src));
    expect(offenders.map(f => f.path)).toEqual([]);
  });

  it("ne versionne aucun fichier téléversé", () => {
    const tracked = execSync("git ls-files public/uploads var/uploads", { cwd: ROOT, encoding: "utf-8" }).trim();
    expect(tracked).toBe("");
  });

  it("dérive le droit d'accès du document porteur", () => {
    const list = files.find(f => f.path === "app/api/attachments/route.ts");
    const one = files.find(f => f.path === "app/api/attachments/[id]/route.ts");
    expect(list).toBeDefined();
    expect(one).toBeDefined();
    // Lire la pièce d'un contrat suppose de pouvoir lire les contrats : sans
    // ce contrôle, un droit « pièces jointes » générique ouvrirait tout.
    // Tous les rôles cumulés et leurs niveaux comptent (authCan), pas seulement le rôle principal.
    expect(list!.src).toMatch(/authCan\(auth, host, "read"\)/);
    expect(one!.src).toMatch(/authCan\(auth, doc\.host, "read"\)/);
  });

  it("force le téléchargement plutôt que l'affichage dans l'origine", () => {
    const one = files.find(f => f.path === "app/api/attachments/[id]/route.ts")!;
    // Un document affiché dans l'origine de l'application emprunterait la
    // session de son lecteur ; `nosniff` empêche de deviner un type plus
    // permissif que celui déclaré.
    expect(one.src).toMatch(/Content-Disposition/);
    expect(one.src).toMatch(/X-Content-Type-Options/);
  });

  it("ne laisse jamais sortir la clé de stockage", () => {
    const list = files.find(f => f.path === "app/api/attachments/route.ts")!;
    expect(list.src).toMatch(/select\("-storageKey"\)/);
  });

  it("vérifie la signature du contenu, pas seulement l'extension", () => {
    const storage = readFileSync(join(ROOT, "lib/storage.ts"), "utf-8");
    expect(storage).toMatch(/magic/);
    // Un SVG est un document exécutable : servi depuis l'origine, il vaut une
    // faille XSS stockée.
    expect(storage).toMatch(/"\.svg"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Les soldes se calculent, ils ne se stockent pas.
//
// Deux champs portaient la même erreur : `TreasuryAccount.balance`, corrigé
// précédemment, et `Client.currentBalance` — mis à zéro à la création,
// explicitement protégé en écriture, et incrémenté par aucune route. La
// colonne « Solde » affichait donc zéro pour tout le monde, y compris pour un
// client devant plusieurs millions.
// ─────────────────────────────────────────────────────────────────────────────

describe("Solde client — calculé, jamais stocké", () => {
  const list = files.find(f => f.path === "app/api/clients/route.ts");
  const detail = files.find(f => f.path === "app/api/clients/[id]/route.ts");

  it("dérive le solde des factures ouvertes, en liste comme en détail", () => {
    for (const route of [list, detail]) {
      expect(route).toBeDefined();
      expect(route!.src).toMatch(/InvoiceModel\.aggregate/);
      // Les avoirs se retranchent : les omettre gonflerait la créance d'un
      // montant déjà crédité au client.
      expect(route!.src).toMatch(/creditedAmount/);
    }
  });

  it("ne réaffecte jamais le champ stocké depuis le corps de requête", () => {
    expect(detail!.src).toMatch(/"currentBalance"/);
  });

  it("expose un relevé qui part du solde d'ouverture", () => {
    const releve = files.find(f => f.path.endsWith("clients/[id]/releve/route.ts"));
    expect(releve).toBeDefined();
    // Un relevé d'octobre qui commence à zéro nie ce que le client devait
    // déjà en septembre.
    expect(releve!.src).toMatch(/openingBalance/);
    expect(releve!.src).toMatch(/buildStatement/);
  });

  it("fait produire le PDF par le même moteur que l'écran", () => {
    const pdf = files.find(f => f.path.endsWith("clients/[id]/releve/pdf/route.ts"));
    expect(pdf).toBeDefined();
    // Un PDF qui recalculerait de son côté finirait par afficher un autre
    // solde que l'écran — et c'est le client qui le découvrirait.
    expect(pdf!.src).toMatch(/buildStatement/);
    expect(pdf!.src).toMatch(/withOpenItems/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Comptes et droits — sept trous constatés à l'audit.
//
// L'ossature RBAC était bonne : vingt-trois rôles, une matrice de droits sur
// quarante ressources, et une revalidation en base à chaque requête — un
// changement de rôle prend effet immédiatement, pas à l'expiration du jeton.
// Ce qui manquait relevait de l'exploitation quotidienne.
// ─────────────────────────────────────────────────────────────────────────────

describe("Comptes — ce qui manquait", () => {
  const usersList = files.find(f => f.path === "app/api/users/route.ts")!;
  const usersOne = files.find(f => f.path === "app/api/users/[id]/route.ts")!;

  it("permet enfin de changer son mot de passe", () => {
    // Aucune route ne le permettait : `passwordResetToken` était un champ mort
    // et `templatePasswordReset` un modèle que rien n'appelait.
    const self = files.find(f => f.path === "app/api/auth/password/route.ts");
    expect(self).toBeDefined();
    // L'ancien mot de passe est exigé même sur une session valide.
    expect(self!.src).toMatch(/comparePassword\(current/);
    // Changer son mot de passe ferme les autres sessions — c'est le geste
    // qu'on fait quand on le croit compromis.
    expect(self!.src).toMatch(/sessionVersion.*\+ 1/);
  });

  it("permet à un administrateur de réinitialiser sans choisir le mot de passe", () => {
    const reset = files.find(f => f.path.endsWith("users/[id]/password/route.ts"));
    expect(reset).toBeDefined();
    // Un administrateur qui saisit la valeur en met une qu'il connaît, et la
    // réutilise pour dix comptes.
    expect(reset!.src).toMatch(/temporaryPassword\(\)/);
    expect(reset!.src).toMatch(/mustChangePassword = true/);
  });

  it("applique la politique dès la création du compte", () => {
    // Sans cela, elle ne protégeait que ceux qui changeaient leur mot de passe.
    expect(usersList.src).toMatch(/passwordErrors/);
  });

  it("refuse de supprimer le dernier administrateur actif", () => {
    // Le verrouillage était irrattrapable depuis l'application.
    expect(usersOne.src).toMatch(/remaining === 0/);
    expect(usersOne.src).toMatch(/TENANT_ADMIN_ROLES/);
  });

  it("empêche de se retirer ses propres droits d'administration", () => {
    expect(usersOne.src).toMatch(/isSelf && losesAdmin/);
  });

  it("déclare dans le modèle tous les rôles proposés à la création", () => {
    // `chef_projet_transversal` (puis les rôles ISIC) étaient offerts au choix et
    // absents de l'enum Mongoose : la création échouait en validation. L'enum
    // dérive désormais de USER_ROLES ; on vérifie l'enum EFFECTIF du schéma.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { UserModel } = require("@/models/User");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ASSIGNABLE_BY_TENANT } = require("@/lib/roles-ui");
    const modelEnum: string[] = UserModel.schema.path("role").options.enum;
    const offered = Object.values(ASSIGNABLE_BY_TENANT as Record<string, string[]>).flat();
    for (const role of [...offered, "chef_projet_transversal", "tech_admin", "pme_isic_operator", "pme_activity_manager"]) {
      expect(modelEnum).toContain(role);
    }
  });

  it("expose un rôle technique sans accès aux données financières", () => {
    const rbac = readFileSync(join(ROOT, "lib/role-resources.ts"), "utf-8");
    const start = rbac.indexOf("const TECH_ADMIN");
    expect(start).toBeGreaterThan(-1);
    const block = rbac.slice(start, rbac.indexOf("};", start));
    // Confier la paie à l'informaticien parce que c'est plus simple.
    for (const forbidden of ["invoices", "payments", "payslips", "accountingEntries", "treasuryAccounts"]) {
      expect(block).not.toContain(`${forbidden}:`);
    }
    expect(block).toContain("auditLogs:");
  });

  it("vérifie l'organisation du compte avant de le rattacher à une fiche salarié", () => {
    const employee = files.find(f => f.path === "app/api/employees/[id]/route.ts")!;
    // Un identifiant d'une autre organisation rembourserait ses notes de frais
    // sur une fiche qui n'est pas la sienne.
    expect(employee.src).toMatch(/UserModel\.findOne\(\{ _id: String\(value\), \.\.\.tenantFilter\(auth\) \}\)/);
  });

  it("garde la liste des rôles décrite pour un humain", () => {
    const rolesUi = readFileSync(join(ROOT, "lib/roles-ui.ts"), "utf-8");
    // L'écran affichait « pme project manager » : choisir sur cette base
    // revient à tirer au sort, et une erreur ouvre l'accès à la paie.
    expect(rolesUi).toMatch(/summary:/);
    expect(rolesUi).toMatch(/cannot\?:/);
  });
});
