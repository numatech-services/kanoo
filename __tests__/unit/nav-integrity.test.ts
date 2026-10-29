/**
 * Navigation : chaque lien mène à une page, chaque page sait quel droit elle
 * demande, et un rôle qui a droit à un écran commun le trouve dans son menu.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { NAV_RESOURCE } from "@/lib/nav-resources";
import { ROLE_PERMISSIONS } from "@/lib/role-resources";

const ROOT = join(__dirname, "../..");
const sidebar = readFileSync(join(ROOT, "components/layout/Sidebar.tsx"), "utf-8");

/** Les liens d'un menu (PME_NAV, ASSO_NAV…), lus dans le source. */
function navHrefs(name: string): string[] {
  const start = sidebar.indexOf(`const ${name}: NavGroup[] = [`);
  const end = sidebar.indexOf("\n];", start);
  return [...sidebar.slice(start, end).matchAll(/href: "([^"]+)"/g)].map(m => m[1]);
}

/** Toutes les routes de pages (groupes « (x) » retirés, segments dynamiques gardés). */
function pageRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, route: string[]) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f === "api" || f.startsWith("_")) continue;
        walk(p, /^\(.*\)$/.test(f) ? route : [...route, f]);
      } else if (f === "page.tsx") out.push("/" + route.join("/"));
    }
  };
  walk(join(ROOT, "app"), []);
  return out;
}
const routes = pageRoutes();
const exists = (href: string) => {
  const path = href.split("?")[0];
  return routes.some(r => r === path || new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(path));
};

const PROFILES = { pme: "PME_NAV", association: "ASSO_NAV", administration: "ADMIN_NAV", superadmin: "SUPERADMIN_NAV" } as const;

describe("Navigation — intégrité", () => {
  it("chaque lien des quatre menus mène à une page existante", () => {
    const broken = Object.values(PROFILES).flatMap(n => navHrefs(n).filter(h => !exists(h)).map(h => `${n} ${h}`));
    expect(broken).toEqual([]);
  });

  it("chaque écran de la table des droits existe, et chaque droit est accordé à au moins un rôle", () => {
    expect(Object.keys(NAV_RESOURCE).filter(p => !exists(p))).toEqual([]);
    const granted = new Set(Object.values(ROLE_PERMISSIONS).flatMap(p => Object.keys(p ?? {})));
    expect([...new Set(Object.values(NAV_RESOURCE))].filter(r => !granted.has(r))).toEqual([]);
  });

  it("un rôle d'association ou d'administration qui a droit à un écran commun le trouve dans son menu", () => {
    const shared = ["/treasury", "/accounting", "/fiscalite", "/notes-de-frais", "/documents", "/courriers", "/audit", "/suppliers"];
    const missing: string[] = [];
    for (const [prefix, nav] of [["asso_", "ASSO_NAV"], ["admin_", "ADMIN_NAV"]] as const) {
      const hrefs = navHrefs(nav);
      for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
        if (!role.startsWith(prefix) || role.endsWith("member_portal")) continue;
        for (const page of shared) {
          const res = NAV_RESOURCE[page];
          if (res && perms?.[res as keyof typeof perms]?.includes("read") && !hrefs.includes(page)) missing.push(`${role} → ${page}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("les pages hors menu sont connues (détail, création, onglets d'un écran, redirections)", () => {
    const linked = new Set(Object.values(PROFILES).flatMap(navHrefs));
    // Écrans atteints autrement que par le menu : onglets d'un écran (ScreenTabs),
    // palette, liens d'une autre page. Tout nouvel écran doit être ajouté à un
    // menu ou à cette liste.
    const ALLOWED = [
      /\/(new|nouvelle|edit|imprimer|print|releve|rapprochement|checkin|scanner|connexion|activer)(\/|$)/, /\[[^\]]+\]/,
      /^\/(login|register|souscrire|tarifs|fonctionnalites|demo|contact|mot-de-passe-oublie|reinitialiser|offline|cgu|confidentialite|mentions-legales|a-propos|activer-compte)?$/,
      /^\/(portail|client|reunion|verifier|verify|invitation|activation|status)(\/|$)/,
      /^\/(fiscalite|accounting|stock|contracts|comptoir|settings|treasury|isic|users|abonnements|company|associations|administration|saas|profile|projects|activites|marges)\//,
      /^\/(settings|profile|associations|administration|saas)$/,
      // Retirée du menu PME exprès (remplacée par « Veille & offres », etape2.test) ;
      // atteinte depuis les documents.
      /^\/marches$/,
    ];
    const unknown = routes.filter(r => !linked.has(r) && !ALLOWED.some(rx => rx.test(r)));
    expect(unknown).toEqual([]);
  });

  it("aucun écran de l'espace connecté ne reste blanc pendant le chargement", () => {
    for (const g of ["(dashboard)", "(associations)", "(administration)", "(portail)"]) {
      if (!existsSync(join(ROOT, "app", g))) continue;
      expect(existsSync(join(ROOT, "app", g, "loading.tsx"))).toBe(true);
      expect(existsSync(join(ROOT, "app", g, "error.tsx"))).toBe(true);
    }
    const blank = routes.length && pageFiles().filter(f => /if \(!mounted\) return null;/.test(readFileSync(f, "utf-8")));
    expect(blank).toEqual([]);
  });
});

function pageFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "api") walk(p); } else if (f === "page.tsx") out.push(p);
    }
  };
  walk(join(ROOT, "app"));
  return out;
}
