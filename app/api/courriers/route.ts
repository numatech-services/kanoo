import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { LetterModel } from "@/models/Letter";
import { parseAttachment } from "@/lib/attachment";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { nextSerial } from "@/lib/serial";

export const dynamic = "force-dynamic";

const KINDS = ["courrier", "rapport", "attestation", "note", "reponse_ao", "autre"];

export const GET = withAuth("documents", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const p = getPagination(req);
  const url = new URL(req.url);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  // Par défaut on montre les courriers actifs ; ?archived=1 pour les archivés.
  filter.archived = url.searchParams.get("archived") === "1" ? true : { $ne: true };
  const direction = url.searchParams.get("direction");
  if (direction === "incoming" || direction === "outgoing") filter.direction = direction;
  // Recherche : référence (CR-2026-003), objet, destinataire / expéditeur.
  const q = (url.searchParams.get("q") || "").trim();
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ reference: rx }, { subject: rx }, { recipient: rx }];
  }
  const [items, total] = await Promise.all([
    LetterModel.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit)
      // Nom de la pièce jointe seulement : le contenu (data-URI, jusqu'à 2,5 Mo)
      // n'est chargé qu'à l'ouverture du courrier, pas dans la liste.
      .select("reference kind subject recipient status direction archived dueDate handled aiAssisted createdAt attachment.name").lean(),
    LetterModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, p);
});

export const POST = withAuth("documents", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["subject"]);
  if (err) return badRequest(err);

  // Numéro attribué automatiquement (CR-AAAA-NNNN), modifiable : une référence
  // saisie à la main est respectée.
  let reference = String(body.reference || "").slice(0, 60).trim();
  if (!reference) {
    // Compteur atomique de la série CR de l'année (deux courriers simultanés
    // prenaient le même « plus grand numéro + 1 »).
    reference = await nextSerial(auth.tenantId, { prefix: "CR", year: new Date().getFullYear(), digits: 4, model: LetterModel as never, field: "reference" });
  }

  const att = parseAttachment(body.attachment);
  if (!att.ok) return badRequest(att.error);

  const letter = await LetterModel.create({
    tenantId: auth.tenantId,
    reference,
    direction: body.direction === "incoming" ? "incoming" : "outgoing",
    attachment: att.value ?? undefined,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
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
