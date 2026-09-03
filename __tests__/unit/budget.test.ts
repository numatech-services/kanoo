/**
 * Budget prévisionnel.
 *
 * Le test central est celui du prorata : comparer trois mois de réalisé à un
 * budget annuel donne toujours l'impression d'être sous contrôle, et c'est
 * l'erreur que ce module existe pour empêcher.
 */

import {
  weightsOf, monthlyBudget, proratedBudget, evaluateLine, isFavourable,
  summarize, headline, TOLERANCE_PERCENT, SEASONAL_PROFILES, VERDICT_LABEL,
  type BudgetLine,
} from "@/lib/budget";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
              "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function line(over: Partial<BudgetLine> = {}): BudgetLine {
  return {
    accountPrefix: "60", label: "Achats", nature: "expense",
    annualAmount: 12_000_000, ...over,
  };
}

/** Réalisé mensuel : `n` mois au montant donné, le reste à zéro. */
function actual(months: number, amount: number): number[] {
  return Array.from({ length: 12 }, (_, i) => (i < months ? amount : 0));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Répartition mensuelle", () => {
  it("répartit en douzièmes à défaut de profil", () => {
    expect(monthlyBudget(line())).toEqual(Array.from({ length: 12 }, () => 1_000_000));
  });

  it("normalise des poids qui ne somment pas à un", () => {
    // Une somme différente de 1 fausserait chaque mois.
    const weights = weightsOf(line({ monthlyWeights: Array.from({ length: 12 }, () => 5) }));
    expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10);
  });

  it("retombe sur les douzièmes si les poids sont incomplets ou nuls", () => {
    expect(weightsOf(line({ monthlyWeights: [1, 2, 3] }))).toEqual(
      Array.from({ length: 12 }, () => 1 / 12)
    );
    expect(weightsOf(line({ monthlyWeights: Array.from({ length: 12 }, () => 0) })))
      .toEqual(Array.from({ length: 12 }, () => 1 / 12));
  });

  it("suit un profil saisonnier", () => {
    // Une entreprise de BTP ne facture pas en août comme en novembre.
    const btp = line({ monthlyWeights: SEASONAL_PROFILES.dry_season.weights });
    const months = monthlyBudget(btp);
    expect(months[6]).toBeLessThan(months[0]);   // juillet < janvier
    expect(months.reduce((s, v) => s + v, 0)).toBeCloseTo(12_000_000, -3);
  });
});

