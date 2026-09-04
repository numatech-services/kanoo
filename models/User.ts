import { Schema, model, models } from "mongoose";
import { IUser } from "@/types";

const UserSchema = new Schema<IUser>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: [
        "pme_admin","pme_manager","pme_accountant","pme_sales","pme_purchases",
        "pme_hr","pme_project_manager","pme_approver","pme_viewer",
        "asso_president","asso_treasurer","asso_secretary","asso_project_manager","asso_member_portal",
        "admin_ordonnateur","admin_daf","admin_public_accountant",
        "admin_procurement_officer","admin_procurement_commission","admin_viewer",
        // `chef_projet_transversal` manquait ici alors qu'il était proposé à
        // la création : toute tentative échouait en validation Mongoose, avec
        // un message que personne ne rattachait à cette cause.
        "chef_projet_transversal","tech_admin",
        "superadmin",
      ],
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
      enum: [
        "pme_admin","pme_manager","pme_accountant","pme_sales","pme_purchases",
        "pme_hr","pme_project_manager","pme_approver","pme_viewer",
        "asso_president","asso_treasurer","asso_secretary","asso_project_manager","asso_member_portal",
        "admin_ordonnateur","admin_daf","admin_public_accountant",
        "admin_procurement_officer","admin_procurement_commission","admin_viewer",
        "chef_projet_transversal","tech_admin","superadmin",
      ],
      default: undefined,
    },
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
