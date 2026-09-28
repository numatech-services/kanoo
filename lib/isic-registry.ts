/**
 * Registre ISIC — règles pures (sans base), testées unitairement.
 *
 * Organisation retenue :
 *  - un ÉTUDIANT a une fiche unique (tous lots et toutes années confondus) ;
 *  - son NUMÉRO ISIC lui est renvoyé par ISIC et le suit d'une année sur l'autre
 *    (renouvellement = même numéro) ; un numéro n'appartient qu'à un étudiant ;
 *  - une LICENCE est le droit annuel d'un étudiant : une par année académique.
 */

// ── Lecture CSV ─────────────────────────────────────────────────────────────

/**
 * CSV robuste : BOM, séparateur `;` (Excel FR), `,` ou tabulation, champs entre
 * guillemets contenant séparateurs, guillemets doublés ou retours à la ligne.
 * L'ancien parseur coupait « Dupont, Jean » en deux colonnes.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => (firstLine.match(new RegExp(c === "\t" ? "\t" : `\\${c}`, "g")) || []).length;
  const delim = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];

  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) { row.push(field.trim()); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (row.some(c => c !== "")) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some(c => c !== "")) out.push(row);
  if (out.length === 0) return { headers: [], rows: [] };
  return { headers: out[0].map(h => normalizeText(h)), rows: out.slice(1) };
}

/** Index de la première colonne dont l'en-tête (normalisé) contient l'un des libellés. */
export function findColumn(headers: string[], ...labels: string[]): number {
  const wanted = labels.map(normalizeText);
  for (const w of wanted) {
    const i = headers.findIndex(h => h === w);
    if (i >= 0) return i;
  }
  return headers.findIndex(h => wanted.some(w => h.includes(w)));
}

export interface RegistryColumns {
  name: number; firstName: number; lastName: number; matricule: number; school: number; number: number;
  email: number; phone: number; year: number; dateOfBirth: number; city: number; className: number;
  nationality: number; validFrom: number; validTo: number; cardStatus: number; issuedOn: number;
}

/**
 * Détection des colonnes d'un fichier d'étudiants : nos modèles français ET les
 * deux fichiers ISIC (envoi à 24 colonnes, retour à 40 colonnes). Chaque
 * colonne n'est attribuée qu'une fois, des plus spécifiques aux plus générales :
 * sans cela, « Numéro étudiant » (le matricule) pouvait être pris pour le nom,
 * ou « Pre-nominal Academic Degree » pour « nom ».
 */
export function detectColumns(headers: string[]): RegistryColumns {
  const used = new Set<number>();
  const pick = (labels: string[], opts: { exactOnly?: boolean; reject?: RegExp } = {}) => {
    const wanted = labels.map(normalizeText);
    for (const exact of opts.exactOnly ? [true] : [true, false]) {
      for (const w of wanted) {
        const i = headers.findIndex((h, idx) => !used.has(idx) && !(opts.reject?.test(h)) && (exact ? h === w : h.includes(w)));
        if (i >= 0) { used.add(i); return i; }
      }
    }
    return -1;
  };
  const validFrom = pick(["valid from", "valide du", "debut de validite"], { reject: /previous|plastic/ });
  const validTo = pick(["valid to", "valide jusqu'au", "fin de validite"], { reject: /previous|plastic/ });
  const issuedOn = pick(["issued on", "emise le", "date d'emission"], { reject: /plastic/ });
  const cardStatus = pick(["card status", "statut carte"]);
  const number = pick(["card number", "numero isic", "n° isic", "no isic", "isic", "numero carte"], { reject: /student card|part number|chip|escn/ });
  const matricule = pick(["personal id", "matricule", "numero etudiant", "n° etudiant", "student id", "matric"]);
  const school = pick(["academic institution name", "etablissement", "universite", "ecole", "institution", "school"]);
  const className = pick(["class name", "filiere", "classe", "niveau", "departement"]);
  const firstName = pick(["cardholder's first name", "first name", "prenom", "prenoms"]);
  const lastName = pick(["cardholder's last name", "last name", "nom de famille"]);
  const dateOfBirth = pick(["date of birth", "date de naissance", "naissance", "dob"]);
  const email = pick(["e-mail", "email", "courriel", "mail"]);
  const phone = pick(["phone number", "telephone", "portable", "phone", "tel"]);
  const city = pick(["city", "ville"]);
  // Dans vos fichiers, la nationalité était saisie dans « State/Province/County ».
  const nationality = pick(["nationalite", "nationality", "state/province/county"]);
  const year = pick(["annee academique", "annee universitaire", "academic year", "annee", "year"]);
  const name = firstName >= 0 && lastName >= 0
    ? pick(["full cardholder's name on the card", "nom complet"], { exactOnly: true })
    : pick(["full cardholder's name on the card", "nom complet", "nom et prenom", "nom & prenom", "nom", "name", "etudiant", "student"],
      { reject: /degree|institution|issuer|class|partner|distributor|company/ });
  return { name, firstName, lastName, matricule, school, number, email, phone, year, dateOfBirth, city, className, nationality, validFrom, validTo, cardStatus, issuedOn };
}

