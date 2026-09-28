/**
 * Crée (ou complète) l'organisation « Numatech Solutions » et son compte
 * administrateur — la seconde société, distincte de Numatech Services SARL.
 *
 * Lancer côté serveur, avec accès à la base (comme `npm run indexes`) :
 *   SOLUTIONS_ADMIN_PASSWORD='MotDePasseFort!' npx tsx scripts/create-numatech-solutions.ts
 *
 * Sans SOLUTIONS_ADMIN_PASSWORD, un mot de passe fort est généré et affiché une
 * seule fois. Le script est idempotent : relancé, il ne duplique rien.
 */
import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { connectDB } from "../lib/db";
import { TenantModel } from "../models/Tenant";
import { UserModel } from "../models/User";
import { hashPassword } from "../lib/auth";

const ADMIN_EMAIL = "mansour.numatechsolutions@gmail.com";

async function main() {
  await connectDB();

  let tenant = await TenantModel.findOne({ slug: "numatech-solutions" });
  if (!tenant) {
    tenant = await TenantModel.create({
      name: "Numatech Solutions",
      slug: "numatech-solutions",
      type: "pme",
      email: ADMIN_EMAIL,
      phone: "+227 96 55 69 84",
      nif: "89103/P",
      rccm: "NE/NIM/01/2022/A10/02283",
      address: "Quartier Bobiel CUN I, Niamey — Niger",
      plan: "business",
      planModules: ["*"],
      subscriptionStatus: "active",
      branding: {
        primaryColor: "#2B4C8C",           // bleu institutionnel Numatech Solutions
        secondaryColor: "#5B8FD6",
        tagline: "Solutions numériques & équipement",
        legalFooter: "Numatech Solutions · Quartier Bobiel CUN I, Niamey — RCCM NE/NIM/01/2022/A10/02283 · NIF 89103/P",
        documentQr: true,
      },
    });
    console.log(`✅ Organisation créée : ${tenant.name} (slug ${tenant.slug}, id ${tenant._id})`);
  } else {
    console.log(`ℹ️  Organisation déjà présente : ${tenant.name} (id ${tenant._id}) — non modifiée.`);
  }

  const existingAdmin = await UserModel.findOne({ email: ADMIN_EMAIL });
  if (existingAdmin) {
    console.log(`ℹ️  Compte admin déjà présent : ${ADMIN_EMAIL} — non modifié.`);
  } else {
    const password = process.env.SOLUTIONS_ADMIN_PASSWORD || `Ns-${randomBytes(9).toString("base64url")}!`;
    await UserModel.create({
      tenantId: tenant._id,
      email: ADMIN_EMAIL,
      passwordHash: await hashPassword(password),
      firstName: "Mansour",
      lastName: "Numatech Solutions",
      role: "pme_admin",
      isActive: true,
    });
    console.log(`✅ Admin créé : ${ADMIN_EMAIL}`);
    if (!process.env.SOLUTIONS_ADMIN_PASSWORD) {
      console.log(`🔑 Mot de passe généré (à noter, affiché une seule fois) : ${password}`);
    }
  }

  await mongoose.connection.close();
  console.log("Terminé.");
}

main().catch((e) => { console.error("Échec :", e); process.exit(1); });
