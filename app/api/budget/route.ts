import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { BudgetChapterModel } from "@/models/BudgetChapter";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// GET /api/budget — Arbre budgétaire par exercice
export const GET = withAuth("budgetChapters", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));
  const flat = url.searchParams.get("flat") === "true";

  const chapters = await BudgetChapterModel.find({
    ...tenantFilter(auth),
    year,
  }).sort({ code: 1 }).lean();

  if (flat) return ok(chapters);

  // Construire l'arbre hiérarchique
  const map = new Map(chapters.map((c) => [c._id.toString(), { ...c, children: [] as typeof chapters }]));
  const roots: typeof chapters = [];
  for (const chapter of map.values()) {
    if (chapter.parentId) {
      const parent = map.get(chapter.parentId.toString());
      if (parent) (parent.children as unknown[]).push(chapter);
    } else {
      roots.push(chapter as unknown as typeof chapters[0]);
    }
  }

  // Totaux par exercice
  const totals = chapters.reduce(
    (acc, c) => ({
      allocated: acc.allocated + (c.parentId ? 0 : c.allocatedAmount),
      engaged: acc.engaged + (c.parentId ? 0 : c.engagedAmount),
      paid: acc.paid + (c.parentId ? 0 : c.paidAmount),
    }),
    { allocated: 0, engaged: 0, paid: 0 }
  );

  return ok({ year, tree: roots, totals });
});

// POST /api/budget — Créer un chapitre budgétaire
export const POST = withAuth("budgetChapters", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["code", "label", "year", "level", "allocatedAmount"]);
  if (missing) return badRequest(missing);

  await connectDB();

  const existing = await BudgetChapterModel.findOne({
    tenantId: auth.tenantId,
    code: body.code,
    year: body.year,
  });
  if (existing) return conflict(`Chapitre '${body.code}' existe déjà pour l'exercice ${body.year}`);

  const chapter = await BudgetChapterModel.create({
    ...body,
    tenantId: auth.tenantId,
    engagedAmount: 0,
    mandatedAmount: 0,
    paidAmount: 0,
  });

  await logAudit(auth, "CREATE", "budgetChapters", {
    resourceId: chapter._id.toString(),
    after: { code: chapter.code, label: chapter.label, allocatedAmount: chapter.allocatedAmount },
  });

  return created(chapter);
});
