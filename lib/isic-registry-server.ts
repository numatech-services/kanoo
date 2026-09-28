import { Types } from "mongoose";
import { tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicLicenseModel } from "@/models/IsicLicense";
import {
  studentKey, normalizeIsicNumber, normalizeMatricule, decideNumber, isAcademicYear, defaultValidUntil,
} from "@/lib/isic-registry";

/**
 * Les unicités (étudiant, numéro) reposent sur des index : juste après un
 * déploiement, on attend leur construction avant la première écriture, sinon
 * deux imports simultanés pourraient passer avant que la contrainte existe.
 */
let indexesReady: Promise<unknown> | null = null;
export function ensureRegistryIndexes() {
  indexesReady ??= Promise.all([IsicStudentModel.init(), IsicLicenseModel.init()]).catch(err => {
    indexesReady = null;
    throw err;
  });
  return indexesReady;
}

export interface RegistryEntry {
  line: number;
  fullName: string;
  matricule?: string;
  schoolName: string;
  schoolId?: string;
  email?: string;
  phone?: string;
  number?: string;
  academicYear?: string;
}

export interface RegistryReport {
  rows: number;
  created: number;
  updated: number;
  numbersAssigned: number;
  licencesCreated: number;
  conflicts: Array<{ line: number; name: string; reason: string }>;
  skipped: Array<{ line: number; reason: string }>;
}

export interface RegistryOutcome {
  report: RegistryReport;
  /** Pour chaque ligne traitée : fiche et numéro final (utile à la synchro des lots). */
  byLine: Map<number, { studentId: string; number?: string }>;
}

interface Known { _id: string; isicNumber?: string; fullName: string }

/**
 * Applique une liste d'entrées au registre : crée ou complète les fiches,
 * attribue les numéros selon `decideNumber` (jamais d'écrasement silencieux,
 * jamais un numéro pour deux étudiants) et ouvre les licences annuelles.
 *
 * `numbersOnly` : fichier retour d'ISIC — on ne crée pas d'étudiant inconnu.
 */
