// Scénario de bout en bout : portail client (lien personnel, documents, devis,
// paiement en ligne) et brief du jour.
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

// Le client n'a aucune session : appels publics, sans cookie ni jeton CSRF.
const pub = async (method, p, body) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, type, data: type.includes("json") ? await res.json().catch(() => null) : null };
};

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);

  console.log("\n▶ Lien du portail");
  const cli = id(await g.req("POST", "/api/clients", { code: "C-PORT", name: "Lycée Mariama", phone: "+227 90 11 22 33" }));
  const other = id(await g.req("POST", "/api/clients", { code: "C-AUTRE", name: "Autre client" }));
  const inv = D(await g.req("POST", "/api/invoices", { clientId: cli, issueDate: today, dueDate: today, lines: [{ description: "Fournitures", quantity: 1, unitPrice: 100000, tvaRate: 0.19 }] }));
  await g.req("POST", `/api/invoices/${inv._id}/send`);
  const draft = D(await g.req("POST", "/api/invoices", { clientId: cli, issueDate: today, dueDate: today, lines: [{ description: "Brouillon", quantity: 1, unitPrice: 5000, tvaRate: 0 }] }));
  const otherInv = D(await g.req("POST", "/api/invoices", { clientId: other, issueDate: today, dueDate: today, lines: [{ description: "Autre", quantity: 1, unitPrice: 7000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${otherInv._id}/send`);
  const next = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const dv = D(await g.req("POST", "/api/devis", { clientId: cli, issueDate: today, validUntil: next, lines: [{ description: "Rentrée 2027", quantity: 1, unitPrice: 300000, tvaRate: 0.19 }] }));
  await g.req("PATCH", `/api/devis/${dv._id}`, { status: "sent" });

  check("aucun lien au départ", D(await g.req("GET", `/api/clients/${cli}/portal-link`)).url === null);
  const link = D(await g.req("POST", `/api/clients/${cli}/portal-link`)).url;
  check("lien créé, de la forme /client/<jeton>", /\/client\/[A-Za-z0-9_-]{40,}$/.test(link ?? ""), link);
  const token = (link ?? "").split("/client/")[1];
  check("le lien se réaffiche à l'identique (jeton chiffré, pas en clair)", D(await g.req("GET", `/api/clients/${cli}/portal-link`)).url === link);

  console.log("\n▶ Ce que voit le client");
  const pv = await pub("GET", `/api/public/client-portal/${token}`);
  const P = pv.data?.data ?? {};
  check("portail lisible sans session", pv.status === 200 && P.client?.name === "Lycée Mariama", `${pv.status} ${J(pv.data).slice(0, 150)}`);
  check("la facture émise y figure, avec son reste à payer", P.invoices?.some(i => i._id === inv._id && i.due === inv.totalTTC));
  check("ni le brouillon, ni la facture d'un autre client", !P.invoices?.some(i => i._id === draft._id || i._id === otherInv._id));
  check("aucune donnée interne (écritures, notes, imputations)", !JSON.stringify(P).match(/accountCode|projectId|createdBy|tenantId/));
  check("devis envoyé : acceptable en ligne", P.quotes?.some(q => q._id === dv._id && q.canAccept));
  const pdf = await pub("GET", `/api/public/client-portal/${token}/pdf?kind=invoice&id=${inv._id}`);
  check("PDF de sa facture", pdf.status === 200 && pdf.type.includes("pdf"), `${pdf.status} ${pdf.type}`);
  check("PDF d'une facture d'un autre client : refusé", (await pub("GET", `/api/public/client-portal/${token}/pdf?kind=invoice&id=${otherInv._id}`)).status === 404);
  check("PDF d'un brouillon : refusé", (await pub("GET", `/api/public/client-portal/${token}/pdf?kind=invoice&id=${draft._id}`)).status === 404);
  check("PDF du devis", (await pub("GET", `/api/public/client-portal/${token}/pdf?kind=quote&id=${dv._id}`)).status === 200);

  const cn = D(await g.req("POST", `/api/invoices/${otherInv._id}/credit-note`, { mode: "full", reason: "Erreur de client" }));
  const inv2 = D(await g.req("POST", "/api/invoices", { clientId: cli, issueDate: today, dueDate: today, lines: [{ description: "À annuler", quantity: 1, unitPrice: 20000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${inv2._id}/send`);
  await g.req("POST", `/api/invoices/${inv2._id}/credit-note`, { mode: "full", reason: "Commande annulée" });
  const P2 = (await pub("GET", `/api/public/client-portal/${token}`)).data?.data ?? {};
  check("facture annulée par avoir : affichée « annulée », rien à régler, son avoir listé", P2.invoices?.some(i => i._id === inv2._id && i.status === "credited" && i.due === 0 && !i.canPay)
    && P2.creditNotes?.length === 1 && P2.totals?.due === inv.totalTTC, J({ inv: P2.invoices?.find(i => i._id === inv2._id), cn: P2.creditNotes?.length, due: P2.totals?.due }));
  check("PDF de la facture annulée par avoir : disponible", (await pub("GET", `/api/public/client-portal/${token}/pdf?kind=invoice&id=${inv2._id}`)).status === 200);
  check("avoir d'un autre client : absent", !P2.creditNotes?.some(c => c._id === cn?.creditNote?._id));

  console.log("\n▶ Acceptation du devis");
  check("sans nom : refusée", (await pub("POST", `/api/public/client-portal/${token}/quotes/${dv._id}/accept`, {})).status === 400);
  const acc = await pub("POST", `/api/public/client-portal/${token}/quotes/${dv._id}/accept`, { name: "Mme Diallo, proviseure" });
  check("devis accepté en ligne", acc.status === 200, `${acc.status} ${J(acc.data)}`);
  check("deuxième acceptation : refusée", (await pub("POST", `/api/public/client-portal/${token}/quotes/${dv._id}/accept`, { name: "x y" })).status === 409);
  const dvAfter = D(await g.req("GET", `/api/devis/${dv._id}`));
  check("côté entreprise : devis accepté, signataire tracé", dvAfter.status === "accepted" && dvAfter.acceptedOnline?.name === "Mme Diallo, proviseure", J(dvAfter.acceptedOnline));

  console.log("\n▶ Paiement en ligne");
  const pay = await pub("POST", `/api/public/client-portal/${token}/invoices/${inv._id}/pay`);
  check("paiement non activé : message clair", pay.status === 400 && /pas activé/.test(pay.data?.error ?? ""), `${pay.status} ${J(pay.data)}`);
  const acc2 = id(await g.req("POST", "/api/treasury-accounts", { label: "Mobile money en ligne", type: "mobile_money", openingBalance: 0, openingDate: "2025-01-01" }));
  const setAcc = await g.req("PATCH", "/api/company", { onlinePaymentAccountId: acc2 });
  check("compte des paiements en ligne enregistré", setAcc.status === 200 && String(D(setAcc).onlinePaymentAccountId) === acc2, `${setAcc.status} ${J(setAcc.data).slice(0, 120)}`);
  check("compte d'une autre organisation : refusé", (await g.req("PATCH", "/api/company", { onlinePaymentAccountId: "64b000000000000000000000" })).status === 400);
  check("PDF interne de la facture (avec QR du portail)", (await g.req("GET", `/api/invoices/${inv._id}/pdf`)).status === 200);

  console.log("\n▶ Révocation");
  const link2 = D(await g.req("POST", `/api/clients/${cli}/portal-link`)).url;
  check("nouveau lien : l'ancien ne fonctionne plus", (await pub("GET", `/api/public/client-portal/${token}`)).status === 404
    && (await pub("GET", `/api/public/client-portal/${link2.split("/client/")[1]}`)).status === 200);
  await g.req("DELETE", `/api/clients/${cli}/portal-link`);
  check("lien révoqué : inaccessible", (await pub("GET", `/api/public/client-portal/${link2.split("/client/")[1]}`)).status === 404);
  check("jeton fantaisiste : inaccessible", (await pub("GET", "/api/public/client-portal/abc")).status === 404);
  const { s: a } = await login("president@test.ne", SEED_PW);
  check("autre organisation : lien du client introuvable", [403, 404].includes((await a.req("POST", `/api/clients/${cli}/portal-link`)).status));

  console.log("\n▶ Page publique");
  const page = await fetch(`${BASE}/client/${link2.split("/client/")[1]}`, { redirect: "manual" });
  check("page /client/<jeton> servie sans connexion", page.status === 200, String(page.status));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
