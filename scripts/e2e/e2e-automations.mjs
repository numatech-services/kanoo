// Scénario de bout en bout : automatisations (lot D) — réglages, amortissements,
// brief, découvert prévu, paie, dossier du comptable, validations, budget,
// cotisations, sauvegarde chiffrée relue, lecture de factures non configurée.
// Chaque tâche est déclenchée par /api/cron?job=… (CRON_SECRET), deux fois :
// le second passage ne doit rien renvoyer.
import { readFileSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const { Types } = createRequire(`${ROOT}/package.json`)("mongoose");
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x);

function session() {
  const jar = new Map(); let csrf = "";
  const store = r => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    const form = body instanceof FormData;
    const send = () => fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), ...(form ? {} : { "content-type": "application/json" }), ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
    // Connexion « keep-alive » fermée par le serveur pendant une pause du
    // scénario (lancement d'une tâche datée) : une lecture est rejouée une fois.
    const res = await send().catch(err => (method === "GET" && err?.cause?.code === "ECONNRESET" ? send() : Promise.reject(err)));
    store(res);
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data };
  }
  return { req, reset: () => { csrf = ""; } };
}
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
const cron = async (job) => {
  const r = await fetch(`${BASE}/api/cron?job=${job}`, { headers: { "x-cron-key": process.env.CRON_SECRET } });
  const d = await r.json();
  return { status: r.status, ...(d.ran?.[0] ?? {}) };
};
const notifList = async (g) => { const r = await g.req("GET", "/api/notifications?limit=100"); return r.data?.data?.items ?? r.data?.data ?? []; };

