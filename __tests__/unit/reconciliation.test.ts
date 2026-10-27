/**
 * Rapprochement bancaire.
 *
 * Un appariement erroné est pire qu'un appariement manquant : le comptable
 * valide, l'écart disparaît de l'écran, et le compte est déclaré rapproché
 * alors qu'il ne l'est pas. Les tests verrouillent donc les refus autant que
 * les propositions.
 */

import {
  matchScore, suggestMatches, reconciliationSummary,
  parseStatementCsv, parseAmount, parseStatementDate, lineFingerprint, normalizeLabel,
  type MovementLike, type StatementLineLike,
} from "@/lib/reconciliation";

function movement(over: Partial<MovementLike> = {}): MovementLike {
  return {
    _id: "m1",
    date: "2026-03-10",
    amount: 250_000,
    label: "Règlement facture FAC-2026-00042 SONIDEP",
    reference: "VIR-8891",
    ...over,
  };
}

function line(over: Partial<StatementLineLike> = {}): StatementLineLike {
  return {
    _id: "l1",
    date: "2026-03-10",
    amount: 250_000,
    label: "VIREMENT RECU SONIDEP VIR-8891",
    ...over,
  };
}

describe("Appariement d'une paire", () => {
  it("apparie un montant et une date identiques", () => {
    const match = matchScore(movement(), line());
    expect(match).not.toBeNull();
    expect(match!.score).toBeGreaterThanOrEqual(90);
    expect(match!.reasons).toContain("Montant identique");
  });

  it("refuse tout montant différent, si proche soit-il", () => {
    // Un franc d'écart, c'est une autre opération. Aucune ressemblance de
    // libellé ne doit compenser.
    expect(matchScore(movement({ amount: 250_001 }), line())).toBeNull();
  });

  it("refuse un signe opposé", () => {
    // Un encaissement ne s'apparie pas à un décaissement du même montant.
    expect(matchScore(movement({ amount: -250_000 }), line())).toBeNull();
  });

  it("refuse au-delà de la fenêtre de tolérance", () => {
    expect(matchScore(movement({ date: "2026-03-01" }), line({ date: "2026-03-10" }))).toBeNull();
  });

  it("accepte dans la fenêtre, avec un score moindre", () => {
    const sameDay = matchScore(movement(), line())!;
    const threeDays = matchScore(movement({ date: "2026-03-07" }), line())!;
    expect(threeDays).not.toBeNull();
    expect(threeDays.score).toBeLessThan(sameDay.score);
  });

  it("valorise une référence retrouvée au relevé", () => {
    const withRef = matchScore(movement(), line())!;
    const withoutRef = matchScore(movement({ reference: undefined }), line({ label: "VIREMENT RECU" }))!;
    expect(withRef.score).toBeGreaterThan(withoutRef.score);
    expect(withRef.reasons.some(r => r.includes("Référence"))).toBe(true);
  });

  it("valorise un mot significatif partagé", () => {
    const match = matchScore(
      movement({ reference: undefined, label: "Encaissement SONIDEP" }),
      line({ label: "VIREMENT RECU SONIDEP" })
    )!;
    expect(match.reasons.some(r => r.includes("Libellé commun"))).toBe(true);
  });

  it("ne se laisse pas convaincre par des mots trop courts", () => {
    // « de », « sur », « par » se retrouvent partout : ils ne prouvent rien.
    const match = matchScore(
      movement({ reference: undefined, label: "Paiement de la sur" }),
      line({ label: "FRAIS de tenue sur compte" })
    )!;
    expect(match.reasons.some(r => r.includes("Libellé commun"))).toBe(false);
  });

  it("plafonne le score à 100", () => {
    expect(matchScore(movement(), line())!.score).toBeLessThanOrEqual(100);
  });
});

describe("Propositions sur un ensemble", () => {
  it("n'utilise jamais deux fois le même mouvement", () => {
    // Trois lignes du même montant ne doivent pas toutes réclamer
    // l'unique encaissement enregistré.
    const suggestions = suggestMatches(
      [movement()],
      [line({ _id: "l1" }), line({ _id: "l2" }), line({ _id: "l3" })]
    );
    expect(suggestions).toHaveLength(1);
  });

  it("n'utilise jamais deux fois la même ligne", () => {
    const suggestions = suggestMatches(
      [movement({ _id: "m1" }), movement({ _id: "m2" }), movement({ _id: "m3" })],
      [line()]
    );
    expect(suggestions).toHaveLength(1);
  });

  it("retient la meilleure paire d'abord", () => {
    // m2 a la même date que la ligne, m1 est décalé de trois jours :
    // c'est m2 qui doit gagner la ligne.
    const suggestions = suggestMatches(
      [
        movement({ _id: "m1", date: "2026-03-07", reference: undefined, label: "Divers" }),
        movement({ _id: "m2", date: "2026-03-10" }),
      ],
      [line()]
    );
    expect(suggestions[0].movementId).toBe("m2");
  });

  it("ignore ce qui est déjà rapproché", () => {
    const suggestions = suggestMatches(
      [movement({ statementLineId: "l9" })],
      [line()]
    );
    expect(suggestions).toEqual([]);
  });

  it("ignore les lignes écartées", () => {
    const suggestions = suggestMatches([movement()], [line({ ignoredAt: new Date() })]);
    expect(suggestions).toEqual([]);
  });

  it("ne propose rien quand rien ne correspond", () => {
    expect(suggestMatches([movement({ amount: 100 })], [line({ amount: 999 })])).toEqual([]);
  });
});

