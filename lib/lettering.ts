import crypto from "crypto";
import { Types, type ClientSession } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { BusinessRuleError } from "@/lib/errors";

/**
 * Lettrage par LIGNE d'écriture.
 *
 * Il était porté par l'écriture entière : lettrer le 421 d'un bulletin avec
 * le virement du salaire marquait tout le bulletin, et son 431 (CNSS) ne se
 * lettrait plus. Les références étaient « nombre distinct + 1 » : après un
 * délettrage, une référence existante ressortait et deux groupes fusionnaient.
 */

const accountRx = (account: string) => new RegExp(`^${account.replace(/\D/g, "")}`);

/**
 * Reprise des lettrages antérieurs, posés au niveau de l'écriture : la
 * référence descend sur ses lignes de tiers (classe 4). Sans effet une fois
 * faite.
 */
export async function migrateLegacyLettering(tenantId: string | Types.ObjectId) {
  await AccountingEntryModel.updateMany(
    { tenantId: new Types.ObjectId(String(tenantId)), isLettered: true, letterRef: { $exists: true, $ne: null }, "lines.letterRef": { $exists: false } },
    [{ $set: { lines: { $map: { input: "$lines", as: "l", in: {
      $cond: [{ $regexMatch: { input: "$$l.accountCode", regex: "^4" } }, { $mergeObjects: ["$$l", { letterRef: "$letterRef" }] }, "$$l"],
    } } } } }],
  );
}

/** Référence de lettrage unique, non séquentielle (aucune collision possible après délettrage). */
export async function newLetterRef(tenantId: string | Types.ObjectId, session?: ClientSession): Promise<string> {
  const year = new Date().getFullYear();
  for (;;) {
    const ref = `LET-${year}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    if (!(await AccountingEntryModel.exists({ tenantId: new Types.ObjectId(String(tenantId)), "lines.letterRef": ref }).session(session ?? null))) return ref;
  }
}

/** Recalcule les marqueurs d'écriture (toutes lignes de tiers lettrées, référence affichée). */
async function refreshEntryFlags(ids: unknown[], session?: ClientSession) {
  const entries = await AccountingEntryModel.find({ _id: { $in: ids } }).select("lines").session(session ?? null)
    .lean<Array<{ _id: unknown; lines: Array<{ accountCode: string; letterRef?: string }> }>>();
  for (const e of entries) {
    const third = e.lines.filter(l => /^4/.test(l.accountCode));
    const refs = third.map(l => l.letterRef).filter(Boolean) as string[];
    await AccountingEntryModel.updateOne({ _id: e._id },
      refs.length ? { $set: { isLettered: third.length > 0 && refs.length === third.length, letterRef: refs[0] } } : { $set: { isLettered: false }, $unset: { letterRef: "" } },
      { session });
  }
}

/**
 * Lettre, sur un compte de tiers, les lignes non lettrées de ces écritures.
 * Contrôles : même tiers partout, débits = crédits. Lève une erreur métier
 * sinon (rien n'est écrit).
 */
export async function applyLetter(
  tenantId: string, entryIds: string[], account: string,
  opts: { letterRef?: string; session?: ClientSession } = {},
): Promise<{ letterRef: string; lines: number }> {
  const tid = new Types.ObjectId(tenantId);
  const rx = accountRx(account);
  const entries = await AccountingEntryModel.find({ _id: { $in: entryIds }, tenantId: tid }).session(opts.session ?? null)
    .lean<Array<{ _id: unknown; reference: string; lines: Array<{ accountCode: string; debit: number; credit: number; thirdPartyId?: unknown; letterRef?: string }> }>>();
  if (entries.length !== entryIds.length) throw new BusinessRuleError("Certaines écritures sont introuvables ou n'appartiennent pas à cette organisation.");
  let debit = 0, credit = 0;
  const parties = new Set<string>();
  for (const e of entries) {
    const lines = e.lines.filter(l => rx.test(l.accountCode) && !l.letterRef);
    if (!lines.length) throw new BusinessRuleError(`L'écriture ${e.reference} n'a plus de ligne ${account} à lettrer.`);
    for (const l of lines) { debit += l.debit; credit += l.credit; parties.add(l.thirdPartyId ? String(l.thirdPartyId) : "—"); }
  }
  // La facture du client A ne se lettre pas avec le règlement du client B.
  if (parties.size > 1) throw new BusinessRuleError("Ces lignes concernent des tiers différents : le lettrage rapproche les pièces d'un même tiers.");
  if (Math.abs(debit - credit) > 1) throw new BusinessRuleError(`Lettrage déséquilibré sur ${account} : débits=${debit} ≠ crédits=${credit}.`);

  const letterRef = opts.letterRef?.trim().slice(0, 40) || await newLetterRef(tid, opts.session);
  if (opts.letterRef && await AccountingEntryModel.exists({ tenantId: tid, "lines.letterRef": letterRef }).session(opts.session ?? null)) {
    throw new BusinessRuleError(`La référence ${letterRef} est déjà utilisée.`);
  }
  let count = 0;
  for (const e of entries) {
    const r = await AccountingEntryModel.updateOne(
      { _id: e._id, tenantId: tid },
      { $set: { "lines.$[l].letterRef": letterRef, "lines.$[l].letteredAt": new Date() } },
      { arrayFilters: [{ "l.accountCode": { $regex: rx.source }, "l.letterRef": { $exists: false } }], session: opts.session },
    );
    if (r.modifiedCount !== 1) throw new BusinessRuleError("Une de ces écritures vient d'être lettrée : recommencez.");
    count++;
  }
  await refreshEntryFlags(entries.map(e => e._id), opts.session);
  return { letterRef, lines: count };
}

/** Délettre un groupe : seules ses lignes perdent la référence. */
export async function removeLetter(tenantId: string, letterRef: string, session?: ClientSession): Promise<number> {
  const tid = new Types.ObjectId(tenantId);
  const ids = (await AccountingEntryModel.find({ tenantId: tid, "lines.letterRef": letterRef }).select("_id").session(session ?? null).lean<Array<{ _id: unknown }>>()).map(e => e._id);
  if (!ids.length) return 0;
  await AccountingEntryModel.updateMany({ _id: { $in: ids } }, { $unset: { "lines.$[l].letterRef": "", "lines.$[l].letteredAt": "" } }, { arrayFilters: [{ "l.letterRef": letterRef }], session });
  await refreshEntryFlags(ids, session);
  return ids.length;
}
