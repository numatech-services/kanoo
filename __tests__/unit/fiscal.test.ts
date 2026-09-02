/**
 * Tests unitaires — Calculs fiscaux Niger
 * Couvre : TVA, CNSS, IR progressif, SMIG, prime d'ancienneté, IS/BIC, retenues
 *
 * Exécuter : npx jest __tests__/unit/fiscal.test.ts
 */

import {
  calculerTVA, calculerTTC, calculerDTS,
  calculerCNSS,
  calculerIR, BAREME_IR_MENSUEL,
  verifierSMIG, SMIG_MENSUEL,
  calculerPrimeAnciennete, calculerTauxAnciennete,
  calculerIS, calculerAcomptesIS,
  calculerRetenue, calculerRetenueDetaillee,
  RETENUES_DETAILLEES,
  TVA_TAUX_STANDARD,
} from "@/lib/niger-fiscal";

import { calculerBulletinDePaie, recapitulatifMensuel } from "@/lib/payslip-calc";

// ─── Utilitaire ──────────────────────────────────────────────────────────────
function assertClose(actual: number, expected: number, tolerance = 1, label = "") {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} — Attendu ≈${expected}, obtenu ${actual} (tolérance ±${tolerance})`);
  }
}

describe("TVA Niger (19%)", () => {
  test("Taux standard = 19%", () => {
    expect(TVA_TAUX_STANDARD).toBe(0.19);
  });

  test("calculerTVA(100 000) = 19 000 XOF", () => {
    expect(calculerTVA(100_000)).toBe(19_000);
  });

  test("calculerTTC(100 000) = 119 000 XOF", () => {
    expect(calculerTTC(100_000)).toBe(119_000);
  });

  test("calculerTVA(0) = 0", () => {
    expect(calculerTVA(0)).toBe(0);
  });

  test("calculerTVA avec taux réduit 10%", () => {
    expect(calculerTVA(100_000, 0.10)).toBe(10_000);
  });

  test("Taux exonéré = 0", () => {
    expect(calculerTVA(100_000, 0)).toBe(0);
  });

  test("calculerTVA sur montant fractionnaire — arrondi à l'entier", () => {
    const tva = calculerTVA(33_333);
    expect(Number.isInteger(tva)).toBe(true);
    expect(tva).toBe(Math.round(33_333 * 0.19));
  });
});

describe("CNSS Niger (3,6% + 16,4%)", () => {
  test("Part salariale 3,6% sur 100 000 = 3 600", () => {
    const r = calculerCNSS(100_000);
    expect(r.salarie).toBe(3_600);
  });

  test("Part patronale 16,4% sur 100 000 = 16 400", () => {
    const r = calculerCNSS(100_000);
    expect(r.patronal).toBe(16_400);
  });

  test("CNSS total = 20% sur 100 000 = 20 000", () => {
    const r = calculerCNSS(100_000);
    expect(r.total).toBe(20_000);
  });

  test("CNSS sur salaire SMIG (41 000)", () => {
    const r = calculerCNSS(41_000);
    expect(r.salarie).toBe(Math.round(41_000 * 0.036));
    expect(r.patronal).toBe(Math.round(41_000 * 0.164));
  });

  test("CNSS résultats entiers (pas de centimes)", () => {
    const r = calculerCNSS(123_456);
    expect(Number.isInteger(r.salarie)).toBe(true);
    expect(Number.isInteger(r.patronal)).toBe(true);
  });
});

describe("IR progressif Niger — barème 5 tranches", () => {
  test("Tranche 0% : revenu ≤ 35 000 → IR = 0", () => {
    expect(calculerIR(35_000)).toBe(0);
    expect(calculerIR(30_000)).toBe(0);
    expect(calculerIR(0)).toBe(0);
  });

  test("Tranche 8% : 35 001 – 50 000", () => {
    // IR = 50 000 × 8% - 2 800 = 1 200
    const ir = calculerIR(50_000);
    expect(ir).toBe(Math.round(50_000 * 0.08 - 2_800));
  });

  test("Tranche 15% : 50 001 – 100 000", () => {
    // IR = 100 000 × 15% - 6 300 = 8 700
    const ir = calculerIR(100_000);
    expect(ir).toBe(Math.round(100_000 * 0.15 - 6_300));
  });

  test("Tranche 20% : 100 001 – 200 000", () => {
    // IR = 150 000 × 20% - 11 300 = 18 700
    const ir = calculerIR(150_000);
    expect(ir).toBe(Math.round(150_000 * 0.20 - 11_300));
  });

  test("Tranche 25% : 200 001 – 400 000", () => {
    const ir = calculerIR(300_000);
    expect(ir).toBe(Math.round(300_000 * 0.25 - 21_300));
  });

  test("Tranche 30% : > 400 000", () => {
    const ir = calculerIR(500_000);
    expect(ir).toBe(Math.round(500_000 * 0.30 - 41_300));
  });

  test("IR toujours positif ou nul", () => {
    for (const montant of [0, 10_000, 35_000, 36_000, 50_000, 100_000, 500_000]) {
      expect(calculerIR(montant)).toBeGreaterThanOrEqual(0);
    }
  });

  test("IR progressif : revenu plus élevé → IR plus élevé", () => {
    const ir1 = calculerIR(100_000);
    const ir2 = calculerIR(200_000);
    const ir3 = calculerIR(300_000);
    expect(ir1).toBeLessThan(ir2);
    expect(ir2).toBeLessThan(ir3);
  });
});

describe("SMIG Niger (41 000 XOF)", () => {
  test("SMIG_MENSUEL = 41 000", () => {
    expect(SMIG_MENSUEL).toBe(41_000);
  });

  test("Salaire conforme au SMIG", () => {
    const r = verifierSMIG(50_000);
    expect(r.conforme).toBe(true);
    expect(r.ecart).toBe(9_000);
  });

  test("Salaire égal au SMIG = conforme", () => {
    expect(verifierSMIG(41_000).conforme).toBe(true);
  });

  test("Salaire inférieur au SMIG = non conforme", () => {
    const r = verifierSMIG(30_000);
    expect(r.conforme).toBe(false);
    expect(r.ecart).toBe(-11_000);
    expect(r.message).toMatch(/inférieur|SMIG|risque/i);
  });
});

describe("Prime d'ancienneté (Code Travail Niger art. 167)", () => {
  test("0 an → 0%", () => {
    expect(calculerTauxAnciennete(0)).toBe(0);
  });

  test("1 an → 2%", () => {
    expect(calculerTauxAnciennete(1)).toBe(0.02);
  });

  test("3 ans → 6%", () => {
    expect(calculerTauxAnciennete(3)).toBe(0.06);
  });

  test("5 ans → 10% (max palier 1)", () => {
    expect(calculerTauxAnciennete(5)).toBe(0.10);
  });

  test("6 ans → 11%", () => {
    expect(calculerTauxAnciennete(6)).toBe(0.11);
  });

  test("10 ans → 15% (maximum absolu)", () => {
    expect(calculerTauxAnciennete(10)).toBe(0.15);
  });

  test("20 ans → toujours 15% (plafond)", () => {
    expect(calculerTauxAnciennete(20)).toBe(0.15);
  });

  test("calculerPrimeAnciennete — montant correct pour 5 ans", () => {
    const dateEntree = new Date();
    dateEntree.setFullYear(dateEntree.getFullYear() - 5);
    const r = calculerPrimeAnciennete(100_000, dateEntree);
    expect(r.taux).toBe(0.10);
    expect(r.montant).toBe(10_000);
    expect(r.annees).toBe(5);
  });
});

describe("IS/BIC Niger (30%)", () => {
  test("IS = 30% du résultat fiscal", () => {
    const r = calculerIS(1_000_000);
    expect(r.taux).toBe(0.30);
    expect(r.montantTheorique).toBe(300_000);
  });

  test("Minimum forfaitaire = 1 000 000 XOF si IS théorique inférieur", () => {
    const r = calculerIS(500_000); // 500k × 30% = 150k < minimum
    expect(r.isMinimumApplique).toBe(true);
    expect(r.montantDu).toBe(1_000_000);
  });

  test("Minimum forfaitaire non appliqué si IS > 1M", () => {
    const r = calculerIS(5_000_000); // 5M × 30% = 1.5M > minimum
    expect(r.isMinimumApplique).toBe(false);
    expect(r.montantDu).toBe(1_500_000);
  });

  test("IS sur résultat nul = minimum forfaitaire", () => {
    const r = calculerIS(0);
    expect(r.montantDu).toBe(1_000_000);
  });

  test("IS sur résultat négatif = minimum forfaitaire", () => {
    const r = calculerIS(-500_000);
    expect(r.montantDu).toBe(1_000_000);
  });

  test("Acomptes provisionnels = 1/3 IS N-1 × 2", () => {
    const r = calculerAcomptesIS(3_000_000);
    expect(r.acompte1.montant).toBe(1_000_000);
    expect(r.acompte2.montant).toBe(1_000_000);
    expect(r.total).toBe(2_000_000);
  });

  test("Secteur agricole = 15%", () => {
    const r = calculerIS(2_000_000, "agricole");
    expect(r.taux).toBe(0.15);
    expect(r.montantTheorique).toBe(300_000);
  });
});

describe("Retenues à la source (CGI Niger)", () => {
  test("Marchés publics = 10%", () => {
    const r = calculerRetenueDetaillee(1_000_000, "marche_public");
    expect(r.taux).toBe(0.10);
    expect(r.montantRetenue).toBe(100_000);
    expect(r.montantNet).toBe(900_000);
  });

  test("Prestations de services = 5%", () => {
    const r = calculerRetenueDetaillee(500_000, "prestation_service");
    expect(r.taux).toBe(0.05);
    expect(r.montantRetenue).toBe(25_000);
  });

  test("Honoraires = 10%", () => {
    const r = calculerRetenueDetaillee(200_000, "honoraires");
    expect(r.taux).toBe(0.10);
    expect(r.montantRetenue).toBe(20_000);
  });

  test("Loyers = 5%", () => {
    const r = calculerRetenueDetaillee(300_000, "loyer_immeuble");
    expect(r.taux).toBe(0.05);
  });

  test("Type inconnu lève une erreur", () => {
    expect(() => calculerRetenueDetaillee(100_000, "type_inexistant" as never)).toThrow();
  });

  test("Article CGI présent dans le résultat", () => {
    const r = calculerRetenueDetaillee(100_000, "marche_public");
    expect(r.article).toMatch(/CGI/i);
  });
});

describe("Moteur de paie (payslip-calc)", () => {
  const baseInput = {
    grossSalary: 100_000,
    startDate: new Date(new Date().setFullYear(new Date().getFullYear() - 3)),
    employeeType: "employee" as const,
    includeCnss: true,
    includeIr: true,
    includeSeniority: true,
  };

  test("Bulletin complet — structure correcte", () => {
    const r = calculerBulletinDePaie(baseInput);
    expect(r).toHaveProperty("grossSalary");
    expect(r).toHaveProperty("cnssEmployee");
    expect(r).toHaveProperty("cnssEmployer");
    expect(r).toHaveProperty("ir");
    expect(r).toHaveProperty("netAPayer");
    expect(r).toHaveProperty("smigCheck");
    expect(r).toHaveProperty("seniority");
  });

  test("CNSS salarié = 3,6% du brut total", () => {
    const r = calculerBulletinDePaie({ ...baseInput, includeSeniority: false });
    expect(r.cnssEmployee).toBe(Math.round(100_000 * 0.036));
  });

  test("CNSS patronal = 16,4% du brut total", () => {
    const r = calculerBulletinDePaie({ ...baseInput, includeSeniority: false });
    expect(r.cnssEmployer).toBe(Math.round(100_000 * 0.164));
  });

  test("Net imposable = Brut − CNSS salarié", () => {
    const r = calculerBulletinDePaie({ ...baseInput, includeSeniority: false });
    expect(r.netImposable).toBe(r.grossTotal - r.cnssEmployee);
  });

  test("Ancienneté 3 ans = 6%", () => {
    const r = calculerBulletinDePaie(baseInput);
    expect(r.seniority.taux).toBe(0.06);
    expect(r.seniority.montant).toBe(6_000);
  });

  test("Salaire inférieur au SMIG → alerte", () => {
    const r = calculerBulletinDePaie({ ...baseInput, grossSalary: 30_000 });
    expect(r.smigCheck.conforme).toBe(false);
    expect(r.alerts.length).toBeGreaterThan(0);
  });

  test("CNSS disabled → cnssEmployee = 0", () => {
    const r = calculerBulletinDePaie({ ...baseInput, includeCnss: false });
    expect(r.cnssEmployee).toBe(0);
    expect(r.cnssEmployer).toBe(0);
  });

  test("Stagiaire → pas de CNSS ni IR", () => {
    const r = calculerBulletinDePaie({
      ...baseInput, employeeType: "intern", indemnity: 50_000
    });
    expect(r.cnssEmployee).toBe(0);
    expect(r.ir).toBe(0);
  });

  test("Net à payer = net imposable − IR − déductions manuelles", () => {
    const r = calculerBulletinDePaie({
      ...baseInput, includeSeniority: false,
      manualItems: [{ label: "Avance", amount: 10_000, type: "deduction" }]
    });
    expect(r.netAPayer).toBe(r.netImposable - r.ir - 10_000);
  });

  test("Récapitulatif mensuel — agrégations correctes", () => {
    const bulletins = [
      calculerBulletinDePaie({ ...baseInput, grossSalary: 100_000 }),
      calculerBulletinDePaie({ ...baseInput, grossSalary: 150_000 }),
    ];
    const recap = recapitulatifMensuel(bulletins);
    expect(recap.nombreBulletins).toBe(2);
    expect(recap.totalCnssEmploye).toBe(bulletins[0].cnssEmployee + bulletins[1].cnssEmployee);
    expect(recap.totalNet).toBe(bulletins[0].netAPayer + bulletins[1].netAPayer);
  });
});
