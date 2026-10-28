import { presenceFor, periodFactor, learnRates, forecastDay, parseTimetableCsv, validateSchedule, serviceAt, DEFAULT_SERVICES, type Schedule } from "@/lib/campus";

const lunch = DEFAULT_SERVICES[1];
const base: Schedule = {
  services: DEFAULT_SERVICES.map(s => (s.key === "lunch" ? { ...s, base: 20 } : s)),
  courses: [
    { day: 1, from: "08:00", to: "12:00", group: "L1 Info", headcount: 120 },
    { day: 1, from: "14:00", to: "16:00", group: "L1 Info", headcount: 120 },
    { day: 1, from: "15:30", to: "18:00", group: "M2 Droit", headcount: 40 },
    { day: 2, from: "08:00", to: "10:00", group: "L2 Éco", headcount: 80 },
  ],
  periods: [],
  safetyMargin: 0.1,
};
const monday = new Date(2026, 10, 2, 12);   // lundi 2 novembre 2026

describe("Présence selon l'emploi du temps", () => {
  test("déjeuner du lundi : public de base + L1 Info (une seule fois), pas le M2 de 15 h 30", () => {
    const p = presenceFor(monday, { ...lunch, base: 20 }, base);
    expect(p.presence).toBe(140);
    expect(p.groups).toBe(1);
  });
  test("mardi midi : L2 Éco finit à 10 h, hors de l'heure autour du déjeuner", () => {
    expect(presenceFor(new Date(2026, 10, 3, 12), lunch, base).presence).toBe(0);
  });
  test("vacances (×0,1) et jour férié (0) ; le férié l'emporte", () => {
    const s = { ...base, periods: [{ from: "2026-11-02", to: "2026-11-06", label: "Vacances de Toussaint", kind: "holiday" as const, factor: 0.1 }] };
    expect(presenceFor(monday, { ...lunch, base: 20 }, s).presence).toBe(14);
    expect(periodFactor("2026-11-02", [...s.periods, { from: "2026-11-02", to: "2026-11-02", label: "Férié", kind: "public_holiday", factor: 0 }]).factor).toBe(0);
  });
  test("service d'un instant", () => {
    expect(serviceAt(new Date(2026, 10, 2, 12, 15), DEFAULT_SERVICES)?.key).toBe("lunch");
    expect(serviceAt(new Date(2026, 10, 2, 10, 0), DEFAULT_SERVICES)).toBeNull();
  });
});

describe("Consommation apprise et prévision", () => {
  // Du lundi 19 au lundi 26 octobre : 140 présents au déjeuner les lundis
  // (70 pastels vendus), les 20 résidents seuls les autres jours (10 pastels).
  const facts = [
    ...[new Date(2026, 9, 19, 12, 30), new Date(2026, 9, 26, 12, 30)].map(at => ({ at, itemId: "pastel", quantity: 70 })),
    ...[20, 21, 22, 23, 24, 25].map(d => ({ at: new Date(2026, 9, d, 12, 30), itemId: "pastel", quantity: 10 })),
  ];
  const { rates } = learnRates(facts, base, "2026-10-19", "2026-10-26");
  test("0,5 pastel par personne présente au déjeuner", () => {
    expect(rates.get("pastel|lunch")).toBeCloseTo(0.5, 5);
  });
  test("lundi : 140 présents → 70 × 1,10 = 77 pastels à préparer", () => {
    const f = forecastDay(monday, base, rates);
    expect(f.total.get("pastel")).toBe(77);
    expect(f.byService.find(b => b.service.key === "lunch")?.presence).toBe(140);
  });
  test("semaine de vacances : 8 pastels seulement", () => {
    const s = { ...base, periods: [{ from: "2026-11-02", to: "2026-11-06", label: "Vacances", kind: "holiday" as const, factor: 0.1 }] };
    expect(forecastDay(monday, s, rates).total.get("pastel")).toBe(8);
  });
  test("vente hors service rattachée au service le plus proche", () => {
    const r = learnRates([{ at: new Date(2026, 9, 19, 11, 0), itemId: "jus", quantity: 14 }], base, "2026-10-19", "2026-10-19").rates;
    expect(r.get("jus|lunch")).toBeCloseTo(0.1, 5);
  });
});

describe("Saisie de l'emploi du temps", () => {
  test("CSV : jours en lettres, « 8h00 », en-tête et lignes fausses", () => {
    const r = parseTimetableCsv("Jour;Début;Fin;Groupe;Effectif\nLundi;8h00;12:00;L1 Info;120\nmercredi;14:00;16:00;M1 Gestion;35\nvendredi;25:00;26:00;X;10");
    expect(r.courses).toEqual([
      { day: 1, from: "08:00", to: "12:00", group: "L1 Info", headcount: 120 },
      { day: 3, from: "14:00", to: "16:00", group: "M1 Gestion", headcount: 35 },
    ]);
    expect(r.errors.length).toBe(1);
  });
  test("contrôles", () => {
    expect(validateSchedule(base)).toBeNull();
    expect(validateSchedule({ ...base, courses: [{ day: 1, from: "10:00", to: "09:00", group: "X", headcount: 10 }] })).toMatch(/invalides/);
    expect(validateSchedule({ ...base, periods: [{ from: "2026-11-06", to: "2026-11-02", label: "V", kind: "holiday", factor: 0.1 }] })).toMatch(/Période/);
  });
});
