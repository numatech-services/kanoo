/**
 * Tests unitaires — Fiscalité Niger (compléments)
 * Couvre les fonctions pures non testées par fiscal.test.ts :
 *   Droits de timbre (DTS), procédures des marchés publics, périodes fiscales,
 *   numérotation des documents (standard + tenant) et validation des préfixes.
 *
 * Exécuter : npx jest __tests__/unit/fiscal-extra.test.ts
 */

import {
  calculerDTS,
  SEUILS_MARCHES,
  determineProcedureMarche,
  getExerciceFiscal,
  getPeriodeTVA,
  getPeriodeCNSS,
  genererNumeroFacture,
  genererNumeroDevis,
  genererNumeroBonCommande,
  genererNumeroMarche,
  genererNumeroDocument,
  genererNumeroFactureTenant,
  genererNumeroDevisTenant,
  validerPrefixe,
  DEFAULT_PREFIXES,
} from "@/lib/niger-fiscal";

// ─── Droits de Timbre sur Factures (DTS) ─────────────────────────────────────
describe("Droits de timbre (DTS) — tranches forfaitaires", () => {
  test("Factures < 10 000 XOF : exonérées", () => {
    expect(calculerDTS(0)).toBe(0);
    expect(calculerDTS(9_999)).toBe(0);
  });
  test("De 10 000 à 99 999 XOF : 200 XOF", () => {
    expect(calculerDTS(10_000)).toBe(200);
    expect(calculerDTS(99_999)).toBe(200);
  });
  test("De 100 000 à 499 999 XOF : 500 XOF", () => {
    expect(calculerDTS(100_000)).toBe(500);
    expect(calculerDTS(499_999)).toBe(500);
  });
  test("De 500 000 à 999 999 XOF : 1 000 XOF", () => {
    expect(calculerDTS(500_000)).toBe(1_000);
    expect(calculerDTS(999_999)).toBe(1_000);
  });
  test("À partir de 1 000 000 XOF : 2 000 XOF", () => {
    expect(calculerDTS(1_000_000)).toBe(2_000);
    expect(calculerDTS(50_000_000)).toBe(2_000);
  });
});

// ─── Code des Marchés Publics Niger 2017 ─────────────────────────────────────
describe("Procédure de marché public selon le montant estimé", () => {
  test("< 5 M XOF : achat direct", () => {
    expect(determineProcedureMarche(0)).toBe("achat_direct");
    expect(determineProcedureMarche(4_999_999)).toBe("achat_direct");
  });
  test("5 M à < 30 M XOF : consultation restreinte", () => {
    expect(determineProcedureMarche(SEUILS_MARCHES.ACHAT_DIRECT)).toBe("consultation_restreinte");
    expect(determineProcedureMarche(29_999_999)).toBe("consultation_restreinte");
  });
  test("30 M à 100 M XOF : appel d'offres ouvert", () => {
    expect(determineProcedureMarche(SEUILS_MARCHES.CONSULTATION_RESTREINTE)).toBe("appel_offres_ouvert");
    expect(determineProcedureMarche(100_000_000)).toBe("appel_offres_ouvert");
  });
  test("> 100 M XOF : appel d'offres international (publicité nationale)", () => {
    expect(determineProcedureMarche(SEUILS_MARCHES.PUBLICITE_NATIONALE)).toBe("appel_offres_international");
    expect(determineProcedureMarche(500_000_000)).toBe("appel_offres_international");
  });
});

// ─── Périodes fiscales ────────────────────────────────────────────────────────
describe("Exercice fiscal et périodes déclaratives", () => {
  test("Exercice fiscal = année civile", () => {
    expect(getExerciceFiscal(new Date(2026, 0, 1))).toBe(2026);
    expect(getExerciceFiscal(new Date(2026, 11, 31))).toBe(2026);
  });
  test("Période TVA = mois civil (1–12) + année", () => {
    expect(getPeriodeTVA(new Date(2026, 0, 15))).toEqual({ mois: 1, annee: 2026 });
    expect(getPeriodeTVA(new Date(2026, 11, 5))).toEqual({ mois: 12, annee: 2026 });
  });
  test("Période CNSS = trimestre civil (1–4) + année", () => {
    expect(getPeriodeCNSS(new Date(2026, 0, 10)).trimestre).toBe(1); // janvier
    expect(getPeriodeCNSS(new Date(2026, 2, 10)).trimestre).toBe(1); // mars
    expect(getPeriodeCNSS(new Date(2026, 3, 10)).trimestre).toBe(2); // avril
    expect(getPeriodeCNSS(new Date(2026, 5, 10)).trimestre).toBe(2); // juin
    expect(getPeriodeCNSS(new Date(2026, 6, 10)).trimestre).toBe(3); // juillet
    expect(getPeriodeCNSS(new Date(2026, 11, 10)).trimestre).toBe(4); // décembre
    expect(getPeriodeCNSS(new Date(2026, 6, 10)).annee).toBe(2026);
  });
});

