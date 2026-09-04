/**
 * Import / export de données, piloté par un registre d'entités.
 *
 * Chaque entité déclare sa ressource RBAC (donc les droits requis : `read`
 * pour exporter, `create` pour importer), ses colonnes d'export et, quand
 * l'entité est un jeu de données « plat » et sûr, ses champs d'import.
 *
 * Le contrôle d'accès n'est pas ici : les routes /api/data passent par withAuth
 * avec la ressource déclarée. Ce module ne fait que décrire la forme des données.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { ProductModel } from "@/models/Product";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { DevisModel } from "@/models/Devis";
import { EmployeeModel } from "@/models/Employee";

export interface ExportColumn { header: string; get: (doc: any) => unknown }
export interface ImportField { header: string; field: string; required?: boolean; kind?: "string" | "number" | "boolean"; enum?: string[]; default?: unknown }

export interface DataEntity {
  key: string;
  label: string;
  resource: string;
  model: any;
  /** Peuplements pour l'export (ex. nom du client sur une facture). */
  populate?: [string, string][];
  columns: ExportColumn[];
  sort?: Record<string, 1 | -1>;
  /** Présent si l'entité est importable (création). */
  import?: { fields: ImportField[]; uniqueBy: string };
}

const bool = (v: unknown) => (v ? "oui" : "non");
const date = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");

