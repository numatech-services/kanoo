import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// On utilise context: any pour accéder à params de manière sécurisée en 14.1
export const GET = withAuth("contracts", "read", async (_req: NextRequest, auth: TokenPayload, context: any) => {
  await connectDB();
  
  const id = context?.params?.id;
  if (!id) return notFound();

  const contract = await ContractModel.findOne({ _id: id, ...tenantFilter(auth) })
    .populate("clientId", "name code nif address phone email")
    .populate("supplierId", "name code")
    .populate("employeeId", "firstName lastName code position")
    .populate("invoiceIds", "number totalTTC status issueDate")
    .lean();

  if (!contract) return notFound();
  return ok(contract);
});

export const PATCH = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, context: any) => {
  await connectDB();
  
  const id = context?.params?.id;
  if (!id) return notFound();

  const body = await req.json();
  const contract = await ContractModel.findOneAndUpdate(
    { _id: id, ...tenantFilter(auth) }, 
    body, 
    { new: true }
  ).populate("clientId", "name code");

  if (!contract) return notFound();
  
  await logAudit(auth, "UPDATE", "contracts", { resourceId: id });
  return ok(contract);
});

export const DELETE = withAuth("contracts", "delete", async (_req: NextRequest, auth: TokenPayload, context: any) => {
  await connectDB();
  
  const id = context?.params?.id;
  if (!id) return notFound();

  const contract = await ContractModel.findOneAndUpdate(
    { _id: id, ...tenantFilter(auth) }, 
    { status: "cancelled" }, 
    { new: true }
  );

  if (!contract) return notFound();
  
  await logAudit(auth, "DELETE", "contracts", { resourceId: id });
  return noContent();
});