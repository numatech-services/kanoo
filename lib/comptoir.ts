import { Types } from "mongoose";
import { tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { canPerformAction, effectiveRoles, hasFinanceAccess } from "@/lib/role-resources";
import { UserRole } from "@/types";

import { postCashFlow } from "@/lib/cash-posting";
import { registerLedgerAccount } from "@/lib/treasury";
import { EXPENSE_ACCOUNTS } from "@/lib/expense-categories";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import type { ClientSession } from "mongoose";
export const isId = (v: unknown): v is string =>
  typeof v === "string" && Types.ObjectId.isValid(v);

/**
 * Sites (comptoirs) accessibles : `null` = tous. Un employé ou stagiaire du
 * service The Spot ne voit que les sites qui lui sont attribués ; le chef The
 * Spot, la comptabilité et le gérant voient tous les sites.
 */
export function deskScope(auth: TokenPayload): string[] | null {
  const roles = effectiveRoles(auth.role, auth.roles);
  const levels = auth.roleLevels ?? {};
  for (const r of roles) {
    if (r === "svc_spot") { if (levels.svc_spot === "chef") return null; continue; }
    if (canPerformAction(r as UserRole, "comptoir", "read", auth.allowedResources, levels[r])) return null;
  }
  return auth.siteIds ?? [];
}

/**
 * Coûts d'achat, valeur du stock et marges du comptoir : direction et
 * comptabilité, et chef du service The Spot (qui pilote ses prix). Masqués
 * aux caissiers et serveurs.
 */
export function canSeeDeskCosts(auth: TokenPayload): boolean {
  if (hasFinanceAccess(auth)) return true;
  return effectiveRoles(auth.role, auth.roles).includes("svc_spot" as UserRole) && (auth.roleLevels ?? {}).svc_spot === "chef";
}

/** Vrai si l'appelant peut agir sur tous les sites (créer / paramétrer un comptoir). */
export function allDesks(auth: TokenPayload): boolean {
  return deskScope(auth) === null;
}

/**
 * Le comptoir demandé, s'il existe, appartient à l'organisation de l'appelant
 * ET fait partie de ses sites. Toute lecture ou écriture d'un comptoir passe par
 * ce contrôle : un site non attribué répond « introuvable ».
 */
export async function ownDesk(auth: TokenPayload, deskId: unknown) {
  if (!isId(deskId)) return null;
  const scope = deskScope(auth);
  if (scope && !scope.includes(String(deskId))) return null;
  return ActivityDeskModel.findOne({ _id: deskId, ...tenantFilter(auth) })
    .select("_id name activityId").lean<{ _id: Types.ObjectId; name: string; activityId?: Types.ObjectId } | null>();
}

/** Filtre Mongo « sites accessibles » pour les collections rattachées à un comptoir. */
export function deskFilter(auth: TokenPayload): Record<string, unknown> {
  const scope = deskScope(auth);
  return scope ? { deskId: { $in: scope.filter(isId).map(id => new Types.ObjectId(id)) } } : {};
}

/**
 * Comptabilise une écriture de caisse de comptoir, si le comptoir est relié à
 * une caisse de trésorerie (lib/cash-posting). Sans liaison, rien n'est écrit :
 * le comptoir affiche alors un avertissement « caisse hors comptabilité ».
 */
export async function postDeskCash(
  auth: TokenPayload,
  deskId: unknown,
  entry: { _id: unknown; direction: "in" | "out"; amount: number; date: Date; label: string; method?: string; category?: string; entryId?: unknown; movementId?: unknown; save: (o?: { session?: ClientSession }) => Promise<unknown> },
  session?: ClientSession,
) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, ...tenantFilter(auth) }).session(session ?? null)
    .select("name activityId treasuryAccountId revenueAccount expenseAccount vatRate")
    .lean<{ name: string; activityId?: unknown; treasuryAccountId?: unknown; revenueAccount?: string; expenseAccount?: string; vatRate?: number } | null>();
  if (!desk?.treasuryAccountId) return null;
  const isIn = entry.direction === "in";
  // Dépense de caisse : le compte de sa nature (eau, électricité, loyer…), sinon le compte d'achats du comptoir.
  const nature = !isIn && entry.category ? EXPENSE_ACCOUNTS[entry.category] ?? null : null;
  // Entrée hors vente : pas de chiffre d'affaires ni de TVA ; compte d'attente à classer par le comptable.
  const nonSale = isIn && entry.category === "non_sale" ? { accountCode: "471000", accountLabel: "Compte d'attente — entrée de caisse à classer" } : null;
  if (nonSale) await registerLedgerAccount(auth.tenantId, nonSale.accountCode, nonSale.accountLabel, session);
  if (nature) await registerLedgerAccount(auth.tenantId, nature.accountCode, nature.accountLabel, session);
  const posted = await postCashFlow({
    tenantId: auth.tenantId, userId: auth.userId,
    treasuryAccountId: await accountForMethod(auth.tenantId, desk.treasuryAccountId, entry.method, session),
    direction: entry.direction, amount: entry.amount, date: entry.date,
    label: `${desk.name} — ${entry.label}`, reference: `CPT-${String(entry._id).slice(-6).toUpperCase()}`,
    account: isIn
      ? nonSale ?? { accountCode: desk.revenueAccount || "701100", accountLabel: "Ventes du comptoir" }
      : nature ?? { accountCode: desk.expenseAccount || "601100", accountLabel: "Dépenses du comptoir" },
    // Dépense de caisse : pas de TVA déductible sans facture du fournisseur
    // (CGI) ; elle était déduite au taux du comptoir sur chaque ticket d'achat.
    vatRate: isIn && !nonSale ? desk.vatRate ?? 0 : 0, activityId: desk.activityId,
    linkedDocType: "desk_cash", linkedDocId: entry._id,
  }, session);
  entry.entryId = posted.entryId;
  entry.movementId = posted.movementId;
  await entry.save({ session });
  return posted;
}

