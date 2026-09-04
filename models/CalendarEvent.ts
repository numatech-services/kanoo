import { Schema, model, models, Types } from "mongoose";

/**
 * Entrée d'agenda — réunion, activité, tâche, rappel.
 *
 * Distincte du modèle `Event` (billetterie publique). Ici il s'agit de
 * l'agenda de travail : chaque collaborateur a le sien (visibilité
 * « personal »), et l'organisation dispose d'agendas partagés (« shared »)
 * visibles de tous. Un événement peut aussi désigner des participants, qui le
 * voient même s'il est personnel.
 */
export interface ICalendarEvent {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  title: string;
  description?: string;
  type: "reunion" | "activite" | "tache" | "rappel" | "autre";
  startAt: Date;
  endAt?: Date;
  allDay: boolean;
  location?: string;
  meetingLink?: string;
  color?: string;
  ownerId: Types.ObjectId;
  visibility: "personal" | "shared";
  participants: Types.ObjectId[];
  status: "planned" | "done" | "cancelled";
  shareToken?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CalendarEventSchema = new Schema<ICalendarEvent>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 4000 },
    type: { type: String, enum: ["reunion", "activite", "tache", "rappel", "autre"], default: "reunion" },
    startAt: { type: Date, required: true },
    endAt: Date,
    allDay: { type: Boolean, default: false },
    location: { type: String, maxlength: 300 },
    meetingLink: { type: String, maxlength: 500 },
    /** Couleur d'affichage (hex). À défaut, dérivée du type côté interface. */
    color: String,
    /** Propriétaire de l'entrée : seul lui (ou un admin) peut la modifier. */
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** « personal » = agenda propre ; « shared » = agenda partagé de l'organisation. */
    visibility: { type: String, enum: ["personal", "shared"], default: "personal" },
    /** Participants conviés : ils voient l'entrée même si elle est personnelle. */
    participants: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    status: { type: String, enum: ["planned", "done", "cancelled"], default: "planned" },
    /** Jeton d'un lien de réunion partageable (public, en lecture seule). */
    shareToken: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Requête principale : les entrées d'un tenant, dans une fenêtre de dates.
CalendarEventSchema.index({ tenantId: 1, startAt: 1 });
// Agenda personnel et agendas partagés.
CalendarEventSchema.index({ tenantId: 1, ownerId: 1, startAt: 1 });
CalendarEventSchema.index({ tenantId: 1, visibility: 1, startAt: 1 });
// Résolution d'un lien public : unique là où le jeton existe.
CalendarEventSchema.index({ shareToken: 1 }, { unique: true, partialFilterExpression: { shareToken: { $type: "string" } } });

export const CalendarEventModel =
  models.CalendarEvent || model<ICalendarEvent>("CalendarEvent", CalendarEventSchema);
