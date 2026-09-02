import { Schema, model, models } from "mongoose";

const TaskSchema = new Schema({
  label:       { type: String, required: true },
  assigneeId:  { type: Schema.Types.ObjectId, ref: "User" },
  memberId:    { type: Schema.Types.ObjectId, ref: "Member" },      // Pour associations
  bureauMemberId: { type: Schema.Types.ObjectId, ref: "BureauMember" },
  dueDate:     Date,
  completedAt: Date,
  status:      { type: String, enum: ["todo","in_progress","done","blocked"], default: "todo" },
  weight:      { type: Number, default: 1 },  // Poids pour le calcul du taux d'exécution
}, { _id: true });

const MilestoneSchema = new Schema({
  label:       { type: String, required: true },
  dueDate:     Date,
  completedAt: Date,
  amount:      { type: Number, default: 0 },
  invoiceId:   { type: Schema.Types.ObjectId, ref: "Invoice" },
  description: String,
}, { _id: true });

const ProjectDocumentSchema = new Schema({
  name:       { type: String, required: true },
  url:        String,
  documentId: { type: Schema.Types.ObjectId, ref: "Document" },
  type:       { type: String, enum: ["contrat","rapport","facture","photo","autre"], default: "autre" },
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { _id: true });

const ProjectMemberSchema = new Schema({
  memberId:       { type: Schema.Types.ObjectId, ref: "Member" },
  bureauMemberId: { type: Schema.Types.ObjectId, ref: "BureauMember" },
  userId:         { type: Schema.Types.ObjectId, ref: "User" },
  employeeId:     { type: Schema.Types.ObjectId, ref: "Employee" },
  role:           String,   // "Chef de projet", "Coordinateur", "Intervenant"…
  addedAt:        { type: Date, default: Date.now },
}, { _id: true });

const ProjectSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

  code:        { type: String, required: true },
  name:        { type: String, required: true },
  description: String,

  // Type de projet (pour adapter l'interface)
  projectType: {
    type: String,
    enum: ["internal","client","ong","public","research","other"],
    default: "internal",
  },

  // Parties prenantes
  clientId:   { type: Schema.Types.ObjectId, ref: "Client" },
  managerId:  { type: Schema.Types.ObjectId, ref: "User" },
  teamIds:    [{ type: Schema.Types.ObjectId, ref: "User" }],

  // Membres (associations / administration)
  projectMembers: [ProjectMemberSchema],

  // Budget & finances
  budget:       { type: Number, default: 0 },
  spentAmount:  { type: Number, default: 0 },
  currency:     { type: String, default: "XOF" },
  bailleurName: String,   // ONG : nom du bailleur (USAID, AFD, UE…)

  // Liens
  contractIds: [{ type: Schema.Types.ObjectId, ref: "Contract" }],
  invoiceIds:  [{ type: Schema.Types.ObjectId, ref: "Invoice" }],

  // Documents joints
  documents: [ProjectDocumentSchema],
  documentIds: [{ type: Schema.Types.ObjectId, ref: "Document" }],

  // Tâches, jalons
  tasks:      [TaskSchema],
  milestones: [MilestoneSchema],

  // Indicateurs d'avancement
  executionRate:  { type: Number, default: 0, min: 0, max: 100 }, // % calculé
  budgetRate:     { type: Number, default: 0, min: 0, max: 200 }, // % budget consommé
  daysProgress:   { type: Number, default: 0 },                   // % temps écoulé

  // Dates
  startDate:   Date,
  endDate:     Date,
  completedAt: Date,

  status: {
    type: String,
    enum: ["planning","active","on_hold","completed","cancelled"],
    default: "planning",
  },

  // Communication
  conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },

  notes: String,
  tags:  [String],
}, { timestamps: true });

// Calcul automatique du taux d'exécution avant sauvegarde
ProjectSchema.pre("save", function(next) {
  if (this.tasks && this.tasks.length > 0) {
    const totalWeight = this.tasks.reduce((s: number, t: {weight?: number}) => s + (t.weight || 1), 0);
    const doneWeight  = this.tasks
      .filter((t: {status: string}) => t.status === "done")
      .reduce((s: number, t: {weight?: number}) => s + (t.weight || 1), 0);
    this.executionRate = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0;
  }
  if (this.budget && this.budget > 0 && this.spentAmount !== undefined) {
    this.budgetRate = Math.round((this.spentAmount / this.budget) * 100);
  }
  next();
});

ProjectSchema.index({ tenantId: 1, code: 1 }, { unique: true });
ProjectSchema.index({ tenantId: 1, status: 1 });
ProjectSchema.index({ tenantId: 1, clientId: 1 });

export const ProjectModel = models.Project || model("Project", ProjectSchema);
