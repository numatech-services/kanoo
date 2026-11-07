/**
 * Crée une clé d'API v1 pour un système tiers, avec écriture de brouillons.
 * Usage : npx tsx scripts/creer-cle-api.ts <courriel de l'auteur> <nom de la clé>
 * La clé ne s'affiche qu'une fois. Seule son empreinte est conservée.
 */
import mongoose from "mongoose";
import { generateApiKey } from "../lib/api-key";
import { ApiKeyModel } from "../models/ApiKey";
import { UserModel } from "../models/User";

async function main() {
  const [email, nom] = process.argv.slice(2);
  if (!email || !nom || !process.env.MONGODB_URI) throw new Error("Usage : MONGODB_URI=… npx tsx scripts/creer-cle-api.ts <courriel> <nom>");
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await UserModel.findOne({ email, isActive: { $ne: false } }).select("_id tenantId").lean<{ _id: unknown; tenantId: unknown }>();
  if (!user) throw new Error("Compte inconnu ou inactif.");
  const { key, hash, prefix } = generateApiKey();
  await ApiKeyModel.create({ tenantId: user.tenantId, userId: user._id, name: nom.slice(0, 80), keyHash: hash, keyPrefix: prefix, scopes: ["invoices:read", "invoices:write", "clients:read"], expiresAt: new Date(Date.now() + 365 * 86_400_000) });
  console.log(key);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
