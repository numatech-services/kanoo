import fs from "fs";
import path from "path";
import { moduleForHref, moduleEnabled, sanitizeModules } from "@/lib/modules";
import { sectionForPath } from "@/lib/sections";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("Modules optionnels", () => {
  it("rattache chaque écran optionnel à son module, et le socle à aucun", () => {
    expect(moduleForHref("/comptoir")).toBe("comptoir");
    expect(moduleForHref("/isic/registre?q=x")).toBe("isic");
    expect(moduleForHref("/abonnements/reventes")).toBe("licences");
    expect(moduleForHref("/activites/abc")).toBe("evenements");
    expect(moduleForHref("/invoices")).toBeUndefined();
    // « /isicx » n'est pas un écran ISIC : correspondance par segment, pas par préfixe brut.
    expect(moduleForHref("/isicx")).toBeUndefined();
  });

  it("masque un écran dont le module est désactivé, jamais un écran du socle", () => {
    expect(moduleEnabled("/comptoir", ["comptoir"])).toBe(false);
    expect(moduleEnabled("/comptoir", [])).toBe(true);
    expect(moduleEnabled("/comptoir", undefined)).toBe(true);
    expect(moduleEnabled("/invoices", ["comptoir", "isic", "licences", "evenements"])).toBe(true);
  });

  it("n'enregistre que des clés connues, sans doublon", () => {
    expect(sanitizeModules(["isic", "isic", "inconnu", 3, "comptoir"])).toEqual(["isic", "comptoir"]);
    expect(sanitizeModules("isic")).toEqual([]);
  });
});

describe("Menu en espaces", () => {
  const sidebar = read("components/layout/Sidebar.tsx");
  const pme = sidebar.slice(sidebar.indexOf("const PME_NAV"), sidebar.indexOf("const ASSO_NAV"));
  const hrefs = [...pme.matchAll(/href: "([^"]+)"/g)].map(m => m[1]);

  it("ne montre chaque écran qu'une fois", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("donne à chaque entrée la teinte de son groupe", () => {
    const groups = [...pme.matchAll(/section: "([^"]+)", tone: "([^"]+)", items: \[([\s\S]*?)\]\}/g)];
    expect(groups.length).toBe(9);
    for (const [, name, tone, body] of groups) {
      for (const [, href] of body.matchAll(/href: "([^"]+)"/g)) {
        expect(`${name} › ${href} → ${sectionForPath(href)}`).toBe(`${name} › ${href} → ${tone}`);
      }
    }
  });

  it("retire les marchés publics PME, remplacés par Veille & offres", () => {
    expect(hrefs).not.toContain("/marches");
    expect(hrefs).toContain("/appels");
  });

  it("fait dériver la palette du menu au lieu d'une liste parallèle", () => {
    const palette = read("components/shared/CommandPalette.tsx");
    expect(palette).toMatch(/NAV_MAP\[profile\]\.flatMap/);
    expect(palette).not.toMatch(/const COMMANDS: Command\[\]/);
    expect(read("app/(dashboard)/layout.tsx")).toMatch(/<CommandPalette profile=\{profile\} \/>/);
  });
});

describe("Dialogues de l'application", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk("app");
  walk("components");

  it("n'emploie plus alert / confirm / prompt du navigateur", () => {
    const offenders = files
      .filter(f => !f.endsWith(path.join("ui", "Dialogs.tsx")))
      .filter(f => /(^|[^.\w])(window\.)?(alert|confirm|prompt)\(/m.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("monte l'hôte des dialogues une fois, à la racine", () => {
    expect(read("app/layout.tsx")).toMatch(/<DialogHost \/>/);
  });
});
