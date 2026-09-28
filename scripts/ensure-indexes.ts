/**
 * Construction explicite des index, à lancer après chaque déploiement.
 *
 * Mongoose crée les index tout seul au premier usage d'un modèle — en tâche de
 * fond, et **sans lever** si la construction échoue. Or deux index de cette
 * version portent une contrainte d'unicité dont dépend une garantie
 * fonctionnelle :
 *
 *   • DunningLog (organisation, facture, étape) empêche qu'un client reçoive
 *     deux fois la même relance ;
 *   • BankStatementLine (organisation, compte, empreinte) empêche qu'un relevé
 *     réimporté duplique ses lignes.
 *
 * Si des doublons existent déjà en base, l'index ne se construit pas — et la
 * garantie tombe sans que rien ne le signale. Ce script rend l'échec visible,
 * et nomme les documents fautifs.
 *
 * Usage : npm run indexes
 */
import mongoose from "mongoose";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI absent.");
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI!);
  console.log("Connecté. Construction des index…\n");

  // Import après connexion : les modèles s'enregistrent à l'import.
  const models = await Promise.all([
    import("../models/DunningLog").then(m => m.DunningLogModel),
    import("../models/DunningSettings").then(m => m.DunningSettingsModel),
    import("../models/BankStatementLine").then(m => m.BankStatementLineModel),
    import("../models/TreasuryMovement").then(m => m.TreasuryMovementModel),
    import("../models/Invoice").then(m => m.InvoiceModel),
    import("../models/SubscriptionPurchase").then(m => m.SubscriptionPurchaseModel),
    import("../models/SubscriptionSale").then(m => m.SubscriptionSaleModel),
    import("../models/IdempotencyRecord").then(m => m.IdempotencyRecordModel),
    import("../models/IsicStudent").then(m => m.IsicStudentModel),
    import("../models/IsicLicense").then(m => m.IsicLicenseModel),
  ]);

  let failed = 0;
  for (const model of models) {
    const name = model.modelName;
    try {
      // syncIndexes réconcilie les index avec le schéma : il crée les manquants
      // ET supprime/recrée ceux dont les options ont changé (ex. passage de
      // sparse à partiel). createIndexes seul échouait sur un tel changement.
      await model.syncIndexes();
      const indexes = await model.collection.indexes();
      const unique = indexes.filter(i => i.unique).map(i => i.name).join(", ");
      console.log(`  ✓ ${name.padEnd(24)} ${indexes.length} index${unique ? ` (unique : ${unique})` : ""}`);
    } catch (err) {
      failed++;
      const e = err as { code?: number; keyValue?: unknown; message?: string };
      console.error(`  ✗ ${name.padEnd(24)} ${e.message}`);
      if (e.code === 11000) {
        console.error(
          `     Des doublons existent déjà. Tant qu'ils ne sont pas résolus,\n`
          + `     la contrainte n'est pas appliquée : ${JSON.stringify(e.keyValue)}`
        );
      }
    }
  }

  console.log(failed === 0
    ? "\nTous les index sont en place."
    : `\n${failed} index n'ont pas pu être construits — voir ci-dessus.`);

  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Échec :", err);
  process.exit(1);
});
