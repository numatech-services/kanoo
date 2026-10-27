/**
 * Factures d'avoir.
 *
 * Une facture émise ne se supprime pas : l'avoir est la seule correction
 * admise, et il engage autant que la facture. Ces tests verrouillent les
 * refus autant que les calculs — un avoir qui passe alors qu'il ne devrait pas
 * est plus grave qu'un avoir refusé à tort.
 */

import {
  buildCreditNote, canCredit, creditableAmount, reversalEntryLines,
  type InvoiceLike,
} from "@/lib/credit-notes";

function invoice(over: Partial<InvoiceLike> = {}): InvoiceLike {
  return {
    _id: "inv1",
    number: "FAC-2026-00001",
    documentType: "invoice",
    status: "sent",
    lines: [
      { description: "Licence Compilatio", quantity: 10, unitPrice: 50_000, tvaRate: 0.19,
        totalHT: 500_000, totalTVA: 95_000, totalTTC: 595_000 },
      { description: "Formation", quantity: 2, unitPrice: 150_000, tvaRate: 0.19,
        totalHT: 300_000, totalTVA: 57_000, totalTTC: 357_000 },
    ],
    totalHT: 800_000,
    totalTVA: 152_000,
    totalDTS: 1_000,
    totalTTC: 953_000,
    creditedAmount: 0,
    ...over,
  };
}

