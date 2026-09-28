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

export interface RegistryColumns { name: number; matricule: number; school: number; number: number; email: number; phone: number; year: number }

/**
 * Détection des colonnes d'un fichier d'étudiants. Chaque colonne n'est
 * attribuée qu'une fois, des plus spécifiques aux plus générales : sans cela,
 * « Numéro étudiant » (le matricule) pouvait être pris pour le nom.
 */
export function detectColumns(headers: string[]): RegistryColumns {
  const used = new Set<number>();
  const pick = (...labels: string[]) => {
    const wanted = labels.map(normalizeText);
    for (const exact of [true, false]) {
      for (const w of wanted) {
        const i = headers.findIndex((h, idx) => !used.has(idx) && (exact ? h === w : h.includes(w)));
        if (i >= 0) { used.add(i); return i; }
      }
    }
    return -1;
  };
  const number = pick("numero isic", "n° isic", "no isic", "isic", "numero carte", "card number");
  const matricule = pick("matricule", "numero etudiant", "n° etudiant", "student id", "matric");
  const school = pick("etablissement", "universite", "ecole", "institution", "school");
  const email = pick("email", "e-mail", "courriel", "mail");
  const phone = pick("telephone", "portable", "phone", "tel");
  const year = pick("annee academique", "annee universitaire", "academic year", "annee", "year");
  const name = pick("nom complet", "nom et prenom", "nom & prenom", "nom", "name", "etudiant", "student");
  return { name, matricule, school, number, email, phone, year };
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
