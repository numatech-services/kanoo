import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { authorize } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { renderBusinessPdf, isDocStyle, type DocTenant } from "@/lib/pdf-business";
import { quoteDoc } from "@/lib/business-doc";

/**
 * GET /api/company/branding/preview?style= — une proforma d'exemple avec
 * l'identité, les couleurs, le signataire et le cachet enregistrés : pour
 * juger le rendu avant d'envoyer un vrai document.
 */
export async function GET(req: NextRequest) {
  const gate = await authorize(req, "companies", "read");
  if (!gate.ok) return gate.response;
  await connectDB();
  const tenant = await TenantModel.findById(gate.auth.tenantId).select("name logo branding nif rccm address phone email").lean<DocTenant | null>();
  if (!tenant) return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  const st = new URL(req.url).searchParams.get("style");
  const today = new Date(), until = new Date(Date.now() + 30 * 86_400_000);
  const doc = quoteDoc({
    number: "PRO-EXEMPLE", docKind: "proforma", issueDate: today, validUntil: until,
    clientId: { name: "Client exemple (EXEMPLE)", address: "Quartier Plateau, Niamey", nif: "000000/A" },
    attention: "À l'attention de Monsieur le Directeur",
    object: "Fourniture et installation d'équipements, mise en service et formation",
    reference: "Votre demande du " + new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(today),
    lines: [
      { section: "Équipements", description: "Ordinateur portable 14\"", details: "Processeur Intel Core i5, 16 Go de mémoire, SSD 512 Go, Windows 11 Pro, garantie 2 ans", unit: "u", quantity: 3, unitPrice: 520000, tvaRate: 0.19, totalHT: 1560000 },
      { section: "Équipements", description: "Vidéoprojecteur", details: "Full HD, 4 000 lumens, écran de projection 2 m sur trépied", unit: "u", quantity: 1, unitPrice: 410000, tvaRate: 0.19, totalHT: 410000 },
      { section: "Prestations", description: "Installation et formation", details: "Installation sur site, configuration, formation des utilisateurs (une demi-journée)", unit: "forfait", quantity: 1, unitPrice: 150000, tvaRate: 0.19, totalHT: 150000 },
    ],
    totalHT: 2120000, totalTVA: 402800, totalTTC: 2522800,
    termsAndConditions: "Validité — offre valable trente (30) jours.\nRèglement — 50 % à la commande, solde à la livraison.",
  }, tenant);
  const buf = await renderBusinessPdf(doc, tenant, { style: isDocStyle(st) ? st : undefined });
  return new NextResponse(new Uint8Array(buf), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"apercu-proforma.pdf\"", "Cache-Control": "no-store" } });
}
