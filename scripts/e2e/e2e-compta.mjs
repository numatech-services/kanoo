// Scénario de bout en bout : moteur comptable (étape 3) — fournisseur unique,
// TVA des charges récurrentes, origine des immobilisations, banque protégée.
import { readFileSync } from "fs";

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

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque compta", type: "bank", openingBalance: 5000000, openingDate: "2025-01-01" }));
  const sup = id(await g.req("POST", "/api/suppliers", { code: "F-CPT", name: "Nigelec" }));

  console.log("\n▶ Mon organisation");
  const org = await g.req("GET", "/api/company");
  check("fiche de l'organisation lisible", org.status === 200 && !!D(org).name, `${org.status} ${J(org.data).slice(0, 120)}`);
  const orgUpd = await g.req("PATCH", "/api/company", { phone: "+227 90 00 00 00" });
  check("fiche de l'organisation modifiable", orgUpd.status === 200 && D(orgUpd).phone === "+227 90 00 00 00", `${orgUpd.status} ${J(orgUpd.data).slice(0, 120)}`);

  console.log("\n▶ Banque et caisse protégées en saisie manuelle");
  const manual = await g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: today, reference: "BQ-MAN", label: "x",
    lines: [{ accountCode: "521000", accountLabel: "Banque", debit: 1000 }, { accountCode: "471000", accountLabel: "Attente", credit: 1000 }] });
  check("écriture manuelle sur 521 : refusée, orientée vers Trésorerie", manual.status === 400 && /Trésorerie/.test(manual.data?.error ?? ""), `${manual.status} ${J(manual.data)}`);

  console.log("\n▶ Charge récurrente : TVA récupérable et compte fournisseur");
  const rc = id(await g.req("POST", "/api/recurring-expenses", { label: "Électricité", amount: 119000, frequency: "monthly", startDate: today,
    accountCode: "605200", tvaRate: 0.19, supplierId: sup, treasuryAccountId: bank }));
  const pay = await g.req("POST", `/api/recurring-expenses/${rc}`, { treasuryAccountId: bank, date: today });
  check("échéance payée", pay.status === 200, `${pay.status} ${J(pay.data).slice(0, 150)}`);
  const rcEntries = (await entriesOf(g, "DEP-")).filter(e => e.label.includes("Électricité"));
  const ac = rcEntries.find(e => e.journalCode === "AC"), rg = rcEntries.find(e => e.journalCode !== "AC");
  check("charge HT 100 000 + TVA 4452 19 000, dette fournisseur 401100 au nom de Nigelec", ac && balancedE(ac)
    && ac.lines.some(l => l.accountCode === "605200" && l.debit === 100000)
    && ac.lines.some(l => l.accountCode === "445200" && l.debit === 19000)
    && ac.lines.some(l => l.accountCode === "401100" && l.credit === 119000 && String(l.thirdPartyId?._id ?? l.thirdPartyId) === sup), J(ac?.lines));
  check("règlement : 401100 soldé par la banque", rg && balancedE(rg) && rg.lines.some(l => l.accountCode === "401100" && l.debit === 119000) && rg.lines.some(l => /^52/.test(l.accountCode) && l.credit === 119000), J(rg?.lines));

  console.log("\n▶ Immobilisations : une seule écriture d'entrée");
  const pur = D(await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, validate: true,
    lines: [{ description: "Ordinateur portable", accountCode: "244000", quantity: 1, unitPrice: 600000, tvaRate: 0.19 }] }));
  check("achat d'immobilisation validé", ["validated", "partial", "paid"].includes(pur.status), J(pur).slice(0, 150));
  const fa1 = await g.req("POST", "/api/fixed-assets", { code: "IMMO-ACH", name: "Ordinateur portable", category: "computer", acquisitionDate: today, acquisitionCost: 600000, origin: "purchase", purchaseId: pur._id });
  check("immobilisation issue de l'achat : créée", fa1.status === 201, `${fa1.status} ${J(fa1.data).slice(0, 150)}`);
  check("… sans seconde écriture d'acquisition", (await entriesOf(g, "IMMO-ACH")).length === 0);
  const fa2 = await g.req("POST", "/api/fixed-assets", { code: "IMMO-DET", name: "Groupe électrogène", category: "equipment", acquisitionDate: today, acquisitionCost: 900000, origin: "supplier", supplierId: sup });
  const e2 = (await entriesOf(g, "IMMO-DET"))[0];
  check("dette fournisseur : 2… au débit, 401100 au nom du fournisseur", fa2.status === 201 && e2 && balancedE(e2)
    && e2.lines.some(l => /^2/.test(l.accountCode) && l.debit === 900000) && e2.lines.some(l => l.accountCode === "401100" && l.credit === 900000), J(e2?.lines));
  const fa3 = await g.req("POST", "/api/fixed-assets", { code: "IMMO-REP", name: "Bureau", category: "furniture", acquisitionDate: "2024-01-10", acquisitionCost: 150000, origin: "existing" });
  check("reprise d'un bien déjà au bilan : aucune écriture", fa3.status === 201 && (await entriesOf(g, "IMMO-REP")).length === 0);
  check("achat d'origine sans compte 2… : refusé", (await g.req("POST", "/api/fixed-assets", { code: "IMMO-X", name: "x", category: "other", acquisitionDate: today, acquisitionCost: 1, origin: "purchase", purchaseId: id(await g.req("POST", "/api/achats", { kind: "invoice", payee: "x", date: today, validate: true, lines: [{ description: "x", accountCode: "605000", amountHT: 1000 }] })) })).status === 400);

  console.log("\n▶ Retenue à la source sur le compte fournisseur commun");
  const rt = await g.req("POST", "/api/fiscal/retenues", { type: "prestation_service", beneficiaire: "Prestataire", montantBrut: 100000 });
  const rtE = (await entriesOf(g, "RTS-"))[0];
  const rt2 = await g.req("POST", "/api/fiscal/retenues", { type: "prestation_service", beneficiaire: "Prestataire payé", montantBrut: 200000, treasuryAccountId: bank });
  const rt2E = (await entriesOf(g, "Prestataire payé"))[0];
  check("retenue avec règlement du net : banque dédiée créditée du net 190 000, retenue 10 000 due à l'État", rt2.status === 201 && rt2E && balancedE(rt2E)
    && rt2E.lines.some(l => /^5211/.test(l.accountCode) && l.credit === 190000) && rt2E.lines.some(l => l.accountCode === "447200" && l.credit === 10000), `${rt2.status} ${J(rt2E?.lines ?? rt2.data).slice(0, 250)}`);
  check("retenue enregistrée sur 401100 (et plus 401000)", rt.status === 201 && rtE && rtE.lines.some(l => l.accountCode === "401100") && !rtE.lines.some(l => l.accountCode === "401000"), `${rt.status} ${J(rtE?.lines ?? rt.data).slice(0, 200)}`);

  console.log("\n▶ Comptoir relié à une caisse");
  const caisse = id(await g.req("POST", "/api/treasury-accounts", { label: "Caisse Spot", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }));
  const loose = id(await g.req("POST", "/api/comptoir/desks", { name: "Buvette non reliée" }));
  await g.req("POST", "/api/comptoir/cash", { deskId: loose, direction: "in", amount: 777, label: "Vente libre" });
  check("comptoir non relié : aucune écriture", (await entriesOf(g, "Buvette non reliée")).length === 0);
  const spot = id(await g.req("POST", "/api/comptoir/desks", { name: "Spot compta" }));
  const link = await g.req("PATCH", `/api/comptoir/desks/${spot}`, { treasuryAccountId: caisse, revenueAccount: "706300", expenseAccount: "601100", vatRate: 0.19 });
  check("comptoir relié à la caisse", link.status === 200, `${link.status} ${J(link.data).slice(0, 150)}`);
  check("compte de produit hors classe 7 : refusé", (await g.req("PATCH", `/api/comptoir/desks/${spot}`, { revenueAccount: "601100" })).status === 400);
  await g.req("POST", "/api/comptoir/cash", { deskId: spot, direction: "in", amount: 11900, label: "Ventes du midi" });
  await g.req("POST", "/api/comptoir/cash", { deskId: spot, direction: "out", amount: 2380, label: "Glace" });
  const spotE = await entriesOf(g, "Spot compta");
  const sale = spotE.find(e => e.label.includes("Ventes du midi")), spend = spotE.find(e => e.label.includes("Glace"));
  check("vente : caisse 571 au débit 11 900, 706300 10 000 et TVA 443 1 900 au crédit", sale && balancedE(sale)
    && sale.lines.some(l => /^571/.test(l.accountCode) && l.debit === 11900) && sale.lines.some(l => l.accountCode === "706300" && l.credit === 10000)
    && sale.lines.some(l => l.accountCode === "443000" && l.credit === 1900), J(sale?.lines));
  // Dépense de caisse sans facture : aucune TVA déductible (lot H3, K5).
  check("dépense : 601100 2 380 au débit, sans TVA déductible, caisse au crédit", spend && balancedE(spend)
    && spend.lines.some(l => l.accountCode === "601100" && l.debit === 2380) && !spend.lines.some(l => l.accountCode === "445200")
    && spend.lines.some(l => /^571/.test(l.accountCode) && l.credit === 2380), J(spend?.lines));
  const cs = D(await g.req("GET", `/api/treasury-accounts/${caisse}`));
  const bal = cs.balance ?? cs.account?.balance;
  check("solde de la caisse = 11 900 − 2 380", bal === 9520, J(cs).slice(0, 200));

  console.log("\n▶ Billetterie comptabilisée");
  const evt = id(await g.req("POST", "/api/events", { title: "Concert compta", startAt: `${today}T18:00:00.000Z`, locationType: "physical", isPaid: true, ticketTypes: [{ name: "Standard", price: 5000, quantity: 0 }] }));
  await g.req("PATCH", `/api/events/${evt}`, { treasuryAccountId: caisse });
  const tt = D(await g.req("GET", `/api/events/${evt}`)).ticketTypes?.[0]?._id;
  const att = D(await g.req("POST", `/api/events/${evt}/attendees`, { firstName: "Awa", lastName: "Test", ticketTypeId: tt, markPaid: true })).attendee ?? {};
  const tk = (await entriesOf(g, att.ticketCode ?? "x"))[0];
  check("billet vendu sur place : caisse au débit, 706500 au crédit", tk && balancedE(tk) && tk.lines.some(l => l.accountCode === "706500" && l.credit === 5000) && tk.lines.some(l => /^571/.test(l.accountCode) && l.debit === 5000), `${J(att).slice(0, 120)} ${J(tk?.lines)}`);
  const rf = await g.req("POST", `/api/events/${evt}/attendees/${att._id}/refund`, { reason: "Annulation" });
  const tkAll = await entriesOf(g, att.ticketCode ?? "x");
  check("remboursement : recette extournée", rf.status === 200 && tkAll.some(e => e.journalCode === "EX"), `${rf.status} ${J(tkAll.map(e => e.journalCode))}`);

  console.log("\n▶ Association : cotisations et dons");
  const { s: a } = await login("president@test.ne", SEED_PW);
  const acaisse = id(await a.req("POST", "/api/treasury-accounts", { label: "Caisse asso", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }));
  const mem = id(await a.req("POST", "/api/membres", { firstName: "Moussa", lastName: "Adhérent", code: `M-${Date.now()}`, membershipType: "active", joinDate: today, email: `m${Date.now()}@asso.ne` }));
  check("cotisation payée sans compte encaisseur : refusée", (await a.req("POST", "/api/cotisations", { memberId: mem, year: 2026, amount: 10000, paid: true })).status === 400);
  const cot = await a.req("POST", "/api/cotisations", { memberId: mem, year: 2026, amount: 10000, paid: true, treasuryAccountId: acaisse });
  const cotE = (await entriesOf(a, D(cot).receiptNumber ?? "x"))[0];
  check("cotisation : caisse au débit, 756000 au crédit", cot.status === 201 && cotE && cotE.lines.some(l => l.accountCode === "756000" && l.credit === 10000), `${cot.status} ${J(cot.data).slice(0, 150)} ${J(cotE?.lines)}`);
  const unpaid = await a.req("PATCH", `/api/cotisations/${D(cot)._id}`, { paid: false });
  check("cotisation repassée à non payée : extournée", unpaid.status === 200 && (await entriesOf(a, D(cot).receiptNumber ?? "x")).some(e => e.journalCode === "EX"));
  const don = await a.req("POST", "/api/dons", { donorType: "company", donorName: "ONG Sahel", amount: 100, currency: "EUR", amountXOF: 65596, date: today, treasuryAccountId: acaisse });
  const donE = (await entriesOf(a, D(don).receiptNumber ?? "x"))[0];
  check("don en euros : 65 596 FCFA reçus en 758100", don.status === 201 && donE && donE.lines.some(l => l.accountCode === "758100" && l.credit === 65596), `${don.status} ${J(don.data).slice(0, 150)}`);
  check("le PME ne voit pas les écritures de l'association", (await entriesOf(g, D(don).receiptNumber ?? "x")).length === 0);

  console.log("\n▶ Un compte comptable par banque et par caisse");
  const b1 = D(await g.req("POST", "/api/treasury-accounts", { label: "BOA Niger", type: "bank", openingBalance: 1000000, openingDate: "2025-01-01" }));
  const b2 = D(await g.req("POST", "/api/treasury-accounts", { label: "Ecobank", type: "bank", openingBalance: 0, openingDate: "2025-01-01" }));
  check("comptes dédiés distincts 5211xx", /^5211\d\d$/.test(b1.ledgerCode ?? "") && /^5211\d\d$/.test(b2.ledgerCode ?? "") && b1.ledgerCode !== b2.ledgerCode, `${b1.ledgerCode} ${b2.ledgerCode}`);
  check("caisse en 5711xx", /^5711\d\d$/.test(D(await g.req("GET", `/api/treasury-accounts/${caisse}`)).ledgerCode ?? ""));
  const vir = await g.req("POST", "/api/treasury-accounts/movements", { kind: "transfer", fromAccountId: b1._id, toAccountId: b2._id, amount: 250000, date: today, label: "Virement BOA vers Ecobank" });
  const virE = (await entriesOf(g, "Virement BOA vers Ecobank"))[0];
  check("virement interne : Ecobank au débit, BOA au crédit, sur leurs comptes dédiés", vir.status < 300 && virE
    && virE.lines.some(l => l.accountCode === b2.ledgerCode && l.debit === 250000) && virE.lines.some(l => l.accountCode === b1.ledgerCode && l.credit === 250000), `${vir.status} ${J(virE?.lines ?? vir.data).slice(0, 250)}`);
  check("vente du comptoir sur la caisse dédiée, plus sur 571000", (await entriesOf(g, "Ventes du midi"))[0]?.lines.some(l => /^5711\d\d$/.test(l.accountCode)));

  console.log("\n▶ Remboursement d'un avoir");
  const cl = id(await g.req("POST", "/api/clients", { code: "C-RMB", name: "Client remboursé" }));
  const fi = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: today, dueDate: today, lines: [{ description: "Prestation", quantity: 1, unitPrice: 100000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${fi._id}/send`); Object.assign(fi ?? {}, D(await g.req("GET", `/api/invoices/${fi?._id}`)));
  await g.req("POST", "/api/payments", { invoiceId: fi._id, amount: fi.totalTTC, method: "bank_transfer", date: today, treasuryAccountId: b1._id });
  const av = D(await g.req("POST", `/api/invoices/${fi._id}/credit-note`, { mode: "full", reason: "Prestation annulée" })).creditNote;
  const st = D(await g.req("GET", `/api/invoices/${av?._id}/refund`));
  check("avoir sur facture payée : tout le TTC est remboursable", st.refundable === fi.totalTTC, J(st));
  check("remboursement au-delà : refusé", (await g.req("POST", `/api/invoices/${av?._id}/refund`, { treasuryAccountId: b1._id, amount: fi.totalTTC + 1 })).status === 400);
  const rb = await g.req("POST", `/api/invoices/${av?._id}/refund`, { treasuryAccountId: b1._id, amount: 40000, date: today });
  const rbE = (await entriesOf(g, `${av?.number}-RMB`))[0];
  check("remboursement partiel : 411 au débit au nom du client, BOA au crédit", rb.status === 200 && rbE && balancedE(rbE)
    && rbE.lines.some(l => l.accountCode === "411000" && l.debit === 40000) && rbE.lines.some(l => l.accountCode === b1.ledgerCode && l.credit === 40000), `${rb.status} ${J(rb.data).slice(0, 150)} ${J(rbE?.lines)}`);
  check("reste remboursable", D(await g.req("GET", `/api/invoices/${av?._id}/refund`)).refundable === fi.totalTTC - 40000);
  const unpaidInv = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: today, dueDate: today, lines: [{ description: "Autre", quantity: 1, unitPrice: 50000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${unpaidInv._id}/send`); Object.assign(unpaidInv ?? {}, D(await g.req("GET", `/api/invoices/${unpaidInv?._id}`)));
  const av2 = D(await g.req("POST", `/api/invoices/${unpaidInv._id}/credit-note`, { mode: "full", reason: "Erreur" })).creditNote;
  check("avoir sur facture impayée : rien à rembourser", D(await g.req("GET", `/api/invoices/${av2?._id}/refund`)).refundable === 0
    && (await g.req("POST", `/api/invoices/${av2?._id}/refund`, { treasuryAccountId: b1._id })).status === 400);

  console.log("\n▶ Livraisons plafonnées au facturé");
  const art = D(await g.req("POST", "/api/products", { code: "ART-LIV", label: "Rame de papier", unitPrice: 4000, initialQty: 20, initialCost: 2500 }));
  const fl = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: today, dueDate: today, lines: [{ productId: art._id, description: "Rame de papier", quantity: 5, unitPrice: 4000, tvaRate: 0.19 }] }));
  await g.req("POST", `/api/invoices/${fl._id}/send`); Object.assign(fl ?? {}, D(await g.req("GET", `/api/invoices/${fl?._id}`)));
  const src1 = D(await g.req("GET", `/api/livraisons/source?number=${encodeURIComponent(fl.number)}`));
  check("source : 5 à livrer sur la ligne 0", src1.lines?.[0]?.remaining === 5 && src1.lines?.[0]?.invoiceLineIndex === 0, J(src1.lines));
  const bl1 = await g.req("POST", "/api/livraisons", { invoiceId: fl._id, deliveryDate: today, lines: [{ invoiceLineIndex: 0, productId: art._id, description: "Rame de papier", quantity: 3 }] });
  check("première livraison de 3 : acceptée", bl1.status === 201, `${bl1.status} ${J(bl1.data).slice(0, 150)}`);
  const bl2 = await g.req("POST", "/api/livraisons", { invoiceId: fl._id, deliveryDate: today, lines: [{ invoiceLineIndex: 0, productId: art._id, description: "Rame de papier", quantity: 3 }] });
  check("deuxième livraison de 3 sur 2 restants : refusée", bl2.status === 400 && /2 restant/.test(bl2.data?.error ?? ""), `${bl2.status} ${J(bl2.data)}`);
  const src2 = D(await g.req("GET", `/api/livraisons/source?number=${encodeURIComponent(fl.number)}`));
  check("source : reste 2", src2.lines?.[0]?.quantity === 2 && src2.lines?.[0]?.delivered === 3, J(src2.lines));
  const bl3 = await g.req("POST", "/api/livraisons", { invoiceId: fl._id, deliveryDate: today, lines: [{ productId: art._id, description: "Rame de papier", quantity: 2 }] });
  check("solde de 2 (ligne retrouvée par l'article) : accepté, facture entièrement livrée", bl3.status === 201
    && D(await g.req("GET", `/api/livraisons/source?number=${encodeURIComponent(fl.number)}`)).fullyDelivered === true, `${bl3.status} ${J(bl3.data).slice(0, 150)}`);

  console.log("\n▶ Rapprochement commande / réception / facture");
  const bcm = D(await g.req("POST", "/api/commandes", { supplierId: sup, orderDate: today, lines: [{ productId: art._id, quantity: 10, unitPrice: 2500, tvaRate: 0.19 }] }));
  await g.req("PATCH", `/api/commandes/${bcm._id}`, { status: "confirmed" });
  await g.req("POST", `/api/commandes/${bcm._id}/receive`, { lines: [{ index: 0, quantity: 4 }] });
  const fac = id(await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, commandeId: bcm._id,
    lines: [{ description: "Rames x10", accountCode: "601100", quantity: 10, unitPrice: 2500, tvaRate: 0.19 }] }));
  const m1 = D(await g.req("GET", `/api/achats/${fac}`)).match;
  check("rapprochement : commandé 25 000, reçu 10 000, facturé 25 000", m1?.orderedHT === 25000 && m1?.receivedHT === 10000 && m1?.invoicedHT === 25000 && m1?.overInvoiced === true, J(m1));
  const v1 = await g.req("POST", `/api/achats/${fac}/validate`);
  check("facture au-delà du reçu : validation refusée", v1.status === 400 && /marchandise reçue/.test(v1.data?.error ?? ""), `${v1.status} ${J(v1.data)}`);
  const v2 = await g.req("POST", `/api/achats/${fac}/validate`, { force: true });
  const after = D(await g.req("GET", `/api/achats/${fac}`));
  check("validation forcée : acceptée et tracée (écart 15 000)", v2.status === 200 && after.status === "validated" && after.matchOverride?.gapHT === 15000, `${v2.status} ${J(after.matchOverride)}`);

  console.log("\n▶ Variation de stock (inventaire intermittent)");
  const pv = D(await g.req("GET", `/api/accounting/stock-variation?date=${today}`));
  check("aperçu : valeur du stock positive, compte 31 vide, variation = valeur", pv.stockValue > 0 && pv.ledgerBalance === 0 && pv.variation === pv.stockValue, J(pv));
  const sv = await g.req("POST", "/api/accounting/stock-variation", { date: today });
  const svE = (await entriesOf(g, `VAR-STOCK-${today}`))[0];
  check("écriture : 311000 au débit, 603100 au crédit, du montant de la variation", sv.status === 201 && svE && balancedE(svE)
    && svE.lines.some(l => l.accountCode === "311000" && l.debit === pv.variation) && svE.lines.some(l => l.accountCode === "603100" && l.credit === pv.variation), `${sv.status} ${J(svE?.lines ?? sv.data).slice(0, 200)}`);
  check("deuxième passage à la même date : refusé", (await g.req("POST", "/api/accounting/stock-variation", { date: today })).status === 400);
  check("après écriture : compte 31 = valeur du stock", D(await g.req("GET", `/api/accounting/stock-variation?date=${today}`)).variation === 0);

  console.log("\n▶ Chiffre d'affaires et avoirs totaux");
  const caBefore = D(await g.req("GET", "/api/reports/analytics?months=12")).kpis?.totalCA;
  const fx = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: today, dueDate: today, lines: [{ description: "Vente annulée", quantity: 1, unitPrice: 80000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${fx._id}/send`); Object.assign(fx ?? {}, D(await g.req("GET", `/api/invoices/${fx?._id}`)));
  const caIssued = D(await g.req("GET", "/api/reports/analytics?months=12")).kpis?.totalCA;
  await g.req("POST", `/api/invoices/${fx._id}/credit-note`, { mode: "full", reason: "Annulation de la vente" });
  const caAfter = D(await g.req("GET", "/api/reports/analytics?months=12")).kpis?.totalCA;
  check("CA : + le TTC de la facture à l'émission, revenu au point de départ après l'avoir total (pas de double déduction)",
    caIssued - caBefore === fx.totalTTC && caAfter === caBefore && caAfter >= 0, J({ caBefore, caIssued, caAfter }));

  console.log("\n▶ Brief du jour");
  const br = D(await g.req("GET", "/api/brief?limit=10"));
  check("brief : actions classées, expliquées, avec un lien", Array.isArray(br.items) && br.items.length > 0
    && br.items.every(i => i.title && i.why && i.href?.startsWith("/") && typeof i.score === "number")
    && br.items.every((i, k) => k === 0 || br.items[k - 1].score >= i.score), J(br.items?.map(i => [i.kind, i.score])));
  check("brief : retard client signalé avec son montant", br.items?.some(i => i.kind === "overdue_receivables" && i.amount > 0), J(br.items?.map(i => i.kind)));
  check("brief : trois actions par défaut", (D(await g.req("GET", "/api/brief")).items ?? []).length <= 3);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
