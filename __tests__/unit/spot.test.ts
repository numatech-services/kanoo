import {
  creditCheck, creditAllowance, recipeUnitCost, reorderSuggestion, targetProgress,
  promoApplies, bestPromoPrice, cancellationAlert, matchMobileMoney, parseMomoCsv, pickCycleCount, type Promo,
} from "@/lib/spot";

describe("1. Ardoise", () => {
  test("plafond respecté, dépassé, absent", () => {
    expect(creditCheck(3000, 10_000, 5000)).toBeNull();
    expect(creditCheck(8000, 10_000, 5000)).toMatch(/Plafond dépassé/);
    expect(creditCheck(0, 0, 100)).toMatch(/pas de crédit/);
    expect(creditAllowance(12_000, 10_000)).toEqual({ remaining: 0, overLimit: true });
  });
});

describe("2. Fiche recette", () => {
  test("pastel maison : farine, huile, viande", () => {
    const costs: Record<string, number> = { farine: 600, huile: 1200, viande: 3000 };
    const r = recipeUnitCost([{ itemId: "farine", quantity: 0.05 }, { itemId: "huile", quantity: 0.02 }, { itemId: "viande", quantity: 0.02 }], id => costs[id]);
    expect(r.cost).toBe(114);        // 30 + 24 + 60
    expect(r.missing).toEqual([]);
  });
  test("ingrédient sans coût signalé", () => {
    expect(recipeUnitCost([{ itemId: "sel", quantity: 1 }], () => 0).missing).toEqual(["sel"]);
  });
});

describe("4. Réassort", () => {
  test("ventes de 6/jour, 2 j de délai, 7 j à couvrir, 20 en stock, paquets de 24", () => {
    const s = reorderSuggestion({ stock: 20, soldInWindow: 168, windowDays: 28, leadDays: 2, coverDays: 7, packSize: 24 });
    expect(s.dailyAverage).toBe(6);
    expect(s.daysLeft).toBe(3);
    expect(s.quantity).toBe(48);     // besoin 54 − 20 = 34 → 2 paquets
    expect(s.packs).toBe(2);
    expect(s.urgent).toBe(false);
  });
  test("stock suffisant : rien ; article jamais vendu : rien", () => {
    expect(reorderSuggestion({ stock: 100, soldInWindow: 28, windowDays: 28, leadDays: 2, coverDays: 7 }).quantity).toBe(0);
    expect(reorderSuggestion({ stock: 0, soldInWindow: 0, windowDays: 28, leadDays: 2, coverDays: 7 }).daysLeft).toBeNull();
  });
  test("rupture avant livraison : urgent", () => {
    expect(reorderSuggestion({ stock: 5, soldInWindow: 84, windowDays: 28, leadDays: 2, coverDays: 7 }).urgent).toBe(true);
  });
});

describe("5. Objectifs", () => {
  test("mercredi soir (3 jours sur 7), 200 000 visés", () => {
    const p = targetProgress(60_000, 200_000, 3);
    expect(p?.expected).toBe(85_714);
    expect(p?.behind).toBe(true);
    expect(p?.perDayNeeded).toBe(35_000);
    expect(targetProgress(80_000, 200_000, 3)?.behind).toBe(false);
    expect(targetProgress(1, 0, 3)).toBeNull();
  });
});

describe("6. Promotions", () => {
  const happy: Promo = { _id: "p1", name: "Happy hour", itemIds: ["biere"], kind: "percent", value: 20, from: "17:00", to: "19:00" };
  const gros: Promo = { _id: "p2", name: "Prix de gros", itemIds: ["biere"], kind: "price", value: 700, minQty: 6 };
  const item = { _id: "biere", category: "Boissons" };
  test("happy hour à 18 h, pas à 20 h", () => {
    expect(promoApplies(happy, item, 1, new Date(2026, 9, 28, 18, 0))).toBe(true);
    expect(promoApplies(happy, item, 1, new Date(2026, 9, 28, 20, 0))).toBe(false);
  });
  test("le meilleur prix l'emporte (gros à partir de 6)", () => {
    expect(bestPromoPrice(1000, [happy, gros], item, 2, new Date(2026, 9, 28, 18, 0))?.price).toBe(800);
    expect(bestPromoPrice(1000, [happy, gros], item, 6, new Date(2026, 9, 28, 18, 0))?.promo._id).toBe("p2");
    expect(bestPromoPrice(1000, [happy, gros], item, 1, new Date(2026, 9, 28, 12, 0))).toBeNull();
  });
  test("par famille, jours et dates", () => {
    const vendredi: Promo = { _id: "p3", name: "Vendredi boissons", category: "Boissons", kind: "percent", value: 10, days: [5], endDate: "2026-12-31" };
    expect(promoApplies(vendredi, item, 1, new Date(2026, 9, 30, 10))).toBe(true);   // vendredi
    expect(promoApplies(vendredi, item, 1, new Date(2026, 9, 29, 10))).toBe(false);
    expect(promoApplies(vendredi, item, 1, new Date(2027, 0, 1, 10))).toBe(false);
  });
});

describe("7. Caissiers", () => {
  test("3 annulations ou plus de 10 % : alerte", () => {
    expect(cancellationAlert(3, 50)).toBe(true);
    expect(cancellationAlert(2, 12)).toBe(true);
    expect(cancellationAlert(1, 40)).toBe(false);
  });
});

describe("8. Mobile money", () => {
  test("rapprochement par montant, à un jour près, le plus proche", () => {
    const d = (day: number, h = 12) => new Date(2026, 9, day, h);
    const r = matchMobileMoney(
      [{ id: "L1", date: d(27), amount: 1000 }, { id: "L2", date: d(27), amount: 2500 }, { id: "L3", date: d(20), amount: 1000 }],
      [{ id: "E1", date: d(27, 18), amount: 1000 }, { id: "E2", date: d(28), amount: 2500 }, { id: "E3", date: d(26), amount: 700 }],
    );
    expect(r.pairs).toEqual([{ lineId: "L1", entryId: "E1" }, { lineId: "L2", entryId: "E2" }]);
    expect(r.unmatchedLines.map(l => l.id)).toEqual(["L3"]);
    expect(r.unmatchedEntries.map(e => e.id)).toEqual(["E3"]);
  });
  test("lecture du relevé CSV", () => {
    const p = parseMomoCsv("Date;Montant;Référence;Téléphone\n27/10/2026 18:05;1 000;TX1;90000000\nmauvaise ligne;x\n2026-10-28;2500;TX2;");
    expect(p.rows.length).toBe(2);
    expect(p.rows[0].amount).toBe(1000);
    expect(p.rows[0].date.getHours()).toBe(18);
    expect(p.errors.length).toBe(1);
  });
});

describe("10. Inventaire tournant", () => {
  test("jamais compté et à pertes d'abord ; compté aujourd'hui exclu", () => {
    const pick = pickCycleCount([
      { itemId: "a", stockValue: 1000, soldValue: 1000, lastCountedDays: 2, recentLosses: 0 },
      { itemId: "b", stockValue: 1000, soldValue: 1000, lastCountedDays: null, recentLosses: 0 },
      { itemId: "c", stockValue: 1000, soldValue: 1000, lastCountedDays: 0, recentLosses: 3 },
      { itemId: "d", stockValue: 50_000, soldValue: 90_000, lastCountedDays: 10, recentLosses: 2 },
    ], 2);
    expect(pick).toEqual(["b", "d"]);
  });
});
