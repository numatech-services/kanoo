import { Schema, model, models } from "mongoose";

export type BureauRole =
  | "president"
  | "vice_president"
  | "secretaire_general"
  | "secretaire_adjoint"
  | "tresorier"
  | "tresorier_adjoint"
  | "commissaire_aux_comptes"
  | "conseiller"
  | "charge_de_mission"
  | "autre";

const BureauMemberSchema = new Schema({
  tenantId:  { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

  // Lien optionnel vers un adhérent existant
  memberId: { type: Schema.Types.ObjectId, ref: "Member" },

  // Informations de la personne (si pas adhérent)
  firstName: { type: String, required: true },
  lastName:  { type: String, required: true },
  email:     String,
  phone:     String,
  photo:     String,

  role: {
    type: String,
    enum: ["president","vice_president","secretaire_general","secretaire_adjoint",
           "tresorier","tresorier_adjoint","commissaire_aux_comptes",
           "conseiller","charge_de_mission","autre"],
    required: true,
  },
  customRoleLabel: String,   // Si role = "autre"

  // Mandat
  mandateStart: { type: Date, required: true },
  mandateEnd:   Date,
  isActive:     { type: Boolean, default: true },

  // Responsabilités sur des projets
  projectIds: [{ type: Schema.Types.ObjectId, ref: "Project" }],

  bio:   String,
  notes: String,
}, { timestamps: true });

BureauMemberSchema.index({ tenantId: 1, role: 1 });
BureauMemberSchema.index({ tenantId: 1, isActive: 1 });

export const BureauMemberModel = models.BureauMember || model("BureauMember", BureauMemberSchema);
