// Scénario de bout en bout : refonte v5 (tableau de bord, assistant, objectif, pipeline des marchés).
import { readFileSync } from "fs";
import { randomBytes } from "crypto";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
const PW = `Kz-${randomBytes(12).toString("base64url")}!9q`;
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x);

function session() {
  const jar = new Map(); let csrf = "";
  const store = r => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    const raw = typeof body === "string";
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": raw ? "text/csv" : "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    store(res);
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data };
  }
  return { req, reset: () => { csrf = ""; } };
}
// Le serveur limite les connexions par adresse (20 par minute) : sur un 429,
// le scénario attend le délai annoncé puis réessaie.
async function login(email, pw) {
  for (let attempt = 0; ; attempt++) {
    const s = session();
    const r = await s.req("POST", "/api/auth/login", { email, password: pw });
    s.reset();
    if (r.status !== 429 || attempt >= 2) return { s, r };
    const wait = Number(/(\d+) secondes/.exec(r.data?.error ?? "")?.[1] ?? 60);
    await new Promise(res => setTimeout(res, (wait + 1) * 1000));
  }
}
const D = r => r.data?.data ?? {};

const today = new Date().toISOString().slice(0, 10);
const id = r => D(r)?._id;
const entriesOf = async (g, q) => D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(q)}&limit=50`)).items ?? [];
const balancedE = e => e.lines.reduce((t, l) => t + l.debit, 0) === e.lines.reduce((t, l) => t + l.credit, 0);
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(12, 0, 0, 0); return d.toISOString(); };

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque v5", type: "bank", openingBalance: 2000000, openingDate: "2025-01-01" }));
  const cl = id(await g.req("POST", "/api/clients", { code: "C-TAH", name: "Université Djibo Hamani de Tahoua" }));
  const past = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const f1 = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: past(40), dueDate: past(10), lines: [{ description: "Prestation", quantity: 1, unitPrice: 500000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${f1._id}/send`);
  const f2 = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: today, dueDate: today, lines: [{ description: "Brouillon", quantity: 1, unitPrice: 70000, tvaRate: 0 }] }));

  console.log("\n▶ Pages");
  for (const p of ["/dashboard", "/appels", "/cautions", "/accounting/etats-financiers"]) {
    const r = await g.req("GET", p);
    check(`${p} : rendu sans erreur`, r.status === 200 && typeof r.data === "string" && !/Application error|Unhandled Runtime Error/.test(r.data), String(r.status));
  }
  const dash = (await g.req("GET", "/dashboard")).data;
  check("tableau de bord : bandeau, indicateurs, créances, factures, assistant", ["Votre trésorerie", "Chiffre d", "Créances par client", "Factures", "Assistant", "Actions rapides"].every(t => dash.includes(t)), "contenu");

  console.log("\n▶ Assistant");
  const ask = async q => D(await g.req("POST", "/api/dashboard/assistant", { question: q }));
  const a1 = await ask("Combien me doit Tahoua ?");
  check("dette d'un client retrouvée par une partie de son nom", a1.intent === "client_due" && a1.answer.includes(f1.totalTTC.toLocaleString("fr-FR")) && /retard/.test(a1.answer), J(a1));
  const a2 = await ask("Quelles factures sont en retard ?");
  check("retards listés avec le nombre de jours", a2.intent === "overdue" && a2.answer.includes(f1.number) && /j de retard/.test(a2.answer), J(a2));
  const a3 = await ask("Résume mes brouillons");
  check("brouillons résumés", a3.intent === "drafts" && a3.answer.includes(f2.number), J(a3));
  const a4 = await ask("Quel est mon solde de trésorerie ?");
  check("trésorerie par compte", a4.intent === "treasury" && a4.answer.includes("Banque v5"), J(a4));
  check("question vide : refusée", (await g.req("POST", "/api/dashboard/assistant", { question: " " })).status === 400);
  check("question hors champ : aide", (await ask("Quel temps fait-il ?")).intent === "help");

  console.log("\n▶ Objectif du mois");
  check("objectif invalide : refusé", (await g.req("PUT", "/api/dashboard/objective", { target: -5 })).status === 400);
  const o = await g.req("PUT", "/api/dashboard/objective", { target: 8000000 });
  check("objectif enregistré et affiché", o.status === 200 && (await g.req("GET", "/dashboard")).data.includes("8,0 M"), J(o.data));

  console.log("\n▶ Marchés : étape d'évaluation et pipeline");
  const ap = D(await g.req("POST", "/api/appels", { title: "Archivage numérique", organism: "Cour des comptes", estimatedAmount: 35000000 }));
  for (const st of ["preparing", "submitted", "evaluation"]) await g.req("PATCH", `/api/appels/${ap._id}`, { status: st });
  check("étape « en évaluation » acceptée", D(await g.req("GET", `/api/appels/${ap._id}`)).status === "evaluation");
  const tc = await g.req("POST", `/api/appels/${ap._id}/to-contract`, { amount: 30000000 });
  check("appel en évaluation → marché", tc.status === 201, `${tc.status} ${J(tc.data).slice(0, 120)}`);
  const pl = D(await g.req("GET", "/api/appels/pipeline"));
  check("pipeline : marché en exécution compté", pl.executing?.count === 1 && pl.executing.amount === 30000000 && pl.contracts?.[0]?.appelId === ap._id, J(pl));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
