import { vatFromEntries } from "@/lib/vat";
import { invoiceDue } from "@/lib/payments";

describe("TVA de la période", () => {
  it("compte la TVA déductible des achats (4452) et des notes de frais, pas seulement 445000", () => {
    const v = vatFromEntries([
      { lines: [{ accountCode: "443000", credit: 190_000 }] },              // vente
      { lines: [{ accountCode: "445200", debit: 57_000 }] },                // achat
      { lines: [{ accountCode: "445100", debit: 3_800 }] },                 // ancienne note de frais
      { lines: [{ accountCode: "443000", debit: 19_000 }] },                // avoir
      { lines: [{ accountCode: "411000", debit: 999 }] },                   // ignoré
    ]);
    expect(v).toEqual({ collected: 171_000, deductible: 60_800, net: 110_200 });
  });
});

describe("Reste à payer d'une facture", () => {
  it("déduit les avoirs déjà émis et les règlements", () => {
    expect(invoiceDue({ totalTTC: 119_500, creditedAmount: 20_000, paidAmount: 50_000 })).toBe(49_500);
    expect(invoiceDue({ totalTTC: 100_000, creditedAmount: 100_000, paidAmount: 0 })).toBe(0);
    expect(invoiceDue({ totalTTC: 100_000, paidAmount: 120_000 })).toBe(0);
  });
});
