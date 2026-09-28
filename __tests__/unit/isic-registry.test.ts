import {
  parseCsv, detectColumns, normalizeText, studentKey, normalizeIsicNumber, isPlausibleIsicNumber,
  academicYearOf, isAcademicYear, shiftAcademicYear, defaultValidUntil, decideNumber, coverageFor,
  normalizeNationality, parseDateLoose, isPlausibleBirthDate, checkForIsic, photoStem, photoFileName, cleanName,
  ISIC_SUBMISSION_HEADERS,
} from "@/lib/isic-registry";
import { readXlsx, buildSubmissionXlsx } from "@/lib/isic-xlsx";

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
    expect(detectColumns(headers)).toMatchObject({ matricule: 0, name: 1, school: 2, number: 3, phone: 4, email: -1, year: 5 });
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

describe("Registre ISIC — vos fichiers ISIC", () => {
  // En-têtes exacts de vos fichiers (aucune donnée d'étudiant).
  const SENT = [...ISIC_SUBMISSION_HEADERS];
  const RECEIVED = ["Card Type", "Card Number", "Full Cardholder's Name on the Card", "Card Issuer Name", "Company Identification Number",
    "Academic Institution Name", "Issued on", "Valid from", "Valid to", "Card Status", "Previous Valid to", "Pre-nominal Academic Degree",
    "First Name", "Last Name", "Post-nominal Academic Degree", "Date of Birth", "Birth Number", "Gender", "Personal ID", "Adress Line 1",
    "Adress Line 2", "City", "State/Province/County", "Postal Code", "Country", "E-mail", "Phone Number", "Class Name", "Grade",
    "Mifare Chip Number", "EM-Marine Chip Number", "Digital Card Part Number", "Plastic Card Part Number", "Plastic Card Issued On",
    "Plastic Card Valid to", "CI Distributor Name", "OO Affiliate Partner Name", "ESC Student ID (ESI)", "ESC card number (ESCN)", "Student Card Number"];
  const norm = (h: string[]) => h.map(normalizeText);

  it("reconnaît le fichier ENVOYÉ à ISIC (24 colonnes)", () => {
    const h = norm(SENT); const c = detectColumns(h);
    expect(h[c.matricule]).toBe("personal id");
    expect(h[c.firstName]).toBe("cardholder's first name");
    expect(h[c.lastName]).toBe("cardholder's last name");
    expect(h[c.school]).toBe("academic institution name");
    expect(h[c.className]).toBe("class name");
    expect(h[c.dateOfBirth]).toBe("date of birth");
    expect(h[c.number]).toBe("card number");
    expect(c.name).toBe(-1); // « Pre-nominal Academic Degree » n'est pas un nom
  });

  it("reconnaît le fichier REÇU d'ISIC (40 colonnes) sans confondre les colonnes voisines", () => {
    const h = norm(RECEIVED); const c = detectColumns(h);
    expect(h[c.number]).toBe("card number");          // pas « Student Card Number » ni « … Part Number »
    expect(h[c.validTo]).toBe("valid to");            // pas « Previous Valid to » ni « Plastic Card Valid to »
    expect(h[c.validFrom]).toBe("valid from");
    expect(h[c.cardStatus]).toBe("card status");
    expect(h[c.issuedOn]).toBe("issued on");
    expect(h[c.name]).toBe("full cardholder's name on the card");
    expect(h[c.firstName]).toBe("first name");
    expect(h[c.matricule]).toBe("personal id");
  });

  it("normalise les nationalités saisies dans vos fichiers", () => {
    for (const v of ["Nigerienne", "NIgerienne", "Nigérienne", "Nigereinne"]) expect(normalizeNationality(v)).toBe("Nigérienne");
    expect(normalizeNationality("Tchadienne")).toBe("Tchadienne");
    expect(normalizeNationality("nigeriane")).toBe("Nigériane");
    expect(normalizeNationality("")).toBe("");
  });

  it("lit les dates Excel et françaises, et repère les dates de naissance absurdes", () => {
    expect(parseDateLoose("2004-03-12")?.getFullYear()).toBe(2004);
    expect(parseDateLoose("12/03/2004")?.getMonth()).toBe(2);
    expect(parseDateLoose("n'importe quoi")).toBeNull();
    const now = new Date(2026, 8, 28);
    expect(isPlausibleBirthDate(new Date(2026, 7, 26), now)).toBe(false); // trouvée dans le fichier 2026-2027
    expect(isPlausibleBirthDate(new Date(1967, 6, 1), now)).toBe(true);   // doctorant
  });

  it("contrôles avant envoi : photo, date, nom séparé, e-mail, téléphone multiple", () => {
    const now = new Date(2026, 8, 28);
    const ok = checkForIsic({ firstName: "Awa", lastName: "Issa", matricule: "25161", schoolName: "UDH", email: "a@b.ne",
      dateOfBirth: new Date(1990, 0, 1), city: "Niamey", className: "Doctorant", hasPhoto: true, phone: "90000000" }, now);
    expect(ok).toEqual([]);
    const bad = checkForIsic({ fullName: "Awa Issa", matricule: "", schoolName: "", email: "pas-un-mail",
      dateOfBirth: new Date(2026, 7, 26), hasPhoto: false, phone: "90000000 / 91000000" }, now);
    const codes = bad.map(i => i.code);
    for (const c of ["personal_id", "name_split", "institution", "dob_implausible", "photo", "email_invalid", "phone_multiple"]) expect(codes).toContain(c);
  });

  it("associe les photos au Personal ID, même avec une double extension", () => {
    expect(photoStem("2025-2026-DOCTORANT/25175.jpg.jpeg")).toBe("25175");
    expect(photoStem("23397.JPG")).toBe("23397");
    expect(photoFileName("UMEF-2503-01")).toBe("UMEF-2503-01.jpg");
    expect(cleanName("  Amina   ")).toBe("Amina");
  });

  it("produit le fichier ISIC au format exact et le relit sans perte (aller-retour Excel)", async () => {
    const buf = await buildSubmissionXlsx([
      { requestType: "NEW_CARD", personalId: "25161", firstName: "Awa", lastName: "Issa", city: "Niamey", email: "a@b.ne",
        phone: "90000000", dateOfBirth: new Date(1990, 4, 17), className: "Doctorant Sciences Juridiques", institution: "UDH" },
    ]);
    const { headers, rows } = await readXlsx(buf);
    expect(headers).toEqual(norm(SENT));
    const c = detectColumns(headers);
    expect(rows[0][headers.indexOf("card type")]).toBe("ISIC");
    expect(rows[0][headers.indexOf("request type")]).toBe("NEW_CARD");
    expect(rows[0][c.matricule]).toBe("25161");          // pas « 25161.0 »
    expect(rows[0][c.dateOfBirth]).toBe("1990-05-17");   // pas de décalage de fuseau
    expect(rows[0][c.nationality]).toBe("");             // State/Province laissé vide (votre choix)
    expect(rows[0][c.school]).toBe("UDH");
  });
});
