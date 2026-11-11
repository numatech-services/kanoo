// Scénario : brouillons d'achat fournisseur par l'API v1 (ISIC → Kanoo).
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
const id = r => D(r)?._id;
const today = new Date().toISOString().slice(0, 10);
const api = (key) => async (method, p, body) => { const r = await fetch(`${BASE}${p}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const { s: other } = await login("president@test.ne", SEED_PW);
  const sup = await g.req("POST", "/api/suppliers", { name: "ISIC Global Office", code: "FRN-ISIC" });
  check("fournisseur créé (code FRN-ISIC)", sup.status === 201, `${sup.status} ${J(sup.data).slice(0, 120)}`);
  const kr = await g.req("POST", "/api/v1/auth", { name: "ISIC", scopes: ["invoices:write", "purchases:read", "purchases:write"] });
  const key = D(kr).key;
  check("clé d'API avec purchases:write", !!key, J(kr.data).slice(0, 160));
  const ro = D(await g.req("POST", "/api/v1/auth", { name: "Lecture", scopes: ["invoices:read"] })).key;
  const A = api(key), R = api(ro);
  const body = { externalRef: "ISIC-COUT-14", supplierCode: "FRN-ISIC", supplierInvoiceRef: "INV-2026-77", issueDate: today, dueDate: today, object: "Licences, vague 12", reference: "ISIC-COUT-14", vatAmount: 1000,
    lines: [{ description: "Licences ISIC", quantity: 3, unitPrice: 1001 }, { description: "Frais d'envoi", quantity: 1, unitPrice: 2000 }] };

  console.log("\n▶ Création");
  check("sans purchases:write : 403", (await R("POST", "/api/v1/purchases", body)).status === 403);
  check("champ invalide : 422", (await A("POST", "/api/v1/purchases", { ...body, vatAmount: -1 })).status === 422);
  check("TVA manquante : 422", (await A("POST", "/api/v1/purchases", { ...body, vatAmount: undefined })).status === 422);
  check("fournisseur inconnu : 404", (await A("POST", "/api/v1/purchases", { ...body, externalRef: "ISIC-X-1", supplierCode: "INCONNU" })).status === 404);
  const c = await A("POST", "/api/v1/purchases", body);
  const d = c.data?.data;
  check("brouillon créé : 201, HT 5 003, TVA 1 000 reprise telle quelle, TTC 6 003", c.status === 201 && d?.status === "draft" && d.totalHT === 5003 && d.totalTVA === 1000 && d.totalTTC === 6003 && d.supplierCode === "FRN-ISIC", J(c.data).slice(0, 300));
  const list = D(await g.req("GET", "/api/achats?status=draft")).items ?? [];
  const p = list.find(x => x.externalRef === "ISIC-COUT-14");
  check("TVA répartie sur les lignes sans écart, compte provisoire à imputer", p && p.lines.reduce((t, l) => t + l.amountTVA, 0) === 1000 && p.lines.every(l => l.accountCode === "608000" && l.amountTVA >= 0), J(p?.lines));
  check("validation refusée tant que les lignes ne sont pas imputées", (await g.req("POST", `/api/achats/${p._id}/validate`, {})).status === 400);
  const imp = await g.req("PATCH", `/api/achats/${p._id}`, { lines: p.lines.map(l => ({ description: l.description, accountCode: "628000", quantity: l.quantity, unitPrice: l.unitPrice, tvaRate: 0.19 })) });
  check("imputation : la TVA de la facture (1 000) est conservée", imp.status === 200 && D(imp).totalTVA === 1000 && D(imp).lines.every(l => l.accountCode === "628000"), J(D(imp)).slice(0, 200));
  const again = await A("POST", "/api/v1/purchases", body);
  check("rejeu identique : 200, existing, pas de doublon", again.status === 200 && again.data?.existing === true && (D(await g.req("GET", "/api/achats?status=draft")).items ?? []).filter(x => x.externalRef === "ISIC-COUT-14").length === 1);
  check("même externalRef, contenu différent : 409", (await A("POST", "/api/v1/purchases", { ...body, vatAmount: 900 })).status === 409);
  check("même facture fournisseur sous une autre externalRef : 409", (await A("POST", "/api/v1/purchases", { ...body, externalRef: "ISIC-COUT-15" })).status === 409);
  check("même facture, autre casse et espaces : 409", (await A("POST", "/api/v1/purchases", { ...body, externalRef: "ISIC-COUT-17", supplierInvoiceRef: " inv 2026-77 " })).status === 409);
  check("même externalRef, autre échéance : 409 (empreinte du contenu)", (await A("POST", "/api/v1/purchases", { ...body, dueDate: "2099-12-31" })).status === 409);
  check("numéro de facture de plus de 60 caractères : 422", (await A("POST", "/api/v1/purchases", { ...body, externalRef: "ISIC-L-1", supplierInvoiceRef: "X".repeat(61) })).status === 422);
  check("TVA aberrante (99,7 % du HT) : 422, pas 500", (await A("POST", "/api/v1/purchases", { ...body, externalRef: "ISIC-T-1", supplierInvoiceRef: "T-1", vatAmount: 179500, lines: [{ description: "x", quantity: 150, unitPrice: 1200 }] })).status === 422);
  check("brouillon : pas encore de numéro Kanoo", d?.number === null, J(d));
  const sid = D(sup)._id;
  const man = await g.req("POST", "/api/achats", { supplierId: sid, supplierRef: "INV-2026-77", date: today, lines: [{ description: "Saisie papier", accountCode: "605000", amountHT: 5003 }] });
  check("saisie manuelle de la même facture : refusée", man.status === 400 && /déjà enregistrée/.test(man.data?.error ?? ""), `${man.status} ${J(man.data)}`);

  console.log("\n▶ Relecture, suppression, cloisonnement");
  const rd = await A("GET", "/api/v1/purchases?externalRef=ISIC-COUT-14,ABSENTE");
  check("relecture par externalRef : une pièce, champs attendus", rd.status === 200 && rd.data?.data?.items?.length === 1 && rd.data.data.items[0].supplierInvoiceRef === "INV-2026-77" && "creditedAmount" in rd.data.data.items[0], J(rd.data).slice(0, 200));
  check("relecture sans purchases:read : 403", (await R("GET", "/api/v1/purchases")).status === 403);
  const del = await g.req("DELETE", `/api/achats/${p._id}`);
  const after = (await A("GET", "/api/v1/purchases?externalRef=ISIC-COUT-14")).data?.data?.items?.[0];
  check("brouillon supprimé dans Kanoo : rendu « cancelled »", del.status < 300 && after?.status === "cancelled", `${del.status} ${J(after)}`);
  check("facture annulée : la même facture fournisseur peut être renvoyée", (await A("POST", "/api/v1/purchases", { ...body, externalRef: "ISIC-COUT-16" })).status === 201);
  const ok = await other.req("GET", "/api/achats");
  check("autre organisation : aucun achat ISIC visible", !(D(ok).items ?? []).some(x => x.externalRef?.startsWith("ISIC-")));
  check("sans clé : 401", (await api("kno_invalide")("GET", "/api/v1/purchases")).status === 401);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n${pass} vérifications réussies, ${fail + 1} en échec`); process.exit(1); });
