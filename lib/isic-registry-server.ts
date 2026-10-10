import { Types } from "mongoose";
import { tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicLicenseModel } from "@/models/IsicLicense";
import { IsicPhotoModel } from "@/models/IsicPhoto";
import { IsicCardModel } from "@/models/IsicCard";
import {
  studentKey, normalizeIsicNumber, normalizeMatricule, decideNumber, isAcademicYear, defaultValidUntil,
  cleanName, normalizeNationality, parseDateLoose, academicYearOf, type RegistryColumns,
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
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  city?: string;
  className?: string;
  nationality?: string;
  /** Validité et statut renvoyés par ISIC (fichier retour). */
  validFrom?: string;
  validTo?: string;
  cardStatus?: string;
  issuedOn?: string;
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

interface Known { _id: string; isicNumber?: string; fullName: string; firstName?: string; lastName?: string; dateOfBirth?: Date }

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
  const existing = await IsicStudentModel.find(tf).select("_id dedupKey isicNumber fullName matricule firstName lastName dateOfBirth")
    .lean<Array<{ _id: Types.ObjectId; dedupKey: string; isicNumber?: string; fullName: string; matricule?: string; firstName?: string; lastName?: string; dateOfBirth?: Date }>>();
  const byKey = new Map<string, Known>();
  const byNumber = new Map<string, string>();
  // Pour le fichier retour d'ISIC sans colonne établissement : matricule seul,
  // accepté uniquement s'il est non ambigu dans l'organisation.
  const byMatricule = new Map<string, string[]>();
  for (const s of existing) {
    const k: Known = { _id: String(s._id), isicNumber: s.isicNumber, fullName: s.fullName, firstName: s.firstName, lastName: s.lastName, dateOfBirth: s.dateOfBirth };
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
    const firstName = cleanName(e.firstName).slice(0, 120);
    const lastName = cleanName(e.lastName).slice(0, 120);
    const fullName = (cleanName(e.fullName) || cleanName(`${firstName} ${lastName}`)).slice(0, 200);
    const dob = parseDateLoose(e.dateOfBirth);
    const profile: Record<string, unknown> = {};
    if (e.city) profile.city = cleanName(e.city).slice(0, 120);
    if (e.className) profile.className = cleanName(e.className).slice(0, 160);
    if (e.nationality && normalizeNationality(e.nationality)) profile.nationality = normalizeNationality(e.nationality);
    if (e.cardStatus) profile.cardStatus = cleanName(e.cardStatus).slice(0, 40);
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
        dedupKey: key, email: e.email?.trim().toLowerCase().slice(0, 200) || undefined, phone: cleanName(e.phone).slice(0, 60) || undefined,
        firstName: firstName || undefined, lastName: lastName || undefined, dateOfBirth: dob ?? undefined, ...profile,
        numberHistory: [], archived: false, hasPhoto: false, createdBy: auth.userId,
      });
      report.created++;
    } else {
      // Fiche existante : on met à jour les coordonnées et le profil fournis par
      // le fichier, et on complète l'identité seulement si elle manquait (un
      // fichier ne renomme pas un étudiant en silence).
      const set: Record<string, unknown> = { ...profile };
      if (!opts.numbersOnly) {
        if (e.email) set.email = e.email.trim().toLowerCase().slice(0, 200);
        if (e.phone) set.phone = cleanName(e.phone).slice(0, 60);
      }
      if (firstName && !known.firstName) { set.firstName = firstName; known.firstName = firstName; }
      if (lastName && !known.lastName) { set.lastName = lastName; known.lastName = lastName; }
      if (dob && !known.dateOfBirth) { set.dateOfBirth = dob; known.dateOfBirth = dob; }
      const fresh = inserts.find(d => String(d._id) === known!._id);
      if (fresh) Object.assign(fresh, set);
      else if (Object.keys(set).length) {
        updates.push({ updateOne: { filter: { _id: known._id, ...tf }, update: { $set: set } } });
        report.updated++;
      }
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

    // Licence annuelle. Le fichier retour d'ISIC donne la validité réelle
    // (ex. 01/02/2026 → 28/02/2027) : elle prime sur la validité par défaut, et
    // l'année académique s'en déduit si elle n'est pas précisée.
    const vFrom = parseDateLoose(e.validFrom);
    const vTo = parseDateLoose(e.validTo);
    const year = e.academicYear || (vFrom ? academicYearOf(vFrom) : undefined);
    if (year) {
      if (!isAcademicYear(year)) report.skipped.push({ line: e.line, reason: `Année « ${year} » invalide (format 2025-2026).` });
      else {
        const lk = `${known._id}|${year}`;
        if (!licenceKeys.has(lk)) {
          licenceKeys.add(lk);
          const real: Record<string, unknown> = {};
          if (vTo) real.validUntil = vTo;
          if (vFrom) real.validFrom = vFrom;
          if (e.cardStatus) real.cardStatus = cleanName(e.cardStatus).slice(0, 40);
          const issued = parseDateLoose(e.issuedOn);
          if (issued) real.issuedOn = issued;
          const onInsert: Record<string, unknown> = {
            tenantId: auth.tenantId, studentId: known._id, academicYear: year,
            source: opts.licenceSource, batchId: opts.batchId, status: "active", createdBy: auth.userId,
          };
          if (!vTo) onInsert.validUntil = defaultValidUntil(year);
          licences.push({ updateOne: {
            filter: { tenantId: auth.tenantId, studentId: known._id, academicYear: year },
            update: Object.keys(real).length ? { $set: real, $setOnInsert: onInsert } : { $setOnInsert: onInsert },
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

/** Lignes (CSV ou Excel) → entrées de registre, d'après les colonnes reconnues. */
export function entriesFromRows(
  rows: string[][],
  cols: RegistryColumns,
  defaults: { schoolName?: string; academicYear?: string },
): RegistryEntry[] {
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return rows.slice(0, 20000).map((r, idx) => ({
    line: idx + 2, // +1 en-tête, +1 base 1 : numéro de ligne tel que vu dans Excel
    fullName: at(r, cols.name),
    firstName: at(r, cols.firstName) || undefined,
    lastName: at(r, cols.lastName) || undefined,
    matricule: at(r, cols.matricule) || undefined,
    schoolName: at(r, cols.school) || defaults.schoolName || "",
    email: at(r, cols.email) || undefined,
    phone: at(r, cols.phone) || undefined,
    number: at(r, cols.number) || undefined,
    academicYear: at(r, cols.year) || defaults.academicYear || undefined,
    dateOfBirth: at(r, cols.dateOfBirth) || undefined,
    city: at(r, cols.city) || undefined,
    className: at(r, cols.className) || undefined,
    nationality: at(r, cols.nationality) || undefined,
    validFrom: at(r, cols.validFrom) || undefined,
    validTo: at(r, cols.validTo) || undefined,
    cardStatus: at(r, cols.cardStatus) || undefined,
    issuedOn: at(r, cols.issuedOn) || undefined,
  }));
}

/**
 * Suppression DÉFINITIVE de fiches du registre saisies par erreur (doublon,
 * mauvais import, faute de frappe) : la fiche, sa photo et ses licences. Les
 * cartes de production rattachées sont seulement déliées. L'archivage reste le
 * geste normal pour un étudiant réel qui quitte l'établissement.
 */
export async function purgeRegistryStudents(tenantId: string, ids: string[]) {
  const oids = ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
  const tid = new Types.ObjectId(tenantId);
  const students = await IsicStudentModel.find({ tenantId: tid, _id: { $in: oids } }).select("fullName isicNumber").lean<Array<{ _id: unknown; fullName: string; isicNumber?: string }>>();
  const found = students.map(s => s._id);
  if (!found.length) return { deleted: 0, licenses: 0, names: [] as string[] };
  const [lic] = await Promise.all([
    IsicLicenseModel.deleteMany({ tenantId: tid, studentId: { $in: found } }),
    IsicPhotoModel.deleteMany({ tenantId: tid, studentId: { $in: found } }),
    IsicCardModel.updateMany({ tenantId: tid, studentId: { $in: found } }, { $unset: { studentId: 1 } }),
  ]);
  const r = await IsicStudentModel.deleteMany({ tenantId: tid, _id: { $in: found } });
  return { deleted: r.deletedCount ?? 0, licenses: lic.deletedCount ?? 0, names: students.map(s => `${s.fullName}${s.isicNumber ? ` (${s.isicNumber})` : ""}`) };
}
