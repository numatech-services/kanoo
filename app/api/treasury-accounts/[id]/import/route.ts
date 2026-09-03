import { NextRequest } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { BankStatementLineModel } from "@/models/BankStatementLine";
import { parseStatementCsv, lineFingerprint } from "@/lib/reconciliation";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Un relevé mensuel dépasse rarement quelques centaines de lignes. */
const MAX_LINES = 5_000;
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * POST /api/treasury-accounts/:id/import
 *
 * Importe un relevé bancaire au format CSV.
 *
 * Le format est **décrit par l'appelant**, jamais deviné : les banques
 * n'exportent pas deux fichiers pareils, et une détection automatique qui se
 * trompe de colonne importe des montants faux sans le dire.
 *
 * Les doublons sont écartés par empreinte : réimporter le même relevé ne
 * duplique rien, ce qui permet d'importer sans crainte un fichier qui recouvre
 * partiellement le précédent — le cas courant.
 */
export const POST = withAuth("treasuryAccounts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();

  const account = await TreasuryAccountModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("label").lean<{ label: string } | null>();
  if (!account) return notFound("Compte introuvable");

  const body = await req.json().catch(() => ({}));
  const content = String(body.content || "");
  if (!content.trim()) return badRequest("Fichier vide.");
  if (content.length > MAX_BYTES) {
    return badRequest("Fichier trop volumineux (2 Mo maximum).");
  }

  const mapping = body.mapping;
  if (!mapping || typeof mapping.date !== "number" || typeof mapping.label !== "number") {
    return badRequest("Indiquez au minimum les colonnes de date et de libellé.");
  }
  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) {
    return badRequest("Indiquez soit une colonne de montant, soit les colonnes débit et crédit.");
  }

  const { lines, rejected } = parseStatementCsv(content, mapping);
  if (lines.length === 0) {
    return badRequest(
      rejected.length > 0
        ? `Aucune ligne exploitable. Première anomalie ligne ${rejected[0].row} : ${rejected[0].reason}.`
        : "Aucune ligne exploitable dans ce fichier."
    );
  }
  if (lines.length > MAX_LINES) {
    return badRequest(`${lines.length} lignes : au-delà de ${MAX_LINES}, découpez le relevé par mois.`);
  }

  const importBatchId = crypto.randomUUID();
  const accountId = String(params.id);

  const documents = lines.map(line => ({
    tenantId: auth.tenantId,
    accountId,
    date: line.date,
    amount: line.amount,
    label: line.label,
    reference: line.reference,
    fingerprint: lineFingerprint(accountId, line.date, line.amount, line.label, line.rank),
    importBatchId,
  }));

  // `ordered: false` poursuit après un doublon : l'index d'unicité rejette les
  // lignes déjà présentes et laisse passer les nouvelles. C'est ce qui rend un
  // réimport partiel sans danger.
  let inserted = 0;
  let duplicates = 0;
  try {
    const result = await BankStatementLineModel.insertMany(documents, { ordered: false });
    inserted = result.length;
  } catch (err) {
    const bulk = err as { insertedDocs?: unknown[]; writeErrors?: Array<{ code: number }> };
    inserted = bulk.insertedDocs?.length ?? 0;
    duplicates = (bulk.writeErrors ?? []).filter(e => e.code === 11000).length;
    // Une erreur d'écriture qui n'est pas un doublon doit remonter.
    const others = (bulk.writeErrors ?? []).filter(e => e.code !== 11000);
    if (others.length > 0) throw err;
  }

  await logAudit(auth, "IMPORT", "treasuryAccounts", {
    resourceId: accountId,
    metadata: { importBatchId, inserted, duplicates, rejected: rejected.length },
  });

  return ok({
    importBatchId,
    inserted,
    duplicates,
    // Les lignes écartées sont rendues à l'utilisateur : une ligne perdue en
    // silence devient un écart inexpliqué au rapprochement.
    rejected,
    message: duplicates > 0
      ? `${inserted} ligne(s) importée(s), ${duplicates} déjà présente(s).`
      : `${inserted} ligne(s) importée(s).`,
  });
});
