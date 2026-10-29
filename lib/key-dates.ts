import { Types } from "mongoose";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { ContractModel } from "@/models/Contract";
import { GUARANTEE_TYPES } from "@/lib/guarantees";
import { authCan } from "@/lib/role-resources";
import type { TokenPayload } from "@/lib/auth";

/**
 * Échéances des marchés publics, lues dans les dossiers eux-mêmes : dates
 * clés des offres en cours (questions, visite de site, dépôt, ouverture des
 * plis), expiration des cautions actives, jalons de facturation des marchés.
 * Une seule source pour les rappels de la semaine, l'onglet Calendrier du
 * suivi des marchés et l'agenda (agenda « Marchés publics »).
 */
export type KeyDateKind = "questions" | "visit" | "deposit" | "opening" | "caution" | "milestone";

export interface KeyDate {
  id: string;
  kind: KeyDateKind;
  /** « Date limite de dépôt », « Échéance de caution »… */
  label: string;
  /** Organisme, bénéficiaire ou client. */
  title: string;
  detail?: string;
  date: string;
  href: string;
  owner?: string;
}

export const KEY_DATE_LABEL: Record<KeyDateKind, string> = {
  questions: "Questions / éclaircissements",
  visit: "Visite de site",
  deposit: "Date limite de dépôt",
  opening: "Ouverture des plis",
  caution: "Échéance de caution",
  milestone: "Jalon de facturation",
};

const OPEN = ["identified", "preparing", "submitted", "evaluation"];
const FIELDS: Array<[KeyDateKind, "questionsDeadline" | "siteVisitDate" | "submissionDeadline" | "openingDate"]> = [
  ["questions", "questionsDeadline"], ["visit", "siteVisitDate"], ["deposit", "submissionDeadline"], ["opening", "openingDate"],
];
const name = (u?: { firstName?: string; lastName?: string } | null) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || undefined;

/**
 * Échéances entre `from` et `to` ; les cautions sont lues jusqu'à
 * `cautionTo` (plus loin : une mainlevée se prépare un mois avant).
 */
export async function keyDates(auth: TokenPayload, from: Date, to: Date, cautionTo: Date = to): Promise<KeyDate[]> {
  const tenantId = new Types.ObjectId(auth.tenantId);
  const out: KeyDate[] = [];
  if (authCan(auth, "appels", "read")) {
    const appels = await AppelCandidatureModel.find({
      tenantId, status: { $in: OPEN },
      $or: FIELDS.map(([, f]) => ({ [f]: { $gte: from, $lte: to } })),
    }).select("title organism questionsDeadline siteVisitDate submissionDeadline openingDate ownerId status")
      .populate("ownerId", "firstName lastName")
      .lean<Array<Record<string, unknown> & { _id: unknown; title: string; organism?: string; status: string; ownerId?: { firstName?: string; lastName?: string } | null }>>();
    for (const a of appels) for (const [kind, f] of FIELDS) {
      const d = a[f] as Date | undefined;
      if (!d || d < from || d > to) continue;
      // Une offre déjà déposée n'a plus de date de dépôt à rappeler.
      if (kind === "deposit" && !["identified", "preparing"].includes(a.status)) continue;
      out.push({ id: `${a._id}-${kind}`, kind, label: KEY_DATE_LABEL[kind], title: a.organism || a.title, detail: a.title, date: new Date(d).toISOString(), href: `/appels/${a._id}`, owner: name(a.ownerId) });
    }
    const cautions = await BankGuaranteeModel.find({ tenantId, status: "active", expiryDate: { $gte: from, $lte: cautionTo } })
      .select("type beneficiary expiryDate appelId").lean<Array<{ _id: unknown; type: keyof typeof GUARANTEE_TYPES; beneficiary: string; expiryDate: Date; appelId?: unknown }>>();
    for (const c of cautions) {
      out.push({ id: `${c._id}-caution`, kind: "caution", label: KEY_DATE_LABEL.caution, title: c.beneficiary, detail: GUARANTEE_TYPES[c.type] ?? "Caution", date: new Date(c.expiryDate).toISOString(), href: c.appelId ? `/appels/${c.appelId}` : "/cautions" });
    }
  }
  if (authCan(auth, "contracts", "read")) {
    const contracts = await ContractModel.find({
      tenantId, status: { $in: ["active", "renewed"] },
      milestones: { $elemMatch: { status: "pending", dueDate: { $gte: from, $lte: to } } },
    }).select("title milestones clientId").populate("clientId", "name")
      .lean<Array<{ _id: unknown; title: string; clientId?: { name?: string } | null; milestones: Array<{ _id: unknown; label: string; dueDate?: Date; status: string }> }>>();
    for (const c of contracts) for (const m of c.milestones) {
      if (m.status !== "pending" || !m.dueDate || m.dueDate < from || m.dueDate > to) continue;
      out.push({ id: `${m._id}-milestone`, kind: "milestone", label: KEY_DATE_LABEL.milestone, title: c.clientId?.name || c.title, detail: m.label, date: new Date(m.dueDate).toISOString(), href: `/contracts/${c._id}` });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}
