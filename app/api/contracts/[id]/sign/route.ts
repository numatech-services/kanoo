import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const { signatureDataUrl, signerName, signerRole } = await req.json();
  if (!signatureDataUrl) return badRequest("Signature requise");
  if (!signerName) return badRequest("Nom du signataire requis");
  if (!signatureDataUrl.startsWith("data:image/")) return badRequest("Format de signature invalide");

  const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!contract) return notFound();

  contract.notes = (contract.notes || "") + `\n[SIGNATURE] ${signerName} (${signerRole || auth.role}) — ${new Date().toLocaleString("fr-FR")}`;
  contract.signedDate = new Date();
  if (contract.status === "draft") contract.status = "active";
  await contract.save();

  await logAudit(auth, "SIGN", "contracts", { resourceId: params.id, after: { signerName, signedAt: new Date().toISOString() } });
  return ok({ message: `Contrat signé par ${signerName}`, contract });
});
