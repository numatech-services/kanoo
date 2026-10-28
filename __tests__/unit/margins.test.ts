import { saleLine, aggregateMargins, marginTotals, landedUnitCosts, type MarginFact } from "@/lib/margins";

describe("Marges : ligne de ticket", () => {
  test("prix TTC remisé, HT extrait au taux de l'article, coût figé", () => {
    const l = saleLine({ quantity: 3, unitPriceTTC: 1190, discount: 10, tvaRate: 0.19, unitCost: 600 });
    expect(l.totalTTC).toBe(3213);          // 3 × 1190 × 0,9
    expect(l.totalHT).toBe(2700);           // 3213 / 1,19
    expect(l.totalTVA).toBe(513);
    expect(l.costTotal).toBe(1800);
    expect(l.marginHT).toBe(900);
  });
  test("comptoir non assujetti : HT = TTC", () => {
    const l = saleLine({ quantity: 2, unitPriceTTC: 500, discount: 0, tvaRate: 0, unitCost: 300 });
    expect(l.totalHT).toBe(1000);
    expect(l.totalTVA).toBe(0);
    expect(l.marginHT).toBe(400);
  });
  test("sans coût d'achat : marge inconnue, jamais 100 %", () => {
    expect(saleLine({ quantity: 1, unitPriceTTC: 1000, discount: 0, tvaRate: 0, unitCost: 0 }).marginHT).toBeNull();
  });
  test("vente à perte : marge négative", () => {
    expect(saleLine({ quantity: 1, unitPriceTTC: 500, discount: 0, tvaRate: 0, unitCost: 650 }).marginHT).toBe(-150);
  });
  test("remise bornée à 100 %", () => {
    expect(saleLine({ quantity: 1, unitPriceTTC: 500, discount: 150, tvaRate: 0, unitCost: 100 }).totalTTC).toBe(0);
  });
});

describe("Marges : agrégation", () => {
  const f = (key: string, revenueHT: number, costTotal: number, valued = true, quantity = 1): MarginFact => ({ key, label: key, quantity, revenueHT, costTotal, valued });

  test("taux de marge (sur coût) et taux de marque (sur prix de vente)", () => {
    const [r] = aggregateMargins([f("soda", 1000, 600), f("soda", 1000, 600)]);
    expect(r.marginHT).toBe(800);
    expect(r.marginRate).toBe(66.7);  // 800 / 1200
    expect(r.markupRate).toBe(40);    // 800 / 2000
  });
  test("le CA non valorisé est exclu de la marge et des taux", () => {
    const [r] = aggregateMargins([f("eau", 1000, 500), f("eau", 400, 0, false)]);
    expect(r.revenueHT).toBe(1000);
    expect(r.unvaluedRevenueHT).toBe(400);
    expect(r.markupRate).toBe(50);
  });
  test("signale les produits vendus sous leur coût et trie par marge", () => {
    const rows = aggregateMargins([f("a", 1000, 1200), f("b", 1000, 200)]);
    expect(rows.map(r => r.key)).toEqual(["b", "a"]);
    expect(rows[1].belowCost).toBe(true);
  });
  test("les avoirs (montants négatifs) viennent en déduction", () => {
    const [r] = aggregateMargins([f("x", 3000, 1800, true, 3), f("x", -1000, -600, true, -1)]);
    expect(r.quantity).toBe(2);
    expect(r.marginHT).toBe(800);
  });
  test("totaux", () => {
    const t = marginTotals(aggregateMargins([f("a", 1000, 600), f("b", 500, 0, false)]));
    expect(t).toMatchObject({ revenueHT: 1000, costTotal: 600, marginHT: 400, unvaluedRevenueHT: 500, markupRate: 40 });
  });
});

describe("Frais d'approche à la réception", () => {
  test("répartis au prorata de la valeur, l'arrondi sur la dernière ligne", () => {
    const c = landedUnitCosts([
      { quantity: 10, unitPrice: 1000, stocked: true },  // 10 000
      { quantity: 3, unitPrice: 10_000, stocked: true }, // 30 000
    ], 4000);
    expect(c[0]).toBe(1100);           // + 1 000 / 10
    expect(c[1]).toBe(11_000);         // + 3 000 / 3
  });
  test("une ligne hors stock garde son prix et ne prend rien", () => {
    const c = landedUnitCosts([
      { quantity: 1, unitPrice: 50_000, stocked: false },
      { quantity: 5, unitPrice: 2000, stocked: true },
    ], 1000);
    expect(c).toEqual([50_000, 2200]);
  });
  test("sans frais : prix de la commande", () => {
    expect(landedUnitCosts([{ quantity: 2, unitPrice: 700, stocked: true }], 0)).toEqual([700]);
  });
});
