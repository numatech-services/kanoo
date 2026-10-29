// Scénario de bout en bout : documents commerciaux prêts à l'envoi et
// corrections de l'administrateur — devis/proforma avec mentions, postes et
// descriptifs ; PDF lisibles (devis, proforma, facture, bon de livraison, bon
// de commande, aperçu du style) ; correction contrôlée d'une facture émise ;
// devis libéré quand sa facture est annulée ; réimputation d'un achat validé
// et d'une écriture manuelle ; note de frais approuvée renvoyée en brouillon ;
// réglages de l'assistant Claude (clé chiffrée, jamais renvoyée).
import { readFileSync } from "fs";
import { createRequire } from "module";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
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
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    store(res);
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  async function raw(p) {
    const res = await fetch(`${BASE}${p}`, { headers: { cookie: cookie() } });
    return { status: res.status, type: res.headers.get("content-type") ?? "", buf: Buffer.from(await res.arrayBuffer()) };
  }
  return { req, raw, reset: () => { csrf = ""; } };
}
async function login(email) {
  for (let attempt = 0; ; attempt++) {
    const s = session();
    const r = await s.req("POST", "/api/auth/login", { email, password: SEED_PW });
    s.reset();
    if (r.status !== 429 || attempt >= 2) return s;
    const wait = Number(/(\d+) secondes/.exec(r.data?.error ?? "")?.[1] ?? 60);
    await new Promise(res => setTimeout(res, (wait + 1) * 1000));
  }
}
const D = r => r.data?.data ?? {};
const db = fn => withDb(ROOT, fn);

