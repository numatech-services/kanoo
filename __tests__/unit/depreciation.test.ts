/**
 * Tests unitaires — Amortissements OHADA (Niger)
 * Couvre : plan linéaire (lib/depreciation), plan dégressif avec bascule linéaire,
 *   coefficients selon la durée de vie, durées usuelles, ainsi que les helpers
 *   d'amortissement de lib/niger-fiscal (dotation, VNC).
 *
 * Note : `calculerAmortissementLineaire` existe dans les deux modules avec des
 *   signatures de retour différentes (DepreciationPlan vs AmortissementEntry[]) ;
 *   les imports sont donc aliasés pour lever l'ambiguïté.
 *
 * Exécuter : npx jest __tests__/unit/depreciation.test.ts
 */

import {
  calculerAmortissementLineaire as planLineaire,
  calculerAmortissementDegressif as planDegressif,
  USEFUL_LIFE,
} from "@/lib/depreciation";

import {
  calculerAmortissementLineaire as tableauLineaire,
  dotationExercice,
  vncADate,
} from "@/lib/niger-fiscal";

// somme des dotations
function sommeAnnuites(schedule: Array<{ annuity: number }>): number {
  return schedule.reduce((s, e) => s + e.annuity, 0);
}

// ─── Plan linéaire (lib/depreciation) ────────────────────────────────────────
describe("Amortissement linéaire (DepreciationPlan)", () => {
  test("Bien 1 000 000 sur 5 ans, sans valeur résiduelle", () => {
    const plan = planLineaire(1_000_000, 0, 5, 2026);
    expect(plan.method).toBe("linear");
    expect(plan.schedule).toHaveLength(5);
    expect(plan.annualRate).toBeCloseTo(0.2, 6);
    expect(plan.schedule[0].annuity).toBe(200_000);
    expect(plan.schedule[0].year).toBe(2026);
    // Cumul et VNC cohérents
    expect(plan.schedule[4].cumulative).toBe(1_000_000);
    expect(plan.schedule[4].netValue).toBe(0);
    expect(plan.totalDepreciation).toBe(1_000_000);
    // La somme des dotations reconstitue la base amortissable
    expect(sommeAnnuites(plan.schedule)).toBe(1_000_000);
  });

  test("Valeur résiduelle : la base amortissable l'exclut", () => {
    const plan = planLineaire(1_200_000, 200_000, 5, 2026);
    expect(plan.totalDepreciation).toBe(1_000_000);
    expect(sommeAnnuites(plan.schedule)).toBe(1_000_000);
    // VNC finale = valeur résiduelle
    expect(plan.schedule[4].netValue).toBe(200_000);
  });

  test("La dernière annuité absorbe les arrondis (base non divisible)", () => {
    const plan = planLineaire(1_000_000, 0, 3, 2026);
    // 333 333 + 333 333 + 333 334 = 1 000 000
    expect(plan.schedule[0].annuity).toBe(333_333);
    expect(plan.schedule[2].annuity).toBe(333_334);
    expect(sommeAnnuites(plan.schedule)).toBe(1_000_000);
  });
});

// ─── Plan dégressif (lib/depreciation) ───────────────────────────────────────
describe("Amortissement dégressif (coefficients OHADA + bascule linéaire)", () => {
  test("Durée 5 ans → coefficient 2 (taux dégressif 40%)", () => {
    const plan = planDegressif(1_000_000, 0, 5, 2026);
    expect(plan.method).toBe("degressive");
    expect(plan.annualRate).toBeCloseTo(0.4, 6);
    expect(plan.schedule[0].annuity).toBe(400_000); // 1 000 000 × 40%
    // Le total amorti reste la base, et la VNC finale tombe à 0
    expect(sommeAnnuites(plan.schedule)).toBe(1_000_000);
    expect(plan.schedule[4].netValue).toBe(0);
    // Les dotations sont décroissantes puis stabilisées (bascule linéaire)
    for (let i = 1; i < plan.schedule.length; i++) {
      expect(plan.schedule[i].annuity).toBeLessThanOrEqual(plan.schedule[i - 1].annuity);
    }
  });

  test("Durée < 5 ans → coefficient 1,5", () => {
    const plan = planDegressif(900_000, 0, 3, 2026);
    // taux linéaire 1/3 × 1,5 = 0,5
    expect(plan.annualRate).toBeCloseTo(0.5, 6);
  });

  test("Durée ≥ 7 ans → coefficient 2,5", () => {
    const plan = planDegressif(1_000_000, 0, 10, 2026);
    // taux linéaire 1/10 × 2,5 = 0,25
    expect(plan.annualRate).toBeCloseTo(0.25, 6);
  });

  test("Taux personnalisé prioritaire sur le coefficient", () => {
    const plan = planDegressif(1_000_000, 0, 5, 2026, 0.35);
    expect(plan.annualRate).toBeCloseTo(0.35, 6);
  });

  test("Valeur résiduelle respectée en fin de plan", () => {
    const plan = planDegressif(1_000_000, 100_000, 5, 2026);
    expect(plan.schedule[4].netValue).toBe(100_000);
    expect(sommeAnnuites(plan.schedule)).toBe(900_000);
  });
});

// ─── Durées de vie usuelles ───────────────────────────────────────────────────
describe("Durées de vie usuelles (USEFUL_LIFE)", () => {
  test("Catégories clés", () => {
    expect(USEFUL_LIFE.building.years).toBe(20);
    expect(USEFUL_LIFE.vehicle.years).toBe(5);
    expect(USEFUL_LIFE.computer.years).toBe(3);
    expect(USEFUL_LIFE.land.years).toBe(0); // terrain non amortissable
  });
});

// ─── Helpers d'amortissement (lib/niger-fiscal) ──────────────────────────────
describe("Dotation de l'exercice et VNC (tableau AmortissementEntry[])", () => {
  const plan = tableauLineaire(1_000_000, 0, 5, 2026); // 2026 → 2030, 200 000 / an

  test("dotationExercice renvoie l'annuité d'une année du plan", () => {
    expect(dotationExercice(plan, 2027)).toBe(200_000);
  });
  test("dotationExercice = 0 hors du plan", () => {
    expect(dotationExercice(plan, 2050)).toBe(0);
  });
  test("vncADate après le premier exercice", () => {
    expect(vncADate(1_000_000, plan, 2026)).toBe(800_000);
  });
  test("vncADate avant tout amortissement = coût d'acquisition", () => {
    expect(vncADate(1_000_000, plan, 2000)).toBe(1_000_000);
  });
  test("vncADate en fin de plan = 0", () => {
    expect(vncADate(1_000_000, plan, 2030)).toBe(0);
  });
});
