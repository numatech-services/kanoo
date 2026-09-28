import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicBatchModel } from "@/models/IsicBatch";
import { IsicCardModel } from "@/models/IsicCard";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Parse un CSV simple (délimiteur , ou ;). Renvoie { headers, rows }. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const delim = (lines[0].match(/;/g)?.length || 0) > (lines[0].match(/,/g)?.length || 0) ? ";" : ",";
  const split = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
  return { headers: split(lines[0]).map((h) => h.toLowerCase()), rows: lines.slice(1).map(split) };
}
const col = (headers: string[], ...names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

const STATUSES = ["pending", "numbered", "printed", "delivered"];

async function getBatch(id: string, auth: TokenPayload) {
  return IsicBatchModel.findOne({ _id: id, ...tenantFilter(auth) }).lean<{ _id: unknown } | null>();
}

/** GET — liste des cartes du lot + compteurs par statut. */
export const GET = withAuth("isic", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const cards = await IsicCardModel.find({ batchId: params.id, ...tenantFilter(auth) }).sort({ studentName: 1 }).limit(5000).lean();
  const counts = cards.reduce((acc: Record<string, number>, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});
  return ok({ cards, counts, total: cards.length });
});

/**
 * POST — actions sur les cartes :
 *  - import-students {csv} : crée les cartes (nom + matricule).
 *  - import-numbers  {csv} : renseigne le numéro ISIC par matricule → « numbered ».
 *  - advance {from, to}    : fait avancer en masse le statut (ex. numbered→printed).
 */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const batch = await getBatch(String(params.id), auth);
  if (!batch) return notFound("Lot ISIC introuvable");
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "import-students") {
    const { headers, rows } = parseCsv(String(body.csv || ""));
    const iName = col(headers, "nom complet", "student", "nom", "name", "prénom");
    const iMat = col(headers, "matricule", "matric", "numéro étudiant", "student id", "id");
    if (iName < 0) return badRequest("Colonne du nom introuvable dans le fichier (ex. « nom »).");
    const docs = rows.map((r) => ({
      tenantId: auth.tenantId, batchId: batch._id,
      studentName: (r[iName] || "").slice(0, 200), matricule: iMat >= 0 ? (r[iMat] || "").slice(0, 60) : undefined,
      status: "pending" as const,
    })).filter((d) => d.studentName).slice(0, 20000);
    if (!docs.length) return badRequest("Aucune ligne exploitable.");
    await IsicCardModel.insertMany(docs);
    await logAudit(auth, "CREATE", "isic", { resourceId: String(params.id), metadata: { importedCards: docs.length } });
    return ok({ imported: docs.length });
  }

  if (action === "import-numbers") {
    const { headers, rows } = parseCsv(String(body.csv || ""));
    const iMat = col(headers, "matricule", "matric", "student id", "id");
    const iNum = col(headers, "isic", "numéro isic", "numero", "number", "card number");
    if (iMat < 0 || iNum < 0) return badRequest("Colonnes matricule et numéro ISIC requises dans le fichier.");
    let updated = 0;
    for (const r of rows) {
      const mat = (r[iMat] || "").trim(); const num = (r[iNum] || "").trim();
      if (!mat || !num) continue;
      const res = await IsicCardModel.updateOne(
        { batchId: batch._id, ...tenantFilter(auth), matricule: mat },
        { $set: { isicNumber: num, status: "numbered" } }
      );
      updated += res.modifiedCount;
    }
    return ok({ updated });
  }

  if (action === "advance") {
    if (!STATUSES.includes(body.from) || !STATUSES.includes(body.to)) return badRequest("Statuts invalides.");
    const res = await IsicCardModel.updateMany(
      { batchId: batch._id, ...tenantFilter(auth), status: body.from },
      { $set: { status: body.to } }
    );
    return ok({ advanced: res.modifiedCount });
  }

  return badRequest("Action inconnue.");
});

/** DELETE — vide les cartes du lot (repartir d'un import propre). */
export const DELETE = withAuth("isic", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const res = await IsicCardModel.deleteMany({ batchId: params.id, ...tenantFilter(auth) });
  return ok({ deleted: res.deletedCount });
});
