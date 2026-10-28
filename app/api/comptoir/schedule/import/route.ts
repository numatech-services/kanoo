import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { ownDesk } from "@/lib/comptoir";
import { readPlanningPdf } from "@/lib/timetable-pdf-server";
import { BusinessRuleError } from "@/lib/errors";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";
const MAX_FILES = 10, MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST (multipart : deskId, files[]) — lit des plannings de cours en PDF et
 * renvoie, pour chacun, la classe, l'année, les cours (dates, jours, heures),
 * la révision, les examens et les pauses. Rien n'est enregistré : l'écran
 * fait saisir l'effectif de chaque classe, puis enregistre l'emploi du temps.
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Envoi invalide.");
  if (!(await ownDesk(auth, form.get("deskId")))) return notFound("Comptoir introuvable");
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) return badRequest("Joignez au moins un planning PDF.");
  if (files.length > MAX_FILES) return badRequest(`${MAX_FILES} plannings au plus à la fois.`);
  const plannings = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return badRequest(`${f.name} : fichier trop lourd (10 Mo au plus).`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return badRequest(`${f.name} : ce n'est pas un PDF.`);
    try {
      plannings.push({ file: f.name, ...(await readPlanningPdf(bytes)) });
    } catch (e) {
      if (e instanceof BusinessRuleError) plannings.push({ file: f.name, error: e.message });
      else throw e;
    }
  }
  return ok({ plannings });
});
