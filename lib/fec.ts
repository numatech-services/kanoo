import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { EmployeeModel } from "@/models/Employee";

/**
 * Fichier des écritures comptables (FEC, 18 colonnes, séparateur « | »).
 *
 * Corrigé sur trois points : un NUMÉRO PAR ÉCRITURE (il était donné à chaque
 * ligne, l'écriture n'était plus reconstituable) ; le TIERS des lignes de
 * classe 4 (CompAuxNum / CompAuxLib, vides) ; les DATES au jour de Niamey
 * (toISOString donnait le jour UTC, la veille pour une écriture du matin).
 * Lettrage et date de lettrage par ligne.
 */
export const FEC_HEADER = "JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise";

export const JOURNAL_LABEL: Record<string, string> = {
  VT: "Ventes", AC: "Achats", BQ: "Banque", CA: "Caisse", OD: "Opérations diverses", AN: "À-nouveaux", EX: "Extournes",
};

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Niamey", year: "numeric", month: "2-digit", day: "2-digit" });
/** AAAAMMJJ au jour de Niamey. */
export function fecDate(d: Date | string | undefined | null): string {
  if (!d) return "";
  return ymd.format(new Date(d)).replace(/-/g, "");
}
/** Texte sans séparateur ni retour à la ligne. */
const clean = (v: unknown) => String(v ?? "").replace(/[|\r\n\t]/g, " ").trim();
/** Montant au format FEC : virgule décimale. */
const amount = (n: number) => (Math.round((n || 0) * 100) / 100).toFixed(2).replace(".", ",");

export interface FecEntry {
  _id: unknown; journalCode: string; entryDate: Date; reference?: string; label?: string; createdAt?: Date;
  lines: Array<{ accountCode: string; accountLabel?: string; debit: number; credit: number; thirdPartyId?: unknown; letterRef?: string; letteredAt?: Date }>;
}

/** Lignes du FEC pour des écritures déjà triées (date, journal, création). */
export function fecRows(entries: FecEntry[], third: Map<string, { num: string; name: string }>, start = 1): string[] {
  const rows: string[] = [FEC_HEADER];
  let n = start;
  for (const e of entries) {
    const num = String(n++).padStart(8, "0");
    const date = fecDate(e.entryDate);
    for (const l of e.lines) {
      const t = /^4/.test(l.accountCode) && l.thirdPartyId ? third.get(String(l.thirdPartyId)) : undefined;
      rows.push([
        e.journalCode, JOURNAL_LABEL[e.journalCode] ?? e.journalCode, num, date,
        l.accountCode, clean(l.accountLabel), t?.num ?? "", clean(t?.name), clean(e.reference) || num, date,
        clean(e.label).slice(0, 200) || clean(l.accountLabel), amount(l.debit), amount(l.credit),
        clean(l.letterRef), l.letterRef ? fecDate(l.letteredAt ?? e.createdAt ?? e.entryDate) : "",
        fecDate(e.createdAt ?? e.entryDate), "", "",
      ].join("|"));
    }
  }
  return rows;
}

/** Tiers des lignes : clients, fournisseurs, salariés (code et nom). */
export async function thirdParties(tenantId: string, ids: string[]): Promise<Map<string, { num: string; name: string }>> {
  const oid = [...new Set(ids)].filter(i => Types.ObjectId.isValid(i)).map(i => new Types.ObjectId(i));
  const out = new Map<string, { num: string; name: string }>();
  if (!oid.length) return out;
  const tid = new Types.ObjectId(tenantId);
  const [c, s, e] = await Promise.all([
    ClientModel.find({ tenantId: tid, _id: { $in: oid } }).select("code name").lean<Array<{ _id: unknown; code?: string; name: string }>>(),
    SupplierModel.find({ tenantId: tid, _id: { $in: oid } }).select("code name").lean<Array<{ _id: unknown; code?: string; name: string }>>(),
    EmployeeModel.find({ tenantId: tid, _id: { $in: oid } }).select("code firstName lastName").lean<Array<{ _id: unknown; code?: string; firstName: string; lastName: string }>>(),
  ]);
  for (const x of c) out.set(String(x._id), { num: x.code || `C${String(x._id).slice(-6)}`, name: x.name });
  for (const x of s) out.set(String(x._id), { num: x.code || `F${String(x._id).slice(-6)}`, name: x.name });
  for (const x of e) out.set(String(x._id), { num: x.code || `S${String(x._id).slice(-6)}`, name: `${x.firstName} ${x.lastName}` });
  return out;
}

/** FEC complet d'une période. */
export async function buildFec(tenantId: string, start: Date, end: Date): Promise<string> {
  const entries = await AccountingEntryModel.find({ tenantId: new Types.ObjectId(tenantId), entryDate: { $gte: start, $lte: end } })
    .sort({ entryDate: 1, journalCode: 1, createdAt: 1, _id: 1 }).lean<FecEntry[]>();
  const ids = entries.flatMap(e => e.lines.filter(l => l.thirdPartyId).map(l => String(l.thirdPartyId)));
  return fecRows(entries, await thirdParties(tenantId, ids)).join("\r\n");
}
