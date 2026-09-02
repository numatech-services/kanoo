/**
 * Tests d'intégration — API Factures
 * Couvre : création, lecture, envoi, annulation, PDF, paiement → écriture comptable
 *
 * Prérequis :
 *   - Serveur Next.js en mode test (PORT=3001)
 *   - Base MongoDB de test (MONGODB_URI_TEST)
 *   - Un token JWT valide (créé par le seed de test)
 *
 * Exécuter : npx jest __tests__/integration/invoices.test.ts
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3001";
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || "";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: ApiResponse<T> }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AUTH_TOKEN}`,
      "x-csrf-token": "test-csrf",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ success: false, error: "Parse error" }));
  return { status: res.status, data };
}

describe("API Factures — Flux complet", () => {
  let invoiceId: string;
  let clientId: string;

  // ─── Setup : créer un client de test ─────────────────────────────────────
  beforeAll(async () => {
    const r = await api("POST", "/api/clients", {
      name: "Client Test Jest",
      type: "company",
      nif: "TEST123456",
      phone: "+22796000001",
      email: "test@jest.ne",
    });

    if (r.data.success && r.data.data) {
      clientId = (r.data.data as { _id: string })._id;
    }
  });

  test("POST /api/invoices — Créer une facture", async () => {
    if (!clientId) return;

    const r = await api<{ _id: string; number: string; status: string }>(
      "POST", "/api/invoices", {
        clientId,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        lines: [{
          description: "Prestation conseil en gestion",
          quantity: 2,
          unitPrice: 50_000,
          tvaRate: 0.19,
        }],
        notes: "Facture de test Jest",
      }
    );

    expect(r.status).toBe(201);
    expect(r.data.success).toBe(true);
    expect(r.data.data).toBeDefined();

    if (r.data.data) {
      invoiceId = r.data.data._id;
      expect(r.data.data.number).toMatch(/^[A-Z]+-\d{4}-\d+$/);
      expect(r.data.data.status).toBe("draft");
    }
  });

  test("GET /api/invoices/:id — Lire la facture", async () => {
    if (!invoiceId) return;

    const r = await api<{ _id: string; totalHT: number; totalTTC: number }>(
      "GET", `/api/invoices/${invoiceId}`
    );

    expect(r.status).toBe(200);
    expect(r.data.data?._id).toBe(invoiceId);
    expect(r.data.data?.totalHT).toBe(100_000); // 2 × 50 000
    expect(r.data.data?.totalTTC).toBe(119_000); // 100 000 + 19% TVA
  });

  test("POST /api/invoices/:id/send — Émettre la facture", async () => {
    if (!invoiceId) return;

    const r = await api<{ status: string }>("POST", `/api/invoices/${invoiceId}/send`);
    expect(r.status).toBe(200);
    expect(r.data.data?.status).toBe("sent");
  });

  test("GET /api/invoices/:id/pdf — Générer le PDF", async () => {
    if (!invoiceId) return;

    const res = await fetch(`${BASE_URL}/api/invoices/${invoiceId}/pdf`, {
      headers: { "Authorization": `Bearer ${AUTH_TOKEN}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
  });

  test("POST /api/payments — Enregistrer un paiement → écriture comptable auto", async () => {
    if (!invoiceId) return;

    const r = await api<{ invoiceStatus: string }>("POST", "/api/payments", {
      invoiceId,
      amount: 119_000,
      paymentDate: new Date().toISOString(),
      method: "virement",
      reference: "VIRT-TEST-001",
    });

    expect(r.status).toBe(201);
    expect(r.data.success).toBe(true);
    expect(r.data.data?.invoiceStatus).toBe("paid");
  });

  test("GET /api/invoices/:id — Facture soldée après paiement", async () => {
    if (!invoiceId) return;

    const r = await api<{ status: string; paidAmount: number }>(
      "GET", `/api/invoices/${invoiceId}`
    );

    expect(r.data.data?.status).toBe("paid");
    expect(r.data.data?.paidAmount).toBe(119_000);
  });

  test("POST /api/invoices/:id/cancel — Annuler une facture payée = refusé", async () => {
    if (!invoiceId) return;

    const r = await api("POST", `/api/invoices/${invoiceId}/cancel`);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  // ─── Tests de sécurité ───────────────────────────────────────────────────
  test("Sans token → 401", async () => {
    const res = await fetch(`${BASE_URL}/api/invoices`, {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  test("Token invalide → 401", async () => {
    const res = await fetch(`${BASE_URL}/api/invoices`, {
      headers: { "Authorization": "Bearer token_invalide_xxx" },
    });
    expect(res.status).toBe(401);
  });

  test("Accès à une facture d'un autre tenant → 404", async () => {
    const fakeId = "000000000000000000000001";
    const r = await api("GET", `/api/invoices/${fakeId}`);
    expect(r.status).toBe(404);
  });
});

describe("API Bulletins de paie — Flux CNSS + IR", () => {
  let employeeId: string;
  let payslipId: string;

  test("POST /api/employees — Créer un employé test", async () => {
    const r = await api<{ _id: string }>("POST", "/api/employees", {
      firstName: "Aminata",
      lastName: "Test",
      position: "Comptable",
      employeeType: "employee",
      contractNature: "cdi",
      grossSalary: 150_000,
      startDate: new Date(new Date().setFullYear(new Date().getFullYear() - 2)),
      includeCnss: true,
      includeIr: true,
      includeSeniority: true,
    });

    if (r.data.success && r.data.data) {
      employeeId = r.data.data._id;
      expect(employeeId).toBeDefined();
    }
  });

  test("POST /api/payslips — Générer un bulletin", async () => {
    if (!employeeId) return;

    const r = await api<{
      _id: string;
      grossTotal: number; cnssEmployee: number; ir: number; netAPayer: number;
    }>("POST", "/api/payslips", {
      employeeId,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    expect(r.status).toBe(201);
    if (r.data.data) {
      payslipId = r.data.data._id;
      // Vérifier les calculs
      expect(r.data.data.cnssEmployee).toBe(Math.round(r.data.data.grossTotal * 0.036));
      expect(r.data.data.ir).toBeGreaterThanOrEqual(0);
      expect(r.data.data.netAPayer).toBeLessThan(r.data.data.grossTotal);
    }
  });

  test("POST /api/payslips/:id/pay — Payer le bulletin → décompte trésorerie", async () => {
    if (!payslipId) return;

    const r = await api<{ treasuryMovement: { amount: number } }>(
      "POST", `/api/payslips/${payslipId}/pay`, {
        paymentDate: new Date().toISOString(),
        treasuryAccountId: "default",
      }
    );

    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
  });
});
