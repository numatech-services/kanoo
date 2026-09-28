import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, notFound, tenantFilter } from "@/lib/api-helpers";
import { LetterModel } from "@/models/Letter";
import { TenantModel } from "@/models/Tenant";
import { generateLetterPdf, type LetterForPdf, type TenantIdentity } from "@/lib/pdf-document";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/courriers/:id/pdf — courrier PDF à la marque de l'organisation.
 * Passe par withAuth : la simple connexion ne suffisait pas, un rôle sans accès
 * aux documents pouvait télécharger un courrier dont il connaissait le lien.
 */
export const GET = withAuth("documents", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Courrier introuvable");

  const [letter, tenant] = await Promise.all([
    LetterModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean<(LetterForPdf & { subject?: string; createdAt?: Date }) | null>(),
    TenantModel.findById(auth.tenantId).select("name logo branding nif rccm address phone email").lean<TenantIdentity | null>(),
  ]);
  if (!letter) return notFound("Courrier introuvable");

  const buf = await generateLetterPdf({ ...letter, date: letter.date ?? letter.createdAt }, tenant ?? { name: "Organisation" });
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${(letter.subject || "courrier").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}.pdf"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
});
