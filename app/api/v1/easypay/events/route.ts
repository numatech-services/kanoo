import { NextRequest, NextResponse } from "next/server";
import { readRaw } from "@/lib/easypay-v1-server";
import { networkContext, ingestNetwork } from "@/lib/easypay-network-server";
import { planNetwork } from "@/lib/easypay-network";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/easypay/events — un événement signé de la liaison réseau
 * (recharges et versements des agents, commissions et reversements des
 * partenaires, bilan du jour du réseau). Réponses du §8 : 200 accepted /
 * duplicate / ignored, 401 signature, 403 site, 422 corps.
 */
export async function POST(req: NextRequest) {
  const read = await readRaw(req);
  if ("error" in read) return read.error;
  const a = await networkContext(req, read.raw);
  if ("error" in a) return a.error;
  const r = await ingestNetwork(a.ctx, planNetwork(read.body), read.body);
  return NextResponse.json(r.body, { status: r.status });
}
