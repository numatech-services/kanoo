// Scénario de bout en bout : pilotage — objectif de marge par article et écart
// attendu/réalisé, échéancier fournisseurs, liquidation de la TVA, et les
// automatisations (marges, EasyPay, réassort, contrôles comptables, calendrier
// fiscal, factures fournisseurs, offres sans réponse).
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
const require = createRequire(`${ROOT}/package.json`);
const { Types } = require("mongoose");
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x);
const db = fn => withDb(ROOT, fn);

function session() {
  const jar = new Map(); let csrf = "";
  const store = r => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    // Connexion réutilisée fermée par le serveur pendant une tâche longue (ECONNRESET) : une nouvelle tentative.
    const send = () => fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await send().catch(() => send());
    store(res);
    const data = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => null) : null;
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
const pad = n => String(n).padStart(2, "0");
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const today = localDay(now);
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
const runAt = (job, at) => JSON.parse(execFileSync("npx", ["tsx", "scripts/e2e/run-job-at.ts", job, at], { cwd: ROOT, env: process.env, encoding: "utf8" }).trim().split("\n").pop()).summary;
const notifs = async g => { const r = await g.req("GET", "/api/notifications?limit=100"); return r.data?.data?.items ?? r.data?.data ?? []; };

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const tenantId = await db(d => d.collection("users").findOne({ email: "admin@test.ne" }).then(u => u.tenantId));

  console.log("\n▶ Comptoir : objectif de marge par article, écart attendu / réalisé");
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse pilotage", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "Comptoir pilotage", treasuryAccountId: caisse }))._id;
  const pastel = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, name: "Pastel", unit: "pièce", category: "Snacks", quantity: 40, unitCost: 150, salePrice: 250 }));
  const jus = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, name: "Jus", unit: "verre", category: "Boissons", quantity: 26, unitCost: 100, salePrice: 300 }));
  // Hier : pastels vendus à 100 (à perte), jus au prix affiché ; aujourd'hui : rien.
  const s1 = await g.req("POST", "/api/comptoir/sales", { deskId: desk, date: yesterday.toISOString(), lines: [{ itemId: pastel._id, quantity: 4, unitPriceTTC: 100 }, { itemId: jus._id, quantity: 24 }] });
  check("ventes d'hier enregistrées", s1.status === 200 || s1.status === 201, `${s1.status} ${J(s1.data).slice(0, 160)}`);
  const tgt = await g.req("PATCH", `/api/comptoir/items/${jus._id}`, { targetMarkup: 0.85 });
  check("objectif de marge propre à l'article enregistré", tgt.status === 200 && D(tgt).targetMarkup === 0.85, `${tgt.status} ${J(tgt.data).slice(0, 120)}`);
  const prof = D(await g.req("GET", `/api/comptoir/profitability?deskId=${desk}&from=${localDay(yesterday)}&to=${today}`));
  const rp = prof.items?.find(r => r._id === pastel._id), rj = prof.items?.find(r => r._id === jus._id);
  check("pastel : attendue 400, réalisée −200, écart venu du prix saisi en caisse (−600)", rp?.gap?.expected === 400 && rp?.gap?.realized === -200 && rp?.gap?.manualEffect === -600 && rp?.gap?.promoEffect === 0 && rp?.gap?.costEffect === 0, J(rp?.gap));
  check("jus : objectif 85 % de l'article, réalisé 66,7 % : sous l'objectif, manque 1 320", rj?.target === 0.85 && rj?.targetOwn === true && rj?.gap?.belowTarget === true && rj?.gap?.shortfall === 1_320, J({ target: rj?.target, gap: rj?.gap }));
  check("totaux de l'écart sur la période", prof.totals?.gap === prof.items.reduce((t, r) => t + (r.gap?.gap ?? 0), 0) && prof.totals?.manualEffect === -600 && prof.totals?.belowTarget >= 1, J(prof.totals));
  const clear = await g.req("PATCH", `/api/comptoir/items/${jus._id}`, { targetMarkup: null });
  check("objectif de l'article retiré : celui du comptoir s'applique", clear.status === 200 && D(clear).targetMarkup === undefined);
  await g.req("PATCH", `/api/comptoir/items/${jus._id}`, { targetMarkup: 0.85 });

  console.log("\n▶ Comptoir : point du matin (marges, réassort, EasyPay)");
  await db(d => d.collection("integrationevents").insertOne({ tenantId, deskId: new Types.ObjectId(desk), source: "easypay", externalId: "evt-pilotage-1", type: "sale", payload: {}, status: "failed", error: "article inconnu", attempts: 1, createdAt: new Date(now.getTime() - 3 * 86_400_000), updatedAt: new Date() }));
  const m = runAt("runComptoirMorning", now.toISOString());
  check("tâche : un point du matin pour le comptoir", /1 point\(s\) du matin/.test(m), m);
  let list = await notifs(g);
  const morning = list.find(n => n.type === "comptoir_morning");
  check("ventes une à une sous le coût : pastel cité", morning && /Vendu sous le coût : Pastel/.test(morning.message), J(morning));
  check("jus sous l'objectif de marge, avec le manque à gagner", morning && /Sous l'objectif de marge : Jus/.test(morning.message), J(morning?.message));
  check("réassort dans le même message (jus : 2 verres pour 24 vendus)", morning && /Réassort : .*Jus/.test(morning.message), J(morning?.message));
  check("envoi EasyPay vieux de 3 jours toujours signalé", morning && /EasyPay : 1 événement\(s\) en attente/.test(morning.message), J(morning?.message));
  check("lien profond vers le comptoir et l'onglet Marges", morning?.linkedTo === `/comptoir?desk=${desk}&tab=rentabilite`, J(morning?.linkedTo));
  check("un seul point du matin par comptoir et par jour", !/point/.test(runAt("runComptoirMorning", now.toISOString())));
  const ep = D(await g.req("GET", `/api/comptoir/easypay?deskId=${desk}`));
  check("onglet EasyPay : rapprochement des 7 derniers jours", Array.isArray(ep.daily) && ep.daily.length === 7 && ep.daily.every(x => typeof x.net === "number"), J(ep.daily?.slice?.(-1)));

  console.log("\n▶ Échéancier et balance âgée des fournisseurs");
  const sup = D(await g.req("POST", "/api/suppliers", { code: "PIL-F", name: "Grossiste Pilotage" }))._id;
  const late = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 40), soon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
  const a1 = await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: localDay(late), dueDate: localDay(late), validate: true, lines: [{ description: "Farine", accountCode: "601000", quantity: 1, unitPrice: 300_000, tvaRate: 0 }] });
  const a2 = await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, dueDate: localDay(soon), validate: true, lines: [{ description: "Sucre", accountCode: "601000", quantity: 1, unitPrice: 120_000, tvaRate: 0 }] });
  check("deux factures fournisseurs validées", [a1.status, a2.status].every(s => s === 200 || s === 201), `${a1.status} ${a2.status} ${J(a1.data).slice(0, 150)}`);
  const sched = D(await g.req("GET", "/api/achats/echeancier"));
  check("échéancier : 420 000 à payer dont 300 000 en retard", sched.total === 420_000 && sched.overdue === 300_000, J({ total: sched.total, overdue: sched.overdue }));
  check("balance âgée : 300 000 échus de 31 à 60 jours, 120 000 sous 7 jours", sched.bySupplier?.[0]?.buckets?.overdue_30 === 300_000 && sched.bySupplier?.[0]?.buckets?.due_7 === 120_000, J(sched.bySupplier?.[0]));
  const sp = runAt("runSupplierPayments", now.toISOString());
  list = await notifs(g);
  check("alerte : factures en retard et à payer", /1 alerte\(s\) de paiement/.test(sp) && list.some(n => n.type === "supplier_payments" && /en retard/.test(n.message)), sp);
  check("une alerte par semaine au plus", !/alerte/.test(runAt("runSupplierPayments", now.toISOString())));

  console.log("\n▶ Offres sans réponse");
  const ap = D(await g.req("POST", "/api/appels", { title: "Fourniture de mobilier scolaire", organism: "Ministère de l'Éducation", estimatedAmount: 25_000_000 }));
  await db(d => d.collection("appelcandidatures").updateOne({ _id: new Types.ObjectId(ap._id) }, { $set: { status: "evaluation", stageChangedAt: new Date(now.getTime() - 45 * 86_400_000) } }));
  const tf = runAt("runTenderFollowup", now.toISOString());
  list = await notifs(g);
  check("offre en évaluation depuis 45 jours relancée", /1 relance/.test(tf) && list.some(n => n.type === "tender_followup" && /mobilier scolaire/.test(n.message)), tf);

  console.log("\n▶ TVA : liquidation 443/445 → 4441, crédit reporté");
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const cl = D(await g.req("POST", "/api/clients", { code: "PIL-C", name: "Client Pilotage", type: "company" }))._id;
  const inv = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: localDay(pm), dueDate: localDay(pm), lines: [{ description: "Étude", quantity: 1, unitPrice: 100_000, tvaRate: 0.19 }] }));
  await g.req("POST", `/api/invoices/${inv._id}/send`);
  await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: localDay(pm), dueDate: localDay(pm), validate: true, lines: [{ description: "Matériel", accountCode: "604000", quantity: 1, unitPrice: 50_000, tvaRate: 0.19 }] });
  const tvaGet = D(await g.req("GET", `/api/fiscal/tva?annee=${pm.getFullYear()}&mois=${pm.getMonth() + 1}`));
  check("TVA du mois : collectée 19 000, déductible 9 500, nette 9 500", tvaGet.tvaCollectee === 19_000 && tvaGet.tvaDeductible === 9_500 && tvaGet.tvaNette === 9_500, J(tvaGet));
  const decl = await g.req("POST", "/api/fiscal/tva", { annee: pm.getFullYear(), mois: pm.getMonth() + 1, settle: true });
  check("déclaration enregistrée et TVA liquidée (9 500 dus)", decl.status === 200 && D(decl).settlement?.due === 9_500, `${decl.status} ${J(D(decl).settlement ?? decl.data).slice(0, 200)}`);
  const ref = `LIQ-TVA-${pm.getFullYear()}-${pad(pm.getMonth() + 1)}`;
  const liq = await db(d => d.collection("accountingentries").find({ tenantId, reference: ref }).toArray());
  const active = liq.filter(e => !e.reversedBy && !e.reverses);
  const bal = e => e.lines.reduce((t, l) => t + l.debit, 0) === e.lines.reduce((t, l) => t + l.credit, 0);
  check("écriture de liquidation équilibrée : 443 débit 19 000, 445 crédit 9 500, 4441 crédit 9 500", active.length === 1 && bal(active[0]) && active[0].lines.some(l => /^443/.test(l.accountCode) && l.debit === 19_000) && active[0].lines.some(l => /^445/.test(l.accountCode) && l.credit === 9_500) && active[0].lines.some(l => l.accountCode === "444100" && l.credit === 9_500), J(active.map(e => e.lines)));
  const tvaAfter = D(await g.req("GET", `/api/fiscal/tva?annee=${pm.getFullYear()}&mois=${pm.getMonth() + 1}`));
  check("la liquidation ne change pas la TVA du mois (écriture non imposable)", tvaAfter.tvaNette === 9_500 && tvaAfter.liquidee === true, J(tvaAfter));
  const rect = await g.req("POST", "/api/fiscal/tva", { annee: pm.getFullYear(), mois: pm.getMonth() + 1, motif: "contrôle" });
  const relq = await g.req("POST", "/api/fiscal/tva/liquidation", { annee: pm.getFullYear(), mois: pm.getMonth() + 1 });
  const liq2 = await db(d => d.collection("accountingentries").find({ tenantId, reference: ref, reversedBy: { $exists: false }, reverses: { $exists: false } }).toArray());
  check("rectification puis « repasser la liquidation » : ancienne extournée, une seule active", rect.status === 200 && relq.status === 200 && liq2.length === 1, `${rect.status} ${relq.status} ${J(relq.data).slice(0, 160)} ${liq2.length}`);
  // Paiement de la TVA déjà passé au 443 hors de Kanoo : la liquidation est refusée (double compte).
  const manual = await db(d => d.collection("accountingentries").insertOne({ tenantId, journalCode: "BQ", entryDate: new Date(pm.getFullYear(), pm.getMonth(), 25), reference: "TVA-MANUELLE", label: "Paiement TVA au 443", createdBy: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(),
    lines: [{ accountCode: "443000", accountLabel: "TVA", debit: 5_000, credit: 0 }, { accountCode: "521000", accountLabel: "Banque", debit: 0, credit: 5_000 }] }));
  const refused = await g.req("POST", "/api/fiscal/tva/liquidation", { annee: pm.getFullYear(), mois: pm.getMonth() + 1 });
  check("TVA déjà soldée en partie au 443 : liquidation refusée", refused.status === 400 && /double compte/.test(refused.data?.error ?? ""), `${refused.status} ${J(refused.data).slice(0, 200)}`);
  await db(d => d.collection("accountingentries").deleteOne({ _id: manual.insertedId }));
  const pay = await g.req("POST", "/api/fiscal/tva/paiement", { annee: pm.getFullYear(), mois: pm.getMonth() + 1, treasuryAccountId: caisse, date: today, reference: "Q-123" });
  const after = D(await g.req("GET", `/api/fiscal/tva?annee=${pm.getFullYear()}&mois=${pm.getMonth() + 1}`));
  check("paiement de la TVA : 9 500 au débit du 4441, déclaration « payée »", pay.status === 200 && D(pay).amount === 9_500 && after.statut === "paid" && after.paiement?.remaining === 0, `${pay.status} ${J(pay.data).slice(0, 160)} ${J(after.paiement)}`);

  console.log("\n▶ Calendrier fiscal et contrôles comptables");
  const nextMonth1 = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1, 9)).toISOString();
  // ITS retenu sur la paie du mois : même échéance du 15, cité dans le rappel.
  await db(d => d.collection("accountingentries").insertOne({ tenantId, journalCode: "OD", entryDate: new Date(), reference: "PAIE-E2E", label: "Paie du mois", createdBy: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(),
    lines: [{ accountCode: "422000", accountLabel: "Personnel", debit: 27_000, credit: 0 }, { accountCode: "447100", accountLabel: "ITS", debit: 0, credit: 27_000 }] }));
  const fc = runAt("runFiscalCalendar", nextMonth1);
  list = await notifs(g);
  check("le 1er : ITS du mois cité avec son solde", list.some(n => n.type === "fiscal_reminder" && /ITS retenu sur les salaires 27\s?000/.test(n.message)), J(list.filter(n => n.type === "fiscal_reminder").map(n => n.message)));
  check("le 1er : TVA du mois à préparer, avec ses montants", /\d+ rappel/.test(fc) && list.some(n => n.type === "fiscal_reminder" && /à préparer/.test(n.title) && /collectée/.test(n.message)), `${fc} ${J(list.filter(n => n.type === "fiscal_reminder"))}`);
  const draft = await db(d => d.collection("fiscaldeclarations").findOne({ tenantId, type: "tva", "period.annee": now.getFullYear(), "period.mois": now.getMonth() + 1 }));
  check("le 1er : brouillon de la déclaration du mois préparé", draft?.status === "draft", J(draft));
  check("pas de second rappel le même jour", !/rappel/.test(runAt("runFiscalCalendar", nextMonth1)));
  const prevMonth10 = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 10, 9)).toISOString();
  runAt("runFiscalCalendar", prevMonth10);
  const dueKey = `fiscal:tva_due:${pm.getFullYear()}-${pad(pm.getMonth() + 1)}`;
  check("mois déjà déclaré : pas de rappel du 10 pour l'organisation", !(await db(d => d.collection("automationlogs").findOne({ tenantId, key: dueKey }))));
  const acompte = runAt("runFiscalCalendar", new Date(Date.UTC(now.getFullYear() + 1, 5, 20, 9)).toISOString());
  check("acompte d'IS rappelé 15 jours avant le 1er juillet", /\d+ rappel/.test(acompte), acompte);
  const ck = runAt("runAccountingChecks", new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 10, 9)).toISOString());
  list = await notifs(g);
  const ckNote = list.find(n => n.type === "accounting_checks");
  check("contrôles comptables du mois : notification avec le nombre de constats", /\d+ contrôle/.test(ck) && ckNote && /constat/.test(ckNote.message), `${ck} ${J(ckNote)}`);

  console.log("\n▶ Réglages");
  const set = D(await g.req("GET", "/api/automations")).settings;
  check("nouvelles automatisations présentes et actives d'office", set?.comptoirMargins?.enabled && set?.easypayRecon?.enabled && set?.fiscalCalendar?.enabled && set?.comptoirReorder?.autoOrder === false && set?.accountingChecks?.day === 10, J(set));
  const off = await g.req("PUT", "/api/automations", { ...set, tenderFollowup: { enabled: false, afterDays: 45 }, comptoirReorder: { enabled: true, autoOrder: true }, easypayRecon: { enabled: true, threshold: 123_456 } });
  const reread = D(await g.req("GET", "/api/automations")).settings;
  check("réglages relus après enregistrement (désactivation, bons automatiques, seuil)", off.status === 200 && reread?.tenderFollowup?.enabled === false && reread?.tenderFollowup?.afterDays === 45 && reread?.comptoirReorder?.autoOrder === true && reread?.easypayRecon?.threshold === 123_456, J(reread));

  console.log(`\n${pass} réussis, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
