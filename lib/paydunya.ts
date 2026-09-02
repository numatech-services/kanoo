/**
 * Intégration PayDunya — Kanoo
 * Supporte : Orange Money Niger, Airtel Money, Moov Money, Carte bancaire
 *
 * Variables d'environnement :
 *   PAYDUNYA_MASTER_KEY=...
 *   PAYDUNYA_PRIVATE_KEY=...
 *   PAYDUNYA_TOKEN=...
 *   PAYDUNYA_MODE=test|live
 *   APP_BASE_URL=https://kanoo.ne
 */

const BASE_URL_LIVE = "https://app.paydunya.com/api/v1";
const BASE_URL_TEST = "https://app.paydunya.com/sandbox-api/v1";

function getBaseUrl(): string {
  return process.env.PAYDUNYA_MODE === "live" ? BASE_URL_LIVE : BASE_URL_TEST;
}

function getHeaders() {
  return {
    "Content-Type": "application/json",
    "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY || "",
    "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY || "",
    "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN || "",
  };
}

export interface PaydunyaInvoiceItem {
  name: string;
  quantity: number;
  unit_price: string;
  total_price: string;
  description?: string;
}

export interface CreatePaymentParams {
  totalAmount: number;
  description: string;
  items?: PaydunyaInvoiceItem[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  orderId: string;          // Référence interne (ex: tenant ID + plan)
  cancelUrl?: string;
  returnUrl?: string;
  webhookUrl?: string;
}

export interface PaydunyaPaymentResponse {
  response_code: string;
  response_text: string;
  description: string;
  response_token: string;
  invoice_token?: string;
}

/**
 * Crée une facture de paiement PayDunya
 * Retourne l'URL de paiement où rediriger l'utilisateur
 */
export async function createPaydunyaInvoice(params: CreatePaymentParams): Promise<{
  success: boolean;
  paymentUrl?: string;
  token?: string;
  error?: string;
}> {
  const baseUrl = process.env.APP_BASE_URL || "https://kanoo.ne";

  const payload = {
    invoice: {
      items: params.items || [{
        name: params.description,
        quantity: 1,
        unit_price: String(params.totalAmount),
        total_price: String(params.totalAmount),
        description: params.description,
      }],
      total_amount: params.totalAmount,
      description: params.description,
    },
    store: {
      name: "Kanoo",
      tagline: "Gestion d'entreprise Niger",
      postal_address: "Niamey, Niger",
    },
    actions: {
      cancel_url: params.cancelUrl || `${baseUrl}/subscription?status=cancelled`,
      return_url: params.returnUrl || `${baseUrl}/subscription?status=success`,
      callback_url: params.webhookUrl || `${baseUrl}/api/webhooks/payment`,
    },
    custom_data: {
      order_id: params.orderId,
      customer_email: params.customerEmail,
    },
    customer: {
      name: params.customerName,
      email: params.customerEmail,
      phone: params.customerPhone || "",
    },
  };

  try {
    const res = await fetch(`${getBaseUrl()}/checkout-invoice/create`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });

    const data: PaydunyaPaymentResponse = await res.json();

    if (data.response_code === "00") {
      return {
        success: true,
        paymentUrl: `https://app.paydunya.com/checkout-invoice/confirm/${data.response_token}`,
        token: data.response_token,
      };
    }

    return { success: false, error: data.response_text || "Erreur PayDunya" };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur réseau PayDunya" };
  }
}

/**
 * Vérifie le statut d'un paiement depuis le webhook ou après redirection
 */
export async function verifyPaydunyaPayment(token: string): Promise<{
  paid: boolean;
  amount?: number;
  orderId?: string;
  customerEmail?: string;
  status?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${getBaseUrl()}/checkout-invoice/confirm/${token}`, {
      headers: getHeaders(),
    });

    const data = await res.json();

    if (data.response_code === "00" && data.status === "completed") {
      return {
        paid: true,
        amount: data.invoice?.total_amount,
        orderId: data.custom_data?.order_id,
        customerEmail: data.customer?.email,
        status: data.status,
      };
    }

    return { paid: false, status: data.status, error: data.response_text };
  } catch (err) {
    return { paid: false, error: err instanceof Error ? err.message : "Erreur vérification" };
  }
}

/**
 * Génère la liste des items pour un abonnement Kanoo
 */
export function buildSubscriptionItems(planLabel: string, amount: number, months = 1): PaydunyaInvoiceItem[] {
  return [{
    name: `Abonnement Kanoo — Plan ${planLabel}`,
    quantity: months,
    unit_price: String(Math.round(amount / months)),
    total_price: String(amount),
    description: `Accès à la plateforme Kanoo pendant ${months} mois`,
  }];
}
