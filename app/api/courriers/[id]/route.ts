import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { LetterModel } from "@/models/Letter";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = withAuth("documents", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const letter = await LetterModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!letter) return notFound("Courrier introuvable");
  return ok(letter);
});

export const PATCH = withAuth("documents", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  // Liste blanche : seuls ces champs sont modifiables. `sanitizeBody` retire au
  // passage tout champ jamais inscriptible ou tout opérateur Mongo ($set…).
  const ALLOWED = ["reference", "kind", "subject", "recipient", "place", "body", "signatory", "status", "aiAssisted", "direction", "archived", "attachment"];
  const clean = sanitizeBody(body);
  const update: Record<string, unknown> = {};
  for (const field of ALLOWED) {
    if (field in clean) update[field] = clean[field];
  }
  const letter = await LetterModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, { $set: update }, { new: true }
  );
  if (!letter) return notFound("Courrier introuvable");
  await logAudit(auth, "UPDATE", "documents", { resourceId: String(params.id) });
  return ok(letter);
});

export const DELETE = withAuth("documents", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const r = await LetterModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  if (!r) return notFound("Courrier introuvable");
  await logAudit(auth, "DELETE", "documents", { resourceId: String(params.id) });
  return noContent();
});