/** Type de compte de trésorerie qui reçoit chaque moyen de paiement du comptoir. */
const METHOD_ACCOUNT_TYPE: Record<string, "bank" | "mobile_money"> = {
  orange_money: "mobile_money", card: "bank", bank_transfer: "bank", check: "bank",
};

/**
 * Compte de trésorerie qui reçoit réellement l'argent d'une écriture de
 * comptoir. La caisse du comptoir ne reçoit que les espèces : un paiement
 * Airtel / Moov / Zamani va sur le compte mobile money de l'organisation, une
 * carte, un virement ou un chèque sur son compte bancaire. Tout passait par la
 * caisse, dont le solde ne correspondait plus aux espèces comptées. À défaut
 * de compte du bon type, la caisse du comptoir.
 */
export async function accountForMethod(tenantId: string, deskAccount: unknown, method: string | undefined, session?: ClientSession): Promise<unknown> {
  const type = method ? METHOD_ACCOUNT_TYPE[method] : undefined;
  if (!type) return deskAccount;
  const desk = await TreasuryAccountModel.findOne({ _id: deskAccount, tenantId }).select("type").session(session ?? null).lean<{ type: string } | null>();
  if (desk?.type === type) return deskAccount;
  const target = await TreasuryAccountModel.findOne({ tenantId, type, isActive: { $ne: false } })
    .sort({ createdAt: 1 }).select("_id").session(session ?? null).lean<{ _id: unknown } | null>();
  return target?._id ?? deskAccount;
}

/** Conditionnement saisi à l'écran : { label, size, cost } validé, ou null pour l'effacer. */
export function parsePack(raw: unknown): { label?: string; size: number; cost?: number } | null | "invalid" {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "object") return "invalid";
  const r = raw as { label?: unknown; size?: unknown; cost?: unknown };
  const size = Number(r.size);
  if (!r.size) return null;
  if (!(Number.isFinite(size) && size >= 1 && size <= 10_000)) return "invalid";
  const cost = r.cost === undefined || r.cost === null || r.cost === "" ? undefined : Number(r.cost);
  if (cost !== undefined && !(Number.isFinite(cost) && cost >= 0)) return "invalid";
  return { ...(r.label ? { label: String(r.label).trim().slice(0, 30) } : {}), size, ...(cost !== undefined ? { cost: Math.round(cost) } : {}) };
}
