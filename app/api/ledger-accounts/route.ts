import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { LedgerAccountModel } from "@/models/LedgerAccount";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { ensureLedger } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/ledger-accounts?q=&class=&all=true — plan comptable (avec usage). */
export const GET = withAuth("ledgerAccounts", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  await ensureLedger(auth.tenantId);
  const url = new URL(req.url);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (url.searchParams.get("all") !== "true") filter.isActive = true;
  const cls = url.searchParams.get("class");
  if (cls && /^[1-9]$/.test(cls)) filter.accountClass = cls;
  const q = (url.searchParams.get("q") || "").trim();
  if (q) filter.$or = [{ code: { $regex: `^${q.replace(/\D/g, "")}` } }, { label: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }];
  const [items, used] = await Promise.all([
    LedgerAccountModel.find(filter).sort({ code: 1 }).limit(1000).lean<Array<{ code: string }>>(),
    AccountingEntryModel.distinct("lines.accountCode", tenantFilter(auth)),
  ]);
  const usedSet = new Set(used as string[]);
  return ok(items.map(a => ({ ...a, used: usedSet.has(a.code) })));
});

/** POST — { code, label } : ajoute un compte (sous-compte d'un compte SYSCOHADA). */
export const POST = withAuth("ledgerAccounts", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  await ensureLedger(auth.tenantId);
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  const label = String(body.label ?? "").trim();
  if (!/^[1-9]\d{2,7}$/.test(code)) return badRequest("Numéro de compte : 3 à 8 chiffres, commençant par la classe (1 à 9).");
  if (!label) return badRequest("Intitulé obligatoire.");
  if (await LedgerAccountModel.exists({ ...tenantFilter(auth), code })) return conflict(`Le compte ${code} existe déjà.`);
  const a = await LedgerAccountModel.create({ tenantId: auth.tenantId, code, label: label.slice(0, 160), accountClass: code[0], notes: body.notes });
  await logAudit(auth, "CREATE", "ledgerAccounts", { resourceId: String(a._id), after: { code, label } });
  return created(a);
});
