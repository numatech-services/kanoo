import { isicBatchFinance } from "@/lib/isic-finance";

describe("ISIC : coûts et marge d'un lot", () => {
  const batch = {
    totalCards: 1000, unitSalePrice: 5000, unitLicenseFee: 2000, unitPrintCost: 600, unitLanyardCost: 400,
    costs: [
      { category: "printing", amount: 650_000 },
      { category: "operations", amount: 120_000 },
    ],
    licensePayments: [{ amount: 1_000_000 }],
  };
  it("prévu : licences, impression et tour de cou par carte, frais saisis", () => {
    const f = isicBatchFinance(batch);
    expect(f.sale).toBe(5_000_000);
    expect(f.planned).toMatchObject({ license: 2_000_000, printing: 600_000, lanyard: 400_000, operations: 120_000 });
    expect(f.plannedMargin).toBe(5_000_000 - 3_120_000);
  });
  it("à terminaison : le réel quand il dépasse le prévu, sinon le prévu", () => {
    const f = isicBatchFinance(batch);
    // licences 2 000 000 (prévu, 1 000 000 réglés), impression 650 000 (réel), tours de cou 400 000, opérations 120 000
    expect(f.forecastMargin).toBe(5_000_000 - 3_170_000);
    expect(f.unitCostForecast).toBe(3170);
    expect(f.unitMarginForecast).toBe(1830);
  });
  it("sans cartes ni prix : pas de division par zéro", () => {
    const f = isicBatchFinance({ totalCards: 0 });
    expect(f.unitCostForecast).toBe(0);
    expect(f.marginRate).toBeNull();
  });
});