describe("Budget au prorata", () => {
  it("ne retient que les mois clos", () => {
    // Index 2 = mars : trois mois sur douze.
    expect(proratedBudget(line(), 2)).toBe(3_000_000);
  });

  it("suit le profil saisonnier plutôt que le calendrier", () => {
    const btp = line({ monthlyWeights: SEASONAL_PROFILES.dry_season.weights });
    // Janvier à mars pèsent 38 % chez un BTP, pas 25 %.
    expect(proratedBudget(btp, 2)).toBeGreaterThan(4_000_000);
  });

  it("borne aux extrémités de l'exercice", () => {
    expect(proratedBudget(line(), -1)).toBe(0);
    expect(proratedBudget(line(), 30)).toBe(12_000_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Évaluation d'une ligne", () => {
  it("compare au prorata, pas au budget annuel", () => {
    // 3 mois à 1,2 M = 3,6 M réalisés contre 3 M prévus : 20 % de dépassement.
    // Comparé aux 12 M annuels, cela ressemblerait à 30 % de consommation et
    // à une marge confortable.
    const result = evaluateLine(line(), actual(3, 1_200_000), 2);
    expect(result.budgetToDate).toBe(3_000_000);
    expect(result.actualToDate).toBe(3_600_000);
    expect(result.variancePercent).toBe(20);
    expect(result.verdict).toBe("over");
  });

  it("reste dans l'épure sous le seuil de tolérance", () => {
    // Un écart de 3 % est du bruit ; l'annoncer chaque mois apprend à ignorer
    // les alertes.
    const result = evaluateLine(line(), actual(3, 1_030_000), 2);
    expect(Math.abs(result.variancePercent!)).toBeLessThan(TOLERANCE_PERCENT);
    expect(result.verdict).toBe("on_track");
  });

  it("signale une enveloppe annuelle déjà consommée", () => {
    const result = evaluateLine(line(), actual(6, 2_100_000), 5);
    expect(result.verdict).toBe("exhausted");
  });

  it("signale du réalisé sans ligne budgétaire", () => {
    const result = evaluateLine(line({ annualAmount: 0 }), actual(2, 500_000), 1);
    expect(result.verdict).toBe("no_budget");
  });

  it("projette la fin d'exercice au rythme constaté", () => {
    const result = evaluateLine(line(), actual(3, 1_200_000), 2);
    expect(result.projection).toBe(14_400_000);
  });

  it("ne projette rien avant le premier mois clos", () => {
    // Extrapoler sur zéro mois n'a pas de sens.
    expect(evaluateLine(line(), actual(0, 0), -1).projection).toBeNull();
  });

  it("traite l'absence de réalisé sans lever", () => {
    const result = evaluateLine(line(), undefined, 5);
    expect(result.actualToDate).toBe(0);
    expect(result.verdict).toBe("under");
  });
});

describe("Lecture du verdict selon la nature", () => {
  it("fait d'un dépassement de charges une mauvaise nouvelle", () => {
    const charge = evaluateLine(line({ nature: "expense" }), actual(3, 1_500_000), 2);
    expect(isFavourable(charge)).toBe(false);
  });

  it("fait d'un dépassement de produits une bonne nouvelle", () => {
    // Un tableau qui peint les deux en rouge apprend à ne plus regarder.
    const produit = evaluateLine(line({ nature: "revenue" }), actual(3, 1_500_000), 2);
    expect(isFavourable(produit)).toBe(true);
  });

  it("fait d'un produit en deçà une mauvaise nouvelle", () => {
    const produit = evaluateLine(line({ nature: "revenue" }), actual(3, 500_000), 2);
    expect(isFavourable(produit)).toBe(false);
  });

  it("ne juge pas ce qui est dans l'épure", () => {
    expect(isFavourable(evaluateLine(line(), actual(3, 1_000_000), 2))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Synthèse", () => {
  const results = [
    evaluateLine(line({ accountPrefix: "70", label: "Ventes", nature: "revenue", annualAmount: 24_000_000 }),
      actual(3, 2_200_000), 2),
    evaluateLine(line({ accountPrefix: "60", nature: "expense", annualAmount: 12_000_000 }),
      actual(3, 1_400_000), 2),
    evaluateLine(line({ accountPrefix: "66", label: "Personnel", nature: "expense", annualAmount: 6_000_000 }),
      actual(3, 500_000), 2),
  ];

  it("sépare produits et charges", () => {
    const s = summarize(results, 2);
    expect(s.revenueActual).toBe(6_600_000);
    expect(s.expenseActual).toBe(5_700_000);
  });

  it("compare le résultat constaté au résultat prévu sur la même période", () => {
    const s = summarize(results, 2);
    expect(s.plannedResult).toBe(6_000_000 - 4_500_000);
    expect(s.actualResult).toBe(900_000);
  });

  it("ne compte comme dépassement que ce qui est défavorable", () => {
    // Les ventes dépassent aussi, mais c'est une bonne nouvelle.
    expect(summarize(results, 2).linesOverBudget).toBe(1);
  });

  it("projette un résultat de fin d'exercice", () => {
    expect(summarize(results, 2).projectedResult).not.toBeNull();
  });

  it("ne projette rien avant le premier mois clos", () => {
    const early = [evaluateLine(line(), actual(0, 0), -1)];
    expect(summarize(early, -1).projectedResult).toBeNull();
  });
});

describe("Phrase de synthèse", () => {
  it("dit l'essentiel avant les colonnes", () => {
    const s = summarize([
      evaluateLine(line({ nature: "revenue", annualAmount: 24_000_000 }), actual(3, 2_200_000), 2),
      evaluateLine(line({ nature: "expense", annualAmount: 12_000_000 }), actual(3, 1_400_000), 2),
    ], 2);
    const phrase = headline(s, MOIS);
    expect(phrase).toMatch(/fin mars/);
    expect(phrase).toMatch(/résultat/i);
  });

  it("le dit quand rien n'a bougé", () => {
    const s = summarize([evaluateLine(line(), actual(0, 0), 2)], 2);
    expect(headline(s, MOIS)).toMatch(/Aucun mouvement/);
  });

  it("annonce un écart conforme sans le dramatiser", () => {
    const s = summarize([
      evaluateLine(line({ nature: "revenue", annualAmount: 24_000_000 }), actual(3, 2_000_000), 2),
      evaluateLine(line({ nature: "expense", annualAmount: 12_000_000 }), actual(3, 1_000_000), 2),
    ], 2);
    expect(headline(s, MOIS)).toMatch(/conforme/);
  });
});

describe("Profils saisonniers", () => {
  it("somment tous à un", () => {
    for (const profile of Object.values(SEASONAL_PROFILES)) {
      expect(profile.weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 6);
      expect(profile.weights).toHaveLength(12);
    }
  });

  it("nomme chaque verdict en français", () => {
    expect(Object.values(VERDICT_LABEL).every(l => l.length > 3)).toBe(true);
  });
});
