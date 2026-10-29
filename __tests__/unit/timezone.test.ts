/**
 * Fuseau : les journées se comptent à l'heure de Niamey, pas en UTC.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { ensureProcessTimezone, APP_TIMEZONE } from "@/lib/timezone";
import { localDay, todayLocal } from "@/lib/format";

describe("Fuseau de l'application", () => {
  const before = process.env.TZ;
  afterEach(() => { process.env.TZ = before; });

  it("posé à Africa/Niamey au démarrage s'il est absent, respecté s'il est explicite", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    expect(ensureProcessTimezone(env)).toBe(APP_TIMEZONE);
    expect(env.TZ).toBe("Africa/Niamey");
    const explicit: NodeJS.ProcessEnv = { NODE_ENV: "test", TZ: "Europe/Paris" };
    expect(ensureProcessTimezone(explicit)).toBe("Europe/Paris");
    expect(ensureProcessTimezone({ NODE_ENV: "test", TZ: "  " })).toBe(APP_TIMEZONE);
  });

  it("00 h 30 à Niamey, c'est déjà le lendemain (le jour UTC était encore la veille)", () => {
    process.env.TZ = "Africa/Niamey";
    const at = new Date("2026-10-28T23:30:00.000Z"); // 29/10 à 00 h 30 à Niamey
    expect(at.toISOString().slice(0, 10)).toBe("2026-10-28");
    expect(localDay(at)).toBe("2026-10-29");
  });

  it("fin du mois dernier construite à minuit local : le bon jour (pas la veille)", () => {
    process.env.TZ = "Africa/Niamey";
    const lastMonthEnd = new Date(2026, 9, 0); // 30 septembre, minuit à Niamey
    expect(lastMonthEnd.toISOString().slice(0, 10)).toBe("2026-09-29");
    expect(localDay(lastMonthEnd)).toBe("2026-09-30");
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("instrumentation et configuration posent le fuseau", () => {
    const root = join(__dirname, "../..");
    expect(readFileSync(join(root, "instrumentation.ts"), "utf-8")).toMatch(/export async function register[\s\S]*ensureProcessTimezone\(\)/);
    expect(readFileSync(join(root, "next.config.mjs"), "utf-8")).toContain('process.env.TZ = "Africa/Niamey"');
  });

  it("plus aucun écran ne prend « aujourd'hui » en UTC", () => {
    const root = join(__dirname, "../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== "node_modules" && f !== "api") walk(p); continue; }
        if (!/\.tsx?$/.test(f)) continue;
        if (/new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\("T"\)\[0\])/.test(readFileSync(p, "utf-8"))) offenders.push(p.slice(root.length + 1));
      }
    };
    walk(join(root, "app"));
    walk(join(root, "components"));
    expect(offenders).toEqual([]);
  });
});