const require = createRequire(`${ROOT}/package.json`);
let unpdf;
async function pdfText(buf) {
  unpdf ??= await import(require.resolve("unpdf"));
  const { text } = await unpdf.extractText(await unpdf.getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
  return text.replace(/\s+/g, " ");
}
async function pdfCheck(label, s, path, expect) {
  const r = await s.raw(path);
  const isPdf = r.status === 200 && r.buf.subarray(0, 4).toString() === "%PDF";
  const text = isPdf ? await pdfText(r.buf) : "";
  // Les titres en capitales espacées (« F A C T U R E ») se comparent sans espaces.
  const flat = text.replace(/\s+/g, "");
  const missing = expect.filter(e => !(e instanceof RegExp ? e.test(text) || e.test(flat) : text.includes(e) || flat.toLowerCase().includes(e.replace(/\s+/g, "").toLowerCase())));
  check(label, isPdf && missing.length === 0, `${r.status} ${r.type} manque ${J(missing.map(String))} — ${text.slice(0, 300)}`);
  return text;
}

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const today = new Date().toISOString().slice(0, 10);
  const g = await login("admin@test.ne");
  const c = await login("comptable@test.ne");

  console.log("\n▶ 1. Devis et proforma");
  const client = D(await g.req("POST", "/api/clients", { code: "C-OBE", name: "Office du Baccalauréat (OBEECS)", address: "Quartier Francophonie, Niamey" }));
  const lines = [
    { section: "Audiovisuel", description: "Écran interactif 86\"", details: "Écran tactile 4K UHD, Android intégré, support mural renforcé", unit: "u", quantity: 1, unitPrice: 3467660, tvaRate: 0.19, discount: 0 },
    { section: "Prestations", description: "Mise en service et formation", details: "Réglages, test de visioconférence, formation des utilisateurs", unit: "h/j", quantity: 3, unitPrice: 79800, tvaRate: 0.19, discount: 0 },
  ];
  const dv = await g.req("POST", "/api/devis", {
    clientId: client._id, issueDate: today, validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), docKind: "proforma",
    object: "Audiovisuel et aménagement de la salle de réunion", reference: "BC-OBE-2026-12", attention: "Monsieur le Directeur général",
    termsAndConditions: "Validité — offre valable trente (30) jours.\nRèglement — 60 % à la commande, solde à la livraison.", notes: "Note interne jamais imprimée", lines,
  });
  const devis = D(dv);
  check("proforma créée avec mentions, postes et descriptifs", dv.status === 201 && devis.docKind === "proforma" && devis.object?.startsWith("Audiovisuel") && devis.lines?.[0]?.section === "Audiovisuel" && devis.lines?.[0]?.details?.includes("4K"), `${dv.status} ${J(dv.data?.error ?? devis.lines?.[0])}`);
  const proText = await pdfCheck("PDF de la proforma : titre, numéro, client, objet, descriptif, postes, somme en lettres, conditions", g, `/api/devis/${devis._id}/pdf`,
    [/FACTURE PROFORMA/i, devis.number, "OBEECS", "Audiovisuel et aménagement", "4K UHD", "Prestations", /Arrêtée la présente (facture )?proforma/i, "francs CFA", "60 % à la commande"]);
  check("les notes internes ne sont pas imprimées", proText && !proText.includes("Note interne"));
  await pdfCheck("la même pièce en devis (?proforma=0) et en style Moderne", g, `/api/devis/${devis._id}/pdf?proforma=0&style=moderne`, [/DEVIS/i, devis.number, /Bon pour accord/i]);
  const pd = await g.req("PATCH", `/api/devis/${devis._id}`, { object: "Équipement audiovisuel de la salle", period: "Décembre 2026", lines: [...lines, { section: "Prestations", description: "Câblage", quantity: 1, unitPrice: 140000, tvaRate: 0.19 }] });
  check("modification : mentions et lignes, totaux recalculés côté serveur", pd.status === 200 && D(pd).period === "Décembre 2026" && D(pd).lines.length === 3 && D(pd).totalHT === 3467660 + 3 * 79800 + 140000, `${pd.status} ${J(pd.data?.error ?? D(pd).totalHT)}`);

  console.log("\n▶ 2. Facture, correction contrôlée");
  const conv = await g.req("POST", `/api/devis/${devis._id}/to-invoice`, { type: "invoice" });
  const inv = D(conv).invoice ?? {};
  check("transformée en facture : mentions et conditions recopiées, sans la validité de l'offre", [200, 201].includes(conv.status) && inv.object === "Équipement audiovisuel de la salle" && inv.reference === "BC-OBE-2026-12" && /60 %/.test(inv.termsAndConditions ?? "") && !/Validité/.test(inv.termsAndConditions ?? ""), `${conv.status} ${J(conv.data?.error ?? { o: inv.object, r: inv.reference, t: inv.termsAndConditions })}`);
  await g.req("POST", `/api/invoices/${inv._id}/send`);
  const issued = D(await g.req("GET", `/api/invoices/${inv._id}`));
  await pdfCheck("PDF de la facture émise : numéro, objet, référence, postes", g, `/api/invoices/${inv._id}/pdf`, [/FACTURE/i, issued.number, "Équipement audiovisuel", "BC-OBE-2026-12", "Audiovisuel", "Arrêtée la présente facture"]);

  const newLines = issued.lines.map((l, i) => ({ ...l, unitPrice: i === 0 ? 3200000 : l.unitPrice }));
  const body = { clientId: client._id, issueDate: issued.issueDate, dueDate: issued.dueDate, lines: newLines, notes: "", termsAndConditions: issued.termsAndConditions };
  const same = await c.req("PATCH", `/api/invoices/${inv._id}`, { ...body, lines: issued.lines, dueDate: new Date(Date.now() + 45 * 86400000).toISOString() });
  check("comptable : l'échéance d'une facture émise se modifie (le formulaire renvoie lignes et client inchangés)", same.status === 200, `${same.status} ${same.data?.error}`);
  const byAccountant = await c.req("PATCH", `/api/invoices/${inv._id}`, body);
  check("comptable : changer les lignes d'une facture émise est réservé à l'administrateur", byAccountant.status === 400 && /administrateur/.test(byAccountant.data?.error ?? ""), `${byAccountant.status} ${byAccountant.data?.error}`);
  const corrNoReason = await g.req("PATCH", `/api/invoices/${inv._id}`, body);
  check("correction sans motif : refusée", corrNoReason.status === 400 && /motif/.test(corrNoReason.data?.error ?? ""), `${corrNoReason.status} ${corrNoReason.data?.error}`);
  const other = D(await g.req("POST", "/api/clients", { code: "C-AUT", name: "Autre client" }));
  const newClient = await g.req("PATCH", `/api/invoices/${inv._id}`, { ...body, clientId: other._id, correctionReason: "mauvais client" });
  check("correction : le client d'une facture émise ne change pas (avoir)", newClient.status === 400 && /client/.test(newClient.data?.error ?? ""), `${newClient.status} ${newClient.data?.error}`);
  const corr = await g.req("PATCH", `/api/invoices/${inv._id}`, { ...body, correctionReason: "prix de l'écran revu après négociation" });
  const after = D(corr);
  const expectedHT = 3200000 + 3 * 79800 + 140000;
  check("administrateur : facture émise corrigée, même numéro, totaux recalculés", corr.status === 200 && after.number === issued.number && after.totalHT === expectedHT && after.status === issued.status, `${corr.status} ${J(corr.data?.error ?? [after.number, after.totalHT])}`);
  const vt = await db(d => d.collection("accountingentries").find({ journalCode: "VT", reference: issued.number }).toArray());
  const active = vt.filter(e => !e.reversedBy);
  const exts = await db(d => d.collection("accountingentries").find({ journalCode: "EX", reference: `EXT-${issued.number}` }).toArray());
  const credit706 = e => e.lines.filter(l => /^7/.test(l.accountCode)).reduce((s, l) => s + (l.credit || 0), 0);
  check("écriture de vente extournée puis repassée au nouveau montant", vt.length === 2 && active.length === 1 && exts.length === 1 && credit706(active[0]) === expectedHT, J({ vt: vt.length, active: active.length, ext: exts.length, ca: active[0] && credit706(active[0]) }));
  const day = x => new Date(x).toISOString().slice(0, 10);
  check("extourne datée comme l'écriture d'origine (TVA et chiffre d'affaires restent dans le mois de la facture)", exts[0] && day(exts[0].entryDate) === day(vt.find(e => e.reversedBy)?.entryDate) && /prix de l'écran/.test(exts[0].label), J(exts[0] && [exts[0].entryDate, exts[0].label]));
  await pdfCheck("PDF de la facture corrigée : « Rectifiée … annule et remplace »", g, `/api/invoices/${inv._id}/pdf`, [issued.number, /Rectifi[ée]e/, "annule et remplace", "3 200 000"]);
  const audit = await db(d => d.collection("auditlogs").find({ resource: "invoices", "metadata.correction": true }).toArray());
  check("avant / après et motif gardés au journal d'audit", audit.some(a => a.metadata?.correction && a.metadata?.reason?.includes("négociation") && a.before?.totalTTC === issued.totalTTC && a.after?.totalTTC === after.totalTTC), J(audit.map(a => [a.action, a.metadata, a.before?.totalTTC])));

  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque docs", type: "bank", openingBalance: 1000000, openingDate: "2025-01-01" }))._id;
  const pay = await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: 100000, method: "bank_transfer", date: today, treasuryAccountId: bank });
  const blocked = await g.req("PATCH", `/api/invoices/${inv._id}`, { ...body, lines: issued.lines, correctionReason: "retour au prix initial" });
  check("après un encaissement, la correction est refusée (avoir)", [200, 201].includes(pay.status) && blocked.status === 400 && /encaiss/.test(blocked.data?.error ?? ""), `${pay.status} ${blocked.status} ${blocked.data?.error}`);

  console.log("\n▶ 3. Devis libéré, bon de livraison, bon de commande");
  const dv2 = D(await g.req("POST", "/api/devis", { clientId: client._id, issueDate: today, validUntil: today, lines: [lines[1]] }));
  const inv2 = D(await g.req("POST", `/api/devis/${dv2._id}/to-invoice`, { type: "invoice" })).invoice ?? {};
  await g.req("POST", `/api/invoices/${inv2._id}/send`);
  const cancel = await g.req("POST", `/api/invoices/${inv2._id}/cancel`);
  const dv2After = D(await g.req("GET", `/api/devis/${dv2._id}`));
  check("facture annulée : son devis redevient transformable", cancel.status === 200 && !dv2After.convertedToInvoiceId, `${cancel.status} ${cancel.data?.error} ${dv2After.convertedToInvoiceId}`);
  const reconv = await g.req("POST", `/api/devis/${dv2._id}/to-invoice`, { type: "invoice" });
  check("… et se transforme de nouveau", [200, 201].includes(reconv.status), `${reconv.status} ${reconv.data?.error}`);

  const bl = await g.req("POST", "/api/livraisons", { invoiceId: inv._id, deliveryDate: today, lines: [{ invoiceLineIndex: 1, description: "Mise en service et formation", quantity: 2 }] });
  if (bl.status === 201) await pdfCheck("PDF du bon de livraison : commandé / livré, descriptif repris de la facture, « Reçu par »", g, `/api/livraisons/${D(bl)._id}/pdf`, [/BON DE LIVRAISON/i, D(bl).number, "Commandé", "Livré", "test de visioconférence", /Reçu par/i]);
  else check("bon de livraison créé", false, `${bl.status} ${bl.data?.error}`);
  const sup = D(await g.req("POST", "/api/suppliers", { code: "F-DOC", name: "Fournisseur audiovisuel" }));
  const bc = await g.req("POST", "/api/commandes", { supplierId: sup._id, orderDate: today, object: "Écrans et caméras", lines: [{ description: "Caméra PTZ 4K", details: "Zoom optique 12×", unit: "u", quantity: 2, unitPrice: 450000, tvaRate: 0.19 }] });
  if ([200, 201].includes(bc.status)) await pdfCheck("PDF du bon de commande : fournisseur, objet, descriptif", g, `/api/commandes/${D(bc)._id}/pdf`, [/BON DE COMMANDE/i, "Fournisseur audiovisuel", "Écrans et caméras", "Zoom optique"]);
  else check("bon de commande créé", false, `${bc.status} ${bc.data?.error}`);
  await pdfCheck("aperçu du style de l'organisation (réglages)", g, "/api/company/branding/preview?style=prestige", [/PROFORMA/i]);
  const brand = await g.req("PATCH", "/api/company/branding", { documentStyle: "signature", legalForm: "SARL au capital de 100 000 FCFA", paymentInstructions: "Orabank Niger\nIBAN NE58 NE17 0000" });
  check("style Signature enregistré avec la forme et le capital", brand.status === 200 && D(brand).branding?.documentStyle === "signature" && D(brand).branding?.legalForm?.includes("capital"), `${brand.status} ${brand.data?.error}`);
  await pdfCheck("PDF au style Signature : forme et capital en tête, coordonnées bancaires en pied", g, `/api/devis/${devis._id}/pdf`, ["SARL au capital de 100 000 FCFA", "COORDONNÉES BANCAIRES", "IBAN NE58 NE17 0000", devis.number]);
  const intruder = await (await login("president@test.ne")).raw(`/api/devis/${devis._id}/pdf`);
  check("PDF d'une autre organisation : refusé", intruder.status >= 400 && intruder.buf.subarray(0, 4).toString() !== "%PDF", `${intruder.status}`);

  console.log("\n▶ 4. Imputation après comptabilisation");
  const prj = D(await g.req("POST", "/api/projects", { code: "PRJ-DOC", name: "Salle OBEECS", budget: 5000000 }))._id;
  const pur = D(await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup._id, date: today, validate: true, lines: [{ description: "Câbles HDMI", accountCode: "605000", quantity: 1, unitPrice: 50000, tvaRate: 0 }] }));
  const reimp = await g.req("PATCH", `/api/achats/${pur._id}`, { imputations: [{ projectId: prj }] });
  const purEntry = await db(d => d.collection("accountingentries").findOne({ journalCode: "AC", reference: pur.number }));
  check("achat validé réimputé : sur l'achat et sur son écriture, montants inchangés", reimp.status === 200 && String(D(reimp).lines?.[0]?.projectId) === String(prj) && String(purEntry?.lines?.[0]?.projectId) === String(prj) && purEntry?.lines?.[0]?.debit === 50000, `${reimp.status} ${reimp.data?.error} ${J(purEntry?.lines?.[0])}`);
  const badImp = await g.req("PATCH", `/api/achats/${pur._id}`, { imputations: [{}, {}] });
  check("une imputation par ligne, sinon refus", badImp.status === 400);
  const amountEdit = await g.req("PATCH", `/api/achats/${pur._id}`, { lines: [{ description: "x", accountCode: "605000", amountHT: 1 }] });
  check("les montants d'un achat validé ne se modifient toujours pas", amountEdit.status === 400);
  const od = await g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: today, reference: "OD-DOC-1", label: "Reclassement", lines: [{ accountCode: "604000", accountLabel: "Achats d'études et prestations", debit: 10000, credit: 0 }, { accountCode: "401100", accountLabel: "Fournisseurs", debit: 0, credit: 10000 }] });
  if ([200, 201].includes(od.status)) {
    const re = await g.req("PATCH", `/api/accounting-entries/${D(od)._id}`, { imputations: [{ projectId: prj }, {}] });
    check("écriture manuelle réimputée", re.status === 200 && String(D(re).lines?.[0]?.projectId) === String(prj), `${re.status} ${re.data?.error}`);
  } else check("écriture manuelle créée", false, `${od.status} ${od.data?.error}`);
  const docEntry = await g.req("PATCH", `/api/accounting-entries/${purEntry?._id}`, { imputations: purEntry?.lines.map(() => ({})) });
  check("écriture d'un document : réimputation refusée ici (elle se fait sur le document)", docEntry.status === 400 && /document/.test(docEntry.data?.error ?? ""), `${docEntry.status}`);

  console.log("\n▶ 5. Note de frais approuvée par erreur");
  const ids = await db(async d => {
    const t = await d.collection("tenants").findOne({ slug: "test-pme" });
    const author = await d.collection("users").findOne({ email: "comptable@test.ne" });
    const emp = (await d.collection("employees").findOne({ tenantId: t._id })) ?? { _id: (await d.collection("employees").insertOne({ tenantId: t._id, firstName: "Awa", lastName: "Doc", code: "EMP-DOC", isActive: true })).insertedId };
    const { insertedId } = await d.collection("expensereports").insertOne({
      tenantId: t._id, reference: "NDF-DOC-1", title: "Mission Tahoua", employeeId: emp._id, createdBy: author._id, status: "approved", approvedAt: new Date(),
      lines: [{ date: new Date(), category: "transport", description: "Car Niamey–Tahoua", amountTTC: 25000, currency: "XOF", attachmentCount: 1 }], totalTTC: 25000, createdAt: new Date(), updatedAt: new Date(),
    });
    await d.collection("accountingentries").insertOne({
      tenantId: t._id, journalCode: "OD", entryDate: new Date(), reference: "NDF-DOC-1", label: "Note de frais NDF-DOC-1", linkedDocType: "expense", linkedDocId: insertedId, createdBy: author._id,
      lines: [{ accountCode: "625100", accountLabel: "Voyages", debit: 25000, credit: 0 }, { accountCode: "421000", accountLabel: "Personnel", debit: 0, credit: 25000 }], createdAt: new Date(), updatedAt: new Date(),
    });
    return { report: String(insertedId) };
  });
  const noReason = await g.req("PATCH", `/api/expenses/${ids.report}`, { status: "draft" });
  check("renvoi en brouillon : motif exigé", noReason.status === 400, `${noReason.status}`);
  const byC = await c.req("PATCH", `/api/expenses/${ids.report}`, { status: "draft", reason: "erreur" });
  check("renvoi en brouillon : réservé à l'administrateur", byC.status === 403, `${byC.status} ${byC.data?.error}`);
  const reopen = await g.req("PATCH", `/api/expenses/${ids.report}`, { status: "draft", reason: "montant saisi deux fois" });
  const ndfEntries = await db(d => d.collection("accountingentries").find({ $or: [{ reference: "NDF-DOC-1" }, { reference: "EXT-NDF-DOC-1" }] }).toArray());
  check("note approuvée renvoyée en brouillon, écriture extournée (jamais effacée)", reopen.status === 200 && ndfEntries.length === 2 && ndfEntries.some(e => e.reversedBy) && ndfEntries.some(e => e.journalCode === "EX"), `${reopen.status} ${reopen.data?.error} ${ndfEntries.length}`);

  console.log("\n▶ 6. Assistant Claude");
  const st = await g.req("GET", "/api/company/ai");
  check("réglages lisibles par l'administrateur", st.status === 200 && Array.isArray(D(st).models) && D(st).models[0].id === "claude-opus-5-5", `${st.status} ${st.data?.error}`);
  check("réglages refusés au comptable", (await c.req("GET", "/api/company/ai")).status === 403);
  check("clé mal formée refusée", (await g.req("PATCH", "/api/company/ai", { apiKey: "sk-proj-abc" })).status === 400);
  const fakeKey = "sk-ant-api03-" + "Zq".repeat(24) + "WXYZ";
  const saved = await g.req("PATCH", "/api/company/ai", { apiKey: fakeKey, model: "claude-sonnet-5-5", monthlyQuota: 120 });
  check("clé enregistrée : seule son empreinte revient", saved.status === 200 && D(saved).keyHint === "sk-ant-…WXYZ" && D(saved).source === "tenant" && D(saved).model === "claude-sonnet-5-5" && D(saved).quota?.quota === 120 && !J(saved.data).includes(fakeKey.slice(10, 30)), `${saved.status} ${J(saved.data).slice(0, 200)}`);
  const stored = await db(d => d.collection("tenants").findOne({ slug: "test-pme" }));
  check("clé chiffrée au repos", stored?.ai?.apiKeyEnc?.startsWith("v1:") && !J(stored.ai).includes(fakeKey));
  const leaks = await Promise.all(["/api/auth/me", "/api/company", "/api/company/branding", "/api/company/ai"].map(p => g.req("GET", p)));
  check("la clé ne fuit par aucune route", leaks.every(r => !J(r.data).includes("apiKeyEnc") && !J(r.data).includes(fakeKey.slice(12, 40))), J(leaks.map(r => r.status)));
  const aiDevis = await g.req("GET", "/api/ai/devis");
  check("« Préparer avec Claude » disponible avec la clé de l'organisation", aiDevis.status === 200 && D(aiDevis).configured === true && D(aiDevis).source === "tenant", J(aiDevis.data));
  const short = await g.req("POST", "/api/ai/devis", { brief: "écran" });
  check("description trop courte refusée sans appel à Claude", short.status === 400);
  const removed = await g.req("PATCH", "/api/company/ai", { removeKey: true });
  check("clé retirée", removed.status === 200 && D(removed).keyHint === null);

  console.log("\n▶ 7. Suivi des marchés et agenda");
  const meUser = D(await g.req("GET", "/api/auth/me")).user ?? {};
  const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const ap = await g.req("POST", "/api/appels", { title: "Bornes de commande — restauration", organism: "CNOU Niamey", estimatedAmount: 28500000,
    ownerId: meUser._id, submissionDeadline: inDays(3), questionsDeadline: inDays(1), siteVisitDate: inDays(6), openingDate: inDays(4) });
  const apId = D(ap)._id;
  check("appel créé avec responsable et dates clés", ap.status === 201 && String(D(ap).ownerId) === String(meUser._id) && D(ap).questionsDeadline && D(ap).stageChangedAt, `${ap.status} ${ap.data?.error}`);
  const rem = D(await g.req("GET", "/api/appels/reminders?days=7"));
  const mine = Array.isArray(rem) ? rem.filter(k => k.href === `/appels/${apId}`) : [];
  check("rappels de la semaine : questions, visite, dépôt et ouverture, avec le responsable", ["questions", "visit", "deposit", "opening"].every(k => mine.some(m => m.kind === k)) && mine.every(m => m.owner), J(mine.map(m => [m.kind, m.owner])));
  const list = D(await g.req("GET", "/api/appels?limit=1000"));
  check("liste : responsable lisible sur la carte", (list.items ?? []).some(a => a._id === apId && a.ownerId?.firstName), "");
  await g.req("PATCH", `/api/appels/${apId}`, { status: "evaluation" });
  const noWhy = await g.req("PATCH", `/api/appels/${apId}`, { status: "lost" });
  check("« non retenu » sans motif : refusé", noWhy.status === 400 && /motif/i.test(noWhy.data?.error ?? ""), `${noWhy.status}`);
  const lost = await g.req("PATCH", `/api/appels/${apId}`, { status: "lost", result: { lossReason: "prix", winnerName: "Concurrent SA", winnerAmount: 26000000 } });
  check("résultat enregistré : motif, attributaire et prix", lost.status === 200 && D(lost).result?.lossReason === "prix" && D(lost).result?.winnerAmount === 26000000, `${lost.status} ${lost.data?.error}`);
  const ap2 = D(await g.req("POST", "/api/appels", { title: "Archivage numérique", organism: "Cour des comptes", submissionDeadline: inDays(2) }))._id;
  const y = new Date().getFullYear();
  const from = new Date(y, 11, 1).toISOString(), to = new Date(y + 1, 0, 1).toISOString();
  const dec = D(await g.req("GET", `/api/agenda?${new URLSearchParams({ from, to, scope: "all", virtual: "1" })}`));
  check("agenda : jours fériés du Niger (18 décembre)", Array.isArray(dec) && dec.some(e => e.virtual && e.calendar === "Jours fériés" && /République/.test(e.title)), J((dec ?? []).filter(e => e.virtual).map(e => e.title)));
  const soon = D(await g.req("GET", `/api/agenda?${new URLSearchParams({ from: new Date().toISOString(), to: new Date(Date.now() + 10 * 86400000).toISOString(), scope: "all", virtual: "1" })}`));
  check("agenda : échéances des marchés en lecture seule, liées au dossier", Array.isArray(soon) && soon.some(e => e.virtual && e.calendar === "Marchés publics" && e.href === `/appels/${ap2}`), J((soon ?? []).filter(e => e.virtual).map(e => [e.title, e.href])));
  const ev = await g.req("POST", "/api/agenda", { title: "Comité de direction", startAt: new Date(Date.now() + 86400000).toISOString(), visibility: "shared", calendar: "Direction" });
  check("événement rangé dans l'agenda d'équipe « Direction »", ev.status === 201 && D(ev).calendar === "Direction", `${ev.status} ${ev.data?.error}`);
  const ics = await g.raw(`/api/agenda/ics?${new URLSearchParams({ from: new Date().toISOString(), to: new Date(Date.now() + 10 * 86400000).toISOString() })}`);
  const icsText = ics.buf.toString("utf-8");
  check("export .ics : calendrier valide avec l'événement et les échéances", ics.status === 200 && /text\/calendar/.test(ics.type) && icsText.startsWith("BEGIN:VCALENDAR") && icsText.includes("SUMMARY:Comité de direction") && /SUMMARY:Date limite de dépôt/.test(icsText), `${ics.status} ${icsText.slice(0, 120)}`);

  console.log(`\n${fail === 0 ? "OK" : "ÉCHEC"} — ${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); console.log("ÉCHEC — exception"); process.exit(1); });
