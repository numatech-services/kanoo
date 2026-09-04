import {
  orderProgress, canDeliver, canInvoice, lotTotals, inputConsumption, isFullyCompleted,
  type FrameworkOrderLike,
} from "@/lib/framework-order";

const base: FrameworkOrderLike = { totalQuantity: 1000, deliveredQuantity: 300, invoicedQuantity: 200, unitPrice: 2500, tvaRate: 0.19 };

describe("Marché-cadre — reliquats", () => {
  it("commandé ≥ livré ≥ facturé, et les restes en découlent", () => {
    const p = orderProgress(base);
    expect(p.toDeliver).toBe(700);   // 1000 - 300
    expect(p.toInvoice).toBe(100);   // 300 livré - 200 facturé
    expect(p.deliveredPct).toBe(30);
    expect(p.invoicedPct).toBe(20);
  });

  it("la valeur du reste à livrer suit le prix unitaire", () => {
    // 700 × 2500 = 1 750 000 HT → +19 % = 2 082 500 TTC
    expect(orderProgress(base).remainingValueTTC).toBe(2_082_500);
  });
});

describe("Marché-cadre — garde-fous de livraison", () => {
  it("refuse une quantité au-delà du reste à livrer", () => {
    const r = canDeliver(base, 800);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("over_delivery");
  });
  it("accepte pile le reste à livrer", () => {
    expect(canDeliver(base, 700).ok).toBe(true);
  });
  it("refuse une quantité nulle ou négative", () => {
    expect(canDeliver(base, 0).ok).toBe(false);
    expect(canDeliver(base, -5).ok).toBe(false);
  });
  it("refuse tout lot sur un marché clôturé", () => {
    expect(canDeliver({ ...base, status: "completed" }, 10).ok).toBe(false);
    expect(canDeliver({ ...base, status: "cancelled" }, 10).ok).toBe(false);
  });
});

describe("Marché-cadre — facturation", () => {
  it("ne facture que le livré non encore facturé", () => {
    expect(canInvoice(base, 100).ok).toBe(true);   // 300 livré - 200 facturé
    expect(canInvoice(base, 101).ok).toBe(false);  // pas d'avance
  });
  it("montants d'un lot exacts", () => {
    expect(lotTotals(100, 2500, 0.19)).toEqual({ ht: 250_000, tva: 47_500, ttc: 297_500 });
  });
});

describe("Marché-cadre — intrants & complétude", () => {
  it("consomme les intrants au prorata (ISIC par carte)", () => {
    expect(inputConsumption({ ...base, inputPerUnit: 1 }, 50)).toBe(50);
    expect(inputConsumption({ ...base, inputPerUnit: 2 }, 50)).toBe(100);
    expect(inputConsumption({ ...base }, 50)).toBe(50); // défaut 1
  });
  it("complet seulement quand tout est livré ET facturé", () => {
    expect(isFullyCompleted(base)).toBe(false);
    expect(isFullyCompleted({ totalQuantity: 1000, deliveredQuantity: 1000, invoicedQuantity: 1000, unitPrice: 1 })).toBe(true);
    expect(isFullyCompleted({ totalQuantity: 1000, deliveredQuantity: 1000, invoicedQuantity: 900, unitPrice: 1 })).toBe(false);
  });
});
