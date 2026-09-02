import { NextRequest } from "next/server";
import crypto from "crypto";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { ProjectModel } from "@/models/Project";
import { DocumentModel } from "@/models/Document";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

import { writeFile, mkdir } from "fs/promises";
import path from "path";

// Extensions autorisées (liste blanche) + taille maximale.
const ALLOWED_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"]);
const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo

export const POST = withAuth("projects", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const { id } = params;

  try {
    // 1. Récupération des données du formulaire
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const name = formData.get("name") as string;
    const type = formData.get("type") as string;

    if (!file) return badRequest("Fichier manquant");

    // 1.b Validations serveur : extension (liste blanche) + taille bornée.
    const ext = path.extname(path.basename(file.name)).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return badRequest("Type de fichier non autorisé");
    if (file.size > MAX_SIZE) return badRequest("Fichier trop volumineux (max 10 Mo)");

    // 1.c Vérifier l'appartenance du projet AVANT toute écriture sur disque.
    const projectItem = await ProjectModel.findOne({ _id: id, ...tenantFilter(auth) });
    if (!projectItem) return notFound();

    // 2. SAUVEGARDE PHYSIQUE DU FICHIER (Local)
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Nom régénéré : neutralise toute traversée de chemin (../) issue de file.name.
    const fileName = `${crypto.randomUUID()}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    const filePath = path.join(uploadDir, fileName);

    await mkdir(uploadDir, { recursive: true });
    await writeFile(filePath, buffer);

    const fileUrl = `/uploads/${fileName}`;

    // 3. Création de l'entrée dans la collection Documents (MongoDB)
    const newDoc = await DocumentModel.create({
      tenantId: auth.tenantId,
      name: name || file.name,
      type: type || "autre",
      size: file.size,
      url: fileUrl,
      linkedTo: "Project",
      linkedId: id,
      uploadedBy: auth.userId,
    });

    // 4. Mise à jour du Projet (le projet a déjà été vérifié ci-dessus)
    await ProjectModel.updateOne(
      { _id: id, ...tenantFilter(auth) },
      {
        $push: {
          documents: {
            _id: newDoc._id,
            name: newDoc.name,
            url: newDoc.url,
            type: newDoc.type,
            uploadedAt: new Date(),
            uploadedBy: auth.userId,
          },
        },
      }
    );

    // 5. Audit
    await logAudit(auth, "UPDATE", "projects", { 
      resourceId: id, 
      action: "add_document", 
      documentId: newDoc._id 
    });

    return ok(newDoc);

  } catch (error: any) {
    console.error("Erreur Upload:", error);
    return new Response(JSON.stringify({ error: "Erreur lors de la sauvegarde du fichier" }), { status: 500 });
  }
});