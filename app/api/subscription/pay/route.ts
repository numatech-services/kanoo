import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, serverError } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { createPaydunyaInvoice, buildSubscriptionItems } from "@/lib/paydunya";
import { sendEmail, templatePaymentConfirmation } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

const PLANS: Record<string, { label: string; priceMonthly: number; priceYearly: number }> = {
  starter:     { label: "PME Starter",       priceMonthly: 15_000,  priceYearly: 150_000 },
  pro:         { label: "PME Pro",            priceMonthly: 35_000,  priceYearly: 350_000 },
  asso_basic:  { label: "Association Basic",  priceMonthly: 10_000,  priceYearly: 100_000 },
  asso_pro:    { label: "Association Pro",    priceMonthly: 25_000,  priceYearly: 250_000 },
  admin:       { label: "Administration",     priceMonthly: 50_000,  priceYearly: 500_000 },
};

export const POST = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const { plan, period = "monthly" } = body;

  if (!plan || !PLANS[plan]) return badRequest(`Plan invalide. Options : ${Object.keys(PLANS).join(", ")}`);

  const planInfo = PLANS[plan];
  const amount = period === "yearly" ? planInfo.priceYearly : planInfo.priceMonthly;
  const months = period === "yearly" ? 12 : 1;

  const tenant = await TenantModel.findById(auth.tenantId).lean() as {
    name: string; email?: string;
  } | null;

  if (!tenant) return badRequest("Organisation introuvable");

  const orderId = `NMP-${auth.tenantId}-${Date.now()}`;

  const result = await createPaydunyaInvoice({
    totalAmount: amount,
    description: `Abonnement Kanoo — ${planInfo.label} (${period === "yearly" ? "annuel" : "mensuel"})`,
    items: buildSubscriptionItems(planInfo.label, amount, months),
    customerName: tenant.name,
    customerEmail: tenant.email || auth.email,
    orderId,
    returnUrl: `${process.env.APP_BASE_URL}/subscription?status=success&ref=${orderId}`,
    cancelUrl: `${process.env.APP_BASE_URL}/subscription?status=cancelled`,
    webhookUrl: `${process.env.APP_BASE_URL}/api/webhooks/payment`,
  });

  if (!result.success) return serverError(result.error || "Erreur création paiement PayDunya");

  // Enregistrer la tentative de paiement
  await TenantModel.findByIdAndUpdate(auth.tenantId, {
    $push: {
      paymentAttempts: {
        orderId,
        plan,
        amount,
        period,
        paydunyaToken: result.token,
        status: "pending",
        createdAt: new Date(),
      }
    }
  });

  await logAudit(auth, "UPDATE", "companies", {
    resourceId: auth.tenantId,
    after: { action: "payment_initiated", plan, amount, orderId },
  });

  return ok({
    paymentUrl: result.paymentUrl,
    token: result.token,
    orderId,
    amount,
    plan: planInfo.label,
    message: "Redirection vers PayDunya (Orange Money / Airtel / Carte bancaire)",
  });
});
