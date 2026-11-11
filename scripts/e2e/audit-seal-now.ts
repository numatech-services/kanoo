// Scénario d'audit (BASE DE TEST UNIQUEMENT) : scellement, vérification ou rapport mensuel à une heure décalée.
// Usage : tsx scripts/e2e/audit-seal-now.ts seal|verify|report <décalage en ms>
import { connectDB } from "@/lib/db";
import { AUTOMATION_RUNNERS } from "@/lib/automation-jobs";
import { verifyTenantCached } from "@/lib/audit-seal";
import { TenantModel } from "@/models/Tenant";

(async () => {
  const uri = process.env.MONGODB_URI ?? "";
  if (!/127\.0\.0\.1|localhost/.test(uri) || !/e2e|test/.test(uri)) throw new Error("Réservé à la base de test locale.");
  process.env.AUDIT_SEAL_TEST_CLOCK = "1";
  await connectDB();
  const [mode, offset] = [process.argv[2] ?? "seal", Number(process.argv[3] ?? 0)];
  const at = new Date(Date.now() + offset);
  if (mode === "verify") {
    for (const t of await TenantModel.find({}).select("_id").lean<Array<{ _id: unknown }>>()) {
      await verifyTenantCached(t._id, "entries", { force: true, now: at });
      await verifyTenantCached(t._id, "audit", { force: true, now: at });
    }
    console.log("vérifié");
  } else console.log(mode === "report" ? await AUTOMATION_RUNNERS.runAuditReport(at) : await AUTOMATION_RUNNERS.runAuditSeal(at));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
