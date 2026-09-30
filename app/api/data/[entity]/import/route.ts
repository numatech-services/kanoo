import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { effectiveRoles, rolesCanPerform } from "@/lib/role-resources";
import { UserRole } from "@/types";
import { ENTITIES, parseCSV, coerce } from "@/lib/data-io";
import { logAudit } from "@/lib/audit";
import { stripPayrollWrites } from "@/lib/payroll-mask";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

/**
 * POST /api/data/[entity]/import — importe un CSV (corps brut). Nécessite le
 * droit `create` sur la ressource de l'entité. Chaque ligne est créée ou mise à
 * jour selon une clé d'unicité (ex. le code), au sein de l'organisation. Renvoie
 * un bilan : créés, mis à jour, ignorés, avec les erreurs par ligne.
 */
export const POST = withAuth("agenda", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  const entity = ENTITIES[params.entity];
  if (!entity) return notFound("Type de données inconnu.");
  if (!entity.import) return badRequest(`« ${entity.label} » ne peut pas être importé.`);

  const roles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
  if (!rolesCanPerform(roles, entity.resource, "create", auth.allowedResources, auth.roleLevels)) {
    return forbidden(`Vous n'avez pas le droit d'importer « ${entity.label} ».`);
  }

  const text = await req.text();
  const { headers, rows } = parseCSV(text);
  if (headers.length === 0) return badRequest("Fichier CSV vide ou illisible.");
  if (rows.length > MAX_ROWS) return badRequest(`Trop de lignes (max ${MAX_ROWS}). Découpez le fichier.`);

  const spec = entity.import;
  // En-tête → index de colonne (insensible à la casse/espaces).
  const norm = (s: string) => s.trim().toLowerCase();
  const colIndex: Record<string, number> = {};
  headers.forEach((h, i) => { colIndex[norm(h)] = i; });

  const missing = spec.fields.filter((f) => f.required && colIndex[norm(f.header)] === undefined).map((f) => f.header);
  if (missing.length) return badRequest(`Colonnes obligatoires absentes : ${missing.join(", ")}.`);
  if (colIndex[norm(spec.uniqueBy)] === undefined) return badRequest(`La colonne clé « ${spec.uniqueBy} » est absente.`);

  await connectDB();
  const tf = tenantFilter(auth);
  let created = 0, updated = 0;
  const errors: { line: number; message: string }[] = [];

  for (let r = 0; r < rows.length; r++) {
    const line = r + 2; // +1 en-tête, +1 base 1
    const raw = rows[r];
    try {
      let doc: Record<string, unknown> = {};
      // Valeurs par défaut appliquées à la CRÉATION seulement : une colonne
      // absente ne doit pas écraser la valeur d'une fiche existante (ex. un
      // salaire remis à 0 par un import sans colonne « grossSalary »).
      let defaults: Record<string, unknown> = {};
      for (const f of spec.fields) {
        const idx = colIndex[norm(f.header)];
        const cell = idx === undefined ? "" : raw[idx] ?? "";
        const val = coerce(cell, f);
        if (val !== undefined && val !== "") doc[f.field] = val;
        else if (f.default !== undefined) defaults[f.field] = f.default;
      }
      for (const f of spec.fields) {
        const v = doc[f.field] ?? defaults[f.field];
        if (f.required && (v === undefined || v === "")) throw new Error(`champ « ${f.header} » requis`);
      }
      // Rémunération : ni fixée ni modifiée sans accès à la paie.
      if (entity.resource === "employees") {
        doc = stripPayrollWrites(doc, auth);
        defaults = stripPayrollWrites(defaults, auth);
      }

      // Rattachement d'un tiers par son code (ex. contrat → client). Un code
      // fourni mais introuvable est une erreur ; un code absent est ignoré.
      for (const rz of spec.resolvers ?? []) {
        const idx = colIndex[norm(rz.header)];
        const code = idx === undefined ? "" : (raw[idx] ?? "").trim();
        if (!code) continue;
        const found = await rz.model.findOne({ ...tf, code }).select("_id").lean();
        if (!found) throw new Error(`${rz.header} « ${code} » introuvable`);
        doc[rz.field] = (found as { _id: unknown })._id;
      }

      const key = doc[spec.uniqueBy];
      if (!key) throw new Error(`clé « ${spec.uniqueBy} » vide`);

      const res = await entity.model.updateOne(
        { ...tf, [spec.uniqueBy]: key },
        { $set: { ...doc, tenantId: auth.tenantId }, $setOnInsert: { ...defaults, createdBy: auth.userId } },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true }
      );
      if (res.upsertedCount) created++; else if (res.matchedCount) updated++;
    } catch (e) {
      errors.push({ line, message: e instanceof Error ? e.message : "erreur inconnue" });
    }
  }

  await logAudit(auth, "IMPORT", entity.resource, { metadata: { entity: entity.key, created, updated, failed: errors.length } });
  return ok({ entity: entity.key, total: rows.length, created, updated, failed: errors.length, errors: errors.slice(0, 50) });
});
