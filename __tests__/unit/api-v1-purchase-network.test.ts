import { parsePurchaseDraft, purchaseLinesFromDraft, distributeVat, draftHash } from "@/lib/api-v1-purchase";
import { planNetwork, realDay } from "@/lib/easypay-network";
import { normSupplierRef } from "@/models/Purchase";

const body = { externalRef: "ISIC-COUT-1", supplierCode: "F1", supplierInvoiceRef: "INV-1", issueDate: "2026-11-10", dueDate: "2026-12-10", vatAmount: 1000,
  lines: [{ description: "A", quantity: 3, unitPrice: 1001 }, { description: "B", quantity: 1, unitPrice: 2000 }] };

describe("brouillons d'achat (API v1)", () => {
  it("TVA de la pièce répartie sans écart et jamais négative", () => {
    const p = parsePurchaseDraft(body);
    if (!("draft" in p)) throw new Error(p.error);
    const b = purchaseLinesFromDraft(p.draft);
    expect(b.totalHT).toBe(5003);
    expect(b.lines.reduce((t, l) => t + l.amountTVA, 0)).toBe(1000);
    expect(b.totalTTC).toBe(6003);
    for (let i = 0; i < 200; i++) {
      const amounts = Array.from({ length: 1 + (i % 7) }, (_, k) => 1 + ((i * 37 + k * 101) % 5000));
      const vat = (i * 13) % amounts.reduce((t, a) => t + a, 0);
      const out = distributeVat(amounts, vat);
      expect(out.reduce((t, v) => t + v, 0)).toBe(vat);
      expect(out.every(v => v >= 0)).toBe(true);
    }
  });
  it("refus : TVA aberrante, numéro de plus de 60 caractères, TVA décimale", () => {
    expect("error" in parsePurchaseDraft({ ...body, vatAmount: 4990 })).toBe(true);
    expect("error" in parsePurchaseDraft({ ...body, supplierInvoiceRef: "X".repeat(61) })).toBe(true);
    expect("error" in parsePurchaseDraft({ ...body, vatAmount: 10.5 })).toBe(true);
  });
  it("empreinte : change avec l'échéance, pas avec la casse du numéro", () => {
    const d = (o: object) => { const p = parsePurchaseDraft({ ...body, ...o }); if (!("draft" in p)) throw new Error(p.error); return draftHash(p.draft); };
    expect(d({})).toBe(d({ supplierInvoiceRef: "inv-1" }));
    expect(d({})).not.toBe(d({ dueDate: "2026-12-11" }));
  });
  it("numéro de facture normalisé : casse, espaces et séparateurs ignorés", () => {
    expect(normSupplierRef(" inv 2026-77 ")).toBe(normSupplierRef("INV-2026/77"));
  });
});

const evt = (type: string, data: object, extra: object = {}) => ({ spec_version: "1", event_id: "evt_00000001", type, sequence: 1, site: { id: "_easypay" },
  occurred_at: "2026-11-12T10:00:00+01:00", business_date: "2026-11-12", data, ...extra });

describe("liaison réseau EasyPay 1.1", () => {
  it("jours réels seulement", () => {
    expect(realDay("2026-11-30")).toBe(true);
    expect(realDay("2026-11-31")).toBe(false);
  });
  it("contrôles de cohérence", () => {
    expect(planNetwork(evt("agent_topup.recorded", { topup_id: "t", amount: 1000, charge_amount: 5000 })).kind).toBe("invalid");
    expect(planNetwork(evt("partner_earning.recorded", { earning_id: "e", base_amount: 100, commission_amount: 10, partner_amount: 90, to_settle_amount: 200 })).kind).toBe("invalid");
    expect(planNetwork(evt("partner_earning.recorded", { earning_id: "e", base_amount: 100, commission_amount: 10, partner_amount: 80 })).kind).toBe("invalid");
    expect(planNetwork(evt("agent_remittance.reconciled", { remittance_id: "r", amount: 10, state: "handed_over", reconciled: false })).kind).toBe("invalid");
    expect(planNetwork(evt("agent_topup.recorded", { topup_id: "t", amount: 1 }, { site: { id: "the-spot" } })).kind).toBe("invalid");
  });
  it("état et rang suivent le type", () => {
    const p = planNetwork(evt("agent_remittance.reconciled", { remittance_id: "r", amount: 10, state: "reconciled", reconciled: true }));
    expect(p.kind === "fact" && p.fact.stateRank).toBe(2);
    const q = planNetwork(evt("partner_earning.settled", { earning_id: "e", base_amount: 100, commission_amount: 10, partner_amount: 90, state: "settled", to_settle_amount: 0 }));
    expect(q.kind === "fact" && q.fact.state).toBe("settled");
    expect(planNetwork(evt("futur.type", {})).kind).toBe("ignored");
  });
});