describe("Situation d'un compte", () => {
  const opening = 1_000_000;

  it("dérive le solde comptable des mouvements", () => {
    const s = reconciliationSummary(
      opening,
      [movement({ amount: 250_000 }), movement({ _id: "m2", amount: -80_000 })],
      []
    );
    expect(s.bookBalance).toBe(1_170_000);
  });

  it("dérive le solde bancaire des lignes de relevé", () => {
    const s = reconciliationSummary(opening, [], [line({ amount: 250_000 })]);
    expect(s.bankBalance).toBe(1_250_000);
  });

  it("expose l'écart entre les deux", () => {
    // Un encaissement enregistré que la banque n'a pas encore vu.
    const s = reconciliationSummary(opening, [movement({ amount: 250_000 })], []);
    expect(s.gap).toBe(250_000);
    expect(s.pendingAmount).toBe(250_000);
  });

  it("signale une ligne qu'aucun mouvement n'explique", () => {
    // Des frais bancaires que personne n'a saisis.
    const s = reconciliationSummary(opening, [], [line({ amount: -12_500, label: "FRAIS TENUE COMPTE" })]);
    expect(s.unexplainedAmount).toBe(-12_500);
    expect(s.linesPending).toBe(1);
  });

  it("annonce un écart nul quand tout est apparié", () => {
    const s = reconciliationSummary(
      opening,
      [movement({ statementLineId: "l1" })],
      [line({ movementId: "m1" })]
    );
    expect(s.gap).toBe(0);
    expect(s.movementsPending).toBe(0);
    expect(s.linesPending).toBe(0);
  });

  it("borne les deux séries à la date d'arrêté", () => {
    // Rapprocher au 31 janvier des mouvements de février produirait un écart
    // qui n'existe pas.
    const s = reconciliationSummary(
      opening,
      [movement({ date: "2026-02-15", amount: 500_000 })],
      [],
      new Date("2026-01-31")
    );
    expect(s.bookBalance).toBe(opening);
    expect(s.movementsTotal).toBe(0);
  });

  it("exclut les lignes écartées du solde bancaire", () => {
    const s = reconciliationSummary(opening, [], [line({ amount: 99_000, ignoredAt: new Date() })]);
    expect(s.bankBalance).toBe(opening);
  });
});

describe("Lecture des montants", () => {
  it("lit les formats français et anglais", () => {
    expect(parseAmount("1 234,56")).toBe(1235);
    expect(parseAmount("1,234.56")).toBe(1235);
    expect(parseAmount("250000")).toBe(250_000);
    // FCFA : un séparateur suivi de trois chiffres est un millier.
    expect(parseAmount("150.000")).toBe(150_000);
    expect(parseAmount("150,000")).toBe(150_000);
    expect(parseAmount("1.500.000")).toBe(1_500_000);
    expect(parseAmount("1,500,000")).toBe(1_500_000);
    expect(parseAmount("1.500.000,50")).toBe(1_500_001);
    expect(parseAmount("-25.000")).toBe(-25_000);
    expect(parseAmount("-1234")).toBe(-1234);
  });

  it("lit la convention comptable des parenthèses", () => {
    expect(parseAmount("(1 500)")).toBe(-1500);
  });

  it("arrondit au franc : le XOF n'a pas de décimale", () => {
    expect(parseAmount("100,49")).toBe(100);
    expect(parseAmount("100,50")).toBe(101);
  });

  it("rend null sur ce qui n'est pas un montant", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
  });
});

