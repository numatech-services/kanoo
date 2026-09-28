import {
  parseCsv, detectColumns, normalizeText, studentKey, normalizeIsicNumber, isPlausibleIsicNumber,
  academicYearOf, isAcademicYear, shiftAcademicYear, defaultValidUntil, decideNumber, coverageFor,
} from "@/lib/isic-registry";

describe("Registre ISIC — lecture CSV", () => {
  it("gère le « ; » d'Excel FR, le BOM, les guillemets et les virgules dans un champ", () => {
    const { headers, rows } = parseCsv('﻿Nom;Matricule;Établissement\r\n"Dupont, Jean";M-01;UAM\r\n"Awa ""la grande""";M-02;UAM\r\n\r\n');
    expect(headers).toEqual(["nom", "matricule", "etablissement"]);
    expect(rows).toEqual([["Dupont, Jean", "M-01", "UAM"], ['Awa "la grande"', "M-02", "UAM"]]);
  });

  it("accepte aussi la virgule comme séparateur", () => {
    const { rows } = parseCsv("nom,matricule\nIbrahim Moussa,A12\n");
    expect(rows).toEqual([["Ibrahim Moussa", "A12"]]);
  });

  it("détecte les colonnes sans confondre « Numéro étudiant » et le nom", () => {
    const { headers } = parseCsv("Numéro étudiant;Nom de l'étudiant;Université;N° ISIC;Téléphone;Année académique\n");
    expect(detectColumns(headers)).toEqual({ matricule: 0, name: 1, school: 2, number: 3, phone: 4, email: -1, year: 5 });
  });
});

describe("Registre ISIC — doublons et numéros", () => {
  it("un même étudiant a la même clé malgré accents, casse et espaces", () => {
    expect(studentKey("Université  Abdou Moumouni", "m 01", "X")).toBe(studentKey("universite abdou moumouni", "M01", "Y"));
    expect(studentKey("UAM", "M01", "A")).not.toBe(studentKey("ENS", "M01", "A"));
    expect(studentKey("UAM", "", "Awa Issa")).toBe("uam|n:awa issa");
    // Variantes de saisie d'un même matricule (bug trouvé en test de bout en bout).
    expect(studentKey("Université Abdou Moumouni", "UAM-001", "A")).toBe(studentKey("universite abdou moumouni", "uam 001", "B"));
    expect(studentKey("UAM", "2021/001", "A")).toBe(studentKey("UAM", "2021.001", "B"));
  });

  it("normalise le numéro : espaces et tirets ne contournent pas l'unicité", () => {
    expect(normalizeIsicNumber("s 123-456 789 012 a")).toBe("S123456789012A");
    expect(isPlausibleIsicNumber("S123456789012A")).toBe(true);
    expect(isPlausibleIsicNumber("12")).toBe(false);
    expect(normalizeText("  ÉCOLE   Normale ")).toBe("ecole normale");
  });

  it("ne remplace jamais un numéro en silence et refuse un numéro déjà pris", () => {
    expect(decideNumber(undefined, "S123456789", null, "a").kind).toBe("assign");
    expect(decideNumber("S123456789", "s 123 456 789", null, "a").kind).toBe("same");
    expect(decideNumber("S123456789", "S999999999", null, "a").kind).toBe("conflict-change");
    expect(decideNumber(undefined, "S123456789", "b", "a").kind).toBe("conflict-owner");
    expect(decideNumber(undefined, "S123456789", "a", "a").kind).toBe("assign");
    expect(decideNumber(undefined, "??", null, "a").kind).toBe("invalid");
  });
});

describe("Registre ISIC — années et licences", () => {
  it("bascule d'année académique en septembre", () => {
    expect(academicYearOf(new Date(2026, 7, 31))).toBe("2025-2026");
    expect(academicYearOf(new Date(2026, 8, 1))).toBe("2026-2027");
    expect(isAcademicYear("2025-2026")).toBe(true);
    expect(isAcademicYear("2025-2027")).toBe(false);
    expect(shiftAcademicYear("2025-2026", -1)).toBe("2024-2025");
    expect(defaultValidUntil("2025-2026").getFullYear()).toBe(2026);
    expect(defaultValidUntil("2025-2026").getMonth()).toBe(11);
  });

  it("compte couverts, nouveaux, renouvelés et à renouveler", () => {
    const c = coverageFor("2025-2026", [
      { studentId: "new", years: ["2025-2026"] },
      { studentId: "renewed", years: ["2024-2025", "2025-2026"] },
      { studentId: "back", years: ["2022-2023", "2025-2026"] },
      { studentId: "torenew", years: ["2024-2025"] },
      { studentId: "old", years: ["2020-2021"] },
      { studentId: "none", years: [] },
    ]);
    expect(c).toEqual({ covered: 3, fresh: 1, renewed: 1, toRenew: 1 });
  });
});