export const ENTITIES: Record<string, DataEntity> = {
  clients: {
    key: "clients", label: "Clients", resource: "clients", model: ClientModel, sort: { name: 1 },
    columns: [
      { header: "code", get: (d) => d.code }, { header: "name", get: (d) => d.name },
      { header: "type", get: (d) => d.type }, { header: "nif", get: (d) => d.nif },
      { header: "rccm", get: (d) => d.rccm }, { header: "email", get: (d) => d.email },
      { header: "phone", get: (d) => d.phone }, { header: "address", get: (d) => d.address },
      { header: "creditLimit", get: (d) => d.creditLimit }, { header: "paymentTermDays", get: (d) => d.paymentTermDays },
      { header: "isActive", get: (d) => bool(d.isActive) }, { header: "notes", get: (d) => d.notes },
    ],
    import: {
      uniqueBy: "code",
      fields: [
        { header: "code", field: "code", required: true }, { header: "name", field: "name", required: true },
        { header: "type", field: "type", enum: ["individual", "company"], default: "company" },
        { header: "nif", field: "nif" }, { header: "rccm", field: "rccm" },
        { header: "email", field: "email" }, { header: "phone", field: "phone" }, { header: "address", field: "address" },
        { header: "creditLimit", field: "creditLimit", kind: "number" },
        { header: "paymentTermDays", field: "paymentTermDays", kind: "number" },
        { header: "notes", field: "notes" },
      ],
    },
  },
  suppliers: {
    key: "suppliers", label: "Fournisseurs", resource: "suppliers", model: SupplierModel, sort: { name: 1 },
    columns: [
      { header: "code", get: (d) => d.code }, { header: "name", get: (d) => d.name },
      { header: "nif", get: (d) => d.nif }, { header: "rccm", get: (d) => d.rccm },
      { header: "email", get: (d) => d.email }, { header: "phone", get: (d) => d.phone },
      { header: "address", get: (d) => d.address }, { header: "bankName", get: (d) => d.bankName },
      { header: "bankAccount", get: (d) => d.bankAccount }, { header: "paymentTermDays", get: (d) => d.paymentTermDays },
      { header: "isActive", get: (d) => bool(d.isActive) },
    ],
    import: {
      uniqueBy: "code",
      fields: [
        { header: "code", field: "code", required: true }, { header: "name", field: "name", required: true },
        { header: "nif", field: "nif" }, { header: "rccm", field: "rccm" },
        { header: "email", field: "email" }, { header: "phone", field: "phone" }, { header: "address", field: "address" },
        { header: "bankName", field: "bankName" }, { header: "bankAccount", field: "bankAccount" },
        { header: "paymentTermDays", field: "paymentTermDays", kind: "number" },
      ],
    },
  },
  products: {
    key: "products", label: "Produits & services", resource: "products", model: ProductModel, sort: { label: 1 },
    columns: [
      { header: "code", get: (d) => d.code }, { header: "label", get: (d) => d.label },
      { header: "unitPrice", get: (d) => d.unitPrice }, { header: "tvaRate", get: (d) => d.tvaRate },
      { header: "unit", get: (d) => d.unit }, { header: "stockQty", get: (d) => d.stockQty },
      { header: "stockMinAlert", get: (d) => d.stockMinAlert }, { header: "isService", get: (d) => bool(d.isService) },
      { header: "isActive", get: (d) => bool(d.isActive) },
    ],
    import: {
      uniqueBy: "code",
      fields: [
        { header: "code", field: "code", required: true }, { header: "label", field: "label", required: true },
        { header: "unitPrice", field: "unitPrice", kind: "number" }, { header: "tvaRate", field: "tvaRate", kind: "number" },
        { header: "unit", field: "unit" }, { header: "stockQty", field: "stockQty", kind: "number" },
        { header: "stockMinAlert", field: "stockMinAlert", kind: "number" }, { header: "isService", field: "isService", kind: "boolean" },
      ],
    },
  },
  contracts: {
    key: "contracts", label: "Contrats", resource: "contracts", model: ContractModel, sort: { createdAt: -1 },
    columns: [
      { header: "reference", get: (d) => d.reference }, { header: "title", get: (d) => d.title },
      { header: "type", get: (d) => d.type }, { header: "status", get: (d) => d.status },
      { header: "amount", get: (d) => d.amount }, { header: "startDate", get: (d) => date(d.startDate) },
      { header: "endDate", get: (d) => date(d.endDate) },
    ],
  },
  invoices: {
    key: "invoices", label: "Factures", resource: "invoices", model: InvoiceModel, sort: { issueDate: -1 },
    populate: [["clientId", "name"]],
    columns: [
      { header: "number", get: (d) => d.number }, { header: "client", get: (d) => d.clientId?.name },
      { header: "issueDate", get: (d) => date(d.issueDate) }, { header: "dueDate", get: (d) => date(d.dueDate) },
      { header: "totalTTC", get: (d) => d.totalTTC }, { header: "paidAmount", get: (d) => d.paidAmount },
      { header: "status", get: (d) => d.status },
    ],
  },
  devis: {
    key: "devis", label: "Devis", resource: "devis", model: DevisModel, sort: { issueDate: -1 },
    populate: [["clientId", "name"]],
    columns: [
      { header: "number", get: (d) => d.number }, { header: "client", get: (d) => d.clientId?.name },
      { header: "issueDate", get: (d) => date(d.issueDate) }, { header: "validUntil", get: (d) => date(d.validUntil) },
      { header: "totalTTC", get: (d) => d.totalTTC }, { header: "status", get: (d) => d.status },
    ],
  },
  employees: {
    key: "employees", label: "Collaborateurs", resource: "employees", model: EmployeeModel, sort: { lastName: 1 },
    columns: [
      { header: "code", get: (d) => d.code }, { header: "firstName", get: (d) => d.firstName },
      { header: "lastName", get: (d) => d.lastName }, { header: "position", get: (d) => d.position },
      { header: "employeeType", get: (d) => d.employeeType }, { header: "grossSalary", get: (d) => d.grossSalary },
      { header: "startDate", get: (d) => date(d.startDate) }, { header: "isActive", get: (d) => bool(d.isActive) },
    ],
  },
};

// ─── CSV ─────────────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(r.map(esc).join(","));
  // BOM pour qu'Excel lise l'UTF-8 (accents) correctement.
  return "﻿" + lines.join("\r\n");
}

/** Parseur CSV tolérant : gère les guillemets, virgules et retours à la ligne. */
export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQ) {
      if (c === '"') { if (clean[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  return { headers: nonEmpty[0].map((h) => h.trim()), rows: nonEmpty.slice(1) };
}

/** Convertit une valeur texte selon le type déclaré du champ d'import. */
export function coerce(value: string, f: ImportField): unknown {
  const v = value?.trim() ?? "";
  if (f.kind === "number") { const n = Number(v.replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? undefined : n; }
  if (f.kind === "boolean") return /^(oui|true|1|vrai|yes|x)$/i.test(v);
  if (f.enum) return f.enum.includes(v) ? v : f.default;
  return v || undefined;
}
