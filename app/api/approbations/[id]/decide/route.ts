import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { ApprobationModel } from "@/models/Approbation";
import { NotificationModel } from "@/models/Notification";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("approbations", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const { id } = params;
  const body = await req.json();
  if (!body.decision || !["approved", "rejected"].includes(body.decision)) {
    return badRequest("decision doit être 'approved' ou 'rejected'");
  }

  const approbation = await ApprobationModel.findOne({ _id: id, ...tenantFilter(auth) });
  if (!approbation) return notFound("Approbation introuvable");
  if (approbation.status !== "pending") return badRequest("Cette approbation est déjà traitée");

  const approverEntry = approbation.approvers.find(
    (a: { userId: { toString(): string }; level: number; status: string }) =>
      a.userId.toString() === auth.userId &&
      a.level === approbation.currentLevel &&
      a.status === "pending"
  );
  if (!approverEntry) return forbidden("Vous n'êtes pas autorisé à décider sur cette approbation");

  approverEntry.status = body.decision;
  approverEntry.comment = body.comment || "";
  approverEntry.decidedAt = new Date();

  if (body.decision === "rejected") {
    approbation.status = "rejected";
    await NotificationModel.create({
      tenantId: auth.tenantId, userId: approbation.requestedBy,
      type: "approval_rejected", title: "Demande refusée",
      message: `Votre demande sur ${approbation.resource} a été refusée. Motif : ${body.comment || "Aucun commentaire"}`,
      linkedTo: "approbations", linkedId: approbation._id,
    });
  } else {
    const nextLevel = approbation.currentLevel + 1;
    const nextApprover = approbation.approvers.find((a: { level: number }) => a.level === nextLevel);
    if (nextApprover) {
      approbation.currentLevel = nextLevel;
      await NotificationModel.create({
        tenantId: auth.tenantId, userId: (nextApprover as { userId: string }).userId,
        type: "approval_request", title: `Approbation niveau ${nextLevel}`,
        message: `Une demande d'approbation de niveau ${nextLevel} vous attend`,
        linkedTo: "approbations", linkedId: approbation._id,
      });
    } else {
      approbation.status = "approved";
      await NotificationModel.create({
        tenantId: auth.tenantId, userId: approbation.requestedBy,
        type: "approval_approved", title: "Demande approuvée",
        message: `Votre demande sur ${approbation.resource} a été approuvée`,
        linkedTo: "approbations", linkedId: approbation._id,
      });
    }
  }

  await approbation.save();
  await logAudit(auth, body.decision === "approved" ? "APPROVE" : "REJECT", "approbations", {
    resourceId: id, after: { decision: body.decision },
  });
  return ok(approbation);
});
