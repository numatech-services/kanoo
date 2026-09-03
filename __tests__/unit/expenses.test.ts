/**
 * Notes de frais.
 *
 * Les cas testés ici sont ceux qui coûtent un redressement : une TVA
 * récupérée sans facture, une charge non déductible faute de justificatif,
 * une note approuvée deux fois.
 */

import {
  CATEGORIES, DEFAULT_POLICY, computeLine, totals, checkLines, canSubmit,
  mileageAmount, commitmentEntry, reimbursementEntry, isBalanced,
  canTransition, transitionError, STAFF_PAYABLE, VAT_RECOVERABLE,
  type ExpenseLine, type ExpensePolicy,
} from "@/lib/expenses";

const TODAY = new Date("2026-09-03T10:00:00");

function line(over: Partial<ExpenseLine> = {}): ExpenseLine {
  return {
    date: new Date("2026-09-01"),
    category: "transport",
    description: "Taxi aéroport → bureau",
    amountTTC: 12_000,
    vatAmount: 1_915,
    attachmentCount: 1,
    ...over,
  };
}

function policy(over: Partial<ExpensePolicy> = {}): ExpensePolicy {
  return { ...DEFAULT_POLICY, ...over };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Calcul d'une ligne", () => {
  it("déduit la TVA quand la nature l'autorise", () => {
    const c = computeLine(line(), policy());
    expect(c.vatDeducted).toBe(1_915);
    expect(c.amountHT).toBe(10_085);
  });

  it("laisse la TVA dans la charge quand la nature l'exclut", () => {
    // C'est l'erreur classique sur la restauration : sortir la TVA sans la
    // déduire ferait disparaître du résultat une dépense réellement supportée.
    const c = computeLine(line({ category: "restauration" }), policy());
    expect(c.vatDeducted).toBe(0);
    expect(c.amountHT).toBe(12_000);
  });

  it("respecte un choix explicite contre le défaut de la nature", () => {
    const c = computeLine(line({ category: "restauration", vatRecoverable: true }), policy());
    expect(c.vatDeducted).toBe(1_915);
  });

  it("convertit une dépense engagée en devise", () => {
    const c = computeLine(
      line({ amountTTC: 50, vatAmount: 0, currency: "EUR", exchangeRate: 655.957 }),
      policy()
    );
    expect(c.amountTTC).toBe(32_798);
  });

  it("ignore le taux quand la devise est déjà le franc", () => {
    const c = computeLine(line({ currency: "XOF", exchangeRate: 655 }), policy());
    expect(c.amountTTC).toBe(12_000);
  });

  it("impute la ligne au compte de sa nature", () => {
    expect(computeLine(line({ category: "carburant" }), policy()).account)
      .toBe(CATEGORIES.carburant.account);
  });
});

