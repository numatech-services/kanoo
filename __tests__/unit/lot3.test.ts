import { syscohadaBalanceSheet, syscohadaIncomeStatement, syscohadaCashFlow, type AccountAmounts } from "@/lib/financial-statements";
import { suggestedRate, requiredProvision, provisionLines, writeOffLines, htShare } from "@/lib/doubtful";
import { invoiceDue } from "@/lib/payments";

/** Écritures → soldes par compte. */
function aggregate(entries: Array<Array<[string, number, number]>>): AccountAmounts[] {
  const m = new Map<string, AccountAmounts>();
  for (const e of entries) {
    expect(e.reduce((t, [, d]) => t + d, 0)).toBe(e.reduce((t, [, , c]) => t + c, 0));
    for (const [code, debit, credit] of e) {
      const a = m.get(code) ?? { code, debit: 0, credit: 0 };
      a.debit += debit; a.credit += credit; m.set(code, a);
    }
  }
  return [...m.values()];
}

const year = aggregate([
  [["521000", 1_000_000, 0], ["101000", 0, 1_000_000]],                                   // apport en capital
  [["244100", 300_000, 0], ["521000", 0, 300_000]],                                        // achat d'immobilisation
  [["411000", 590_000, 0], ["706000", 0, 500_000], ["443000", 0, 90_000]],                 // vente
  [["521000", 400_000, 0], ["411000", 0, 400_000]],                                        // encaissement
  [["601100", 120_000, 0], ["401100", 0, 120_000]],                                        // achat de marchandises
  [["311000", 30_000, 0], ["603100", 0, 30_000]],                                          // stock final
  [["681000", 50_000, 0], ["28", 0, 50_000]],                                              // amortissement (compte « 28 » générique)
  [["521000", 200_000, 0], ["162000", 0, 200_000]],                                        // emprunt
  [["162000", 50_000, 0], ["671000", 10_000, 0], ["521000", 0, 60_000]],                   // échéance d'emprunt
  [["416000", 190_000, 0], ["411000", 0, 190_000]],                                        // créance douteuse
  [["659400", 80_000, 0], ["491100", 0, 80_000]],                                          // dépréciation
  [["28", 40_000, 0], ["812000", 60_000, 0], ["244100", 0, 100_000]],                      // sortie d'immobilisation
  [["521000", 70_000, 0], ["822000", 0, 70_000]],                                          // prix de cession
  [["661000", 100_000, 0], ["421000", 0, 100_000]],                                        // salaires dus
  [["275000", 25_000, 0], ["521000", 0, 25_000]],                                          // dépôt de caution bloqué
  [["521000", 9_000, 0], ["776000", 0, 9_000]],                                            // gain de change
]);

describe("États financiers SYSCOHADA", () => {
  const cr = syscohadaIncomeStatement(year.filter(r => /^[678]/.test(r.code)));
  const bs = syscohadaBalanceSheet(year);
  const tft = syscohadaCashFlow(year, 0);
  const ref = (lines: Array<{ ref: string; amount: number }>, r: string) => lines.find(l => l.ref === r)!.amount;

  it("compte de résultat : soldes intermédiaires et résultat net", () => {
    expect(ref(cr.lines, "XA")).toBe(-120_000 + 30_000);           // pas de vente de marchandises
    expect(ref(cr.lines, "XB")).toBe(500_000);
    expect(ref(cr.lines, "XD")).toBe(500_000 - 90_000 - 80_000 - 100_000);
    expect(ref(cr.lines, "XF")).toBe(9_000 - 10_000);
    expect(ref(cr.lines, "XH")).toBe(10_000);
    expect(cr.resultat).toBe(500_000 + 9_000 + 70_000 - 120_000 + 30_000 - 50_000 - 10_000 - 80_000 - 60_000 - 100_000);
    expect(cr.unclassified).toBe(0);
  });
  it("bilan équilibré, clients nets de dépréciation, amortissements génériques compris", () => {
    expect(bs.totalActif).toBe(bs.totalPassif);
    const bi = bs.actif.find(l => l.ref === "BI")!;
    expect(bi).toMatchObject({ gross: 190_000, depreciation: 80_000, amount: 110_000 });
    expect(bs.actif.find(l => l.ref === "AI")).toMatchObject({ gross: 200_000, depreciation: 10_000, amount: 190_000 });
    expect(ref(bs.passif, "CJ")).toBe(cr.resultat);
  });
  it("tableau des flux : rapproché de la trésorerie, cessions et caution bien classées", () => {
    expect(tft.gap).toBe(0);
    expect(ref(tft.lines, "ZH")).toBe(1_000_000 - 300_000 + 400_000 + 200_000 - 60_000 + 70_000 - 25_000 + 9_000);
    expect(ref(tft.lines, "FI")).toBe(70_000);
    expect(ref(tft.lines, "FG")).toBe(-300_000);
    expect(ref(tft.lines, "FH")).toBe(-25_000);
    expect(ref(tft.lines, "FK")).toBe(1_000_000);
    expect(ref(tft.lines, "FO") + ref(tft.lines, "FQ")).toBe(150_000);
    // CAFG : résultat + dotations − résultat de cession.
    expect(ref(tft.lines, "FA")).toBe(cr.resultat + 50_000 - 10_000);
  });
});

describe("Créances douteuses", () => {
  const inv = { totalHT: 1_000_000, totalTTC: 1_190_000 };
  it("taux suggéré selon l'ancienneté", () => {
    expect([30, 100, 200, 400].map(suggestedRate)).toEqual([0, 0.25, 0.5, 1]);
  });
  it("dépréciation sur le HT du reste dû", () => {
    expect(htShare(595_000, inv)).toBe(500_000);
    expect(requiredProvision(595_000, inv, 0.5)).toBe(250_000);
  });
  it("dotation ou reprise selon l'écart", () => {
    expect(provisionLines(100_000, 250_000).map(l => [l.accountCode, l.debit, l.credit])).toEqual([["659400", 150_000, 0], ["491100", 0, 150_000]]);
    expect(provisionLines(250_000, 100_000).map(l => [l.accountCode, l.debit, l.credit])).toEqual([["491100", 150_000, 0], ["759400", 0, 150_000]]);
    expect(provisionLines(5, 5)).toEqual([]);
  });
  it("perte : HT en 651, TVA régularisée, créance soldée", () => {
    const l = writeOffLines(1_190_000, inv, { fromAccount: "416000", recoverVat: true, clientId: "c" });
    expect(l.map(x => [x.accountCode, x.debit, x.credit])).toEqual([["651000", 1_000_000, 0], ["443000", 190_000, 0], ["416000", 0, 1_190_000]]);
    expect(writeOffLines(1_190_000, inv, { fromAccount: "411000", recoverVat: false, clientId: "c" })[0].debit).toBe(1_190_000);
  });
  it("facture passée en perte : plus rien d'exigible", () => {
    expect(invoiceDue({ totalTTC: 1_190_000, paidAmount: 0, status: "written_off" })).toBe(0);
  });
});
