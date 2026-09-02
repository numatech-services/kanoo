import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { validateApiKey } from "@/lib/api-v1-middleware";
import { InvoiceModel } from "@/models/Invoice";

/**
 * GET /api/v1/invoices
 * API publique — authentification par clé API (Bearer kno_xxx)
 * Scope requis: invoices:read
 */
export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if ("error" in auth) return auth.error;
  if (!auth.context.scopes.includes("invoices:read") && !auth.context.scopes.includes("*")) {
    return NextResponse.json({ error: "Scope insuffisant. Requis: invoices:read" }, { status: 403 });
  }

  await connectDB();
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = { tenantId: auth.context.tenantId };
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    InvoiceModel.find(filter).select("number status totalHT totalTVA totalTTC paidAmount issueDate dueDate").sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean(),
    InvoiceModel.countDocuments(filter),
  ]);

  return NextResponse.json({
    success: true,
    data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total/limit) } },
    api_version: "v1",
    docs: "https://docs.kanoo.ne/api/v1/invoices",
  });
}
