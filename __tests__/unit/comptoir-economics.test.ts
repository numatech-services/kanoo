import { itemEconomics, stockOutlook, packEntry, roundPrice } from "@/lib/comptoir-economics";

describe("Rentabilité d'un article de comptoir", () => {
  test("paquet de 24 biscuits à 5 000, sachet revendu 200 : vente à perte", () => {
    const e = itemEconomics({ pack: { label: "paquet", size: 24, cost: 5000 }, salePrice: 200 });
    expect(e.unitCost).toBe(208.33);
    expect(e.marginUnit).toBe(-8.33);
    expect(e.packRevenue).toBe(4800);
    expect(e.packMargin).toBe(-200);
    expect(e.status).toBe("loss");
    expect(e.breakEvenPrice).toBe(225);           // 208,33 arrondi aux 25 FCFA
  });
  test("pastel acheté 150, revendu 200 : +50 par pièce", () => {
    const e = itemEconomics({ unitCost: 150, salePrice: 200 });
    expect(e.marginUnit).toBe(50);
    expect(e.markupRate).toBe(25);                // 50 / 200
    expect(e.marginRate).toBe(33.3);              // 50 / 150
    expect(e.status).toBe("ok");
  });
  test("comptoir assujetti à la TVA : marge sur le prix HT", () => {
    const e = itemEconomics({ unitCost: 150, salePrice: 238, vatRate: 0.19 });
    expect(e.priceHT).toBe(200);
    expect(e.marginUnit).toBe(50);
  });
  test("prix conseillé pour 30 % de marque", () => {
    const e = itemEconomics({ pack: { size: 24, cost: 5000 }, salePrice: 200, targetMarkup: 0.3 });
    expect(e.suggestedPrice).toBe(300);           // 208,33 / 0,7 = 297,6 → 300
    expect(roundPrice(201)).toBe(225);
  });
  test("marge mince signalée ; coût inconnu", () => {
    expect(itemEconomics({ unitCost: 190, salePrice: 200 }).status).toBe("thin");
    expect(itemEconomics({ salePrice: 200 }).status).toBe("unknown");
  });
  test("stock : chiffre d'affaires et marge attendus", () => {
    const o = stockOutlook(48, itemEconomics({ unitCost: 150, salePrice: 200 }));
    expect(o).toEqual({ expectedRevenue: 9600, expectedMargin: 2400, stockValue: 7200 });
  });
  test("entrée de 3 paquets de 24 à 5 100", () => {
    expect(packEntry(3, { size: 24, cost: 5000 }, 5100)).toEqual({ quantity: 72, unitCost: 212.5, packCost: 5100 });
  });
});
