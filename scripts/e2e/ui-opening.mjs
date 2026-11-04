// Parcours réel de l'assistant d'ouverture dans un navigateur, au format
// téléphone : ouvre un site (argent, stock en cartons), puis ajoute du stock et
// de l'argent à un site ouvert, et relit les chiffres à l'écran.
//
//   node scripts/e2e/ui-opening.mjs <racine> [dossier-captures]
//
// Exige une instance sur le port 3099 et la base de test ensemencée.
import { readFileSync, existsSync } from "fs";
import { chromium } from "playwright-core";

const BASE = "http://localhost:3099", ROOT = process.argv[2], SHOTS = process.argv[3];
const PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
const executablePath = process.env.CHROME_PATH || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(`JS : ${e.message}`));
page.on("response", async r => {
  if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  if (r.status() >= 400 && r.url().includes("/api/restauration/")) console.log(`  ! ${r.status()} ${await r.text().catch(() => "")}`.slice(0, 300));
});
let pass = 0, fail = 0;
const check = (label, ok, info) => { if (ok) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`, info ?? ""); } };
const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const button = name => page.getByRole("button", { name, exact: false });
const name = `Site parcours ${Date.now().toString().slice(-6)}`;

await page.goto(`${BASE}/login`);
const status = await page.evaluate(async ({ pw }) => {
  const c = await fetch("/api/auth/csrf").then(r => r.json());
  return (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": c.csrfToken }, body: JSON.stringify({ email: "admin@test.ne", password: pw }) })).status;
}, { pw: PW });
if (status !== 200) throw new Error(`Connexion impossible (${status})`);

await page.goto(`${BASE}/restauration/ouverture`, { waitUntil: "networkidle", timeout: 120000 });
// Mode développement : l'indicateur de Next.js recouvre le bas de l'écran du téléphone.
await page.addStyleTag({ content: "nextjs-portal { display: none !important; pointer-events: none !important; }" });
await button("Ouvrir un site").first().click();
await page.getByLabel("Nom du site").fill(name);
await page.getByLabel("TVA sur les ventes").selectOption("0");
await shot("1-site");
await button("Continuer").click();
await page.getByLabel("Montant alloué").fill("150000");
await page.getByLabel("D'où vient cet argent").selectOption("advance");
await shot("2-argent");
await button("Continuer").click();
await page.getByLabel("Article", { exact: true }).fill("Jus parcours");
await page.getByLabel("Carton de (unités)").fill("24");
await page.getByLabel("Cartons comptés").fill("2");
await page.getByLabel("+ unités").fill("5");
await page.getByLabel("Coût (FCFA)").fill("4800");
await page.getByLabel("Coût par").selectOption("pack");
await page.getByLabel("Prix de vente").fill("300");
await shot("3-stock");
const sum = await page.getByText("Stock de départ :").textContent();
check("2 cartons de 24 + 5 à 4 800 le carton = 10 600 affichés", /10\s?600/.test(sum ?? ""), sum);
await button("Continuer").click();
await button("Continuer").click();
await page.getByLabel("Électricité").fill("25000");
await button("Continuer").click();
await shot("4-verifier");
const recap = await page.getByRole("dialog").textContent();
check("récapitulatif : argent, stock, charges", /150\s?000/.test(recap) && /10\s?600/.test(recap) && /25\s?000/.test(recap), recap);
await button("Ouvrir le site").last().click();
await page.getByText("est ouvert").waitFor({ timeout: 30000 });
await shot("5-ouvert");
check("site ouvert, fonds de caisse annoncé", /fonds de caisse/.test(await page.getByRole("dialog").textContent()));
await button("Fermer").last().click();
await page.waitForLoadState("networkidle");
const card = page.locator("section", { hasText: name }).first();
const text = await card.textContent();
check("carte du site : caisse et stock à jour", /150\s?000/.test(text) && /10\s?600/.test(text), text);
await shot("6-liste");

await card.getByRole("button", { name: "Stock" }).click();
await page.getByLabel("Article", { exact: true }).fill("Eau parcours");
await page.getByLabel("Quantité").fill("10");
await page.getByLabel("Coût (FCFA)").fill("100");
await button("Enregistrer le stock").click();
await button("Confirmer").last().click().catch(() => {});
await page.getByRole("dialog").waitFor({ state: "detached", timeout: 30000 });
await card.getByText(/11\s?600/).waitFor({ timeout: 30000 }).catch(() => {});
check("stock ajouté sur un site ouvert : 11 600 au coût", /11\s?600/.test(await card.textContent()), await card.textContent());

await card.getByRole("button", { name: "Argent" }).click();
await page.getByLabel("Montant alloué").fill("50000");
await page.getByLabel("D'où vient cet argent").selectOption("to_classify");
await button("Allouer").last().click();
await page.getByRole("dialog").waitFor({ state: "detached", timeout: 30000 });
await card.getByText(/200\s?000/).first().waitFor({ timeout: 30000 }).catch(() => {});
check("argent ajouté : caisse à 200 000", /200\s?000/.test(await card.textContent()), await card.textContent());

await card.getByRole("button", { name: "Situation de départ" }).click();
await page.getByText("Où il est allé").waitFor({ timeout: 30000 });
await shot("7-situation");
const pos = await page.getByRole("dialog").textContent();
check("situation de départ : l'origine à qualifier est signalée, le stock a son origine", /à qualifier/.test(pos) && /Stock repris/.test(pos), pos);

check("aucune erreur JavaScript ni erreur 500", errors.length === 0, errors);
console.log(`\n${pass} réussis, ${fail} en échec`);
await browser.close();
process.exit(fail ? 1 : 0);