describe("Totaux", () => {
  it("sépare ce qui pèse sur le résultat de ce qui est récupéré", () => {
    const t = totals([
      line(),                                        // TVA déductible
      line({ category: "restauration", amountTTC: 20_000, vatAmount: 3_193 }),
    ], policy());
    expect(t.totalTTC).toBe(32_000);
    expect(t.totalVatDeducted).toBe(1_915);
    expect(t.totalCharge).toBe(30_085);
    expect(t.lineCount).toBe(2);
  });

  it("rend des totaux nuls sur une note vide, sans lever", () => {
    expect(totals([], policy())).toEqual({
      totalTTC: 0, totalVatDeducted: 0, totalCharge: 0, lineCount: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Contrôles", () => {
  const blocking = (lines: ExpenseLine[], p = policy()) =>
    checkLines(lines, p, TODAY).filter(i => i.level === "block");

  it("laisse passer une ligne complète", () => {
    expect(checkLines([line()], policy(), TODAY)).toEqual([]);
  });

  it("bloque une dépense sans justificatif", () => {
    const issues = blocking([line({ attachmentCount: 0 })]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toMatch(/justificatif/i);
  });

  it("bloque une TVA récupérée sans facture", () => {
    // Même si la nature n'exige pas de justificatif, la déduction, elle,
    // l'exige : la facture est la condition du droit.
    const issues = blocking([line({ category: "mission", vatRecoverable: true, attachmentCount: 0 })]);
    expect(issues.some(i => /TVA récupérée sans justificatif/.test(i.message))).toBe(true);
  });

  it("bloque une TVA supérieure au total", () => {
    expect(blocking([line({ amountTTC: 1_000, vatAmount: 5_000 })]).length).toBeGreaterThan(0);
  });

  it("bloque un objet manquant", () => {
    expect(blocking([line({ description: "   " })])[0].message).toMatch(/motif/i);
  });

  it("bloque un montant nul", () => {
    expect(blocking([line({ amountTTC: 0 })]).length).toBeGreaterThan(0);
  });

  it("bloque une devise sans taux", () => {
    expect(blocking([line({ currency: "EUR" })])[0].message).toMatch(/taux/i);
  });

  it("bloque une dépense datée dans le futur", () => {
    expect(blocking([line({ date: new Date("2026-12-01") })])[0].message).toMatch(/futur/i);
  });

  it("signale un dépassement de plafond sans l'interdire", () => {
    // Bloquer pousserait le salarié à reclasser sa dépense ailleurs : on
    // perdrait la dépense réelle *et* le contrôle.
    const issues = checkLines(
      [line({ category: "restauration", amountTTC: 40_000, attachmentCount: 1 })],
      policy({ caps: { restauration: 15_000 } }), TODAY
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warn");
    expect(canSubmit(issues)).toBe(true);
  });

  it("signale une dépense trop ancienne sans l'interdire", () => {
    const issues = checkLines([line({ date: new Date("2026-01-05") })], policy(), TODAY);
    expect(issues[0].level).toBe("warn");
    expect(issues[0].message).toMatch(/jours/);
  });

  it("bloque un kilométrage tant qu'aucun tarif n'est défini", () => {
    // Inventer un barème ferait passer un chiffre arbitraire pour une
    // référence fiscale ; le Niger n'en publie pas.
    const issues = blocking([line({ category: "transport", distanceKm: 120 })]);
    expect(issues.some(i => /tarif kilométrique/.test(i.message))).toBe(true);
  });

  it("accepte le kilométrage une fois le tarif renseigné", () => {
    const issues = blocking([line({ distanceKm: 120 })], policy({ mileageRate: 250 }));
    expect(issues).toEqual([]);
  });

  it("rattache chaque anomalie à sa ligne", () => {
    const issues = checkLines(
      [line(), line({ description: "" }), line()], policy(), TODAY
    );
    expect(issues.every(i => i.index === 1)).toBe(true);
  });

  it("empêche l'envoi tant qu'une anomalie bloque", () => {
    expect(canSubmit(checkLines([line({ attachmentCount: 0 })], policy(), TODAY))).toBe(false);
  });
});

describe("Indemnité kilométrique", () => {
  it("refuse de calculer sans tarif plutôt que d'en inventer un", () => {
    expect(mileageAmount(120, policy())).toBeNull();
    expect(mileageAmount(120, policy({ mileageRate: 0 }))).toBeNull();
  });

  it("applique le tarif de l'organisation", () => {
    expect(mileageAmount(120, policy({ mileageRate: 250 }))).toBe(30_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Écritures", () => {
  it("regroupe les charges par compte", () => {
    // Douze tickets de taxi ne produisent pas douze lignes au même compte.
    const entry = commitmentEntry([line(), line(), line()], policy());
    const charges = entry.filter(l => l.accountCode === CATEGORIES.transport.account);
    expect(charges).toHaveLength(1);
    expect(charges[0].debit).toBe(10_085 * 3);
  });

  it("porte la TVA déductible à son compte, et rien quand elle est nulle", () => {
    const withVat = commitmentEntry([line()], policy());
    expect(withVat.some(l => l.accountCode === VAT_RECOVERABLE.account)).toBe(true);

    const withoutVat = commitmentEntry([line({ category: "restauration" })], policy());
    expect(withoutVat.some(l => l.accountCode === VAT_RECOVERABLE.account)).toBe(false);
  });

  it("crédite la dette envers le salarié du montant réellement engagé", () => {
    const entry = commitmentEntry([line(), line({ category: "restauration", amountTTC: 20_000, vatAmount: 3_193 })], policy());
    const payable = entry.find(l => l.accountCode === STAFF_PAYABLE.account)!;
    expect(payable.credit).toBe(32_000);
  });

  it("produit une écriture équilibrée", () => {
    const entry = commitmentEntry([
      line(),
      line({ category: "restauration", amountTTC: 17_500, vatAmount: 2_794 }),
      line({ category: "carburant", amountTTC: 25_000, vatAmount: 3_992 }),
    ], policy());
    expect(isBalanced(entry)).toBe(true);
  });

  it("équilibre aussi le règlement", () => {
    const entry = reimbursementEntry(32_000);
    expect(isBalanced(entry)).toBe(true);
    expect(entry.find(l => l.accountCode === "521000")!.credit).toBe(32_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Cycle de vie", () => {
  it("suit le chemin normal", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("submitted", "approved")).toBe(true);
    expect(canTransition("approved", "reimbursed")).toBe(true);
  });

  it("laisse revenir en brouillon depuis la validation ou le refus", () => {
    expect(canTransition("submitted", "draft")).toBe(true);
    expect(canTransition("rejected", "draft")).toBe(true);
  });

  it("refuse de défaire une approbation en silence", () => {
    // L'approbation a produit une écriture : l'annuler suppose une
    // contre-passation, pas un retour en arrière.
    expect(canTransition("approved", "draft")).toBe(false);
    expect(transitionError("approved", "draft")).toMatch(/contre-passation/);
  });

  it("fait du remboursement un terminus", () => {
    for (const to of ["draft", "submitted", "approved", "rejected"] as const) {
      expect(canTransition("reimbursed", to)).toBe(false);
    }
    expect(transitionError("reimbursed", "draft")).toMatch(/note corrective/);
  });

  it("refuse de sauter la validation", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("draft", "reimbursed")).toBe(false);
  });
});
