import { Types } from "mongoose";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { logAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/errors";
import type { TokenPayload } from "@/lib/auth";

export interface DeclarationAmounts { base?: number; taux?: number; montant?: number; deductible?: number; net?: number }

/**
 * Enregistre une déclaration fiscale avec des montants calculés par le
 * serveur (jamais ceux du navigateur). Une seule déclaration par impôt et par
 * période : la TVA en créait une nouvelle à chaque envoi, et l'export
 * comparait la comptabilité à une version remplacée.
 *
 * Une déclaration déjà déposée ne se réécrit qu'avec un motif de
 * rectification, et l'état précédent est conservé au journal d'audit ; une
 * déclaration payée ne se modifie plus.
 */
export async function saveDeclaration(auth: TokenPayload, input: {
  type: "tva" | "isbic";
  annee: number;
  mois?: number;
  amounts: DeclarationAmounts;
  motif?: string;
  reference?: string;
  trace?: { ip?: string; userAgent?: string };
}) {
  const tenantId = new Types.ObjectId(String(auth.tenantId));
  const filter = { tenantId, type: input.type, "period.annee": input.annee, ...(input.mois ? { "period.mois": input.mois } : {}) };
  const existing = await FiscalDeclarationModel.findOne(filter).sort({ updatedAt: -1 })
    .lean<{ _id: Types.ObjectId; status: string; amounts?: DeclarationAmounts; notes?: string; submittedAt?: Date; reference?: string } | null>();
  if (existing?.status === "paid") throw new BusinessRuleError("Déclaration déjà payée : elle ne se modifie plus.");
  const motif = String(input.motif ?? "").trim().slice(0, 300);
  if (existing && existing.status !== "draft" && !motif) throw new BusinessRuleError("Déclaration déjà déposée : indiquez le motif de la rectification.");

  const now = new Date();
  const note = motif ? `${now.toLocaleDateString("fr-FR")} — rectification : ${motif}` : undefined;
  const decl = existing
    ? await FiscalDeclarationModel.findOneAndUpdate({ _id: existing._id, status: { $ne: "paid" } }, {
        // Rectification : la date du dépôt d'origine est conservée (elle compte pour les pénalités).
        $set: { amounts: input.amounts, status: "submitted", ...(existing.status === "draft" ? { submittedAt: now } : {}), ...(input.reference ? { reference: input.reference } : {}), ...(note ? { notes: [existing.notes, note].filter(Boolean).join("\n").slice(-2000) } : {}) },
      }, { new: true })
    : await FiscalDeclarationModel.findOneAndUpdate(filter, {
        // Organisation, impôt et période viennent du filtre (champs d'égalité recopiés à la création).
        $setOnInsert: { createdBy: auth.userId },
        $set: { amounts: input.amounts, status: "submitted", submittedAt: now, ...(input.reference ? { reference: input.reference } : {}) },
      }, { upsert: true, new: true }).catch((err: { code?: number }) => {
        // Deux envois simultanés : l'index unique a gardé le premier.
        if (err?.code === 11000) throw new BusinessRuleError("Déclaration enregistrée entre-temps. Rechargez la page.");
        throw err;
      });
  if (!decl) throw new BusinessRuleError("Déclaration modifiée entre-temps. Rechargez la page.");

  await logAudit(auth, existing ? "UPDATE" : "CREATE", "fiscalDeclarations", {
    resourceId: String(decl._id), ...input.trace,
    ...(existing ? { before: { status: existing.status, amounts: existing.amounts, submittedAt: (existing as { submittedAt?: Date }).submittedAt, reference: (existing as { reference?: string }).reference } } : {}),
    after: { type: input.type, annee: input.annee, mois: input.mois, amounts: input.amounts, ...(motif ? { motif } : {}) },
  });
  return decl;
}
