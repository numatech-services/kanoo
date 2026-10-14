// Scénario de bout en bout : organisation cloisonnée (services × niveaux).
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { withDb } from "./db.mjs";

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
// Le serveur limite les connexions par adresse (20 par minute) : le scénario,
// qui ouvre plus de sessions que cela, attend le délai annoncé puis réessaie.
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

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);

  console.log("\n▶ Préparation par le gérant");
  const plateau = D(await g.req("POST", "/api/comptoir/desks", { name: "The Spot Plateau" }))._id;
  const kouara = D(await g.req("POST", "/api/comptoir/desks", { name: "The Spot Kouara" }))._id;
  check("deux sites The Spot créés", !!plateau && !!kouara);
  const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  const bad1 = await g.req("POST", "/api/users", { email: "x1@test.ne", password: PW, firstName: "X", lastName: "Un", roles: ["svc_dev"], roleLevels: { svc_dev: "stagiaire" } });
  check("stagiaire sans date de fin → refusé", bad1.status === 400 && /fin de stage/.test(bad1.data?.error), J(bad1.data));
  const bad2 = await g.req("POST", "/api/users", { email: "x2@test.ne", password: PW, firstName: "X", lastName: "Deux", roles: ["svc_spot"], roleLevels: { svc_spot: "employe" } });
  check("employé The Spot sans site → refusé", bad2.status === 400 && /site/.test(bad2.data?.error), J(bad2.data));
  const bad3 = await g.req("POST", "/api/users", { email: "x3@test.ne", password: PW, firstName: "X", lastName: "Trois", roles: ["pme_viewer"] });
  check("ancien rôle « Lecture seule » : plus attribuable", bad3.status === 400, String(bad3.status));
  const bad4 = await g.req("POST", "/api/users", { email: "x4@test.ne", password: PW, firstName: "X", lastName: "Quatre", roles: ["svc_comm"], roleLevels: { svc_comm: "patron" } });
  check("niveau inconnu → refusé", bad4.status === 400, String(bad4.status));

  const people = {
    compta_chef: { roles: ["svc_compta"], roleLevels: { svc_compta: "chef" } },
    compta_emp: { roles: ["svc_compta"], roleLevels: { svc_compta: "employe" } },
    admin_emp: { roles: ["svc_admin"], roleLevels: { svc_admin: "employe" } },
    comm_chef: { roles: ["svc_comm"], roleLevels: { svc_comm: "chef" } },
    prosp_emp: { roles: ["svc_prosp"], roleLevels: { svc_prosp: "employe" } },
    dev_stag: { roles: ["svc_dev"], roleLevels: { svc_dev: "stagiaire" }, accessUntil: future },
    prod_emp: { roles: ["svc_prod"], roleLevels: { svc_prod: "employe" } },
    prod_stag: { roles: ["svc_prod"], roleLevels: { svc_prod: "stagiaire" }, accessUntil: future },
    spot_emp: { roles: ["svc_spot"], roleLevels: { svc_spot: "employe" }, siteIds: [plateau] },
    spot_chef: { roles: ["svc_spot"], roleLevels: { svc_spot: "chef" } },
    secu_emp: { roles: ["svc_secu"], roleLevels: { svc_secu: "employe" } },
    cumul: { roles: ["svc_comm", "svc_dev"], roleLevels: { svc_comm: "chef", svc_dev: "stagiaire" }, accessUntil: future },
  };
  const ids = {};
  for (const [key, access] of Object.entries(people)) {
    const r = await g.req("POST", "/api/users", { email: `${key.replace("_", ".")}@test.ne`, password: PW, firstName: "Test", lastName: key.replace("_", " "), ...access });
    ids[key] = D(r)._id;
    if (r.status !== 201) console.log(`   création ${key}:`, r.status, J(r.data));
  }
  check("12 comptes de service créés (services × niveaux, cumul)", Object.values(ids).every(Boolean), J(ids));

  const S = {};
  for (const key of Object.keys(people)) S[key] = (await login(`${key.replace("_", ".")}@test.ne`, PW)).s;

  console.log("\n▶ Cloisonnement des finances");
  const FIN = ["/api/invoices", "/api/payments", "/api/treasury-accounts", "/api/accounting-entries", "/api/analytics/report", "/api/abonnements/rapprochement"];
  for (const key of Object.keys(people)) {
    const codes = {};
    for (const p of FIN) codes[p] = (await S[key].req("GET", p)).status;
    const finance = key.startsWith("compta");
    const ok = Object.values(codes).every(c => finance ? c === 200 : c === 403);
    check(`${key.padEnd(11)} ${finance ? "voit" : "ne voit pas"} les finances`, ok, J(codes));
  }
  const pay = async key => (await S[key].req("GET", "/api/payslips")).status;
  check("paie : chef comptable oui, comptable employé non", (await pay("compta_chef")) === 200 && (await pay("compta_emp")) === 403, `${await pay("compta_chef")} ${await pay("compta_emp")}`);
  const me = D(await S.secu_emp.req("GET", "/api/auth/me")).resources ?? [];
  check("Sécurité : accès minimal (événements, contrôle d'entrée, documents)", me.includes("eventCheckin") && !me.includes("clients") && !me.includes("invoices") && !me.includes("comptoir"), J(me));

  console.log("\n▶ Salaires masqués");
  const empAdmin = D(await S.admin_emp.req("GET", "/api/employees")).items ?? [];
  const empCompta = D(await S.compta_chef.req("GET", "/api/employees")).items ?? [];
  check("Administration voit les dossiers sans salaire ni banque", empAdmin.length > 0 && empAdmin.every(e => !("grossSalary" in e) && !("bankAccount" in e) && e.payrollHidden), J(empAdmin[0]));
  check("chef comptable voit les salaires", empCompta.some(e => "grossSalary" in e), J(empCompta[0] && Object.keys(empCompta[0])));
  const created = await S.admin_emp.req("POST", "/api/employees", { firstName: "Nouveau", lastName: "Agent", position: "Magasinier", startDate: "2026-10-01", code: "EMP-E2E-1", employeeType: "employee", grossSalary: 999999 });
  const createdId = D(created)._id;
  const seen = (D(await S.compta_chef.req("GET", "/api/employees")).items ?? []).find(e => e._id === createdId);
  check("Administration crée un dossier sans pouvoir fixer le salaire", created.status === 201 && seen && !seen.grossSalary, `${created.status} ${J(seen?.grossSalary)}`);

  console.log("\n▶ Facturation par la comptabilité");
  const bl = await S.admin_emp.req("GET", "/api/livraisons/source?number=FAC-2025-00001");
  check("Administration retrouve une facture pour un bon de livraison, sans aucun montant", bl.status === 200 && D(bl).lines?.length > 0 && !/total|amount|price|paid/i.test(J(D(bl))), `${bl.status} ${J(D(bl)).slice(0, 200)}`);
  check("… mais la liste des factures lui reste fermée", (await S.admin_emp.req("GET", "/api/invoices?number=FAC-2025-00001")).status === 403);
  const clients = D(await S.comm_chef.req("GET", "/api/clients")).items ?? [];
  const dv = await S.comm_chef.req("POST", "/api/devis", { clientId: clients[0]?._id, issueDate: "2026-09-30", validUntil: "2026-10-30", lines: [{ description: "Création charte graphique", quantity: 1, unitPrice: 350000, tvaRate: 19 }] });
  const devisId = D(dv)._id;
  check("Communication crée un devis", dv.status === 201 && !!devisId, `${dv.status} ${J(dv.data).slice(0, 200)}`);
  const conv1 = await S.comm_chef.req("POST", `/api/devis/${devisId}/to-invoice`, { type: "invoice" });
  check("… mais ne peut pas le transformer en facture", conv1.status === 403 && /comptabilité/.test(conv1.data?.error), `${conv1.status} ${J(conv1.data)}`);
  const conv2 = await S.compta_emp.req("POST", `/api/devis/${devisId}/to-invoice`, { type: "invoice" });
  check("la comptabilité transforme le devis en facture", conv2.status === 200 || conv2.status === 201, `${conv2.status} ${J(conv2.data).slice(0, 200)}`);

  console.log("\n▶ The Spot par site");
  const d1 = D(await S.spot_emp.req("GET", "/api/comptoir/desks"));
  check("employé The Spot : ne voit que son site", Array.isArray(d1) && d1.length === 1 && d1[0]._id === plateau, J(d1));
  check("… un autre site lui répond « introuvable »", (await S.spot_emp.req("GET", `/api/comptoir/summary?deskId=${kouara}`)).status === 404);
  check("… impossible d'y saisir la caisse", (await S.spot_emp.req("POST", "/api/comptoir/cash", { deskId: kouara, direction: "in", amount: 1000, label: "Vente" })).status === 404);
  check("… saisie sur son propre site : oui", (await S.spot_emp.req("POST", "/api/comptoir/cash", { deskId: plateau, direction: "in", amount: 1000, label: "Vente" })).status === 201);
  check("… ne crée pas de site", (await S.spot_emp.req("POST", "/api/comptoir/desks", { name: "Pirate" })).status === 403);
  const d2 = D(await S.spot_chef.req("GET", "/api/comptoir/desks"));
  check("chef The Spot : voit tous les sites", Array.isArray(d2) && d2.length === 2, J(d2?.length));

  console.log("\n▶ Niveaux");
  check("stagiaire Production : export ISIC refusé", (await S.prod_stag.req("GET", "/api/isic/registry/export?filter=all")).status === 403);
  check("employé Production : export ISIC autorisé", (await S.prod_emp.req("GET", "/api/isic/registry/export?filter=all")).status === 200);
  check("employé Prospection : export CSV des clients autorisé", (await S.prosp_emp.req("GET", "/api/data/clients/export")).status === 200);
  // (Les devis n'ont pas de suppression dans l'application : test sur un projet.)
  const prj = await S.prod_emp.req("POST", "/api/projects", { code: "PRJ-E2E-1", name: "Stand salon étudiant" });
  const prjId = D(prj)._id;
  check("employé Production crée un projet", prj.status === 201 && !!prjId, `${prj.status} ${J(prj.data).slice(0, 150)}`);
  const delEmp = await S.prod_emp.req("DELETE", `/api/projects/${prjId}`);
  check("employé : ne supprime pas", delEmp.status === 403, String(delEmp.status));
  const delChef = await S.comm_chef.req("DELETE", `/api/projects/${prjId}`);
  check("chef : supprime", delChef.status < 300, `${delChef.status} ${J(delChef.data)}`);
  check("cumul chef Communication + stagiaire Développement : exporte les clients (via Communication)", (await S.cumul.req("GET", "/api/data/clients/export")).status === 200);


  console.log("\n▶ Audit — fuites corrigées");
  // Exports comptables, déclarations, PDF de facture : auparavant ouverts à tout compte connecté.
  const inv = (D(await S.compta_chef.req("GET", "/api/invoices?limit=1")).items ?? [])[0];
  const GATED = ["/api/exports/sage?annee=2025", "/api/exports/ohada?annee=2025", "/api/exports/generic?format=fec&annee=2025",
    "/api/reports/dgi-cnss?year=2026&trimestre=1", "/api/reports/dgi-tva?year=2026&month=1", "/api/reports/dgi-pdf?type=grandlivre&annee=2025", `/api/invoices/${inv?._id}/pdf`];
  for (const key of ["comm_chef", "admin_emp", "prod_emp", "secu_emp"]) {
    const codes = {}; for (const p of GATED) codes[p.split("?")[0]] = (await S[key].req("GET", p)).status;
    check(`${key.padEnd(11)} : exports comptables, CNSS, TVA, PDF facture refusés`, Object.values(codes).every(c => c === 403), J(codes));
  }
  const gcodes = {}; for (const p of GATED) gcodes[p.split("?")[0]] = (await g.req("GET", p)).status;
  check("gérant : exports et déclarations accessibles", Object.values(gcodes).every(c => c === 200), J(gcodes));
  const cnssEmp = (await S.compta_emp.req("GET", GATED[3])).status;
  check("bordereau CNSS (paie) : refusé au comptable employé", cnssEmp === 403, String(cnssEmp));

  // Secrets de compte : le transform toJSON ne s'applique pas aux lectures lean().
  await withDb(ROOT, db => db.collection("users").updateOne({ email: "admin@test.ne" }, { $set: { twoFactorPending: "PENDINGSECRET", passwordResetToken: "RESETTOKEN", twoFactorBackupCodes: ["h1"] } }));
  const meRaw = J(await g.req("GET", "/api/auth/me"));
  const usersRaw = J(await g.req("GET", "/api/users?limit=100"));
  const adminId = D(await g.req("GET", "/api/users?limit=100")).items?.find(u => u.email === "admin@test.ne")?._id;
  const oneRaw = J(await g.req("GET", `/api/users/${adminId}`));
  check("secrets 2FA et jeton de réinitialisation jamais renvoyés (me, liste, fiche)",
    ![meRaw, usersRaw, oneRaw].some(x => /PENDINGSECRET|RESETTOKEN|twoFactorBackupCodes|passwordResetToken/.test(x)), [meRaw, usersRaw, oneRaw].map(x => x.length).join(","));

  // Clients : fiche visible, soldes et relevé réservés à la comptabilité.
  const cl = D(await S.prosp_emp.req("GET", "/api/clients")).items ?? [];
  check("Prospection : liste clients sans solde", cl.length > 0 && cl.every(c => !("currentBalance" in c)), J(cl[0] && Object.keys(cl[0])));
  const clC = D(await S.compta_emp.req("GET", "/api/clients")).items ?? [];
  check("Comptabilité : solde client présent", clC.length > 0 && clC.every(c => "currentBalance" in c));
  const cid = cl[0]?._id;
  const ov = D(await S.prosp_emp.req("GET", `/api/clients/${cid}/overview`));
  check("Prospection : fiche client sans synthèse financière ni factures", ov.financials === null && ov.sections?.invoices?.count === 0 && ov.access?.invoices === false && !("currentBalance" in (ov.client ?? {})), J({ f: ov.financials, n: ov.sections?.invoices?.count }));
  const ovC = D(await S.compta_emp.req("GET", `/api/clients/${cid}/overview`));
  check("Comptabilité : synthèse financière de la fiche client", ovC.financials && typeof ovC.financials.invoiced === "number");
  check("Prospection : relevé de compte client refusé", (await S.prosp_emp.req("GET", `/api/clients/${cid}/releve`)).status === 403);
  const one = D(await S.prosp_emp.req("GET", `/api/clients/${cid}`));
  check("Prospection : fiche client unitaire sans solde", one._id && !("currentBalance" in one), J(Object.keys(one)));
  const nav = D(await S.prosp_emp.req("GET", "/api/nav-counters"));
  check("Prospection : pas de compteur de factures en retard", !("/invoices" in nav) && !("/relances" in nav), J(nav));

  // Projets : budget masqué, corps assaini (ni tenantId ni montant écrasé).
  // Un employé ne voit que les projets auxquels il participe.
  const prospId = D(await S.prosp_emp.req("GET", "/api/auth/me")).user?._id;
  const hidden = D(await g.req("POST", "/api/projects", { code: "PRJ-E2E-HID", name: "Projet d'une autre équipe", budget: 100000 }));
  check("Prospection : projet d'une autre équipe invisible", (await S.prosp_emp.req("GET", `/api/projects/${hidden._id}`)).status === 404);
  const pj = D(await g.req("POST", "/api/projects", { code: "PRJ-E2E-BUD2", name: "Projet budgété", budget: 800000, teamIds: [prospId] }));
  const pjComm = D(await S.prosp_emp.req("GET", `/api/projects/${pj._id}`));
  check("Prospection : projet visible sans budget", pjComm._id === pj._id && !("budget" in pjComm) && pjComm.amountsHidden === true, J(Object.keys(pjComm)));
  const listComm = D(await S.prosp_emp.req("GET", "/api/projects")).items ?? [];
  check("Prospection : liste des projets sans montants, sans les projets des autres", listComm.length > 0 && listComm.every(p => !("budget" in p) && !("spentAmount" in p)) && !listComm.some(p => p._id === hidden._id));
  check("Prospection (lecture seule) : ne modifie pas un projet", (await S.prosp_emp.req("PATCH", `/api/projects/${pj._id}`, { name: "X" })).status === 403);
  const upd = await S.comm_chef.req("PATCH", `/api/projects/${pj._id}`, { name: "Renommé", budget: 0, spentAmount: 5, tenantId: "000000000000000000000000", $where: "1" });
  const after = D(await g.req("GET", `/api/projects/${pj._id}`));
  check("… sa modification ne touche ni le budget ni l'organisation", upd.status === 200 && after.name === "Renommé" && after.budget === 800000 && !after.spentAmount, `${upd.status} ${J({ n: after.name, b: after.budget, s: after.spentAmount })}`);

  // Journal d'audit : pas d'entrées de paiements / factures hors finances.
  const logs = D(await S.cumul.req("GET", "/api/audit-logs?limit=200")).items ?? [];
  check("service Développement : journal d'audit sans factures ni paiements", logs.every(l => !["invoices", "payments", "payslips", "accountingEntries"].includes(l.resource)), J([...new Set(logs.map(l => l.resource))]));
  const logsG = D(await g.req("GET", "/api/audit-logs?limit=200")).items ?? [];
  check("gérant : journal complet (factures incluses)", logsG.some(l => l.resource === "invoices"), J([...new Set(logsG.map(l => l.resource))]));

  // Activités : inscription réservée à l'équipe / l'accueil ; recette masquée.
  const ev = D(await g.req("POST", "/api/events", { title: "Salon E2E", startAt: "2026-11-15T09:00:00Z" }));
  check("Prospection (simple lecteur) : inscription d'un participant refusée", (await S.prosp_emp.req("POST", `/api/events/${ev._id}/attendees`, { firstName: "A", lastName: "B" })).status === 403);
  check("Sécurité (accueil) : inscription sur place autorisée", (await S.secu_emp.req("POST", `/api/events/${ev._id}/attendees`, { firstName: "C", lastName: "D" })).status === 201);
  const stComm = D(await S.secu_emp.req("GET", `/api/events/${ev._id}/attendees`)).stats;
  check("… recette de l'activité masquée hors finances", stComm && stComm.revenue === null && stComm.total === 1, J(stComm));

  // Import CSV : une colonne absente n'écrase plus la valeur existante.
  const before = (D(await g.req("GET", "/api/employees?limit=100")).items ?? []).find(e => e.code === "EMP-T01");
  const imp1 = await g.req("POST", "/api/data/employees/import", "code,firstName,lastName,position,startDate\nEMP-T01,Alpha,Test,Directeur,2020-01-01\n");
  const imp2 = await S.admin_emp.req("POST", "/api/data/employees/import", "code,firstName,lastName,position,startDate,grossSalary\nEMP-T01,Alpha,Test,Directeur,2020-01-01,1\n");
  const afterImp = (D(await g.req("GET", "/api/employees?limit=100")).items ?? []).find(e => e.code === "EMP-T01");
  check("import sans colonne salaire : salaire conservé ; import par l'Administration : salaire non modifiable",
    imp1.status === 200 && imp2.status === 200 && before?.grossSalary === 500000 && afterImp?.grossSalary === 500000 && afterImp?.position === "Directeur",
    `${imp1.status} ${imp2.status} ${before?.grossSalary} → ${afterImp?.grossSalary} ${J(imp2.data).slice(0, 150)}`);
  const csv = await S.admin_emp.req("GET", "/api/data/employees/export");
  check("export des collaborateurs par l'Administration : sans colonne salaire", csv.status === 200 && !/grossSalary/.test(csv.data) && /EMP-T01/.test(csv.data), `${csv.status}`);

  // Suppressions : l'employé ne supprime pas une ligne de paiement ISIC ni un mouvement de stock.
  check("contrat : génération de facture refusée hors comptabilité", (await S.admin_emp.req("POST", `/api/contracts/000000000000000000000000/generate-invoice`)).status === 403);

  console.log("\n▶ Fin de stage et changement d'accès");
  await withDb(ROOT, db => db.collection("users").updateOne({ email: "dev.stag@test.ne" }, { $set: { accessUntil: new Date(Date.now() - 86400000) } }));
  const exp = await S.dev_stag.req("GET", "/api/projects");
  check("stage terminé : la session ouverte est coupée", exp.status === 401 && /fin de stage/.test(exp.data?.error), `${exp.status} ${J(exp.data)}`);
  const relog = await login("dev.stag@test.ne", PW);
  check("… et la reconnexion est refusée", relog.r.status === 401 && /fin de stage/.test(relog.r.data?.error), `${relog.r.status}`);
  const ch = await g.req("PATCH", `/api/users/${ids.comm_chef}`, { roleLevels: { svc_comm: "employe" } });
  check("gérant rétrograde le chef Communication en employé", ch.status === 200, `${ch.status} ${J(ch.data)}`);
  check("… sa session ouverte est fermée", (await S.comm_chef.req("GET", "/api/projects")).status === 401);
  const comptable = D(await g.req("GET", "/api/users?limit=100")).items?.find(u => u.email === "comptable@test.ne");
  const keep = await g.req("PATCH", `/api/users/${comptable._id}`, { roles: ["pme_accountant", "svc_compta"], roleLevels: { svc_compta: "chef" } });
  check("ancien rôle déjà porté : conservé pendant la migration", keep.status === 200, `${keep.status} ${J(keep.data)}`);
  const add = await g.req("PATCH", `/api/users/${comptable._id}`, { roles: ["svc_compta", "pme_viewer"] });
  check("… mais un autre ancien rôle ne peut pas être ajouté", add.status === 400, String(add.status));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
