import { Schema, model, models } from "mongoose";

const EmployeeSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  code: { type: String, required: true },

  /**
   * Compte de connexion rattaché à cette fiche.
   *
   * Sans ce lien, l'application ne sait pas quelle fiche salarié correspond à
   * la personne connectée : « mes notes de frais » ne peut pas être filtré, et
   * un remboursement ne sait pas à qui il est dû. Facultatif — tous les
   * salariés n'ont pas de compte —, unique par organisation quand il est posé.
   */
  userId: { type: Schema.Types.ObjectId, ref: "User" },

  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: String,
  phone: String,
  nif: String,
  cnssNumber: String,
  bankAccount: String,
  bankName: String,

  // Type de collaborateur
  employeeType: { type: String, enum: ["employee","intern","freelance"], default: "employee" },
  contractNature: { type: String, enum: ["cdi","cdd","stage","freelance","consultant"], default: "cdi" },

  position: { type: String, required: true },
  department: String,
  /** Service de rattachement (centre de coût) : la paie y est imputée. */
  costCenter: { type: String, maxlength: 20 },
  /** Départ : motif (démission, fin de contrat, licenciement, retraite…). */
  exitReason: { type: String, maxlength: 200 },
  /** Solde de congés reporté à l'ouverture (jours), avant l'usage du module. */
  leaveOpeningBalance: { type: Number, default: 0 },

  // Rémunération
  grossSalary: { type: Number, default: 0 },
  indemnity: { type: Number, default: 0 },
  indemnityPeriod: { type: String, enum: ["monthly","daily","hourly","fixed"], default: "monthly" },

  // Dates
  startDate: { type: Date, required: true },
  endDate: Date,
  contractEndDate: Date,

  // Paramètres paie
  includeCnss: { type: Boolean, default: true },
  includeIr: { type: Boolean, default: true },
  otherDeductionLabel: String,
  otherDeductionAmount: { type: Number, default: 0 },

  // Trésorerie
  paymentTreasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },

  isActive: { type: Boolean, default: true },
  notes: String,
}, { timestamps: true });

// Index PARTIEL, et non `sparse` : sur un index composé, sparse indexe tout
// document possédant AU MOINS UN des champs — donc chaque employé (tous ont un
// tenantId), avec userId à null. Dès le deuxième salarié d'une organisation,
// l'insertion échouait en collision d'unicité. Attrapé par le seed sur base
// réelle, pas par la relecture.
EmployeeSchema.index(
  { tenantId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $exists: true } } }
);
EmployeeSchema.index({ tenantId: 1, code: 1 }, { unique: true });
EmployeeSchema.index({ tenantId: 1, isActive: 1 });
EmployeeSchema.index({ tenantId: 1, contractEndDate: 1 });

export const EmployeeModel = models.Employee || model("Employee", EmployeeSchema);
