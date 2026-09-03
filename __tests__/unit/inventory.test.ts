/**
 * Inventaire physique.
 *
 * Ce qui est testé ici décide de la valeur de l'inventaire : un comptage
 * aveugle, un théorique figé, un écart valorisé au coût et non au prix de
 * vente, et des écarts qui ne se compensent pas entre eux.
 */

import {
  DEFAULT_COUNT_POLICY, weightedAverageCost, evaluateLine, summarizeCount,
  validationBlockers, adjustmentEntry, isBalanced, rankVariances,
  INVENTORY_ACCOUNTS, COUNT_STATUS_LABEL,
  type CountLine, type CountPolicy,
} from "@/lib/inventory";

function line(over: Partial<CountLine> = {}): CountLine {
  return {
    productId: "p1", code: "ART-001", label: "Ciment 50 kg",
    theoreticalQty: 100, countedQty: 100, unitCost: 5_000, ...over,
  };
}

const policy = (over: Partial<CountPolicy> = {}): CountPolicy => ({ ...DEFAULT_COUNT_POLICY, ...over });

// ─────────────────────────────────────────────────────────────────────────────

describe("Coût moyen pondéré", () => {
  it("pondère par les quantités, pas par le nombre d'entrées", () => {
    // 10 à 1 000 et 90 à 2 000 : la moyenne simple donnerait 1 500.
    expect(weightedAverageCost([
      { quantity: 10, unitCost: 1_000 },
      { quantity: 90, unitCost: 2_000 },
    ])).toBe(1_900);
  });

  it("ignore les entrées sans coût plutôt que de les compter à zéro", () => {
    expect(weightedAverageCost([
      { quantity: 50, unitCost: 4_000 },
      { quantity: 50 },
    ])).toBe(4_000);
  });

  it("ignore les sorties", () => {
    expect(weightedAverageCost([
      { quantity: 100, unitCost: 3_000 },
      { quantity: -40, unitCost: 3_000 },
    ])).toBe(3_000);
  });

  it("ne devine pas un coût quand il n'y a pas d'historique", () => {
    // Renvoyer le prix de vente ferait entrer une marge jamais gagnée dans
    // une écriture comptable.
    expect(weightedAverageCost([])).toBeNull();
    expect(weightedAverageCost([{ quantity: 10 }])).toBeNull();
  });
});

