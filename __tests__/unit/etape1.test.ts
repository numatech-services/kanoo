import { vatFromEntries } from "@/lib/vat";
import { invoiceDue } from "@/lib/payments";

describe("TVA de la période", () => {
  it("compte la TVA déductible des achats (4452) et des notes de frais, pas seulement 445000", () => {
    const v = vatFromEntries([
      { lines: [{ accountCode: "411000", debit: 1_190_000 }, { accountCode: "706000", credit: 1_000_000 }, { accountCode: "443000", credit: 190_000 }] }, // vente
      { lines: [{ accountCode: "604000", debit: 300_000 }, { accountCode: "445200", debit: 57_000 }, { accountCode: "401100", credit: 357_000 }] },  // achat
      { lines: [{ accountCode: "625100", debit: 20_000 }, { accountCode: "445100", debit: 3_800 }, { accountCode: "421000", credit: 23_800 }] },    // ancienne note de frais
      { lines: [{ accountCode: "706000", debit: 100_000 }, { accountCode: "443000", debit: 19_000 }, { accountCode: "411000", credit: 119_000 }] },  // avoir
      { lines: [{ accountCode: "411000", debit: 999 }, { accountCode: "521000", credit: 999 }] },                                                     // ignoré
    ]);
    expect(v).toEqual({ collected: 171_000, deductible: 60_800, net: 110_200 });
  });
  it("ignore les à-nouveaux et le règlement de la TVA à la DGI", () => {
    const v = vatFromEntries([
      { lines: [{ accountCode: "411000", debit: 119_000 }, { accountCode: "701000", credit: 100_000 }, { accountCode: "443000", credit: 19_000 }] },
      { journalCode: "AN", lines: [{ accountCode: "443000", credit: 500_000 }, { accountCode: "890000", debit: 500_000 }] },
      { journalCode: "BQ", lines: [{ accountCode: "443000", debit: 190_000 }, { accountCode: "521000", credit: 190_000 }] },
    ]);
    expect(v).toEqual({ collected: 19_000, deductible: 0, net: 19_000 });
  });
});

describe("Reste à payer d'une facture", () => {
  it("déduit les avoirs déjà émis et les règlements", () => {
    expect(invoiceDue({ totalTTC: 119_500, creditedAmount: 20_000, paidAmount: 50_000 })).toBe(49_500);
    expect(invoiceDue({ totalTTC: 100_000, creditedAmount: 100_000, paidAmount: 0 })).toBe(0);
    expect(invoiceDue({ totalTTC: 100_000, paidAmount: 120_000 })).toBe(0);
  });
});