describe("Lecture des dates", () => {
  it("accepte les formats courants des relevés", () => {
    expect(parseStatementDate("10/03/2026")?.getMonth()).toBe(2);
    expect(parseStatementDate("10-03-2026")?.getDate()).toBe(10);
    expect(parseStatementDate("2026-03-10")?.getFullYear()).toBe(2026);
  });

  it("interprète une année sur deux chiffres dans ce siècle", () => {
    expect(parseStatementDate("10/03/26")?.getFullYear()).toBe(2026);
  });

  it("rend null sur une date illisible", () => {
    expect(parseStatementDate("hier")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });
});

describe("Import d'un relevé CSV", () => {
  const csv = [
    "Date;Libelle;Debit;Credit;Reference",
    "10/03/2026;VIREMENT RECU SONIDEP;;250 000;VIR-8891",
    "12/03/2026;FRAIS TENUE COMPTE;12 500;;",
    "13/03/2026;CHEQUE 0012345;80 000;;CHQ-12345",
  ].join("\n");

  it("lit deux colonnes débit et crédit en donnant leur signe", () => {
    const { lines } = parseStatementCsv(csv, { date: 0, label: 1, debit: 2, credit: 3, reference: 4 });
    expect(lines).toHaveLength(3);
    expect(lines[0].amount).toBe(250_000);
    // Un débit est une sortie, même exporté en valeur absolue.
    expect(lines[1].amount).toBe(-12_500);
    expect(lines[2].amount).toBe(-80_000);
  });

  it("un relevé réimporté qui chevauche le précédent redonne les mêmes empreintes", () => {
    const fp = (l: { date: Date; amount: number; label: string; rank: number }) => lineFingerprint("acc", l.date, l.amount, l.label, l.rank);
    const a = parseStatementCsv("date;libelle;montant\n01/10/2026;Retrait DAB;-10000\n02/10/2026;Virement client;250000", { date: 0, label: 1, amount: 2 }).lines;
    const b = parseStatementCsv("date;libelle;montant\n02/10/2026;Virement client;250000\n03/10/2026;Frais;-1500", { date: 0, label: 1, amount: 2 }).lines;
    expect(fp(a[1])).toBe(fp(b[0]));
    // Deux retraits identiques le même jour restent deux lignes distinctes.
    const twin = parseStatementCsv("date;libelle;montant\n01/10/2026;Retrait DAB;-10000\n01/10/2026;Retrait DAB;-10000", { date: 0, label: 1, amount: 2 }).lines;
    expect(fp(twin[0])).not.toBe(fp(twin[1]));
  });

  it("lit une colonne unique de montant signé", () => {
    const signed = "Date,Libelle,Montant\n10/03/2026,VIREMENT,250000\n11/03/2026,FRAIS,-12500";
    const { lines } = parseStatementCsv(signed, { separator: ",", date: 0, label: 1, amount: 2 });
    expect(lines.map(l => l.amount)).toEqual([250_000, -12_500]);
  });

  it("écarte les lignes illisibles en disant pourquoi", () => {
    // Jamais avalées en silence : une ligne perdue est un écart inexpliqué.
    const broken = "Date;Libelle;Montant\n;SANS DATE;1000\n10/03/2026;;5000\n10/03/2026;OK;pas un nombre";
    const { lines, rejected } = parseStatementCsv(broken, { date: 0, label: 1, amount: 2 });
    expect(lines).toHaveLength(0);
    expect(rejected).toHaveLength(3);
    // Chaque motif est distinct : date absente, libellé absent, montant illisible.
    expect(rejected.map(r => r.reason)).toEqual([
      "Date illisible", "Libellé absent", "Montant illisible ou nul",
    ]);
  });

  it("respecte les guillemets autour d'un libellé contenant le séparateur", () => {
    const quoted = 'Date;Libelle;Montant\n10/03/2026;"PAIEMENT SARL DUPONT; FILS";150000';
    const { lines } = parseStatementCsv(quoted, { date: 0, label: 1, amount: 2 });
    expect(lines[0].label).toBe("PAIEMENT SARL DUPONT; FILS");
  });

  it("ignore le nombre d'en-têtes demandé", () => {
    const twoHeaders = "Compte 001\nDate;Libelle;Montant\n10/03/2026;VIREMENT;1000";
    const { lines } = parseStatementCsv(twoHeaders, { date: 0, label: 1, amount: 2, skipRows: 2 });
    expect(lines).toHaveLength(1);
  });
});

describe("Empreinte des lignes", () => {
  it("est stable pour une même ligne", () => {
    const a = lineFingerprint("acc1", "2026-03-10", 250_000, "VIREMENT RECU", 0);
    const b = lineFingerprint("acc1", "2026-03-10", 250_000, "VIREMENT RECU", 0);
    expect(a).toBe(b);
  });

  it("distingue deux opérations identiques du même jour", () => {
    // Deux retraits de 10 000 au même distributeur : le rang les sépare, sinon
    // l'index d'unicité rejetterait la seconde à tort.
    const first = lineFingerprint("acc1", "2026-03-10", -10_000, "RETRAIT DAB", 0);
    const second = lineFingerprint("acc1", "2026-03-10", -10_000, "RETRAIT DAB", 1);
    expect(first).not.toBe(second);
  });

  it("distingue deux comptes", () => {
    expect(lineFingerprint("acc1", "2026-03-10", 1000, "X", 0))
      .not.toBe(lineFingerprint("acc2", "2026-03-10", 1000, "X", 0));
  });

  it("ignore casse, accents et ponctuation du libellé", () => {
    expect(normalizeLabel("Règlement  FACTURE-42 !")).toBe("reglement facture 42");
  });
});
