import { Types } from "mongoose";

// ─── Tenant ───────────────────────────────────────────────────────────────────

export type TenantType = "pme" | "association" | "administration";

export type SubscriptionStatus = "trial" | "active" | "suspended" | "cancelled" | "none";

export type PlanCode = "starter" | "pro" | "enterprise" | "asso_basic" | "asso_pro" | "admin";

export interface ITenant {
  _id: Types.ObjectId;
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
  createdAt: Date;
  updatedAt: Date;
}

// ─── User / Roles ─────────────────────────────────────────────────────────────

export type UserRole =
  // PME
  | "pme_admin" | "pme_manager" | "pme_accountant" | "pme_sales"
  | "pme_purchases" | "pme_hr" | "pme_project_manager"
  | "pme_approver" | "pme_viewer"
  // Associations
  | "asso_president" | "asso_treasurer" | "asso_secretary"
  | "asso_project_manager" | "asso_member_portal"
  // Administration
  | "admin_ordonnateur" | "admin_daf" | "admin_public_accountant"
  | "admin_procurement_officer" | "admin_procurement_commission"
  | "admin_viewer"
  // Transversal
  | "chef_projet_transversal"   // Accès projets tous profils, sans facturation
  // Platform
  | "superadmin";

export interface IUser {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  allowedResources?: string[];
  phone?: string;
  avatar?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  passwordResetToken?: string;
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
  email?: string;
  phone?: string;
  address?: string;
  paymentTermDays: number;
  bankName?: string;
  bankAccount?: string;
  isActive: boolean;
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
}

export interface IInvoice {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  clientId: Types.ObjectId;
  quoteId?: Types.ObjectId;
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
  notes?: string;
  termsAndConditions?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
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
  grossSalary: number;
  cnssEmployee: number;
  cnssEmployer: number;
  otherDeductions: number;
  netSalary: number;
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
  linkedDocType?: "invoice" | "payment" | "supplier_invoice" | "payslip";
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
  winnerAmount?: number;
  commissionMemberIds: Types.ObjectId[];
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
