import { parsePlanningItems, parseDays, parseSlots, planningToSchedule, type TextItem } from "@/lib/timetable-pdf";
import { presenceFor, DEFAULT_SERVICES } from "@/lib/campus";

// Planning fictif, même mise en page qu'un planning de semestre (colonnes
// Dates | Cours | Jour | Heures | Professeur), avec un intitulé sur deux
// lignes et une page dont le texte arrive colonne par colonne.
const row = (page: number, y: number, cells: Array<[number, string]>): TextItem[] => cells.map(([x, s]) => ({ s, x, y, page }));
const items: TextItem[] = [
  ...row(1, 459, [[53, "École :"], [98, "Test"]]),
  ...row(1, 423, [[53, "Programme :"], [136, "Bachelor en Exemple"]]),
  ...row(1, 406, [[53, "Planning valable du 05.10.2026 au 06.02.2027"]]),
  ...row(1, 387, [[53, "Année : Première – Semestre I"]]),
  ...row(1, 334, [[53, "Classe :"], [103, "Promotion 10-TEST-26"]]),
  ...row(1, 313, [[104, "Dates"], [243, "Cours"], [378, "Jour"], [514, "Heures"], [644, "Professeur"]]),
  ...row(1, 289, [[53, "05.10.2026 au 09.10.2026"], [191, "Accueil des nouveaux étudiants"], [334, "Lundi au vendredi"], [455, "08h30 à 10h30 et 11h00 à 12h30"]]),
  ...row(1, 270, [[191, "Introduction aux sciences"]]),
  ...row(1, 263, [[53, "12.10.2026 au 22.01.2027"], [334, "Lundi et jeudi"], [455, "08h30 à 10h30 et 11h00 à 12h30"], [620, "Dr. X. Exemple"]]),
  ...row(1, 255, [[191, "économiques"]]),
  ...row(1, 234, [[53, "12.10.2026 au 04.12.2026"], [191, "Anglais"], [334, "Lundi,mardi,jeudi et vendredi"], [455, "14h30 à 15h45 et 16h15 à 17h30"], [620, "M. Y. Exemple"]]),
  // Page 2 : colonne des dates d'abord, puis le reste.
  ...row(2, 522, [[53, "25.01.2027 au 29.01.2027"]]), ...row(2, 522, [[191, "Révision d'examens"]]),
  ...row(2, 500, [[53, "01.02.2027 au 05.02.2027"]]), ...row(2, 500, [[191, "Examens"]]),
  ...row(3, 313, [[72, "Remarques"], [179, "VHT"], [234, "Salle"]]),
  ...row(3, 263, [[53, "Avec une autre classe"], [163, "40H"], [229, "B010"]]),
];

describe("Lecture d'un planning de semestre en PDF", () => {
  const p = parsePlanningItems(items);
  test("en-tête : classe, programme, première année, validité", () => {
    expect(p.className).toBe("Promotion 10-TEST-26");
    expect(p.program).toBe("Bachelor en Exemple");
    expect(p.firstYear).toBe(true);
    expect([p.validFrom, p.validTo]).toEqual(["2026-10-05", "2027-02-06"]);
  });
  test("lignes : intitulé sur deux lignes, jours et heures, sans le professeur", () => {
    expect(p.entries.map(e => e.course)).toEqual(["Accueil des nouveaux étudiants", "Introduction aux sciences économiques", "Anglais", "Révision d'examens", "Examens"]);
    expect(p.entries[1]).toMatchObject({ from: "2026-10-12", to: "2027-01-22", days: [1, 4], kind: "course" });
    expect(p.entries[2].days).toEqual([1, 2, 4, 5]);
    expect(p.entries[3].kind).toBe("revision");
    expect(p.entries[4].kind).toBe("exams");
    expect(p.warnings).toEqual([]);
  });
  test("pauses détectées entre deux plages", () => {
    expect(p.breaks).toEqual([{ from: "10:30", to: "11:00" }, { from: "15:45", to: "16:15" }]);
  });
  test("jours et heures", () => {
    expect(parseDays("Lundi au vendredi")).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("Mercredi et vendredi")).toEqual([3, 5]);
    expect(parseSlots("14h30 à 15h45 et 16h15 à 17h30")).toEqual([{ from: "14:30", to: "15:45" }, { from: "16:15", to: "17:30" }]);
  });
});

describe("Du planning à l'emploi du temps", () => {
  const s = planningToSchedule(parsePlanningItems(items), "1re année Test", 150);
  test("une demi-journée = un bloc ; révision et examens en périodes", () => {
    const intro = s.courses.filter(c => c.label === "Introduction aux sciences économiques");
    expect(intro).toHaveLength(2);
    expect(intro[0]).toMatchObject({ day: 1, from: "08:30", to: "12:30", start: "2026-10-12", end: "2027-01-22", headcount: 150 });
    expect(s.periods.map(p => p.label)).toEqual(["Révision d'examens", "Examens"]);
  });
  test("présence au déjeuner : cours, vacances déclarées, examens, révision, après le semestre", () => {
    // Le planning n'écrit pas les vacances (un cours court du 12.10 au 22.01) : on les déclare.
    const noel = { from: "2026-12-25", to: "2027-01-03", label: "Vacances de fin d'année", kind: "holiday" as const, factor: 0 };
    const sched = { services: DEFAULT_SERVICES, courses: s.courses, periods: [...s.periods, noel] };
    const lunch = DEFAULT_SERVICES[1];
    expect(presenceFor(new Date(2026, 9, 19, 12), lunch, sched).presence).toBe(150);
    expect(presenceFor(new Date(2026, 11, 28, 12), lunch, sched).presence).toBe(0);
    expect(presenceFor(new Date(2027, 1, 15, 12), lunch, sched).presence).toBe(0);     // semestre terminé
    expect(presenceFor(new Date(2027, 1, 1, 12), lunch, sched).presence).toBe(150);
    expect(presenceFor(new Date(2027, 0, 25, 12), lunch, sched).presence).toBe(90);   // révision : × 0,6
  });
});
