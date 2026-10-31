import { priceCheck, targetGap, unitCostOf, roundUp } from "@/lib/restaurant-pricing";

describe("restauration — prix minimum pour 20 % de marge nette", () => {
  it("coût de revient d'une recette, inconnu si un ingrédient n'a pas de coût", () => {
    const costs = new Map([["riz", 600], ["huile", 1200], ["poulet", 0]]);
    expect(unitCostOf({ recipe: [{ itemId: "riz", quantity: 0.2 }, { itemId: "huile", quantity: 0.05 }] }, costs)).toBe(180);
    expect(unitCostOf({ recipe: [{ itemId: "riz", quantity: 0.2 }, { itemId: "poulet", quantity: 0.25 }] }, costs)).toBeNull();
    expect(unitCostOf({ unitCost: 300 }, costs)).toBe(300);
    expect(unitCostOf({ unitCost: 0 }, costs)).toBeNull();
  });
  it("marge nette = prix HT − coût − part des frais ; prix minimum = coût ÷ (1 − cible − taux de frais)", () => {
    // Plat à 1 000 TTC sans TVA, coût 400, frais 35 % du CA : marge nette 250 = 25 % → objectif atteint.
    const ok = priceCheck({ priceTTC: 1000, vatRate: 0, cost: 400, overheadRate: 0.35, target: 0.2 });
    expect(ok).toMatchObject({ grossMargin: 600, overhead: 350, netMargin: 250, netMarginPct: 25, status: "ok" });
    expect(ok.minPriceHT).toBe(Math.ceil(400 / 0.45));
    expect(ok.minPriceTTC).toBe(roundUp(400 / 0.45));
    // Même plat, coût 550 : marge nette 10 % → sous le minimum (1 223 FCFA, arrondi à 1 225).
    const low = priceCheck({ priceTTC: 1000, vatRate: 0, cost: 550, overheadRate: 0.35, target: 0.2 });
    expect(low.status).toBe("below");
    expect(low.minPriceTTC).toBe(1225);
  });
  it("TVA : le prix minimum TTC inclut la TVA du comptoir", () => {
    const c = priceCheck({ priceTTC: 1190, vatRate: 0.19, cost: 400, overheadRate: 0.3, target: 0.2 });
    expect(c.priceHT).toBe(1000);
    expect(c.minPriceHT).toBe(800);
    expect(c.minPriceTTC).toBe(roundUp(800 * 1.19));
  });
  it("frais trop lourds (cible + frais ≥ 100 %) : aucun prix ne suffit", () => {
    expect(priceCheck({ priceTTC: 1000, vatRate: 0, cost: 400, overheadRate: 0.85, target: 0.2 }).status).toBe("impossible");
  });
  it("sans coût ou sans prix : signalé, pas de marge inventée", () => {
    expect(priceCheck({ priceTTC: 1000, vatRate: 0, cost: null, overheadRate: 0.3, target: 0.2 }).status).toBe("no_cost");
    expect(priceCheck({ priceTTC: 0, vatRate: 0, cost: 300, overheadRate: 0.3, target: 0.2 }).status).toBe("no_price");
  });
  it("manque pour atteindre la cible et hausse moyenne des prix qui le comble", () => {
    // CA 1 000 000, résultat 100 000 : cible 200 000, manque 100 000 ; hausse x = 100 000 / (1 000 000 × 0,8) = 12,5 %.
    expect(targetGap({ revenueHT: 1_000_000, result: 100_000, target: 0.2 })).toEqual({ targetResult: 200_000, missing: 100_000, priceUpliftPct: 12.5 });
    expect(targetGap({ revenueHT: 1_000_000, result: 250_000, target: 0.2 }).missing).toBe(0);
  });
});
