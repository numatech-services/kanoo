import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { LetterModel } from "@/models/Letter";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const KINDS = ["courrier", "rapport", "attestation", "note", "reponse_ao", "autre"];

export const GET = withAuth("documents", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const p = getPagination(req);
  const filter = { ...tenantFilter(auth) };
  const [items, total] = await Promise.all([
    LetterModel.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit)
      .select("reference kind subject recipient status aiAssisted createdAt").lean(),
    LetterModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, p);
});

export const POST = withAuth("documents", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["subject"]);
  if (err) return badRequest(err);

  const letter = await LetterModel.create({
    tenantId: auth.tenantId,
    reference: String(body.reference || "").slice(0, 60) || undefined,
    kind: KINDS.includes(body.kind) ? body.kind : "courrier",
    subject: String(body.subject).slice(0, 200),
    recipient: String(body.recipient || "").slice(0, 400),
    place: String(body.place || "").slice(0, 80),
    body: String(body.body || "").slice(0, 20_000),
    signatory: String(body.signatory || "").slice(0, 200),
    linkedTo: ["client", "supplier"].includes(body.linkedTo) ? body.linkedTo : undefined,
    linkedId: body.linkedId || undefined,
    aiAssisted: Boolean(body.aiAssisted),
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "documents", { resourceId: letter._id.toString(), metadata: { kind: letter.kind } });
  return created(letter);
});
