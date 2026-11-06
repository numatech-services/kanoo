import { NextRequest } from "next/server";
import { contractScope, marketsOnly } from "@/lib/contract-input";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, forbidden } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (marketsOnly(auth)) return forbidden("La signature d\'un contrat revient à la direction.");
  await connectDB();
  const { signatureDataUrl, signerName, signerRole, signedDate } = await req.json().catch(() => ({}));
  if (!signerName || !String(signerName).trim()) return badRequest("Nom du signataire requis");
  // Image de signature facultative (l'original signé se joint en document) ;
  // si elle est fournie, ce doit être une image.
  if (signatureDataUrl && !String(signatureDataUrl).startsWith("data:image/")) return badRequest("Format de signature invalide");
  const date = signedDate ? new Date(String(signedDate)) : new Date();
  if (isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) return badRequest("Date de signature invalide.");

  const contract = await ContractModel.findOne({ _id: params.id, ...contractScope(auth) });
  if (!contract) return notFound();
  if (contract.status !== "draft") return badRequest("Seul un contrat en brouillon se signe.");

  const name = String(signerName).trim().slice(0, 120);
  const role = String(signerRole || "").trim().slice(0, 80);
  contract.notes = (contract.notes || "") + `\n[SIGNATURE] ${name}${role ? ` (${role})` : ""} — ${date.toLocaleDateString("fr-FR")}`;
  contract.signedDate = date;
  contract.status = "active";
  await contract.save();

  await logAudit(auth, "SIGN", "contracts", { resourceId: params.id, after: { signerName: name, signerRole: role, signedAt: date.toISOString() } });
  return ok({ message: `Contrat signé par ${name}`, contract });
});
