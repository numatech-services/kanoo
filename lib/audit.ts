import { TokenPayload } from "./auth";

export type AuditAction =
  | "CREATE" | "UPDATE" | "DELETE" | "READ"
  | "LOGIN" | "LOGOUT" | "LOGIN_FAILED"
  | "EXPORT" | "IMPORT"
  | "APPROVE" | "REJECT"
  | "PAYMENT" | "INVOICE_SENT" | "INVOICE_PAID";

export interface AuditEntry {
  tenantId: string;
  userId: string;
  userEmail: string;
  userRole: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Enregistre une entrée d'audit en base
 * Import dynamique pour éviter les dépendances circulaires
 */
export async function logAudit(
  auth: TokenPayload,
  action: AuditAction,
  resource: string,
  options?: {
    resourceId?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { AuditLogModel } = await import("@/models/AuditLog");
    await AuditLogModel.create({
      tenantId: auth.tenantId,
      userId: auth.userId,
      userEmail: auth.email,
      userRole: auth.role,
      action,
      resource,
      resourceId: options?.resourceId,
      before: options?.before,
      after: options?.after,
      ip: options?.ip,
      userAgent: options?.userAgent,
      metadata: options?.metadata,
      createdAt: new Date(),
    });
  } catch (err) {
    // Ne jamais faire échouer une opération métier pour un log d'audit
    console.error("[Audit] Erreur lors de l'enregistrement:", err);
  }
}
