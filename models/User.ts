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
        "superadmin",
      ],
      required: true,
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
UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.passwordResetToken;
    delete ret.passwordResetExpiry;
    delete ret.twoFactorSecret;
    delete ret.twoFactorPending;
    delete ret.twoFactorBackupCodes;
    return ret;
  },
});

export const UserModel = models.User || model<IUser>("User", UserSchema);