// ─── Numérotation standard ────────────────────────────────────────────────────
describe("Numérotation des documents (format standard)", () => {
  test("Facture : FAC-AAAA-NNNNN (séquence sur 5 chiffres)", () => {
    expect(genererNumeroFacture(2026, 42)).toBe("FAC-2026-00042");
    expect(genererNumeroFacture(2026, 1)).toBe("FAC-2026-00001");
    expect(genererNumeroFacture(2026, 123_45)).toBe("FAC-2026-12345");
  });
  test("Devis : DEV-AAAA-NNNNN", () => {
    expect(genererNumeroDevis(2026, 7)).toBe("DEV-2026-00007");
  });
  test("Bon de commande : BC-AAAA-NNNNN", () => {
    expect(genererNumeroBonCommande(2026, 100)).toBe("BC-2026-00100");
  });
  test("Marché : MRC-AAAA-NNNN (séquence sur 4 chiffres)", () => {
    expect(genererNumeroMarche(2026, 5)).toBe("MRC-2026-0005");
    expect(genererNumeroMarche(2026, 1234)).toBe("MRC-2026-1234");
  });
});

// ─── Numérotation personnalisée par tenant ───────────────────────────────────
describe("Numérotation avec préfixe tenant", () => {
  test("Sans préfixe personnalisé → préfixes par défaut", () => {
    expect(genererNumeroDocument("invoice", 2026, 42)).toBe("FAC-2026-00042");
    expect(genererNumeroDocument("marche", 2026, 3)).toBe("MRC-2026-00003");
    expect(DEFAULT_PREFIXES.invoice).toBe("FAC");
  });
  test("Avec préfixe personnalisé", () => {
    expect(genererNumeroDocument("invoice", 2026, 42, { invoice: "NML" })).toBe("NML-2026-00042");
  });
  test("Le préfixe est toujours mis en majuscules", () => {
    expect(genererNumeroDocument("invoice", 2026, 1, { invoice: "nml" })).toBe("NML-2026-00001");
  });
  test("Facture tenant avec séquence de départ (offset)", () => {
    expect(genererNumeroFactureTenant(2026, 1, { invoice: "NML" }, 100)).toBe("NML-2026-00101");
    expect(genererNumeroFactureTenant(2026, 5)).toBe("FAC-2026-00005");
  });
  test("Devis tenant", () => {
    expect(genererNumeroDevisTenant(2026, 3)).toBe("DEV-2026-00003");
    expect(genererNumeroDevisTenant(2026, 3, { devis: "PRO" })).toBe("PRO-2026-00003");
  });
});

// ─── Validation des préfixes ──────────────────────────────────────────────────
describe("Validation d'un préfixe de document", () => {
  test("Préfixe vide ou espaces → invalide", () => {
    expect(validerPrefixe("").valide).toBe(false);
    expect(validerPrefixe("   ").valide).toBe(false);
  });
  test("Longueur hors bornes (2–6) → invalide", () => {
    expect(validerPrefixe("A").valide).toBe(false);
    expect(validerPrefixe("TROPLONG").valide).toBe(false);
  });
  test("Caractères non autorisés → invalide", () => {
    expect(validerPrefixe("NM@").valide).toBe(false);
    expect(validerPrefixe("A B").valide).toBe(false);
  });
  test("Préfixes valides (lettres, chiffres, tiret)", () => {
    expect(validerPrefixe("NML").valide).toBe(true);
    expect(validerPrefixe("AB").valide).toBe(true);
    expect(validerPrefixe("ABCDEF").valide).toBe(true);
    expect(validerPrefixe("NM-1").valide).toBe(true);
    expect(validerPrefixe("F2026").valide).toBe(true);
  });
});