describe("Évaluation d'une ligne", () => {
  it("distingue une ligne non comptée d'une ligne comptée à zéro", () => {
    // Une ligne non relevée n'est pas un stock vide : le confondre écrirait
    // une perte totale sur un article simplement oublié.
    expect(evaluateLine(line({ countedQty: null }), policy()).counted).toBe(false);
    const zero = evaluateLine(line({ countedQty: 0 }), policy());
    expect(zero.counted).toBe(true);
    expect(zero.variance).toBe(-100);
  });

  it("fait primer le second comptage sur le premier", () => {
    const result = evaluateLine(line({ countedQty: 70, recountQty: 96 }), policy());
    expect(result.finalQty).toBe(96);
    expect(result.variance).toBe(-4);
  });

  it("valorise l'écart au coût", () => {
    expect(evaluateLine(line({ countedQty: 95 }), policy()).varianceValue).toBe(-25_000);
  });

  it("laisse l'écart non valorisé plutôt que d'inventer un coût", () => {
    const result = evaluateLine(line({ countedQty: 95, unitCost: null }), policy());
    expect(result.variance).toBe(-5);
    expect(result.varianceValue).toBeNull();
  });

  it("demande un second comptage au-delà du seuil en quantité", () => {
    expect(evaluateLine(line({ countedQty: 85 }), policy()).needsRecount).toBe(true);
    expect(evaluateLine(line({ countedQty: 97 }), policy()).needsRecount).toBe(false);
  });

  it("demande un second comptage au-delà du seuil relatif, même sur petite quantité", () => {
    // 3 sur 20, c'est 15 % : le seuil absolu de 10 ne l'attraperait pas.
    const small = evaluateLine(line({ theoreticalQty: 20, countedQty: 17 }), policy());
    expect(small.needsRecount).toBe(true);
  });

  it("ne redemande pas un comptage déjà refait", () => {
    const result = evaluateLine(line({ countedQty: 60, recountQty: 62 }), policy());
    expect(result.needsRecount).toBe(false);
  });

  it("exige un motif au-delà du seuil de valeur", () => {
    // 20 × 5 000 = 100 000, au-dessus du seuil de 50 000.
    expect(evaluateLine(line({ countedQty: 80, recountQty: 80 }), policy()).needsReason).toBe(true);
    expect(evaluateLine(line({ countedQty: 80, recountQty: 80, reason: "Casse au dépôt" }), policy()).needsReason)
      .toBe(false);
  });

  it("exige un motif sur un écart qu'on n'a pas pu valoriser", () => {
    // Sans valeur, on ne peut pas juger de l'importance : on demande.
    const result = evaluateLine(line({ countedQty: 99, unitCost: null }), policy());
    expect(result.needsReason).toBe(true);
  });

  it("n'exige rien quand il n'y a pas d'écart", () => {
    const result = evaluateLine(line(), policy());
    expect(result.variance).toBe(0);
    expect(result.needsRecount).toBe(false);
    expect(result.needsReason).toBe(false);
  });

  it("traite un article théoriquement absent mais trouvé", () => {
    const result = evaluateLine(line({ theoreticalQty: 0, countedQty: 12 }), policy());
    expect(result.variance).toBe(12);
    expect(result.variancePercent).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Synthèse", () => {
  const lines = [
    line({ productId: "a", countedQty: 100 }),                        // juste
    line({ productId: "b", countedQty: 95, reason: "Casse" }),        // −5
    line({ productId: "c", countedQty: 103, reason: "Retour" }),      // +3
    line({ productId: "d", countedQty: null }),                       // non compté
    line({ productId: "e", countedQty: 98, unitCost: null, reason: "?" }), // non valorisé
  ];

  it("sépare les excédents des manquants sans les compenser", () => {
    // Compenser masquerait un vol derrière une erreur de saisie.
    const s = summarizeCount(lines, policy());
    expect(s.shortageValue).toBe(25_000);
    expect(s.surplusValue).toBe(15_000);
    expect(s.netValue).toBe(-10_000);
  });

  it("compte les lignes non relevées à part", () => {
    const s = summarizeCount(lines, policy());
    expect(s.pending).toBe(1);
    expect(s.counted).toBe(4);
  });

  it("signale les écarts qu'il n'a pas pu valoriser", () => {
    expect(summarizeCount(lines, policy()).unvaluedLines).toBe(1);
  });

  it("mesure la fiabilité sur ce qui a été compté", () => {
    // 1 ligne juste sur 4 comptées. L'annoncer sur les 5 ferait passer un
    // inventaire à moitié fait pour un inventaire à moitié faux.
    expect(summarizeCount(lines, policy()).accuracy).toBe(25);
  });

  it("ne calcule aucune fiabilité tant que rien n'est compté", () => {
    expect(summarizeCount([line({ countedQty: null })], policy()).accuracy).toBeNull();
  });
});

describe("Conditions de validation", () => {
  it("laisse passer un inventaire complet et expliqué", () => {
    const clean = [
      line({ productId: "a", countedQty: 100 }),
      line({ productId: "b", countedQty: 99, reason: "Casse" }),
    ];
    expect(validationBlockers(clean, policy())).toEqual([]);
  });

  it("refuse tant qu'une ligne n'a pas été relevée", () => {
    expect(validationBlockers([line({ countedQty: null })], policy()))
      .toContain("lines_pending");
  });

  it("refuse tant qu'un écart notable n'a pas été recompté", () => {
    expect(validationBlockers([line({ countedQty: 70 })], policy()))
      .toContain("recount_required");
  });

  it("refuse un écart de valeur sans motif", () => {
    expect(validationBlockers([line({ countedQty: 80, recountQty: 80 })], policy()))
      .toContain("reason_required");
  });

  it("refuse un inventaire vide", () => {
    expect(validationBlockers([], policy())).toContain("nothing_counted");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Écriture de régularisation", () => {
  it("charge le résultat d'un manquant", () => {
    const entry = adjustmentEntry([line({ countedQty: 95, reason: "Casse" })], policy());
    const charge = entry.find(l => l.accountCode === INVENTORY_ACCOUNTS.shortage.account)!;
    expect(charge.debit).toBe(25_000);
    expect(isBalanced(entry)).toBe(true);
  });

  it("crédite le résultat d'un excédent", () => {
    const entry = adjustmentEntry([line({ countedQty: 104, reason: "Retour" })], policy());
    const produit = entry.find(l => l.accountCode === INVENTORY_ACCOUNTS.surplus.account)!;
    expect(produit.credit).toBe(20_000);
    expect(isBalanced(entry)).toBe(true);
  });

  it("porte les deux sens séparément dans la même écriture", () => {
    const entry = adjustmentEntry([
      line({ productId: "a", countedQty: 94, reason: "Casse" }),
      line({ productId: "b", countedQty: 106, reason: "Retour" }),
    ], policy());
    expect(entry.find(l => l.accountCode === INVENTORY_ACCOUNTS.shortage.account)?.debit).toBe(30_000);
    expect(entry.find(l => l.accountCode === INVENTORY_ACCOUNTS.surplus.account)?.credit).toBe(30_000);
    expect(isBalanced(entry)).toBe(true);
  });

  it("n'écrit rien quand l'inventaire est juste", () => {
    expect(adjustmentEntry([line()], policy())).toEqual([]);
  });

  it("laisse hors écriture ce qui n'a pas pu être valorisé", () => {
    // Écrire un montant deviné serait pire que ne rien écrire.
    const entry = adjustmentEntry([line({ countedQty: 90, unitCost: null, reason: "?" })], policy());
    expect(entry).toEqual([]);
  });
});

describe("Classement des écarts", () => {
  it("met les plus lourds en tête, en valeur absolue", () => {
    const ranked = rankVariances([
      line({ productId: "a", code: "A", countedQty: 99 }),                        // −5 000
      line({ productId: "b", code: "B", countedQty: 120, unitCost: 5_000 }),      // +100 000
      line({ productId: "c", code: "C", countedQty: 90, unitCost: 5_000 }),       // −50 000
    ], policy());
    expect(ranked.map(r => r.line.code)).toEqual(["B", "C", "A"]);
  });

  it("ignore les lignes justes", () => {
    expect(rankVariances([line()], policy())).toEqual([]);
  });
});

describe("Libellés", () => {
  it("nomme chaque état de session", () => {
    expect(Object.values(COUNT_STATUS_LABEL).every(l => l.length > 3)).toBe(true);
  });
});
