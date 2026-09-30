import { Schema, model, models } from "mongoose";
import { IUser, USER_ROLES } from "@/types";

const UserSchema = new Schema<IUser>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    role: {
      type: String,
      // Dérivé de la liste unique USER_ROLES : des rôles (chef de projet
      // transversal, puis ISIC) manquaient ici alors qu'ils étaient proposés à
      // la création, et toute tentative échouait en validation Mongoose.
      enum: [...USER_ROLES],
      required: true,
    },
    /**
     * Rôles cumulés. Dans une petite structure, une personne est souvent
     * comptable ET RH ET achats à la fois. Les permissions s'évaluent en union
     * (voir rolesCanPerform). `role` reste le rôle PRINCIPAL — le premier de la
     * liste — pour la rétrocompatibilité (affichage, garde superadmin du
     * middleware). Un compte legacy sans `roles` retombe sur `[role]`.
     */
    roles: {
      type: [String],
      enum: [...USER_ROLES],
      default: undefined,
    },
    /**
     * Niveau par rôle de service : { svc_comm: "chef", svc_dev: "employe" }.
     * Un même collaborateur peut être chef dans un service et employé dans un
     * autre. Absent pour un rôle de service = « employe ».
     */
    roleLevels: { type: Map, of: { type: String, enum: ["chef", "employe", "stagiaire"] }, default: undefined },
    /** The Spot : sites (comptoirs) attribués à un employé ou stagiaire. */
    siteIds: { type: [{ type: Schema.Types.ObjectId, ref: "ActivityDesk" }], default: undefined },
    /** Fin d'accès (stagiaire) : au-delà, toute requête et toute connexion sont refusées. */
    accessUntil: Date,
    allowedResources: [String],
    phone: String,
    avatar: String,
    isActive: { type: Boolean, default: true },
    sessionVersion: { type: Number, default: 1 },   // Incrémenter pour révoquer TOUTES les sessions
    lastActivityAt: { type: Date, default: Date.now },
    revokedAt: Date,                                 // Null = sessions actives
    lastLoginAt: Date,
    passwordResetToken: String,
    passwordResetExpiry: Date,
    /**
     * Mot de passe temporaire attribué par un administrateur : l'utilisateur
     * doit le remplacer à sa prochaine connexion. Sans ce drapeau, un mot de
     * passe dicté au téléphone reste en place des mois — connu de deux
     * personnes.
     */
    mustChangePassword: { type: Boolean, default: false },
    passwordChangedAt: Date,
    // Authentification à deux facteurs (TOTP).
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: String,   // secret actif (base32)
    twoFactorPending: String,  // secret en cours de configuration (avant validation)
    twoFactorBackupCodes: { type: [String], default: undefined }, // codes de secours hachés (bcrypt)
    // RGPD : consentements de communication horodatés + demande de suppression.
    consents: {
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
      updatedAt: Date,
    },
    deletionRequestedAt: Date,
  },
  { timestamps: true }
);

// Unicité email par tenant
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
UserSchema.index({ email: 1 });

// Ne jamais retourner le hash en sérialisation JSON
// Champs jamais sérialisés vers le client, quelle que soit la route.
const SENSITIVE_FIELDS = [
  "passwordHash", "passwordResetToken", "passwordResetExpiry",
  "twoFactorSecret", "twoFactorPending", "twoFactorBackupCodes",
] as const;

UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const plain = ret as unknown as Record<string, unknown>;
    for (const field of SENSITIVE_FIELDS) delete plain[field];
    return plain;
  },
});

export const UserModel = models.User || model<IUser>("User", UserSchema);