describe("Éligibilité à l'avoir", () => {
  it("accepte une facture émise", () => {
    expect(canCredit(invoice()).ok).toBe(true);
  });

  it("refuse un avoir sur un avoir", () => {
    const res = canCredit(invoice({ documentType: "credit_note" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("autre avoir");
  });

  it("refuse un brouillon et renvoie vers la modification", () => {
    // Un brouillon n'a pas été transmis : le corriger directement est plus
    // simple et ne laisse pas deux documents là où un seul suffit.
    const res = canCredit(invoice({ status: "draft" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("modifiez-la");
  });

  it("refuse une facture annulée", () => {
    expect(canCredit(invoice({ status: "cancelled" })).ok).toBe(false);
  });

  it("refuse une facture déjà intégralement créditée", () => {
    const res = canCredit(invoice({ creditedAmount: 953_000 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("intégralement créditée");
  });

  it("calcule le restant créditable", () => {
    expect(creditableAmount(invoice({ creditedAmount: 300_000 }))).toBe(653_000);
    expect(creditableAmount(invoice({ creditedAmount: 999_999 }))).toBe(0);
  });
});

describe("Avoir total", () => {
  it("reprend exactement les totaux de la facture", () => {
    const res = buildCreditNote(invoice(), "full");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.totalHT).toBe(800_000);
      expect(res.draft.totalTVA).toBe(152_000);
      expect(res.draft.totalTTC).toBe(953_000);
      expect(res.draft.isFull).toBe(true);
      expect(res.draft.lines).toHaveLength(2);
    }
  });

  it("reprend le droit de timbre en entier", () => {
    // Le timbre est un forfait par document : sur un avoir total, il s'annule
    // intégralement.
    const res = buildCreditNote(invoice(), "full");
    if (res.ok) expect(res.draft.totalDTS).toBe(1_000);
  });

  it("est refusé après un avoir partiel", () => {
    // Sinon le total dépasserait la facture : l'utilisateur doit sélectionner
    // les lignes restantes.
    const res = buildCreditNote(invoice({ creditedAmount: 100_000 }), "full");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("avoir partiel");
  });
});

describe("Avoir partiel", () => {
  it("recalcule les totaux ligne par ligne", () => {
    const res = buildCreditNote(invoice(), [{ lineIndex: 0, quantity: 4 }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.totalHT).toBe(200_000);      // 4 × 50 000
      expect(res.draft.totalTVA).toBe(38_000);      // 19 %
      expect(res.draft.totalTTC).toBe(238_000);
      expect(res.draft.lines).toHaveLength(1);
      expect(res.draft.lines[0].quantity).toBe(4);
    }
  });

  it("ne fractionne jamais le droit de timbre", () => {
    const res = buildCreditNote(invoice(), [{ lineIndex: 0, quantity: 1 }]);
    if (res.ok) expect(res.draft.totalDTS).toBe(0);
  });

  it("refuse une quantité supérieure à celle facturée", () => {
    const res = buildCreditNote(invoice(), [{ lineIndex: 0, quantity: 11 }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("11 demandé, 10 encore créditable sur 10 facturé");
  });

  it("cumule les avoirs partiels : une ligne déjà créditée ne se crédite plus", () => {
    const res = buildCreditNote(invoice({ creditedAmount: 357_000 }), [{ lineIndex: 1, quantity: 1 }], [0, 2]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("déjà entièrement créditée");
  });

  it("l'avoir qui complète les précédents reprend le timbre et solde la facture", () => {
    // Formation déjà créditée par un premier avoir (357 000) ; le second
    // crédite les licences : la facture est couverte, timbre compris.
    const res = buildCreditNote(invoice({ creditedAmount: 357_000 }), [{ lineIndex: 0, quantity: 10 }], [0, 2]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.isFull).toBe(true);
      expect(res.draft.totalDTS).toBe(1_000);
      expect(res.draft.totalTTC).toBe(596_000);
      expect(res.draft.lines[0].sourceLineIndex).toBe(0);
    }
  });

  it("refuse une quantité nulle ou négative", () => {
    expect(buildCreditNote(invoice(), [{ lineIndex: 0, quantity: 0 }]).ok).toBe(false);
    expect(buildCreditNote(invoice(), [{ lineIndex: 0, quantity: -3 }]).ok).toBe(false);
  });

  it("refuse une ligne inexistante", () => {
    const res = buildCreditNote(invoice(), [{ lineIndex: 9, quantity: 1 }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("introuvable");
  });

  it("refuse une même ligne sélectionnée deux fois", () => {
    // Sans ce contrôle, on créditerait deux fois la même prestation.
    const res = buildCreditNote(invoice(), [
      { lineIndex: 0, quantity: 5 },
      { lineIndex: 0, quantity: 5 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("deux fois");
  });

  it("refuse une sélection vide", () => {
    expect(buildCreditNote(invoice(), []).ok).toBe(false);
  });

  it("refuse de dépasser le montant encore créditable", () => {
    const res = buildCreditNote(
      invoice({ creditedAmount: 900_000 }),
      [{ lineIndex: 0, quantity: 10 }]
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("dépasse le montant");
  });

  it("respecte la remise de la ligne d'origine", () => {
    const withDiscount = invoice({
      lines: [{ description: "Article remisé", quantity: 10, unitPrice: 10_000,
        tvaRate: 0.19, discount: 20, totalHT: 80_000, totalTVA: 15_200, totalTTC: 95_200 }],
      totalHT: 80_000, totalTVA: 15_200, totalDTS: 0, totalTTC: 95_200,
    });
    const res = buildCreditNote(withDiscount, [{ lineIndex: 0, quantity: 5 }]);
    if (res.ok) expect(res.draft.totalHT).toBe(40_000); // 5 × 10 000 × 0,8
  });

  it("cumule plusieurs avoirs partiels sans dépasser la facture", () => {
    const first = buildCreditNote(invoice(), [{ lineIndex: 0, quantity: 10 }]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const after = invoice({ creditedAmount: first.draft.totalTTC });
    const second = buildCreditNote(after, [{ lineIndex: 1, quantity: 2 }]);
    expect(second.ok).toBe(true);
    if (second.ok) {
      // 595 000 + 357 000 = 952 000, sous les 953 000 TTC (timbre non fractionné).
      expect(first.draft.totalTTC + second.draft.totalTTC).toBeLessThanOrEqual(953_000);
    }
  });
});

describe("Écriture d'extourne", () => {
  it("inverse exactement l'écriture de vente", () => {
    const res = buildCreditNote(invoice(), "full");
    if (!res.ok) throw new Error("avoir non construit");
    const lines = reversalEntryLines(res.draft, "client1");

    const client = lines.find(l => l.accountCode === "411000");
    const produits = lines.find(l => l.accountCode === "706000");
    const tva = lines.find(l => l.accountCode === "443000");

    // Sur une vente : client au débit, produits et TVA au crédit. Ici l'inverse.
    expect(client?.credit).toBe(953_000);
    expect(client?.debit).toBe(0);
    expect(produits?.debit).toBe(800_000);
    expect(tva?.debit).toBe(152_000);
  });

  it("est équilibrée", () => {
    for (const request of ["full" as const, [{ lineIndex: 0, quantity: 3 }]]) {
      const res = buildCreditNote(invoice(), request);
      if (!res.ok) throw new Error("avoir non construit");
      const lines = reversalEntryLines(res.draft, "client1");
      const debit = lines.reduce((s, l) => s + l.debit, 0);
      const credit = lines.reduce((s, l) => s + l.credit, 0);
      expect(debit).toBe(credit);
    }
  });

  it("omet la TVA quand la facture est exonérée", () => {
    const exempt = invoice({
      lines: [{ description: "Export", quantity: 1, unitPrice: 100_000, tvaRate: 0,
        totalHT: 100_000, totalTVA: 0, totalTTC: 100_000 }],
      totalHT: 100_000, totalTVA: 0, totalDTS: 0, totalTTC: 100_000,
    });
    const res = buildCreditNote(exempt, "full");
    if (!res.ok) throw new Error("avoir non construit");
    const lines = reversalEntryLines(res.draft, "client1");
    expect(lines.some(l => l.accountCode === "443000")).toBe(false);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });
});
