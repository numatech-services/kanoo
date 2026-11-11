import { Schema, model, models } from "mongoose";

/**
 * Sceau d'intégrité (lib/audit-seal) : empreinte des pièces d'une plage
 * d'identifiants (fromId exclu, toId inclus), chaînée au sceau précédent et
 * signée (HMAC, clé du serveur identifiée par `kid`). Les plages se suivent
 * sans trou. Un sceau n'est jamais modifié : une reprise de la comptabilité
 * ajoute un sceau d'archive (`archive`) qui couvre les sceaux antérieurs.
 *
 * `items` : par pièce, l'empreinte du noyau intangible (`h`) et celle de la
 * partie modifiable par l'application (`m` : libellé, référence).
 */
const AuditSealSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  kind: { type: String, enum: ["entries", "audit"], required: true },
  seq: { type: Number, required: true, min: 1 },
  fromId: { type: Schema.Types.ObjectId, required: true },
  toId: { type: Schema.Types.ObjectId, required: true },
  count: { type: Number, required: true, min: 0 },
  items: { type: [{ _id: false, id: Schema.Types.ObjectId, h: String, m: String }], default: [] },
  contentHash: { type: String, required: true },
  prevHash: { type: String, required: true },
  sealedAt: { type: Date, required: true },
  kid: { type: String, required: true },
  hash: { type: String, required: true },
  /** Sceau d'archive : les sceaux fromSeq..toSeq couvrent des écritures effacées par la reprise `restartId`. */
  archive: { type: { _id: false, fromSeq: Number, toSeq: Number, restartId: Schema.Types.ObjectId, exportHash: String }, default: undefined },
});
AuditSealSchema.index({ tenantId: 1, kind: 1, seq: 1 }, { unique: true });

export const AuditSealModel = models.AuditSeal || model("AuditSeal", AuditSealSchema);

/** Dernière vérification complète (cache : la vérification relit tout l'historique). */
const AuditCheckSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, required: true },
  at: { type: Date, required: true },
  result: Schema.Types.Mixed,
});
AuditCheckSchema.index({ tenantId: 1, kind: 1 }, { unique: true });
export const AuditCheckModel = models.AuditCheck || model("AuditCheck", AuditCheckSchema);

/** Rapport d'audit mensuel figé à son émission (empreinte jointe, envoyée par courriel). */
const AuditReportSnapshotSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true },
  generatedAt: { type: Date, required: true },
  report: Schema.Types.Mixed,
  hash: { type: String, required: true },
  /** Signature de l'empreinte avec la clé de scellement (un rapport figé réécrit en base se voit). */
  kid: String,
  sig: String,
});
AuditReportSnapshotSchema.index({ tenantId: 1, year: 1, month: 1 }, { unique: true });
export const AuditReportSnapshotModel = models.AuditReportSnapshot || model("AuditReportSnapshot", AuditReportSnapshotSchema);