/** Nom propre : espaces en trop retirés (9 prénoms en finissaient par une dans le fichier UMEF). */
export function cleanName(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

const NATIONALITIES: Array<[RegExp, string]> = [
  [/^nigeria/, "Nigériane"], [/^niger/, "Nigérienne"], [/^tchad/, "Tchadienne"], [/^mali/, "Malienne"],
  [/^burkin/, "Burkinabè"], [/^benin/, "Béninoise"], [/^senegal/, "Sénégalaise"], [/^togo/, "Togolaise"],
  [/^ivoir|^cote d.?ivoire/, "Ivoirienne"], [/^camer/, "Camerounaise"], [/^guine/, "Guinéenne"],
  [/^mauritan/, "Mauritanienne"], [/^alger/, "Algérienne"], [/^maroc/, "Marocaine"], [/^libye|^libyen/, "Libyenne"],
  [/^ghan/, "Ghanéenne"], [/^franc/, "Française"],
];

/** « NIgerienne », « Nigereinne », « nigérienne » → « Nigérienne ». */
export function normalizeNationality(s: unknown): string {
  const t = normalizeText(s);
  if (!t) return "";
  for (const [rx, label] of NATIONALITIES) if (rx.test(t)) return label;
  const c = cleanName(s);
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

/**
 * Date lue d'un fichier : ISO (« 2004-03-12 », ce que produit la lecture Excel)
 * ou française (« 12/03/2004 »). Renvoie null si illisible.
 */
export function parseDateLoose(s: unknown): Date | null {
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  const t = String(s ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/** Date de naissance plausible pour un étudiant : entre 14 et 90 ans. */
export function isPlausibleBirthDate(d: Date | null | undefined, now: Date = new Date()): boolean {
  if (!d) return false;
  const age = (now.getTime() - d.getTime()) / (365.25 * 86_400_000);
  return age >= 14 && age <= 90;
}

// ── Normalisation & doublons ────────────────────────────────────────────────

/** Minuscules, sans accents, espaces réduits : « École  Normale » = « ecole normale ». */
export function normalizeText(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Clé d'unicité d'un étudiant dans l'organisation : même établissement + même
 * matricule. Sans matricule, on se rabat sur le nom (moins sûr, mais évite de
 * créer deux fiches à chaque réimport d'une même liste).
 */
/**
 * Forme canonique d'un matricule : « UAM-001 », « uam 001 » et « UAM.001 » sont
 * le même étudiant. Sans cela, un simple tiret suffisait à créer un doublon.
 */
export function normalizeMatricule(m: unknown): string {
  return normalizeText(m).replace(/[\s\-_./]/g, "");
}

export function studentKey(schoolName: string, matricule: string | undefined, fullName: string): string {
  const school = normalizeText(schoolName) || "-";
  const mat = normalizeMatricule(matricule);
  return mat ? `${school}|m:${mat}` : `${school}|n:${normalizeText(fullName)}`;
}

/**
 * Forme canonique d'un numéro ISIC : majuscules, sans espaces ni tirets.
 * « s 123-456 789 012 a » et « S123456789012A » sont le même numéro — sans
 * cette normalisation, l'unicité serait contournée par une simple espace.
 */
export function normalizeIsicNumber(n: unknown): string {
  return String(n ?? "").toUpperCase().replace(/[\s\-_.]/g, "");
}

/** Contrôle de forme minimal : alphanumérique, 6 à 20 caractères. */
export function isPlausibleIsicNumber(n: string): boolean {
  return /^[A-Z0-9]{6,20}$/.test(n);
}

// ── Années académiques ──────────────────────────────────────────────────────

/** Année académique d'une date : à partir de septembre, on passe à l'année suivante. */
export function academicYearOf(d: Date = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 8 ? y : y - 1;
  return `${start}-${start + 1}`;
}

export function isAcademicYear(s: unknown): s is string {
  const m = /^(\d{4})-(\d{4})$/.exec(String(s ?? ""));
  return !!m && Number(m[2]) === Number(m[1]) + 1;
}

export function shiftAcademicYear(year: string, delta: number): string {
  const start = Number(year.slice(0, 4)) + delta;
  return `${start}-${start + 1}`;
}

/**
 * Fin de validité par défaut d'une licence : 31 décembre de la seconde année
 * (une carte ISIC émise à la rentrée couvre l'année scolaire et le semestre
 * suivant). Modifiable licence par licence.
 */
export function defaultValidUntil(year: string): Date {
  return new Date(Number(year.slice(5, 9)), 11, 31, 23, 59, 59);
}

// ── Attribution des numéros ─────────────────────────────────────────────────

export type NumberDecision =
  | { kind: "assign" }            // l'étudiant n'avait pas de numéro : on l'attribue
  | { kind: "same" }              // déjà ce numéro : rien à faire
  | { kind: "conflict-owner" }    // numéro déjà porté par un AUTRE étudiant : refus
  | { kind: "conflict-change" }   // l'étudiant a déjà un AUTRE numéro : refus (changement explicite requis)
  | { kind: "invalid" };

/**
 * Règle d'attribution à l'import (retour ISIC, reprise) : on ne remplace jamais
 * silencieusement un numéro, et un numéro ne peut pas passer d'un étudiant à un
 * autre par un fichier. Les cas refusés remontent dans le rapport d'import ; un
 * changement volontaire se fait sur la fiche, avec un motif (carte perdue…).
 */
export function decideNumber(
  current: string | undefined | null,
  incoming: string,
  ownerOfIncoming: string | null,
  studentId: string | null,
): NumberDecision {
  const n = normalizeIsicNumber(incoming);
  if (!isPlausibleIsicNumber(n)) return { kind: "invalid" };
  if (ownerOfIncoming && ownerOfIncoming !== studentId) return { kind: "conflict-owner" };
  const cur = normalizeIsicNumber(current);
  if (!cur) return { kind: "assign" };
  return cur === n ? { kind: "same" } : { kind: "conflict-change" };
}

// ── Indicateurs ─────────────────────────────────────────────────────────────

export interface CoverageInput { studentId: string; years: string[] }

/**
 * Pour une année N : couverts, nouveaux (première licence en N), renouvelés
 * (licence en N et en N-1) et à renouveler (licence en N-1 mais pas en N).
 */
export function coverageFor(year: string, students: CoverageInput[]) {
  const prev = shiftAcademicYear(year, -1);
  let covered = 0, fresh = 0, renewed = 0, toRenew = 0;
  for (const s of students) {
    const has = s.years.includes(year);
    const hadPrev = s.years.includes(prev);
    if (has) {
      covered++;
      if (hadPrev) renewed++;
      else if (!s.years.some(y => y < year)) fresh++;
    } else if (hadPrev) toRenew++;
  }
  return { covered, fresh, renewed, toRenew };
}

// ── Fichier d'envoi à ISIC ──────────────────────────────────────────────────

/** Les 24 colonnes du modèle d'import ISIC, dans l'ordre exact de vos fichiers. */
export const ISIC_SUBMISSION_HEADERS = [
  "Card Type", "Request Type", "Valid from", "Valid to", "Personal ID", "Pre-nominal Academic Degree",
  "Cardholder's First Name", "Cardholder's Last Name", "Country Code", "Address Line 1", "Address Line 2",
  "City", "State/Province/County", "Postal Code", "E-mail", "Phone Number", "Date of Birth", "Birth Number",
  "Class Name", "Academic Institution Name", "Card number", "Photo Filename", "Marketing Consent", "Student Card Number",
] as const;

export interface IsicCheckInput {
  firstName?: string; lastName?: string; fullName?: string; matricule?: string; schoolName?: string;
  email?: string; phone?: string; dateOfBirth?: Date | string | null; city?: string; className?: string;
  hasPhoto?: boolean; isicNumber?: string;
}
export interface IsicIssue { level: "error" | "warning"; code: string; message: string }

/**
 * Contrôles avant envoi à ISIC. Chacun correspond à un défaut trouvé dans vos
 * fichiers réels : 11 doctorants sans photo, une date de naissance en 2026,
 * établissement vide, prénoms avec espaces, deux téléphones dans une case.
 * « error » = la carte sera refusée ou fausse ; « warning » = à vérifier.
 */
export function checkForIsic(s: IsicCheckInput, now: Date = new Date()): IsicIssue[] {
  const out: IsicIssue[] = [];
  const err = (code: string, message: string) => out.push({ level: "error", code, message });
  const warn = (code: string, message: string) => out.push({ level: "warning", code, message });
  if (!cleanName(s.matricule)) err("personal_id", "Personal ID (matricule) manquant");
  if (!cleanName(s.firstName) || !cleanName(s.lastName)) err("name_split", "Prénom et nom à séparer (ISIC les demande dans deux colonnes)");
  if (!cleanName(s.schoolName)) err("institution", "Établissement manquant");
  const dob = s.dateOfBirth ? parseDateLoose(s.dateOfBirth) : null;
  if (!dob) err("dob_missing", "Date de naissance manquante");
  else if (!isPlausibleBirthDate(dob, now)) err("dob_implausible", `Date de naissance improbable (${dob.toLocaleDateString("fr-FR")})`);
  if (!s.hasPhoto) err("photo", "Photo manquante");
  if (!s.email) warn("email_missing", "E-mail manquant");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.email)) err("email_invalid", `E-mail invalide (${s.email})`);
  if (!cleanName(s.className)) warn("class", "Filière (Class Name) manquante");
  if (!cleanName(s.city)) warn("city", "Ville manquante");
  if (s.phone && /[/;,]| et /i.test(s.phone)) warn("phone_multiple", "Plusieurs numéros de téléphone dans la même case");
  return out;
}

/** « 12345 », « UMEF-2503-01 » → nom de photo attendu par ISIC. */
export function photoFileName(matricule: string): string {
  return `${String(matricule).trim().replace(/[^A-Za-z0-9._-]/g, "_")}.jpg`;
}

/** Nom de photo « 25175.jpg.jpeg » → identifiant « 25175 ». */
export function photoStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  return base.split(".")[0].trim();
}