export async function applyRegistryEntries(
  auth: TokenPayload,
  entries: RegistryEntry[],
  opts: { numberSource: "reprise" | "isic" | "manuel"; licenceSource: "reprise" | "lot" | "manuel"; batchId?: string; numbersOnly?: boolean },
): Promise<RegistryOutcome> {
  await ensureRegistryIndexes();
  const tf = tenantFilter(auth);
  const report: RegistryReport = { rows: entries.length, created: 0, updated: 0, numbersAssigned: 0, licencesCreated: 0, conflicts: [], skipped: [] };
  const byLine = new Map<number, { studentId: string; number?: string }>();

  // Préchargement : clé étudiant → fiche, numéro → propriétaire.
  const existing = await IsicStudentModel.find(tf).select("_id dedupKey isicNumber fullName matricule")
    .lean<Array<{ _id: Types.ObjectId; dedupKey: string; isicNumber?: string; fullName: string; matricule?: string }>>();
  const byKey = new Map<string, Known>();
  const byNumber = new Map<string, string>();
  // Pour le fichier retour d'ISIC sans colonne établissement : matricule seul,
  // accepté uniquement s'il est non ambigu dans l'organisation.
  const byMatricule = new Map<string, string[]>();
  for (const s of existing) {
    const k: Known = { _id: String(s._id), isicNumber: s.isicNumber, fullName: s.fullName };
    byKey.set(s.dedupKey, k);
    if (s.isicNumber) byNumber.set(s.isicNumber, k._id);
    const m = normalizeMatricule(s.matricule);
    if (m) byMatricule.set(m, [...(byMatricule.get(m) ?? []), s.dedupKey]);
  }

  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }> = [];
  const licenceKeys = new Set<string>();
  const licences: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: true } }> = [];
  const now = new Date();

  for (const e of entries) {
    const fullName = (e.fullName || "").trim().slice(0, 200);
    let key = studentKey(e.schoolName, e.matricule, fullName);
    let known = byKey.get(key);

    if (!known && opts.numbersOnly && !e.schoolName && e.matricule) {
      const hits = byMatricule.get(normalizeMatricule(e.matricule)) ?? [];
      if (hits.length === 1) { key = hits[0]; known = byKey.get(key); }
      else if (hits.length > 1) { report.conflicts.push({ line: e.line, name: e.matricule, reason: "Matricule présent dans plusieurs établissements : précisez l'établissement." }); continue; }
    }

    if (!known) {
      if (opts.numbersOnly) { report.skipped.push({ line: e.line, reason: `Étudiant introuvable (${e.matricule || fullName}).` }); continue; }
      if (!fullName) { report.skipped.push({ line: e.line, reason: "Nom manquant." }); continue; }
      if (!e.schoolName) { report.skipped.push({ line: e.line, reason: "Établissement manquant." }); continue; }
      const id = new Types.ObjectId();
      known = { _id: String(id), fullName };
      byKey.set(key, known);
      inserts.push({
        _id: id, tenantId: auth.tenantId, fullName, matricule: e.matricule?.trim().slice(0, 60) || undefined,
        schoolName: e.schoolName.trim().slice(0, 200), schoolId: e.schoolId && Types.ObjectId.isValid(e.schoolId) ? e.schoolId : undefined,
        dedupKey: key, email: e.email?.trim().slice(0, 200) || undefined, phone: e.phone?.trim().slice(0, 40) || undefined,
        numberHistory: [], archived: false, createdBy: auth.userId,
      });
      report.created++;
    } else if (!opts.numbersOnly && (e.email || e.phone)) {
      // Complète les coordonnées sans écraser celles déjà saisies.
      const set: Record<string, unknown> = {};
      if (e.email) set.email = e.email.trim().slice(0, 200);
      if (e.phone) set.phone = e.phone.trim().slice(0, 40);
      updates.push({ updateOne: { filter: { _id: known._id, ...tf }, update: { $set: set } } });
      report.updated++;
    }

    // Numéro
    if (e.number && e.number.trim()) {
      const decision = decideNumber(known.isicNumber, e.number, byNumber.get(normalizeIsicNumber(e.number)) ?? null, known._id);
      const n = normalizeIsicNumber(e.number);
      if (decision.kind === "assign") {
        const newlyCreated = inserts.find(d => String(d._id) === known!._id);
        const hist = { number: n, at: now, by: auth.userId, reason: opts.numberSource === "reprise" ? "Reprise de l'existant" : "Numéro renvoyé par ISIC" };
        if (newlyCreated) Object.assign(newlyCreated, { isicNumber: n, numberSource: opts.numberSource, numberAssignedAt: now, numberHistory: [hist] });
        else updates.push({ updateOne: {
          filter: { _id: known._id, ...tf, $or: [{ isicNumber: { $exists: false } }, { isicNumber: null }, { isicNumber: "" }] },
          update: { $set: { isicNumber: n, numberSource: opts.numberSource, numberAssignedAt: now }, $push: { numberHistory: hist } },
        } });
        known.isicNumber = n;
        byNumber.set(n, known._id);
        report.numbersAssigned++;
      } else if (decision.kind === "conflict-owner") {
        report.conflicts.push({ line: e.line, name: fullName || e.matricule || "", reason: `Le numéro ${n} appartient déjà à un autre étudiant.` });
      } else if (decision.kind === "conflict-change") {
        report.conflicts.push({ line: e.line, name: fullName || e.matricule || "", reason: `A déjà le numéro ${known.isicNumber} (fichier : ${n}). Changement à faire sur la fiche, avec un motif.` });
      } else if (decision.kind === "invalid") {
        report.conflicts.push({ line: e.line, name: fullName || e.matricule || "", reason: `Numéro « ${e.number} » invalide.` });
      }
    }

    // Licence annuelle
    if (e.academicYear) {
      if (!isAcademicYear(e.academicYear)) report.skipped.push({ line: e.line, reason: `Année « ${e.academicYear} » invalide (format 2025-2026).` });
      else {
        const lk = `${known._id}|${e.academicYear}`;
        if (!licenceKeys.has(lk)) {
          licenceKeys.add(lk);
          licences.push({ updateOne: {
            filter: { tenantId: auth.tenantId, studentId: known._id, academicYear: e.academicYear },
            update: { $setOnInsert: {
              tenantId: auth.tenantId, studentId: known._id, academicYear: e.academicYear,
              validUntil: defaultValidUntil(e.academicYear), source: opts.licenceSource,
              batchId: opts.batchId, status: "active", createdBy: auth.userId,
            } },
            upsert: true,
          } });
        }
      }
    }
    byLine.set(e.line, { studentId: known._id, number: known.isicNumber });
  }

  if (inserts.length) await IsicStudentModel.insertMany(inserts, { ordered: false });
  if (updates.length) await IsicStudentModel.bulkWrite(updates, { ordered: false });
  if (licences.length) {
    const r = await IsicLicenseModel.bulkWrite(licences, { ordered: false });
    report.licencesCreated = r.upsertedCount;
  }
  return { report, byLine };
}

/** Rows CSV → entrées de registre, d'après les en-têtes reconnus. */
export function entriesFromCsv(
  headers: string[], rows: string[][],
  cols: { name: number; matricule: number; school: number; number: number; email: number; phone: number; year: number },
  defaults: { schoolName?: string; academicYear?: string },
): RegistryEntry[] {
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return rows.slice(0, 20000).map((r, idx) => ({
    line: idx + 2, // +1 en-tête, +1 base 1 : numéro de ligne tel que vu dans Excel
    fullName: at(r, cols.name),
    matricule: at(r, cols.matricule) || undefined,
    schoolName: at(r, cols.school) || defaults.schoolName || "",
    email: at(r, cols.email) || undefined,
    phone: at(r, cols.phone) || undefined,
    number: at(r, cols.number) || undefined,
    academicYear: at(r, cols.year) || defaults.academicYear || undefined,
  }));
}
