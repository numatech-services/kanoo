// Scénario de bout en bout : restaurant de campus — import d'un planning de
// semestre en PDF, emploi du temps, quantités à préparer selon la présence
// (cours, week-end, vacances), ingrédients manquants, réassort calé dessus.
import { readFileSync } from "fs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };

function session() {
  const jar = new Map(); let csrf = "";
  const store = r => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body, extraHeaders = {}) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    const form = body instanceof FormData;
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), ...(form ? {} : { "content-type": "application/json" }), ...(method !== "GET" ? { "x-csrf-token": csrf } : {}), ...extraHeaders }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
    store(res);
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
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





const PDFDocument = (await import("module")).createRequire(`${ROOT}/package.json`)("pdfkit");

/** Planning fictif au format d'un planning de semestre (Dates | Cours | Jour | Heures | Professeur). */
function planningPdf(rows) {
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: [841.8, 595.2], margin: 0 });
    const chunks = [];
    doc.on("data", c => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(9);
    const t = (s, x, y) => doc.text(s, x, y, { lineBreak: false });
    t("École : Test", 53, 120); t("Programme : Bachelor de test", 53, 150); t("Planning valable du 01.09.2026 au 30.06.2027", 53, 168);
    t("Année : Première – Semestre I", 53, 186); t("Classe :", 53, 240); t("Promotion TEST-26", 103, 240);
    t("Dates", 104, 270); t("Cours", 243, 270); t("Jour", 378, 270); t("Heures", 514, 270); t("Professeur", 644, 270);
    let y = 300;
    for (const r of rows) {
      t(r.dates, 53, y);
      if (r.course2) { t(r.course, 191, y - 7); t(r.course2, 191, y + 8); } else t(r.course, 191, y);
      if (r.days) t(r.days, 334, y);
      if (r.hours) t(r.hours, 455, y);
      y += 30;
    }
    doc.end();
  });
}

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const local = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const at = (n, h = 12, m = 30) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
  const fr = d => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "Restaurant du campus" }))._id;
  const item = async b => D(await g.req("POST", "/api/comptoir/items", { deskId: desk, ...b }));
  const pastel = await item({ name: "Pastel", unit: "pièce", category: "Snacks", quantity: 5000, unitCost: 90, salePrice: 200 });

  console.log("\n▶ Import du planning PDF");
  const pdf = await planningPdf([
    { dates: `${fr(at(-30))} au ${fr(at(30))}`, course: "Introduction aux", course2: "sciences du test", days: "Lundi au vendredi", hours: "08h30 à 10h30 et 11h00 à 12h30" },
    { dates: `${fr(at(-30))} au ${fr(at(30))}`, course: "Anglais", days: "Lundi,mardi,jeudi et vendredi", hours: "14h30 à 15h45 et 16h15 à 17h30" },
    { dates: `${fr(at(40))} au ${fr(at(44))}`, course: "Examens" },
  ]);
  const fd = new FormData();
  fd.append("deskId", desk);
  fd.append("files", new Blob([pdf], { type: "application/pdf" }), "planning-test.pdf");
  const im = await g.req("POST", "/api/comptoir/schedule/import", fd);
  const pl = D(im).plannings?.[0];
  check("planning lu : classe, 1re année, 3 lignes dont l'intitulé sur deux lignes", im.status === 200 && pl?.className === "Promotion TEST-26" && pl.firstYear === true && pl.entries?.length === 3 && pl.entries[0].course === "Introduction aux sciences du test", `${im.status} ${JSON.stringify(D(im)).slice(0, 300)}`);
  check("jours, heures et pauses", JSON.stringify(pl?.entries?.[1]?.days) === "[1,2,4,5]" && pl.entries[0].slots?.length === 2 && pl.breaks?.length === 2 && pl.entries[2].kind === "exams", JSON.stringify(pl?.entries));
  const bad = new FormData(); bad.append("deskId", desk); bad.append("files", new Blob(["pas un pdf"], { type: "application/pdf" }), "x.pdf");
  check("fichier qui n'est pas un PDF : refusé", (await g.req("POST", "/api/comptoir/schedule/import", bad)).status === 400);

  console.log("\n▶ Emploi du temps");
  // Comme l'écran : une demi-journée = un bloc ; effectif saisi 200 ; 10 résidents au déjeuner.
  const courses = pl.entries.filter(e => e.kind === "course").flatMap(e => e.days.map(day => ({ day, from: e.slots[0].from, to: e.slots[e.slots.length - 1].to, group: "1re année test", headcount: 200, start: e.from, end: e.to, label: e.course })));
  const services = [{ key: "lunch", label: "Déjeuner", from: "12:30", to: "14:30", base: 10 }, { key: "break", label: "Pause de l'après-midi", from: "15:45", to: "16:15", base: 0 }];
  const put = await g.req("PUT", "/api/comptoir/schedule", { deskId: desk, services, courses, periods: [], safetyMargin: 0.1 });
  check("emploi du temps enregistré", put.status === 200 && D(put).courses === courses.length, `${put.status} ${JSON.stringify(put.data).slice(0, 150)}`);
  check("cours aux horaires impossibles : refusé", (await g.req("PUT", "/api/comptoir/schedule", { deskId: desk, services, courses: [{ day: 1, from: "12:00", to: "08:00", group: "X", headcount: 10 }] })).status === 400);

  console.log("\n▶ Consommation apprise sur 14 jours de tickets");
  for (let k = -14; k <= -1; k++) {
    const d = at(k), wk = d.getDay() === 0 || d.getDay() === 6;
    const r = await g.req("POST", "/api/comptoir/sales", { deskId: desk, date: d.toISOString(), lines: [{ itemId: pastel._id, quantity: wk ? 5 : 105 }] });
    if (r.status !== 201) { check(`ticket du ${local(d)}`, false, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`); break; }
  }
  let k = 1; while ([0, 6].includes(at(k).getDay())) k++;
  const weekday = local(at(k));
  let s = 1; while (at(s).getDay() !== 6) s++;
  const saturday = local(at(s));
  const pw = D(await g.req("GET", `/api/comptoir/production?deskId=${desk}&day=${weekday}`));
  const lw = pw.services?.find(x => x.key === "lunch");
  check("jour de cours : 210 présents au déjeuner (200 + 10 résidents)", pw.configured === true && lw?.presence === 210 && lw.groups === 1, JSON.stringify(lw));
  check("116 pastels à préparer (0,5 par personne × 210 + 10 %)", lw?.items?.find(i => i.itemId === pastel._id)?.quantity === 116, JSON.stringify(lw?.items));
  const ps = D(await g.req("GET", `/api/comptoir/production?deskId=${desk}&day=${saturday}`));
  check("samedi sans cours : 10 présents, 6 pastels", ps.services?.find(x => x.key === "lunch")?.presence === 10 && ps.services.find(x => x.key === "lunch").items?.[0]?.quantity === 6, JSON.stringify(ps.services?.[0]));
  check("aperçu de la semaine (7 jours, chiffre d'affaires attendu)", pw.week?.length === 7 && pw.week[0].expectedRevenue === 116 * 200, JSON.stringify(pw.week?.[0]));

  console.log("\n▶ Vacances et ingrédients");
  await g.req("PUT", "/api/comptoir/schedule", { deskId: desk, services, courses, periods: [{ from: weekday, to: weekday, label: "Pont", kind: "holiday", factor: 0.1 }], safetyMargin: 0.1 });
  const ph = D(await g.req("GET", `/api/comptoir/production?deskId=${desk}&day=${weekday}`));
  check("jour de vacances (×0,1) : 21 présents, 12 pastels, période affichée", ph.services?.[0]?.presence === 21 && ph.services[0].items?.[0]?.quantity === 12 && ph.services[0].periods?.includes("Pont"), JSON.stringify(ph.services?.[0]));
  await g.req("PUT", "/api/comptoir/schedule", { deskId: desk, services, courses, periods: [], safetyMargin: 0.1 });
  const farine = await item({ name: "Farine", unit: "kg", quantity: 2, unitCost: 600 });
  await g.req("PATCH", `/api/comptoir/items/${pastel._id}`, { recipe: [{ itemId: farine._id, quantity: 0.05 }] });
  const pi = D(await g.req("GET", `/api/comptoir/production?deskId=${desk}&day=${weekday}`));
  const fi = pi.shortfall?.find(i => i.itemId === farine._id);
  check("préparation : 116 × 0,05 kg = 5,8 kg de farine, il en manque 3,8", fi?.needed === 5.8 && fi.missing === 3.8, JSON.stringify(pi.ingredients));
  const ro = D(await g.req("GET", `/api/comptoir/reorder?deskId=${desk}`));
  check("réassort calé sur l'emploi du temps", ro.basis === "schedule" && ro.lines?.find(l => l.itemId === farine._id)?.quantity > 0, JSON.stringify({ b: ro.basis, f: ro.lines?.find(l => l.itemId === farine._id) }));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