const now = new Date();
const year = now.getFullYear();
const today = now.toISOString().slice(0, 10);
const plusDays = n => new Date(now.getTime() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);

  console.log("\n▶ Réglages");
  const r0 = await g.req("GET", "/api/automations");
  check("défauts : écrits et écritures désactivés, alertes internes actives",
    r0.status === 200 && D(r0).settings.morningBrief.enabled === false && D(r0).settings.depreciation.enabled === false && D(r0).settings.treasuryAlert.enabled === true, J(r0.data));
  check("canaux non branchés signalés (instance de test)", D(r0).channels?.email === false && D(r0).channels?.whatsapp === false);
  const refused = await g.req("PUT", "/api/automations", { ...D(r0).settings, accountantPacket: { enabled: true, emails: ["pas-une-adresse"], day: 1 } });
  check("dossier du comptable sans adresse valide : refusé", refused.status === 400, J(refused.data));
  const settings = {
    ...D(r0).settings,
    morningBrief: { enabled: true, channels: ["email", "whatsapp"], days: [0, 1, 2, 3, 4, 5, 6], recipientIds: [] },
    depreciation: { enabled: true },
    payroll: { enabled: true, reminderDay: 1, autoGenerate: false },
    accountantPacket: { enabled: true, emails: ["cabinet@exemple.ne"], day: 1 },
    approvalReminders: { enabled: true, afterHours: 12 },
    budgetAlerts: { enabled: true, thresholds: [80, 100] },
    treasuryAlert: { enabled: true, horizonDays: 30, threshold: 0 },
  };
  const saved = await g.req("PUT", "/api/automations", settings);
  check("réglages enregistrés", saved.status === 200 && D(saved).settings.accountantPacket.emails[0] === "cabinet@exemple.ne", J(saved.data));
  const { s: comptable } = await login("comptable@test.ne", SEED_PW);
  check("un comptable ne peut pas modifier les automatisations", (await comptable.req("PUT", "/api/automations", settings)).status === 403);

  console.log("\n▶ Amortissements de l'exercice écoulé");
  const asset = D(await g.req("POST", "/api/fixed-assets", { code: "IMMO-AUTO", name: "Véhicule de liaison", category: "vehicle", acquisitionDate: `${year - 1}-01-01`, acquisitionCost: 6_000_000, usefulLifeYears: 5, origin: "existing" }));
  check("immobilisation créée avec son échéancier", Array.isArray(asset.depreciationSchedule) && asset.depreciationSchedule.some(e => e.year === year - 1), J(asset).slice(0, 300));
  const dep = await cron("auto-depreciation");
  check("dotation N-1 passée automatiquement", dep.status === 200 && /1 dotation\(s\) \d{4} passée/.test(dep.summary ?? ""), J(dep));
  const entries = D(await g.req("GET", `/api/accounting-entries?search=AMT-IMMO-AUTO&limit=10`)).items ?? [];
  const e = entries.find(x => x.reference === `AMT-IMMO-AUTO-${year - 1}`);
  check("écriture 681 / 28 au 31/12, équilibrée, au nom du comptable", e && e.lines.some(l => /^68/.test(l.accountCode) && l.debit === 1_200_000) && e.lines.some(l => /^28/.test(l.accountCode) && l.credit === 1_200_000)
    && new Date(e.entryDate).getMonth() === 11, J(e));
  check("second passage : rien de plus", /rien à faire/.test((await cron("auto-depreciation")).summary ?? ""));
  const manual = await g.req("POST", `/api/fixed-assets/${asset._id}/depreciation`, { year: year - 1 });
  check("bouton manuel ensuite : refusé (déjà comptabilisé)", manual.status === 400 && /déjà/.test(manual.data?.error ?? ""), J(manual.data));

  console.log("\n▶ Découvert prévu");
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque automatismes", type: "bank", openingBalance: 300_000, openingDate: `${year}-01-01` }));
  const sup = D(await g.req("POST", "/api/suppliers", { code: "F-AUTO", name: "Fournisseur échéance" }));
  const big = await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup._id, date: today, dueDate: plusDays(10), validate: true, lines: [{ description: "Matériel", accountCode: "604000", quantity: 1, unitPrice: 20_000_000, tvaRate: 0 }] });
  check("facture fournisseur à payer sous 10 jours", big.status === 201 || big.status === 200, J(big.data));
  const ta = await cron("treasury-alert");
  check("alerte de découvert émise", /1 alerte\(s\) de découvert/.test(ta.summary ?? ""), J(ta));
  check("une seule alerte par semaine", /rien à faire/.test((await cron("treasury-alert")).summary ?? ""));
  let list = await notifList(g);
  check("notification « Découvert prévu » pour le gérant", list.some(n => n.type === "treasury_alert" && /passe à/.test(n.message)), J(list.map(n => n.type)));

  console.log("\n▶ Brief du matin");
  const brief = await cron("morning-brief");
  check("brief envoyé par e-mail et WhatsApp (mode console)", /brief\(s\) par e-mail/.test(brief.summary ?? ""), J(brief));
  check("un seul brief par jour et par personne", /rien à faire/.test((await cron("morning-brief")).summary ?? ""));

  console.log("\n▶ Paie du mois");
  const emp = await g.req("POST", "/api/employees", { code: "EMP-AUTO", firstName: "Moussa", lastName: "Auto", position: "Technicien", startDate: `${year - 1}-03-01`, employeeType: "employee", grossSalary: 250_000 });
  const intern = await g.req("POST", "/api/employees", { code: "STG-AUTO", firstName: "Aïcha", lastName: "Stage", position: "Stagiaire", startDate: `${year - 1}-03-01`, employeeType: "intern", indemnity: 5_000, indemnityPeriod: "daily" });
  check("salarié et stagiaire (indemnité journalière) créés", [emp.status, intern.status].every(s => s === 201 || s === 200), J([emp.data, intern.data]));
  const pay = await cron("payroll-prep");
  check("rappel de paie envoyé", /1 rappel\(s\) de paie/.test(pay.summary ?? ""), J(pay));
  list = await notifList(g);
  const pn = list.find(n => n.type === "payroll_reminder");
  check("rappel : masse estimée et fiche à compléter (jours du stagiaire)", pn && /\d+ bulletin\(s\), masse brute estimée [\d\s]+FCFA/.test(pn.message) && /Aïcha Stage/.test(pn.message) && !/Moussa Auto/.test(pn.message), J(pn));
  check("un rappel par mois", /rien à faire/.test((await cron("payroll-prep")).summary ?? ""));
  // Génération d'office : le dernier jour du mois (heure de Niamey), simulé à cette date.
  const s1 = D(await g.req("GET", "/api/automations")).settings;
  await g.req("PUT", "/api/automations", { ...s1, payroll: { ...s1.payroll, autoGenerate: true } });
  const lastDay = new Date(Date.UTC(year, now.getMonth() + 1, 0, 10, 0, 0)).toISOString();
  const runAt = (job, at) => JSON.parse(execFileSync("npx", ["tsx", "scripts/e2e/run-job-at.ts", job, at], { cwd: ROOT, env: process.env, encoding: "utf8" }).trim().split("\n").pop()).summary;
  check("veille du dernier jour : rien généré", !/généré/.test(runAt("runPayroll", new Date(Date.UTC(year, now.getMonth() + 1, -1, 10)).toISOString())));
  const gen = runAt("runPayroll", lastDay);
  check("dernier jour du mois : bulletins à salaire fixe générés d'office", /\d+ bulletin\(s\) généré\(s\)/.test(gen), gen);
  const slips = D(await g.req("GET", `/api/payslips?month=${now.getMonth() + 1}&year=${year}&limit=100`));
  const slipList = slips.items ?? slips;
  check("bulletin du salarié créé, pas celui du stagiaire à la journée", Array.isArray(slipList) && slipList.some(p => (p.employeeId?.code ?? p.employeeId) === "EMP-AUTO" || p.employeeId?.lastName === "Auto") && !slipList.some(p => p.employeeId?.lastName === "Stage"), J(slipList?.map?.(p => p.employeeId?.lastName ?? p.employeeId)));
  check("génération d'office une seule fois", !/généré/.test(runAt("runPayroll", lastDay)));
  list = await notifList(g);
  check("notification « Paie générée »", list.some(n => n.type === "payroll_generated"), J(list.map(n => n.type)));

  console.log("\n▶ Validations en attente");
  const users = D(await g.req("GET", "/api/automations")).users;
  const adminId = users.find(u => u.role === "pme_admin")._id;
  const appr = D(await g.req("POST", "/api/approbations", { resource: "purchases", resourceId: big.data?.data?._id ?? asset._id, amount: 20_000_000, approvers: [{ userId: adminId, level: 1 }] }));
  await withDb(ROOT, db => db.collection("approbations").updateOne({ _id: new Types.ObjectId(appr._id) }, { $set: { createdAt: new Date(Date.now() - 2 * 86400000) } }));
  const ar = await cron("approval-reminders");
  check("relance de la personne qui doit décider", /1 relance\(s\) de validation/.test(ar.summary ?? ""), J(ar));
  check("pas de relance le lendemain immédiat", /rien à faire/.test((await cron("approval-reminders")).summary ?? ""));

  console.log("\n▶ Budget");
  const bud = await g.req("POST", "/api/budget-previsionnel", { year, label: `Budget ${year}`, lines: [{ accountPrefix: "6045", label: "Petit matériel", nature: "expense", annualAmount: 100_000 }] });
  check("budget de l'exercice créé", bud.status === 201 || bud.status === 200, J(bud.data));
  await g.req("POST", "/api/achats", { kind: "cash", payee: "Quincaillerie", date: today, validate: true, pay: true, treasuryAccountId: bank._id, lines: [{ description: "Outillage", accountCode: "604500", quantity: 1, unitPrice: 85_000, tvaRate: 0 }] });
  const ba = await cron("budget-alerts");
  check("alerte à 80 % de la ligne", /1 alerte\(s\) budgétaire/.test(ba.summary ?? ""), J(ba));
  check("une fois par seuil", /rien à faire/.test((await cron("budget-alerts")).summary ?? ""));
  await g.req("POST", "/api/achats", { kind: "cash", payee: "Quincaillerie", date: today, validate: true, pay: true, treasuryAccountId: bank._id, lines: [{ description: "Outillage", accountCode: "604500", quantity: 1, unitPrice: 30_000, tvaRate: 0 }] });
  check("dépassement (115 %) : nouvelle alerte au seuil 100", /1 alerte\(s\) budgétaire/.test((await cron("budget-alerts")).summary ?? ""));
  list = await notifList(g);
  check("notification « Budget dépassé »", list.some(n => n.type === "budget_alert" && n.title === "Budget dépassé"), J(list.filter(n => n.type === "budget_alert")));

  console.log("\n▶ Dossier du comptable");
  const pk = await cron("accountant-packet");
  check("dossier du mois écoulé envoyé", /1 dossier\(s\) comptable/.test(pk.summary ?? ""), J(pk));
  check("un envoi par mois", /rien à faire/.test((await cron("accountant-packet")).summary ?? ""));

  console.log("\n▶ Cotisations (association)");
  const { s: asso } = await login("president@test.ne", SEED_PW);
  const as0 = D(await asso.req("GET", "/api/automations")).settings;
  await asso.req("PUT", "/api/automations", { ...as0, cotisationReminders: { enabled: true, channels: ["email", "sms"], intervalDays: 30 } });
  const m = D(await asso.req("POST", "/api/membres", { code: "M-AUTO", firstName: "Fati", lastName: "Membre", membershipType: "actif", joinDate: `${year}-01-10`, email: "fati@exemple.ne", phone: "96000000" }));
  const c = await asso.req("POST", "/api/cotisations", { memberId: m._id, year, amount: 10_000, paid: false });
  check("cotisation impayée enregistrée", c.status === 201 || c.status === 200, J(c.data));
  const cr = await cron("cotisation-reminders");
  check("relance de l'adhérent (e-mail et SMS)", /1 relance\(s\) par e-mail/.test(cr.summary ?? "") && /1 par SMS/.test(cr.summary ?? ""), J(cr));
  check("pas avant l'intervalle", /rien à faire/.test((await cron("cotisation-reminders")).summary ?? ""));

  console.log("\n▶ Sauvegarde chiffrée");
  const bk = await cron("backup");
  check("sauvegarde écrite", bk.status === 200 && /document\(s\)/.test(bk.summary ?? ""), J(bk));
  check("une par jour", /déjà faite/.test((await cron("backup")).summary ?? ""));
  const dir = process.env.BACKUP_DIR;
  const file = dir && readdirSync(dir).find(f => f.endsWith(".knb"));
  check("archive .knb présente, illisible en clair", file && !readFileSync(`${dir}/${file}`).includes(Buffer.from("admin@test.ne")) && readFileSync(`${dir}/${file}`).subarray(0, 4).toString() === "KNB1");
  let verify = "";
  try { verify = execFileSync("npx", ["tsx", "scripts/restore-backup.ts", "--verify", `${dir}/${file}`], { cwd: ROOT, env: process.env, encoding: "utf8" }); } catch (err) { verify = String(err.stdout ?? err); }
  check("restauration vérifiée : archive lisible et complète", /Vérification réussie/.test(verify) && /document\(s\)/.test(verify), verify.slice(0, 300));
  let wrong = "";
  try { execFileSync("npx", ["tsx", "scripts/restore-backup.ts", "--verify", `${dir}/${file}`], { cwd: ROOT, env: { ...process.env, BACKUP_ENCRYPTION_KEY: "mauvaise-cle-de-chiffrement-xx" }, encoding: "utf8", stdio: "pipe" }); wrong = "accepté"; } catch (err) { wrong = String(err.stderr ?? err); }
  check("mauvaise clé : refus", /clé incorrecte/.test(wrong), wrong.slice(0, 200));

  // Sans clé d'API, la lecture se déclare indisponible ; avec (faux service), e2e-lotE la couvre.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\n▶ Lecture des factures (non configurée)");
    const ai = await g.req("GET", "/api/ai/lire-facture");
    check("indisponible sans clé d'API", ai.status === 200 && D(ai).configured === false, J(ai.data));
    const fd = new FormData(); fd.append("file", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "f.pdf");
    check("envoi refusé proprement (402)", (await g.req("POST", "/api/ai/lire-facture", fd)).status === 402);
  }

  console.log("\n▶ Journal des actions");
  const recent = D(await g.req("GET", "/api/automations")).recent ?? [];
  check("dernières actions listées dans les réglages", recent.length >= 5 && recent.some(r => r.kind === "packet") && recent.some(r => r.kind === "budget"), J(recent));
  const cronAll = await fetch(`${BASE}/api/cron?group=daily`, { headers: { "x-cron-key": process.env.CRON_SECRET } });
  const all = await cronAll.json();
  check("groupe quotidien complet sans échec", cronAll.status === 200 && all.failed === 0, J(all.ran?.filter(x => x.error)));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); console.log(`\n${pass} vérifications réussies, ${fail + 1} en échec`); process.exit(1); });

