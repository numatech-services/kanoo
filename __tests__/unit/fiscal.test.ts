/**
 * Tests unitaires — Calculs fiscaux Niger
 * Couvre : TVA, CNSS 2024, ITS 2026, SMIG, prime d'ancienneté, IS/BIC, retenues
 *
 * Exécuter : npx jest __tests__/unit/fiscal.test.ts
 */

import {
  calculerTVA, calculerTTC, calculerDTS,
  calculerCNSS,
  calculerITS, parametresPaie, calculerCotisationsCnss,
  verifierSMIG,
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

// Périodes de référence : les paramètres sont datés.
const MAI_2026 = new Date(2026, 4, 31);
const MAI_2023 = new Date(2023, 4, 31);

describe("CNSS Niger — taux 2024 (22,65 %)", () => {
  test("Part salariale 5,25 % sur 100 000 = 5 250", () => {
    expect(calculerCNSS(100_000, MAI_2026).salarie).toBe(5_250);
  });

  test("Part patronale 17,40 % sur 100 000 = 17 400", () => {
    expect(calculerCNSS(100_000, MAI_2026).patronal).toBe(17_400);
  });

  test("Total 22,65 % sur 100 000 = 22 650", () => {
    expect(calculerCNSS(100_000, MAI_2026).total).toBe(22_650);
  });

  test("Plafond 500 000 : cotisation maximale 113 250 (87 000 + 26 250)", () => {
    const r = calculerCNSS(2_000_000, MAI_2026);
    expect(r.assiette).toBe(500_000);
    expect(r.patronal).toBe(87_000);
    expect(r.salarie).toBe(26_250);
    expect(r.total).toBe(113_250);
  });

  test("Ventilation par branche : PF 4,90 · AT 1,75 · pensions 9,75 · ANPE 1,00", () => {
    const { branches, patronal } = calculerCNSS(500_000, MAI_2026);
    expect(branches).toEqual({ pf: 24_500, atmp: 8_750, pensions: 48_750, anpe: 5_000 });
    expect(branches.pf + branches.atmp + branches.pensions + branches.anpe).toBe(patronal);
  });

  test("Ventilation exacte même avec des arrondis", () => {
    const { branches, patronal } = calculerCNSS(123_457, MAI_2026);
    expect(branches.pf + branches.atmp + branches.pensions + branches.anpe).toBe(patronal);
  });

  test("Apprentis et stagiaires : 16,75 % (5,25 salarié + 11,50 employeur), ni PF ni ANPE", () => {
    const r = calculerCotisationsCnss(100_000, "stagiaire", MAI_2026);
    expect(r.salarie).toBe(5_250);
    expect(r.patronal).toBe(11_500);
    expect(r.branches.pf).toBe(0);
    expect(r.branches.anpe).toBe(0);
  });

  test("Fonctionnaire détaché : 6,65 % à la charge de l'employeur", () => {
    const r = calculerCotisationsCnss(100_000, "detache", MAI_2026);
    expect(r.salarie).toBe(0);
    expect(r.patronal).toBe(6_650);
  });

  test("Plancher : l'assiette d'un salarié est relevée au SMIG", () => {
    const r = calculerCotisationsCnss(20_000, "standard", MAI_2026, { plancher: true });
    expect(r.relevee).toBe(true);
    expect(r.assiette).toBe(30_047);
  });

  test("Avant 2024 : ancien taux Kanoo (3,6 % + 16,4 %), sans plafond", () => {
    const r = calculerCNSS(1_000_000, MAI_2023);
    expect(r.salarie).toBe(36_000);
    expect(r.patronal).toBe(164_000);
  });

  test("CNSS résultats entiers (pas de centimes)", () => {
    const r = calculerCNSS(123_456, MAI_2026);
    expect(Number.isInteger(r.salarie)).toBe(true);
    expect(Number.isInteger(r.patronal)).toBe(true);
  });
});

describe("ITS — CGI 2026, art. 143 à 150", () => {
  const its = (revenu: number, opts: Partial<Parameters<typeof calculerITS>[0]> = {}) =>
    calculerITS({ revenuBrut: revenu, remunerationPrincipale: revenu, retraite: Math.round(revenu * 0.0525), ...opts }, MAI_2026);

  test("Exemple de référence : 300 000 brut, 2 charges → base 217 000, ITS 27 000", () => {
    const r = its(300_000, { chargesFamille: 2 });
    expect(r.base).toBe(217_000);
    expect(r.impot).toBe(27_000);
    expect(r.bareme).toBe("its");
  });

  test("Barème progressif par tranches (1 % à 35 %)", () => {
    const tranches = parametresPaie(MAI_2026).its!.tranches;
    // 25 000 × 1 % + 25 000 × 2 % + 50 000 × 6 % = 3 750 pour une base de 100 000.
    let impot = 0, bas = 0;
    for (const t of tranches) { if (100_000 <= bas) break; impot += (Math.min(100_000, t.jusqua) - bas) * t.taux; bas = t.jusqua; }
    expect(impot).toBe(3_750);
    expect(tranches.at(-1)!.taux).toBe(0.35);
  });

  test("Base arrondie au millier inférieur", () => {
    const r = its(123_456);
    expect(r.base % 1_000).toBe(0);
  });

  test("Retraite déductible plafonnée à 6 % de la rémunération principale", () => {
    const r = calculerITS({ revenuBrut: 500_000, remunerationPrincipale: 100_000, retraite: 26_250 }, MAI_2026);
    expect(r.deductions.retraite).toBe(6_000);
  });

  test("Abattement familial : 0 % à 30 %, plafonné à 7 charges", () => {
    expect(its(300_000, { chargesFamille: 0 }).tauxFamille).toBe(0);
    expect(its(300_000, { chargesFamille: 7 }).tauxFamille).toBe(0.30);
    expect(its(300_000, { chargesFamille: 12 }).tauxFamille).toBe(0.30);
    expect(its(300_000, { chargesFamille: 3 }).impot).toBeLessThan(its(300_000, { chargesFamille: 1 }).impot);
  });

  test("Assurance déductible jusqu'à 20 000", () => {
    expect(its(300_000, { assurance: 50_000 }).deductions.assurance).toBe(20_000);
  });

  test("Expatrié : 17 % si le dépaysement atteint 40 % de la rémunération principale", () => {
    const avec = calculerITS({ revenuBrut: 1_400_000, remunerationPrincipale: 1_000_000, indemniteDepaysement: 400_000, retraite: 26_250 }, MAI_2026);
    expect(avec.deductions.expatrie).toBe(238_000);
    const sans = calculerITS({ revenuBrut: 1_300_000, remunerationPrincipale: 1_000_000, indemniteDepaysement: 300_000, retraite: 26_250 }, MAI_2026);
    expect(sans.deductions.expatrie).toBe(0);
  });

  test("ITS toujours positif ou nul et croissant", () => {
    let prev = -1;
    for (const m of [0, 10_000, 50_000, 100_000, 300_000, 1_000_000, 3_000_000]) {
      const v = its(m).impot;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test("Avant 2026 : ancien barème Kanoo (brut − CNSS)", () => {
    const r = calculerITS({ revenuBrut: 100_000, remunerationPrincipale: 100_000, retraite: 3_600 }, MAI_2023);
    expect(r.bareme).toBe("ancien");
    expect(r.impot).toBe(Math.round(96_400 * 0.15 - 6_300));
  });
});

describe("SMIG Niger (30 047 FCFA, guide CNSS 2025)", () => {
  test("SMIG en vigueur = 30 047", () => {
    expect(parametresPaie(MAI_2026).smig).toBe(30_047);
  });

  test("Salaire conforme au SMIG", () => {
    const r = verifierSMIG(50_000, MAI_2026);
    expect(r.conforme).toBe(true);
    expect(r.ecart).toBe(50_000 - 30_047);
  });

  test("Salaire égal au SMIG = conforme", () => {
    expect(verifierSMIG(30_047, MAI_2026).conforme).toBe(true);
  });

  test("Salaire inférieur au SMIG = non conforme", () => {
    const r = verifierSMIG(25_000, MAI_2026);
    expect(r.conforme).toBe(false);
    expect(r.ecart).toBe(-5_047);
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
    // 3 ans d'ancienneté à la fin de la période (mai 2026).
    startDate: new Date(2023, 0, 15),
    employeeType: "employee" as const,
    includeCnss: true,
    includeIr: true,
    includeSeniority: true,
    periodEnd: new Date(2026, 4, 31),
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

  test("CNSS salarié = 5,25 % du brut total", () => {
    const r = calculerBulletinDePaie({ ...baseInput, includeSeniority: false });
    expect(r.cnssEmployee).toBe(5_250);
  });

  test("CNSS patronal = 17,40 % du brut total", () => {
    const r = calculerBulletinDePaie({ ...baseInput, includeSeniority: false });
    expect(r.cnssEmployer).toBe(17_400);
  });

  test("Exemple de référence : 300 000, 2 charges → ITS 27 000, net 257 250", () => {
    const r = calculerBulletinDePaie({ ...baseInput, grossSalary: 300_000, includeSeniority: false, familyCharges: 2 });
    expect(r.cnssEmployee).toBe(15_750);
    expect(r.netImposable).toBe(217_000);
    expect(r.ir).toBe(27_000);
    expect(r.netAPayer).toBe(300_000 - 15_750 - 27_000);
  });

  test("Plafond CNSS : un salaire de 800 000 cotise sur 500 000", () => {
    const r = calculerBulletinDePaie({ ...baseInput, grossSalary: 800_000, includeSeniority: false });
    expect(r.cnssBase).toBe(500_000);
    expect(r.cnssEmployee).toBe(26_250);
    expect(r.cnssEmployer).toBe(87_000);
  });

  test("Avantages en nature : soumis à la CNSS et à l'ITS, absents du net", () => {
    const sans = calculerBulletinDePaie({ ...baseInput, grossSalary: 300_000, includeSeniority: false });
    const avec = calculerBulletinDePaie({ ...baseInput, grossSalary: 300_000, includeSeniority: false, benefitsInKind: [{ kind: "logement", count: 3 }, { kind: "vehicule" }] });
    expect(avec.benefitsInKind).toBe(80_000);
    expect(avec.grossTotal).toBe(300_000);
    expect(avec.cnssBase).toBe(380_000);
    expect(avec.ir).toBeGreaterThan(sans.ir);
    expect(avec.netAPayer).toBe(300_000 - avec.cnssEmployee - avec.ir);
  });

  test("Logement plafonné au tiers du salaire de base", () => {
    const r = calculerBulletinDePaie({ ...baseInput, grossSalary: 90_000, includeSeniority: false, benefitsInKind: [{ kind: "logement", count: 5 }] });
    expect(r.benefitsInKind).toBe(30_000);
  });

  test("Frais non soumis : versés, hors assiette", () => {
    const r = calculerBulletinDePaie({ ...baseInput, includeSeniority: false, manualItems: [{ label: "Mission", amount: 40_000, type: "addition", subject: false }] });
    expect(r.grossTotal).toBe(140_000);
    expect(r.cnssBase).toBe(100_000);
    expect(r.netAPayer).toBe(140_000 - r.cnssEmployee - r.ir);
  });

  test("Ancienneté 3 ans = 6%", () => {
    const r = calculerBulletinDePaie(baseInput);
    expect(r.seniority.taux).toBe(0.06);
    expect(r.seniority.montant).toBe(6_000);
  });

  test("Salaire inférieur au SMIG → alerte et assiette CNSS relevée", () => {
    const r = calculerBulletinDePaie({ ...baseInput, grossSalary: 25_000, includeSeniority: false });
    expect(r.cnssBase).toBe(30_047);
    expect(r.smigCheck.conforme).toBe(false);
    expect(r.alerts.length).toBeGreaterThan(0);
  });

  test("CNSS disabled → cnssEmployee = 0", () => {
    const r = calculerBulletinDePaie({ ...baseInput, includeCnss: false });
    expect(r.cnssEmployee).toBe(0);
    expect(r.cnssEmployer).toBe(0);
  });

  test("Stagiaire (2026) → CNSS des apprentis 16,75 %, sans ancienneté ni plancher", () => {
    const r = calculerBulletinDePaie({ ...baseInput, employeeType: "intern", indemnity: 20_000 });
    expect(r.cnssCategory).toBe("stagiaire");
    expect(r.cnssBase).toBe(20_000);
    expect(r.cnssEmployee).toBe(1_050);
    expect(r.cnssEmployer).toBe(2_300);
    expect(r.seniority.montant).toBe(0);
  });

  test("Stagiaire avant 2024 → ni CNSS ni impôt (calcul antérieur conservé)", () => {
    const r = calculerBulletinDePaie({ ...baseInput, employeeType: "intern", indemnity: 50_000, periodEnd: new Date(2023, 4, 31) });
    expect(r.cnssEmployee).toBe(0);
    expect(r.ir).toBe(0);
  });

  test("Freelance → ni CNSS ni ITS", () => {
    const r = calculerBulletinDePaie({ ...baseInput, employeeType: "freelance", indemnity: 200_000 });
    expect(r.cnssEmployee + r.cnssEmployer + r.ir).toBe(0);
    expect(r.netAPayer).toBe(200_000);
  });

  test("Net à payer = brut − CNSS salarié − ITS − déductions manuelles", () => {
    const r = calculerBulletinDePaie({
      ...baseInput, includeSeniority: false,
      manualItems: [{ label: "Avance", amount: 10_000, type: "deduction" }]
    });
    expect(r.netAPayer).toBe(r.grossTotal - r.cnssEmployee - r.ir - 10_000);
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
