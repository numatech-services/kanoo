import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { validateApiKey } from "@/lib/api-v1-middleware";
import { ClientModel } from "@/models/Client";

export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if ("error" in auth) return auth.error;
  if (!auth.context.scopes.includes("clients:read") && !auth.context.scopes.includes("*")) {
    return NextResponse.json({ error: "Scope insuffisant. Requis: clients:read" }, { status: 403 });
  }

  await connectDB();
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const search = url.searchParams.get("search") || "";

  const filter: Record<string, unknown> = { tenantId: auth.context.tenantId, isActive: true };
  if (search) filter.$or = [{ name: { $regex: search, $options: "i" } }, { code: { $regex: search, $options: "i" } }];

  const [items, total] = await Promise.all([
    ClientModel.find(filter).select("code name type nif phone email currentBalance paymentTermDays").sort({ name: 1 }).skip((page-1)*limit).limit(limit).lean(),
    ClientModel.countDocuments(filter),
  ]);

  return NextResponse.json({
    success: true,
    data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total/limit) } },
    api_version: "v1",
  });
}
