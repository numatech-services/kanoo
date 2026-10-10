import { Types } from "mongoose";

// ─── Tenant ───────────────────────────────────────────────────────────────────

export type TenantType = "pme" | "association" | "administration";

/** `pending_activation` : inscrit, adresse e-mail pas encore prouvée. */
export type SubscriptionStatus = "pending_activation" | "trial" | "active" | "suspended" | "cancelled" | "none";

export type PlanCode = "starter" | "pro" | "enterprise" | "asso_basic" | "asso_pro" | "admin";

export interface ITenant {
  _id: Types.ObjectId;
  accountingLockedUntil?: Date;
  closedFiscalYears?: number[];
  type: TenantType;
  name: string;
  slug: string;
  nif?: string;
  rccm?: string;
  address?: string;
  phone?: string;
  email?: string;
  logo?: string;
  plan: PlanCode;
  planModules: string[];
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt?: Date;
  subscriptionEndsAt?: Date;
  activatedAt?: Date;
  activationToken?: string;
  activationTokenExpiry?: Date;
  branding?: { primaryColor?: string; secondaryColor?: string };
  preferredLanguage?: "fr" | "en";
  /** Identité de facturation certifiée (SECeF Niger). */
  secef?: { isf?: string; mcfId?: string; certifiedSince?: Date };
  /** Quota mensuel de l'assistant IA — voir lib/ai-quota.ts. */
  aiUsage?: { month?: string; count?: number; monthlyQuota?: number | null };
  documentPrefixes?: DocumentPrefixes;
  documentSequences?: DocumentSequences;
  numberingConfig?: NumberingConfig;
  /** Règles de frais — voir lib/expenses.ts. */
  expensePolicy?: {
    caps?: Record<string, number>;
    /** Aucun défaut : le Niger ne publie pas de barème kilométrique. */
    mileageRate?: number;
    receiptThreshold?: number;
    maxAgeDays?: number;
    vatRate?: number;
  };
  paymentAttempts?: PaymentAttempt[];
  subscriptionActivatedAt?: Date;
  subscriptionNextBilling?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Préfixes de numérotation par type de document. */
export interface DocumentPrefixes {
  invoice?: string;
  devis?: string;
  commande?: string;
  delivery?: string;
  marche?: string;
  contract?: string;
}

/** Séquences de départ, utilisées lors d'une migration depuis un logiciel existant. */
export interface DocumentSequences {
  invoice?: number;
  devis?: number;
  commande?: number;
  delivery?: number;
}

/**
 * Configuration de numérotation d'un tenant. Les champs `*Sequence` sont
 * incrémentés atomiquement par `nextDocumentNumber` ; ne jamais les écrire
 * depuis une route.
 */
export interface NumberingConfig {
  invoicePrefix?: string;
  quotePrefix?: string;
  orderPrefix?: string;
  deliveryPrefix?: string;
  contractPrefix?: string;
  creditNotePrefix?: string;
  purchasePrefix?: string;
  separator?: string;
  digitCount?: number;
  yearInNumber?: boolean;
  resetYearly?: boolean;
  invoiceSequence?: number;
  quoteSequence?: number;
  orderSequence?: number;
  deliverySequence?: number;
  contractSequence?: number;
  creditNoteSequence?: number;
  purchaseSequence?: number;
  invoiceStartAt?: number;
  /** Année couverte par les séquences courantes — sert au remise à zéro annuelle. */
  sequenceYear?: number;
}

/** Tentative de paiement d'abonnement, adossée au webhook PayDunya. */
export interface PaymentAttempt {
  orderId: string;
  amount?: number;
  plan?: string;
  status?: "pending" | "completed" | "failed";
  createdAt?: Date;
  completedAt?: Date;
}

// ─── User / Roles ─────────────────────────────────────────────────────────────

/**
 * Liste UNIQUE des rôles. Le type `UserRole`, l'enum Mongoose du modèle User et
 * les contrôles d'API en dérivent : ajouter un rôle ici suffit, et il ne peut
 * plus être « proposé à l'écran mais refusé en base » (cas des rôles ISIC).
 */
export const USER_ROLES = [
  // PME
  "pme_admin", "pme_manager", "pme_accountant", "pme_sales",
  "pme_purchases", "pme_hr", "pme_project_manager",
  "pme_approver", "pme_viewer",
  "pme_isic_operator",    // Cartes ISIC : production/impression/livraison, sans finances
  "pme_isic_finance",     // Cartes ISIC : volet financier (coûts, revente, encaissements)
  "pme_activity_manager", // Comptoir d'activité (The Spot) : stock matière + caisse, sans le reste de la compta
  // Services de l'organisation cloisonnée (niveau chef / employé / stagiaire par rôle)
  "svc_admin",   // Administration : vente matériel/mobilier, achats, stock, appels d'offres, dossiers RH
  "svc_comm",    // Communication (interne et clients)
  "svc_prosp",   // Prospection : prospects, CRM, devis, veille appels d'offres
  "svc_dev",     // Développement logiciel
  "svc_prod",    // Production & Cartes (ISIC, Easypay)
  "svc_spot",    // The Spot : restauration multi-site, limité aux sites attribués
  "svc_secu",    // Sécurité : contrôle des accès physiques
  "svc_compta",  // Comptabilité : seule avec le gérant à voir les finances
  // Associations
  "asso_president", "asso_treasurer", "asso_secretary",
  "asso_project_manager", "asso_member_portal",
  // Administration
  "admin_ordonnateur", "admin_daf", "admin_public_accountant",
  "admin_procurement_officer", "admin_procurement_commission",
  "admin_viewer",
  // Transversal
  "chef_projet_transversal", // Accès projets tous profils, sans facturation
  "tech_admin",              // Intégration, journaux, support — aucune donnée financière
  // Platform
  "superadmin",
] as const;

export type UserRole = typeof USER_ROLES[number];

export interface IUser {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  /** Rôles cumulés ; `role` reste le principal. Union des permissions. */
  roles?: UserRole[];
  /** Niveau par rôle de service (chef / employe / stagiaire). */
  roleLevels?: Record<string, "chef" | "employe" | "stagiaire">;
  /** The Spot : comptoirs attribués. */
  siteIds?: Types.ObjectId[];
  /** Fin d'accès (stagiaires). */
  accessUntil?: Date;
  allowedResources?: string[];
  phone?: string;
  avatar?: string;
  isActive: boolean;
  /** Incrémenté pour révoquer toutes les sessions ouvertes de l'utilisateur. */
  sessionVersion: number;
  lastActivityAt?: Date;
  revokedAt?: Date;
  /** Compte supprimé (anonymisé) par un administrateur. */
  deletedAt?: Date;
  lastLoginAt?: Date;
  passwordResetToken?: string;
  /** Mot de passe temporaire : remplacement exigé à la prochaine connexion. */
  mustChangePassword?: boolean;
  passwordChangedAt?: Date;
  passwordResetExpiry?: Date;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorPending?: string;
  twoFactorBackupCodes?: string[];
  consents?: { email?: boolean; whatsapp?: boolean; sms?: boolean; updatedAt?: Date };
  deletionRequestedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── PME Types ────────────────────────────────────────────────────────────────

export interface IClient {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  code: string;
  name: string;
  type: "individual" | "company";
  nif?: string;
  rccm?: string;
  email?: string;
  phone?: string;
  address?: string;
  /** Logo propre du client (data-URI). */
  logo?: string;
  creditLimit: number;
  currentBalance: number;
  paymentTermDays: number;
  isActive: boolean;
  notes?: string;
  createdAt: Date;
}

export interface ISupplier {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  code: string;
  name: string;
  nif?: string;
  rccm?: string;
  email?: string;
  phone?: string;
  address?: string;
  /** Logo propre du fournisseur (data-URI). */
  logo?: string;
  notes?: string;
  paymentTermDays: number;
  bankName?: string;
  bankAccount?: string;
  isActive: boolean;
  /** Code d'accès au portail fournisseur, haché (bcrypt). */
  accessCodeHash?: string;
  accessCodeGeneratedAt?: Date;
  createdAt: Date;
}

export interface IProduct {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  code: string;
  label: string;
  description?: string;
  unitPrice: number;
  tvaRate: number;
  unit: string;
  stockQty: number;
  stockMinAlert: number;
  purchaseCost?: number;
  lastPurchaseCost?: number;
  category?: string;
  barcode?: string;
  location?: string;
  preferredSupplierId?: Types.ObjectId;
  stockMaxAlert?: number;
  trackingMode?: "none" | "lot" | "serial";
  isService: boolean;
  accountCode?: string;
  isActive: boolean;
}

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "cancelled";
export type DevisStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export type CommandeStatus = "draft" | "confirmed" | "partially_received" | "received" | "cancelled" | "invoiced";

export interface IInvoiceLine {
  productId?: Types.ObjectId;
  description: string;
  quantity: number;
  unitPrice: number;
  tvaRate: number;
  discount: number;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  /** Ligne de déduction d'un acompte déjà facturé (montant négatif). */
  kind?: "deposit_deduction";
  depositInvoiceId?: Types.ObjectId;
}

export type InvoiceDocumentType = "invoice" | "credit_note";
/** Facture ordinaire, ou facture d'acompte (avance sur un marché, compte 419). */
export type InvoiceKind = "standard" | "deposit";

export interface IInvoice {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  /** Facture ou avoir. Toute somme de CA doit filtrer dessus. */
  documentType: InvoiceDocumentType;
  originalInvoiceId?: Types.ObjectId;
  creditReason?: string;
  /** TTC déjà couvert par des avoirs, sur une facture d'origine. */
  creditedAmount: number;
  number: string;
  projectId?: Types.ObjectId;
  activityId?: Types.ObjectId;
  clientId: Types.ObjectId;
  quoteId?: Types.ObjectId;
  /** Marché (contrat) facturé, et échéance de son échéancier. */
  contractId?: Types.ObjectId;
  milestoneId?: Types.ObjectId;
  kind?: InvoiceKind;
  /** Facture d'acompte : part HT déjà déduite sur des factures suivantes. */
  depositUsedHT?: number;
  lines: IInvoiceLine[];
  totalHT: number;
  totalTVA: number;
  totalDTS: number;
  totalTTC: number;
  retenueSource?: number;
  status: InvoiceStatus;
  issueDate: Date;
  dueDate: Date;
  paidAmount: number;
  /** Litige ouvert : suspend les relances automatiques. */
  disputedAt?: Date;
  disputeReason?: string;
  notes?: string;
  termsAndConditions?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  /** Certification SECeF — voir lib/secef. */
  secef?: {
    code?: string;
    qrPayload?: string;
    certifiedAt?: Date;
    counters?: string;
    signature?: string;
    mcfId?: string;
    driver?: string;
    invoiceType?: "FV" | "FA";
    referencedCode?: string;
  };
}

export interface IDevis {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  clientId: Types.ObjectId;
  lines: IInvoiceLine[];
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  status: DevisStatus;
  issueDate: Date;
  validUntil: Date;
  notes?: string;
  convertedToInvoiceId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  /** Marché créé depuis ce devis accepté, et son projet d'exécution. */
  contractId?: Types.ObjectId;
  projectId?: Types.ObjectId;
}

export interface IPayment {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  invoiceId: Types.ObjectId;
  amount: number;
  method: "cash" | "bank_transfer" | "cheque" | "mobile_money" | "other";
  reference?: string;
  date: Date;
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  /** Compte de trésorerie encaissé. */
  treasuryAccountId?: Types.ObjectId;
  /** « effective » = encaissé (impacte compta/trésorerie) ; « pending » = en attente. */
  status?: "pending" | "effective" | "cancelled";
  cancelledAt?: Date;
  cancelReason?: string;
}

export interface ICommande {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  supplierId: Types.ObjectId;
  lines: IInvoiceLine[];
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  status: CommandeStatus;
  orderDate: Date;
  expectedDeliveryDate?: Date;
  notes?: string;
  projectId?: Types.ObjectId;
  activityId?: Types.ObjectId;
  costCenter?: string;
  purchaseId?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

export interface IGoodsReceipt {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  commandeId: Types.ObjectId;
  supplierId: Types.ObjectId;
  lines: Array<{
    commandeLineIndex: number;
    description: string;
    orderedQty: number;
    receivedQty: number;
    unitPrice: number;
  }>;
  receiptDate: Date;
  notes?: string;
  receivedBy: Types.ObjectId;
  createdAt: Date;
}

export interface IEmployee {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  code: string;
  firstName: string;
  lastName: string;
  position: string;
  department?: string;
  grossSalary: number;
  startDate: Date;
  endDate?: Date;
  cnssNumber?: string;
  nif?: string;
  phone?: string;
  email?: string;
  bankAccount?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface IPayslip {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  employeeId: Types.ObjectId;
  month: number;
  year: number;
  /** Salaire de base contractuel. */
  grossSalary: number;
  /** Base + ancienneté + primes — c'est l'assiette des cotisations. */
  grossTotal: number;
  seniorityRate: number;
  seniorityAmount: number;
  cnssEmployee: number;
  cnssEmployer: number;
  /** Impôt sur le revenu retenu à la source (barème mensuel CGI art. 84). */
  incomeTax: number;
  otherDeductions: number;
  items?: Array<{ label: string; amount: number; type: "addition" | "deduction" }>;
  netImposable?: number;
  accountingEntryId?: Types.ObjectId;
  netSalary: number;
  /** Coût total employeur : brut total + part patronale. */
  employerCost: number;
  isPaid: boolean;
  paidAt?: Date;
  createdAt: Date;
}

// ─── Comptabilité ─────────────────────────────────────────────────────────────

export type JournalCode = "AC" | "VT" | "BQ" | "CA" | "OD" | "AN" | "EX";

export interface IAccountingLine {
  accountCode: string;
  accountLabel: string;
  debit: number;
  credit: number;
  thirdPartyId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  activityId?: Types.ObjectId;
  costCenter?: string;
}

export interface IAccountingEntry {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  journalCode: JournalCode;
  entryDate: Date;
  reference: string;
  label: string;
  lines: IAccountingLine[];
  isLettered: boolean;
  letterRef?: string;
  linkedDocType?: string;
  reversedBy?: Types.ObjectId;
  reverses?: Types.ObjectId;
  linkedDocId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

// ─── Associations Types ───────────────────────────────────────────────────────

export type MemberStatus = "active" | "inactive" | "suspended" | "expelled";

export interface IMember {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  code: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  membershipType: string;
  joinDate: Date;
  status: MemberStatus;
  portalPassword?: string;
  /** Code d'accès au portail, haché (bcrypt). Jamais stocké en clair. */
  accessCodeHash?: string;
  /** @deprecated Code en clair d'avant le hachage — migré à la première connexion. */
  accessCode?: string;
  accessCodeGeneratedAt?: Date;
  accessCodeSentAt?: Date;
  createdAt: Date;
}

export interface IMembership {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  memberId: Types.ObjectId;
  year: number;
  amount: number;
  paidAt?: Date;
  paymentMethod?: string;
  receiptNumber: string;
  createdAt: Date;
}

export interface IDonation {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  donorName?: string;
  donorType: "individual" | "company" | "anonymous";
  donorContact?: string;
  amount: number;
  currency: "XOF" | "EUR" | "USD";
  campaign?: string;
  date: Date;
  paymentMethod?: string;
  receiptNumber: string;
  receiptGeneratedAt?: Date;
  notes?: string;
  createdAt: Date;
}

export interface IGeneralAssembly {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  title: string;
  type: "ordinary" | "extraordinary";
  date: Date;
  location: string;
  convocationSentAt?: Date;
  quorumRequired: number;
  quorumAchieved: number;
  attendees: Types.ObjectId[];
  decisions: Array<{ text: string; votes: { for: number; against: number; abstain: number }; passed: boolean }>;
  pvDocumentId?: Types.ObjectId;
  /** Procès-verbal joint (data-URI). */
  pvFile?: { name?: string; dataUri?: string; uploadedAt?: Date };
  createdAt: Date;
}

// ─── Administration Types ─────────────────────────────────────────────────────

export interface IBudgetChapter {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  code: string;
  label: string;
  year: number;
  allocatedAmount: number;
  engagedAmount: number;
  mandatedAmount: number;
  paidAmount: number;
  parentId?: Types.ObjectId;
  level: "titre" | "chapitre" | "article" | "ligne";
  createdAt: Date;
}

export type TenderStatus =
  | "planning" | "draft" | "published" | "bids_open" | "bids_closed"
  | "evaluation" | "attributed" | "cancelled" | "completed";

export type TenderProcedure =
  | "achat_direct" | "consultation_restreinte"
  | "appel_offres_ouvert" | "appel_offres_international" | "gre_a_gre";

export interface IPublicTender {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  reference: string;
  object: string;
  budgetChapterId?: Types.ObjectId;
  estimatedAmount: number;
  procedure: TenderProcedure;
  status: TenderStatus;
  publishDate?: Date;
  bidsDeadline?: Date;
  openingDate?: Date;
  attributionDate?: Date;
  winnerId?: Types.ObjectId;
  /** Nom du titulaire (peut être une entreprise non enregistrée comme fournisseur). */
  winnerName?: string;
  winnerAmount?: number;
  commissionMemberIds: Types.ObjectId[];
  /** Soumissions reçues (dépouillement des plis). */
  bids?: {
    _id?: Types.ObjectId;
    bidderName: string;
    supplierId?: Types.ObjectId;
    amount: number;
    compliant?: boolean;
    notes?: string;
  }[];
  cancelReason?: string;
  engagementId?: Types.ObjectId;
  notes?: string;
  createdAt: Date;
}

export interface ICommitmentOrder {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  chapterId: Types.ObjectId;
  tenderId?: Types.ObjectId;
  supplierId?: Types.ObjectId;
  amount: number;
  label: string;
  date: Date;
  validatedBy?: Types.ObjectId;
  validatedAt?: Date;
  status: "draft" | "validated" | "rejected";
  createdBy: Types.ObjectId;
  createdAt: Date;
}

export interface IPaymentOrder {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  commitmentId: Types.ObjectId;
  amount: number;
  beneficiaryId: Types.ObjectId;
  retenueSource?: number;
  date: Date;
  status: "draft" | "ordered" | "paid" | "rejected";
  paidAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
