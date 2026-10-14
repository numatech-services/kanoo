import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { autoLetter } from "@/lib/auto-lettering-server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST { account: "411" | "401" | …, apply?: boolean } — lettrage automatique :
 * sans `apply`, la proposition (groupes et règle appliquée) ; avec, le lettrage.
 */
export const POST = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const account = String(body.account ?? "411").replace(/\D/g, "");
  if (!/^4\d{1,7}$/.test(account)) return badRequest("Le lettrage porte sur un compte de tiers (classe 4).");
  await connectDB();
  const r = await autoLetter(auth.tenantId, account, body.apply === true);
  if (body.apply === true) await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { action: "lettrage-auto", account, groups: r.applied } });
  const byRule = r.groups.reduce<Record<string, number>>((t, g) => ({ ...t, [g.rule]: (t[g.rule] ?? 0) + 1 }), {});
  return ok({ proposed: r.groups.length, applied: r.applied, byRule, entries: r.groups.reduce((t, g) => t + g.entryIds.length, 0) });
});
