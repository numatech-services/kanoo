import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, tenantFilter } from "@/lib/api-helpers";
import { EngagementModel } from "@/models/Engagement";
import { errorMessage } from "@/lib/errors";
import { TokenPayload } from "@/lib/auth";

// --- RÉCUPÉRATION (GET) ---
export const GET = withAuth("budgetChapters", "read", async (req: NextRequest, auth: TokenPayload) => {
  try {
    await connectDB();
    const segments = req.nextUrl.pathname.split('/');
    const id = segments[segments.length - 1];

    const engagement = await EngagementModel.findOne({
      _id: id,
      ...tenantFilter(auth)
    }).lean();

    if (!engagement) {
      return NextResponse.json({ error: "Engagement introuvable" }, { status: 404 });
    }

    return NextResponse.json({ data: engagement });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
});

// --- MISE À JOUR (PATCH) — changement de statut d'un engagement ---
// Garde « update » (et non « read ») : approuver/rejeter/mandater est une
// mutation, elle exige le droit d'écriture sur le budget.
const ALLOWED_STATUS = ["en_attente", "approuve", "rejete", "mandate"];
export const PATCH = withAuth("budgetChapters", "update", async (req: NextRequest, auth: TokenPayload) => {
  try {
    await connectDB();
    const segments = req.nextUrl.pathname.split('/');
    const id = segments[segments.length - 1];

    const body = await req.json();
    const rawValue = body.status || body.action;
    let newStatus = rawValue;
    if (rawValue === "APPROVE") newStatus = "approuve";
    if (rawValue === "REJECT") newStatus = "rejete";
    if (!ALLOWED_STATUS.includes(newStatus)) {
      return NextResponse.json({ error: `Statut invalide : ${newStatus}` }, { status: 400 });
    }

    const updated = await EngagementModel.findOneAndUpdate(
      { _id: id, ...tenantFilter(auth) },
      { $set: { status: newStatus, ...(newStatus === "mandate" ? { mandatedAt: new Date() } : {}) } },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return NextResponse.json({ error: "Engagement introuvable ou accès refusé" }, { status: 404 });
    }
    return NextResponse.json({ data: updated });

  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
});