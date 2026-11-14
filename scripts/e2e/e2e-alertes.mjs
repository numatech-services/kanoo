// Scénario de bout en bout : alertes et échéances (droits et niveaux, cloisonnement, rappels et escalade,
// enregistrement des marchés, récurrence, tableau de bord de chaque profil, agenda).
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { createRequire } from "module";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const { Types } = createRequire(`${ROOT}/package.json`)("mongoose");
const oid = x => new Types.ObjectId(String(x));
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
const PW2 = `Kz-${randomBytes(12).toString("base64url")}!9q`;
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x)?.slice(0, 400);

function session() {
  const jar = new Map(); let csrf = "";
  const store = r => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body, rawBody) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
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
const id = r => D(r)?._id;
const cron = async job => {
  const r = await fetch(`${BASE}/api/cron?job=${job}`, { headers: { "x-cron-key": process.env.CRON_SECRET } });
  const d = await r.json();
  return { status: r.status, ...(d.ran?.[0] ?? {}) };
};
const notifs = async s => { const r = await s.req("GET", "/api/notifications?limit=200"); return r.data?.data?.items ?? r.data?.data ?? []; };
const local = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusDays = n => local(new Date(Date.now() + n * 86400000));
const items = r => (r.status === 200 && Array.isArray(D(r).items) ? D(r).items : null);
const newUser = async (g, email, extra) => {
  const r = await g.req("POST", "/api/users", { email, password: PW2, firstName: email.split("@")[0], lastName: "Test", ...extra });
  return id(r);
};

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const { s: cpt } = await login("comptable@test.ne", SEED_PW);
  const { s: other } = await login("president@test.ne", SEED_PW);
  const { s: ord } = await login("ordonnateur@test.ne", SEED_PW);

  console.log("\n▶ Création et contrôles de saisie");
  const a1 = await g.req("POST", "/api/alerts", { title: "Enregistrer le bail du siège", dueDate: plusDays(5), category: "contrat", consequence: "Pénalités de retard d'enregistrement.", remindDays: "7, 1" });
  const a1id = id(a1);
  check("alerte créée par le gérant", a1.status === 201 && D(a1).remindDays?.join() === "7,1", J(a1));
  check("sans intitulé : refusée", (await g.req("POST", "/api/alerts", { title: " ", dueDate: plusDays(3) })).status === 400);
  check("intitulé non textuel : refusé", (await g.req("POST", "/api/alerts", { title: {}, dueDate: plusDays(3) })).status === 400);
  check("sans échéance : refusée", (await g.req("POST", "/api/alerts", { title: "X", dueDate: "" })).status === 400);
  check("date impossible (30 février) : refusée", (await g.req("POST", "/api/alerts", { title: "X", dueDate: "2027-02-30" })).status === 400);
  check("catégorie inconnue : refusée", (await g.req("POST", "/api/alerts", { title: "X", dueDate: plusDays(3), category: "zzz" })).status === 400);
  check("catégorie « constructor » : refusée", (await g.req("POST", "/api/alerts", { title: "X", dueDate: plusDays(3), category: "constructor" })).status === 400);
  check("délais « 1 mois » : refusés", (await g.req("POST", "/api/alerts", { title: "X", dueDate: plusDays(3), remindDays: "1 mois" })).status === 400);
  check("corps vide (null) : refusé sans erreur serveur", (await g.req("POST", "/api/alerts", undefined, "null")).status === 400);
  const foreignUser = await withDb(ROOT, db => db.collection("users").findOne({ email: "president@test.ne" }));
  check("destinataire d'une autre organisation : refusé", (await g.req("POST", "/api/alerts", { title: "X", dueDate: plusDays(3), assigneeIds: [String(foreignUser._id)] })).status === 400);
  check("destinataire en chaîne seule : refusé", (await g.req("POST", "/api/alerts", { title: "X", dueDate: plusDays(3), assigneeIds: String(foreignUser._id) })).status === 400);
  check("contrat inconnu : refusé", (await g.req("POST", "/api/alerts", { title: "X", dueDate: plusDays(3), contractId: "0123456789abcdef01234567" })).status === 400);
  check("prévenance vide : rappels par défaut (7, 1)", D(await g.req("POST", "/api/alerts", { title: "Défaut", dueDate: plusDays(40), remindDays: "" })).remindDays?.join() === "7,1");
  check("statut inconnu en lecture : refusé", (await g.req("GET", "/api/alerts?status=zzz")).status === 400);

  console.log("\n▶ Comptable : voit tout et crée");
  const listC = await cpt.req("GET", "/api/alerts");
  check("la comptable voit l'alerte du gérant", D(listC).canManage === true && (items(listC) ?? []).some(a => a._id === a1id), J(D(listC)));
  const a2 = await cpt.req("POST", "/api/alerts", { title: "Déclaration CNSS", dueDate: plusDays(-3), category: "social", consequence: "Majorations de retard." });
  check("la comptable crée une alerte", a2.status === 201, J(a2));
  const otherList = items(await other.req("GET", "/api/alerts"));
  check("autre organisation : liste lue, sans les alertes de la PME", Array.isArray(otherList) && !otherList.some(a => a._id === a1id), J(otherList));

  console.log("\n▶ Niveaux et collaborateurs sans droit de gestion");
  const uid = await newUser(g, "vente.alertes@test.ne", { roles: ["svc_comm"], roleLevels: { svc_comm: "employe" } });
  check("commercial créé", !!uid);
  const { s: sales } = await login("vente.alertes@test.ne", PW2);
  const mine0 = await sales.req("GET", "/api/alerts");
  check("commercial : liste lue, sans les alertes de la direction", D(mine0).canManage === false && Array.isArray(items(mine0)) && !items(mine0).some(a => a._id === a1id), J(D(mine0)));
  check("commercial : ne peut pas créer", (await sales.req("POST", "/api/alerts", { title: "X", dueDate: plusDays(2) })).status === 403);
  await newUser(g, "stagiaire.compta@test.ne", { roles: ["svc_compta"], roleLevels: { svc_compta: "stagiaire" }, accessUntil: plusDays(90) });
  const { s: stag } = await login("stagiaire.compta@test.ne", PW2);
  check("comptable stagiaire : ne peut pas créer", (await stag.req("POST", "/api/alerts", { title: "X", dueDate: plusDays(2) })).status === 403);
  check("comptable stagiaire : ne voit pas les alertes de la direction", !(items(await stag.req("GET", "/api/alerts")) ?? [{ _id: a1id }]).some(a => a._id === a1id));
  await newUser(g, "employe.compta@test.ne", { roles: ["svc_compta"], roleLevels: { svc_compta: "employe" } });
  const { s: emp } = await login("employe.compta@test.ne", PW2);
  const own = await emp.req("POST", "/api/alerts", { title: "Rapprochement bancaire", dueDate: plusDays(20) });
  check("comptable employée : crée une alerte", own.status === 201, J(own));
  check("comptable employée : modifie la sienne", (await emp.req("PATCH", `/api/alerts/${id(own)}`, { title: "Rapprochement bancaire de novembre" })).status === 200);
  check("comptable employée : ne modifie pas celle du gérant", (await emp.req("PATCH", `/api/alerts/${a1id}`, { title: "Autre" })).status === 403);
  check("comptable employée : ne peut pas annuler celle du gérant", (await emp.req("PATCH", `/api/alerts/${a1id}`, { action: "cancel" })).status === 403);

  const a3 = await g.req("POST", "/api/alerts", { title: "Relancer l'agrément", dueDate: plusDays(1), assigneeIds: [uid] });
  const a3id = id(a3);
  const mine1 = items(await sales.req("GET", "/api/alerts"));
  check("commercial : voit l'alerte qui lui est confiée", mine1?.length === 1 && mine1[0]._id === a3id, J(mine1));
  check("commercial : prévenu dès la création", (await notifs(sales)).some(n => /^Alerte qui vous est confiée : Relancer l'agrément/.test(n.title ?? "")));
  check("commercial : ne peut pas la modifier", (await sales.req("PATCH", `/api/alerts/${a3id}`, { title: "Autre" })).status === 403);
  check("commercial : ne peut pas l'annuler", (await sales.req("PATCH", `/api/alerts/${a3id}`, { action: "cancel" })).status === 403);
  check("commercial : alerte qui ne le concerne pas introuvable", (await sales.req("PATCH", `/api/alerts/${a1id}`, { action: "done" })).status === 404);
  check("autre organisation : introuvable", (await other.req("PATCH", `/api/alerts/${a1id}`, { action: "done" })).status === 404);

  // Escalade : confiée au commercial, en retard → la direction est prévenue aussi.
  await g.req("POST", "/api/alerts", { title: "Visite technique du véhicule", dueDate: plusDays(-1), assigneeIds: [uid] });
  // Destinataire désactivé : la direction reprend la main.
  const gone = await newUser(g, "parti.alertes@test.ne", { roles: ["svc_comm"], roleLevels: { svc_comm: "employe" } });
  const aGone = id(await g.req("POST", "/api/alerts", { title: "Renouveler l'assurance", dueDate: plusDays(2), assigneeIds: [gone] }));
  check("désactivation du destinataire", (await g.req("PATCH", `/api/users/${gone}`, { isActive: false })).status === 200);
  // Deux alertes à la même date, sans conséquence : deux rappels distincts.
  await g.req("POST", "/api/alerts", { title: "Déclaration TVA", dueDate: plusDays(3) });
  await g.req("POST", "/api/alerts", { title: "Acompte ISB", dueDate: plusDays(3) });

  console.log("\n▶ Rappels quotidiens");
  const r1 = await cron("alerts-due");
  check("tâche « alerts-due » exécutée", r1.status === 200 && /rappel\(s\) d'alerte/.test(r1.summary ?? ""), J(r1));
  const nA = await notifs(g);
  const n1 = nA.find(n => /Enregistrer le bail du siège/.test(n.title ?? ""));
  check("gérant : rappel J-7 avec la conséquence et le lien", !!n1 && /dans 5 jours/.test(n1.message) && /Pénalités/.test(n1.message) && n1.linkedTo === `/alertes?alerte=${a1id}`, J(n1));
  check("comptable : reçoit aussi le rappel", (await notifs(cpt)).some(n => /Enregistrer le bail du siège/.test(n.title ?? "")));
  check("comptable stagiaire : ne reçoit pas les rappels de la direction", !(await notifs(stag)).some(n => /bail du siège/.test(n.title ?? "")));
  check("retard signalé comme tel", nA.some(n => /^Alerte en retard : Déclaration CNSS/.test(n.title ?? "") && /en retard de 3 jours/.test(n.message)), J(nA.map(n => n.title)));
  const nS = await notifs(sales);
  check("destinataire nommé prévenu à J-1, la direction non", nS.some(n => n.title === "Alerte : Relancer l'agrément") && !nA.some(n => n.title === "Alerte : Relancer l'agrément"), J(nS.map(n => n.title)));
  check("en retard : le destinataire et la direction sont prévenus", nS.some(n => /Visite technique/.test(n.title ?? "")) && nA.some(n => /Visite technique/.test(n.title ?? "")));
  check("destinataire désactivé : la direction est prévenue", nA.some(n => /Renouveler l'assurance/.test(n.title ?? "")), J(nA.map(n => n.title)));
  check("deux alertes le même jour : deux rappels", nA.some(n => /Déclaration TVA/.test(n.title ?? "")) && nA.some(n => /Acompte ISB/.test(n.title ?? "")));
  check("commercial : rien des alertes de la direction", !nS.some(n => /bail du siège|Déclaration TVA/.test(n.title ?? "")));
  const r2 = await cron("alerts-due");
  check("second passage le même jour : aucun doublon", /^0 rappel/.test(r2.summary ?? ""), J(r2));
  const before = D(await g.req("GET", "/api/alerts")).items?.find(a => a._id === a1id)?.dueDate;
  check("report de l'échéance", (await g.req("PATCH", `/api/alerts/${a1id}`, { dueDate: plusDays(6) })).status === 200);
  const r3 = await cron("alerts-due");
  check("date reportée : nouveau rappel", /^[1-9]\d* rappel/.test(r3.summary ?? ""), J(r3));
  const audit = await withDb(ROOT, db => db.collection("auditlogs").findOne({ resource: "alerts", resourceId: oid(a1id), action: "UPDATE" }));
  check("modification journalisée, ancienne et nouvelle date différentes", !!audit?.before?.dueDate && !!audit?.after?.dueDate && String(audit.before.dueDate) !== String(audit.after.dueDate) && String(new Date(audit.before.dueDate)) === String(new Date(before)), J(audit));
  check("alerte au destinataire désactivé : encore modifiable", (await g.req("PATCH", `/api/alerts/${aGone}`, { title: "Renouveler l'assurance flotte", assigneeIds: [gone] })).status === 200);

  console.log("\n▶ Traitement, récurrence, annulation");
  check("le destinataire marque son alerte traitée", (await sales.req("PATCH", `/api/alerts/${a3id}`, { action: "done", note: "Dossier déposé" })).status === 200);
  check("déjà traitée : second clic refusé", (await sales.req("PATCH", `/api/alerts/${a3id}`, { action: "done" })).status === 400);
  const done = items(await g.req("GET", "/api/alerts?status=done")) ?? [];
  check("traitée : auteur et note conservés", done.some(a => a._id === a3id && a.doneNote === "Dossier déposé" && a.doneBy?.firstName === "vente.alertes"), J(done));
  const rec = await g.req("POST", "/api/alerts", { title: "Acompte IS", dueDate: "2026-01-31", repeat: "monthly", category: "fiscal" });
  const recDone = await g.req("PATCH", `/api/alerts/${id(rec)}`, { action: "done" });
  const next = D(recDone).next;
  check("récurrente traitée : occurrence suivante au 28 février", !!next && new Date(next.dueDate).getDate() === 28 && new Date(next.dueDate).getMonth() === 1 && next.status === "open", J(D(recDone)));
  const next2 = D(await g.req("PATCH", `/api/alerts/${next._id}`, { action: "done" })).next;
  check("quantième d'origine conservé : 31 mars", !!next2 && new Date(next2.dueDate).getDate() === 31, J(next2));
  await g.req("PATCH", `/api/alerts/${id(rec)}`, { action: "reopen" });
  await g.req("PATCH", `/api/alerts/${id(rec)}`, { action: "done" });
  const febs = await withDb(ROOT, db => db.collection("alerts").countDocuments({ previousId: oid(id(rec)) }));
  check("rouverte puis retraitée : pas de seconde occurrence", febs === 1, String(febs));
  check("modification d'une alerte traitée : refusée", (await g.req("PATCH", `/api/alerts/${a3id}`, { title: "Y" })).status === 400);
  check("annulation par la direction", (await g.req("PATCH", `/api/alerts/${id(a2)}`, { action: "cancel" })).status === 200);
  check("annulée : plus dans « à traiter »", !(items(await g.req("GET", "/api/alerts")) ?? [{ _id: id(a2) }]).some(a => a._id === id(a2)));
  check("réouverture", (await g.req("PATCH", `/api/alerts/${id(a2)}`, { action: "reopen" })).status === 200);

  console.log("\n▶ Enregistrement d'un marché seulement signé");
  const client = await withDb(ROOT, async db => { const admin = await db.collection("users").findOne({ email: "admin@test.ne" }); return db.collection("clients").findOne({ tenantId: admin.tenantId }); });
  const ct = await g.req("POST", "/api/contracts", { title: "Marché e2e enregistrement", type: "client", clientId: String(client._id), amount: 1000000, status: "active" });
  const ctId = id(ct);
  check("marché créé", !!ctId, J(ct));
  const signed = new Date(); signed.setDate(signed.getDate() - 25);
  await withDb(ROOT, db => db.collection("contracts").updateOne({ _id: oid(ctId) }, { $set: { signedDate: signed, buyerType: "private" } }));
  const auto = D(await g.req("GET", "/api/alerts")).automatic ?? [];
  const regItem = auto.find(a => a.href === `/contracts/${ctId}`);
  check("échéance calculée depuis la signature (sans approbation)", !!regItem && regItem.left >= 4 && regItem.left <= 7 && /signature du contrat/.test(regItem.consequence ?? ""), J(auto));
  const rr = await cron("registration-due");
  check("rappel d'enregistrement envoyé", rr.status === 200 && /rappel\(s\) d'enregistrement/.test(rr.summary ?? ""), J(rr));
  check("gérant : rappel d'enregistrement avec le lien du marché", (await notifs(g)).some(n => n.type === "registration_due" && n.linkedTo === `/contracts/${ctId}`), J((await notifs(g)).filter(n => n.type === "registration_due")));
  const linked = await g.req("POST", "/api/alerts", { title: "Copie du marché au bailleur", dueDate: plusDays(10), contractId: ctId });
  check("alerte rattachée au marché", linked.status === 201);
  check("alertes du marché : filtre par contrat", (items(await g.req("GET", `/api/alerts?status=all&contractId=${ctId}`)) ?? []).length === 1);
  await withDb(ROOT, db => db.collection("contracts").updateOne({ _id: oid(ctId) }, { $set: { "registration.number": "Q-E2E-1" } }));
  check("quittance saisie : l'échéance disparaît", !(D(await g.req("GET", "/api/alerts")).automatic ?? []).some(a => a.href === `/contracts/${ctId}`));

  console.log("\n▶ Tableaux de bord et agenda");
  const home = D(await g.req("GET", "/api/dashboard/home"));
  const lefts = (home.alerts?.items ?? []).map(i => i.left);
  check("gérant : bloc alertes, les plus urgentes d'abord, retards comptés", home.alerts?.canManage === true && home.alerts.overdue >= 2 && home.alerts.total >= home.alerts.items.length && home.alerts.items.length === Math.min(6, home.alerts.total) && lefts.every((l, i) => i === 0 || lefts[i - 1] <= l) && home.alerts.items.some(i => /Déclaration CNSS/.test(i.title)), J(home.alerts));
  const allOpen = items(await g.req("GET", "/api/alerts")) ?? [];
  check("bloc : le total compte aussi le bail du siège (hors des 6 premiers)", allOpen.some(a => /bail du siège/.test(a.title)) && home.alerts.total > 6);
  const homeC = D(await cpt.req("GET", "/api/dashboard/home"));
  check("comptable : même bloc que le gérant", homeC.alerts?.total === home.alerts?.total && homeC.alerts?.overdue === home.alerts?.overdue, J(homeC.alerts));
  const homeS = D(await sales.req("GET", "/api/dashboard/home"));
  check("commercial : bloc limité à ses alertes", homeS.alerts !== undefined && !(homeS.alerts?.items ?? []).some(i => /bail du siège/.test(i.title)), J(homeS.alerts));
  const boardO = await ord.req("GET", "/api/alerts/board");
  check("ordonnateur (administration) : bloc disponible", boardO.status === 200 && D(boardO)?.canManage === true, J(boardO.data));
  const boardP = await other.req("GET", "/api/alerts/board");
  check("président (association) : bloc disponible", boardP.status === 200 && D(boardP)?.canManage === true, J(boardP.data));
  const page = await g.req("GET", "/dashboard");
  // Le libellé du menu porte le même nom : on cherche le sous-titre du bloc.
  check("page du tableau de bord : bloc des alertes affiché", typeof page.data === "string" && /\d+ à traiter/.test(page.data), String(page.status));
  check("écran des alertes accessible", (await g.req("GET", "/alertes")).status === 200);
  const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 30 * 86400000).toISOString();
  const ag = await g.req("GET", `/api/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&virtual=1`);
  const agItems = Array.isArray(D(ag)) ? D(ag) : D(ag).items ?? [];
  check("agenda : échéance visible dans le calendrier des alertes", agItems.some(e => e.calendar === "Échéances (alertes Kanoo)" && /bail du siège/.test(e.title)), J(agItems.map(e => `${e.calendar}:${e.title}`)));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
