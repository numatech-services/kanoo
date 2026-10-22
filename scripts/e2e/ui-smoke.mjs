// Test de fumée dans un vrai navigateur : charge chaque page de l'application
// avec le profil qui y a accès et relève ce qu'aucun test d'API ne voit —
// erreur JavaScript, page d'erreur, appel d'API en 500, écran resté « en
// chargement », page vide.
//
//   node scripts/e2e/ui-smoke.mjs <racine> [--out rapport.json] [--compare reference.json]
//
// Exige une instance sur le port 3099 et la base de test ensemencée
// (scripts/seed-test.ts, idéalement complétée par un scénario). Utilise le
// Chrome installé (playwright-core, sans téléchargement de navigateur) ;
// CHROME_PATH pour en désigner un autre.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";
import { chromium } from "playwright-core";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];

// ── Pages : déduites de l'arborescence app/ ────────────────────────────────
function pages(dir, segs = []) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "api" || name.startsWith("_")) continue;
      out.push(...pages(full, [...segs, name]));
    } else if (name === "page.tsx") {
      const group = segs.find(s => /^\(.+\)$/.test(s)) ?? "";
      const route = "/" + segs.filter(s => !/^\(.+\)$/.test(s)).join("/");
      out.push({ route: route === "/" ? "/" : route, group, saas: segs[0] === "saas" });
    }
  }
  return out;
}

const PROFILE = p => p.saas ? "super@test.ne"
  : p.group === "(associations)" ? "president@test.ne"
  : p.group === "(administration)" ? "ordonnateur@test.ne"
  : p.group === "(public)" || p.route === "/" ? null
  : "admin@test.ne";

/** Identifiant d'exemple pour une route dynamique : premier élément de la liste API correspondante. */
const LISTS = {
  invoices: "/api/invoices", clients: "/api/clients", suppliers: "/api/suppliers", stock: "/api/products",
  employees: "/api/employees", devis: "/api/devis", contracts: "/api/contracts", depenses: "/api/achats",
  appels: "/api/appels", commandes: "/api/commandes", livraisons: "/api/livraisons", payslips: "/api/payslips",
  projects: "/api/projects", "notes-de-frais": "/api/expenses", treasury: "/api/treasury-accounts", isic: "/api/isic/cards",
  marches: "/api/marches", "marches-cadres": "/api/marches-cadres", "fixed-assets": "/api/fixed-assets",
};

// « Failed to load resource » double le suivi des réponses ci-dessous, qui sait,
// lui, distinguer une panne de Kanoo d'un service externe indisponible
// (Google Fonts répond parfois 503).
const IGNORED_CONSOLE = /fetching the script|service ?worker|favicon|Download the React DevTools|Failed to load resource/i;

async function main() {
  const executablePath = process.env.CHROME_PATH
    || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"].find(existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  const all = pages(path.join(ROOT, "app")).filter(p => !p.route.includes("/client/") && !p.group.includes("portail") && !/\/(offline|reunion)/.test(p.route));
  const contexts = new Map();
  async function contextFor(email) {
    if (contexts.has(email)) return contexts.get(email);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    if (email) {
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`);
      const status = await page.evaluate(async ({ email, pw }) => {
        const c = await fetch("/api/auth/csrf").then(r => r.json());
        return (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": c.csrfToken }, body: JSON.stringify({ email, password: pw }) })).status;
      }, { email, pw: SEED_PW });
      if (status !== 200) throw new Error(`Connexion impossible pour ${email} (${status})`);
      await page.close();
    }
    contexts.set(email, ctx);
    return ctx;
  }

  const results = [];
  for (const p of all) {
    const email = PROFILE(p);
    const ctx = await contextFor(email);
    let route = p.route;
    if (route.includes("[")) {
      const base = route.split("/")[1];
      const list = LISTS[base];
      if (!list || route.split("[").length > 2) { results.push({ route: p.route, skipped: "route dynamique sans liste connue" }); continue; }
      const page0 = await ctx.newPage();
      await page0.goto(`${BASE}/dashboard`).catch(() => {});
      const id = await page0.evaluate(async url => { const d = await fetch(url + (url.includes("?") ? "&" : "?") + "limit=1").then(r => r.json()).catch(() => null); const items = d?.data?.items ?? d?.data ?? []; return Array.isArray(items) ? items[0]?._id ?? null : null; }, list);
      await page0.close();
      if (!id) { results.push({ route: p.route, skipped: "aucune donnée d'exemple" }); continue; }
      route = route.replace(/\[[^\]]+\]/, id);
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(`JS: ${e.message}`.slice(0, 200)));
    page.on("console", m => { if (m.type() === "error" && !IGNORED_CONSOLE.test(m.text())) errors.push(`console: ${m.text()}`.slice(0, 200)); });
    page.on("response", r => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    let status = 0;
    try {
      const resp = await page.goto(BASE + route, { waitUntil: "load", timeout: 30000 });
      status = resp?.status() ?? 0;
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => errors.push("réseau jamais au repos (15 s)"));
      await page.waitForTimeout(400);
    } catch (e) { errors.push(`navigation : ${e.message.slice(0, 120)}`); }
    const info = await page.evaluate(() => ({
      errorBoundary: /Une erreur est survenue/.test(document.body.innerText),
      pulses: [...document.querySelectorAll(".animate-pulse")].filter(e => e.getBoundingClientRect().height > 12).length,
      text: (document.querySelector("main")?.innerText ?? document.body.innerText).replace(/\s+/g, " ").length,
      url: location.pathname,
    })).catch(() => ({ errorBoundary: false, pulses: 0, text: 0, url: "" }));
    if (info.errorBoundary) errors.push("page d'erreur affichée");
    results.push({ route: p.route, path: route, status, finalUrl: info.url, errors, pulses: info.pulses, text: info.text });
    await page.close();
  }
  await browser.close();

  const out = arg("--out");
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
  const visited = results.filter(r => !r.skipped);
  const broken = visited.filter(r => r.errors.length || r.status >= 400);
  console.log(`${visited.length} page(s) visitée(s), ${results.length - visited.length} sautée(s), ${broken.length} en défaut`);
  for (const r of broken) console.log(`  ✗ ${r.path} [${r.status}] ${r.errors.join(" | ")}`);

  const ref = arg("--compare");
  let regressions = 0;
  if (ref) {
    const before = new Map(JSON.parse(readFileSync(ref, "utf8")).map(r => [r.route, r]));
    for (const r of visited) {
      const b = before.get(r.route);
      if (!b || b.skipped) continue;
      const why = [];
      if (r.errors.length > b.errors.length) why.push(`erreurs ${b.errors.length} → ${r.errors.length}`);
      if (r.pulses > b.pulses) why.push(`chargements bloqués ${b.pulses} → ${r.pulses}`);
      if (b.text > 200 && r.text < b.text * 0.7) why.push(`contenu ${b.text} → ${r.text} caractères`);
      // Redirection (accès refusé, connexion perdue…) : comparée à la page
      // demandée, pas à l'adresse brute — les identifiants des fiches changent
      // d'une base ensemencée à l'autre.
      const redirected = x => x.finalUrl !== x.path;
      if (redirected(r) && !redirected(b)) why.push(`redirigée vers ${r.finalUrl}`);
      if (why.length) { regressions++; console.log(`  ↘ ${r.route} : ${why.join(", ")}`); }
    }
    console.log(`${regressions} régression(s) par rapport à la référence`);
  }
  process.exit(broken.length || regressions ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
