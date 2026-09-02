import { Schema, model, models } from "mongoose";

export type CRMStage =
  | "prospect"      // Nouveau contact non qualifié
  | "qualified"     // Besoin confirmé
  | "proposal"      // Devis envoyé
  | "negotiation"   // En cours de négociation
  | "won"           // Affaire gagnée → créer une commande/contrat
  | "lost";         // Affaire perdue

const ActivitySchema = new Schema({
  type: { type: String, enum: ["call", "email", "meeting", "note", "task"], required: true },
  label: { type: String, required: true },
  date: { type: Date, default: Date.now },
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  completed: { type: Boolean, default: false },
  dueDate: Date,
}, { _id: true });

const CRMOpportunitySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

  // Identification
  reference:    { type: String, required: true },
  title:        { type: String, required: true },
  description:  String,

  // Prospect / client lié
  clientId:     { type: Schema.Types.ObjectId, ref: "Client" },
  companyName:  String,                    // Si prospect non encore client
  contactName:  String,
  contactEmail: String,
  contactPhone: String,

  // Pipeline
  stage: {
    type: String,
    enum: ["prospect","qualified","proposal","negotiation","won","lost"],
    default: "prospect",
    index: true,
  },
  probability:     { type: Number, default: 50, min: 0, max: 100 },  // % de chance de gagner

  // Financier
  estimatedAmount: { type: Number, default: 0 },
  currency:        { type: String, default: "XOF" },

  // Responsable
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },

  // Dates
  expectedCloseDate: Date,
  wonDate:           Date,
  lostDate:          Date,
  lostReason:        String,

  // Liens
  quoteId:    { type: Schema.Types.ObjectId, ref: "Devis" },
  contractId: { type: Schema.Types.ObjectId, ref: "Contract" },

  // Activités & suivi
  activities: [ActivitySchema],

  // Prochaine relance
  nextFollowUpDate: Date,
  followUpCount:    { type: Number, default: 0 },

  source:  { type: String, enum: ["inbound","outbound","referral","event","other"] },
  tags:    [String],
  notes:   String,
}, { timestamps: true });

CRMOpportunitySchema.index({ tenantId: 1, stage: 1 });
CRMOpportunitySchema.index({ tenantId: 1, assignedTo: 1 });
CRMOpportunitySchema.index({ tenantId: 1, nextFollowUpDate: 1 });
CRMOpportunitySchema.index({ tenantId: 1, expectedCloseDate: 1 });

export const CRMOpportunityModel = models.CRMOpportunity || model("CRMOpportunity", CRMOpportunitySchema);
