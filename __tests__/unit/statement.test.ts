/**
 * Relevé de compte client.
 *
 * Les erreurs testées ici sont celles que le client relève lui-même : un avoir
 * qui gonfle le solde, un relevé qui repart de zéro, un solde négatif
 * transitoire le jour d'un règlement comptant.
 */

import {
  buildStatement, withOpenItems, summarySentence, KIND_LABEL,
  type StatementSource, type OpenItem,
} from "@/lib/statement";

const FROM = new Date("2026-09-01");
const TO = new Date("2026-09-30");
const AS_OF = new Date("2026-09-30");

const invoice = (ref: string, date: string, amount: number, dueDate?: string): StatementSource =>
  ({ _id: ref, kind: "invoice", date: new Date(date), reference: ref, amount, dueDate: dueDate ? new Date(dueDate) : undefined });
const payment = (ref: string, date: string, amount: number): StatementSource =>
  ({ _id: ref, kind: "payment", date: new Date(date), reference: ref, amount: -Math.abs(amount) });
const credit = (ref: string, date: string, amount: number): StatementSource =>
  ({ _id: ref, kind: "credit_note", date: new Date(date), reference: ref, amount: -Math.abs(amount) });

// ─────────────────────────────────────────────────────────────────────────────

describe("Construction du relevé", () => {
  it("part du solde d'ouverture plutôt que de zéro", () => {
    // Un relevé d'octobre qui commence à zéro nie ce que le client devait déjà.
    const s = buildStatement([invoice("F-1", "2026-09-10", 500_000)], 1_200_000, FROM, TO);
    expect(s.rows[0].balance).toBe(1_700_000);
    expect(s.totals.openingBalance).toBe(1_200_000);
  });

  it("tient un solde courant après chaque mouvement", () => {
    const s = buildStatement([
      invoice("F-1", "2026-09-05", 1_000_000),
      payment("R-1", "2026-09-12", 400_000),
      invoice("F-2", "2026-09-20", 250_000),
    ], 0, FROM, TO);
    expect(s.rows.map(r => r.balance)).toEqual([1_000_000, 600_000, 850_000]);
    expect(s.totals.closingBalance).toBe(850_000);
  });

  it("retranche l'avoir au lieu de l'ajouter", () => {
    // Le signe est posé à la source : c'est ainsi qu'un avoir cesse de gonfler
    // le solde qu'il devrait réduire.
    const s = buildStatement([
      invoice("F-1", "2026-09-05", 1_000_000),
      credit("AV-1", "2026-09-15", 300_000),
    ], 0, FROM, TO);
    expect(s.totals.closingBalance).toBe(700_000);
    expect(s.totals.credited).toBe(300_000);
  });

  it("place la facture avant le règlement qui l'éteint, à date égale", () => {
    // Sans cette règle, un paiement comptant affiche un solde négatif
    // transitoire — que le client relève immédiatement.
    const s = buildStatement([
      payment("R-1", "2026-09-05", 800_000),
      invoice("F-1", "2026-09-05", 800_000),
    ], 0, FROM, TO);
    expect(s.rows.map(r => r.kind)).toEqual(["invoice", "payment"]);
    expect(s.rows.every(r => r.balance >= 0)).toBe(true);
  });

  it("écarte ce qui tombe hors de la période", () => {
    const s = buildStatement([
      invoice("F-0", "2026-08-28", 100_000),
      invoice("F-1", "2026-09-10", 200_000),
      invoice("F-2", "2026-10-02", 300_000),
    ], 0, FROM, TO);
    expect(s.rows.map(r => r.reference)).toEqual(["F-1"]);
  });

  it("inclut les bornes de la période", () => {
    const s = buildStatement([
      invoice("F-1", "2026-09-01", 100_000),
      invoice("F-2", "2026-09-30", 200_000),
    ], 0, FROM, TO);
    expect(s.rows).toHaveLength(2);
  });

  it("compte le retard d'une facture, pas celui d'un règlement", () => {
    const s = buildStatement([
      invoice("F-1", "2026-09-01", 100_000, "2026-09-10"),
      payment("R-1", "2026-09-20", 50_000),
    ], 0, FROM, TO);
    expect(s.rows[0].daysPastDue).toBe(20);
    expect(s.rows[1].daysPastDue).toBe(0);
  });

  it("ne compte pas de retard négatif sur une échéance à venir", () => {
    const s = buildStatement([invoice("F-1", "2026-09-25", 100_000, "2026-10-25")], 0, FROM, TO);
    expect(s.rows[0].daysPastDue).toBe(0);
  });

  it("rend un relevé vide sans lever", () => {
    const s = buildStatement([], 0, FROM, TO);
    expect(s.rows).toEqual([]);
    expect(s.totals.closingBalance).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Ancienneté des pièces ouvertes", () => {
  const open: OpenItem[] = [
    { reference: "F-A", dueDate: new Date("2026-10-15"), outstanding: 100_000 }, // non échu
    { reference: "F-B", dueDate: new Date("2026-09-20"), outstanding: 200_000 }, // 10 j
    { reference: "F-C", dueDate: new Date("2026-08-15"), outstanding: 300_000 }, // 46 j
    { reference: "F-D", dueDate: new Date("2026-03-01"), outstanding: 400_000 }, // 213 j
    { reference: "F-E", dueDate: new Date("2026-08-01"), outstanding: 0 },       // soldée
  ];

  const s = withOpenItems(buildStatement([], 0, FROM, TO), open, AS_OF);

  it("répartit pièce par pièce, pas sur le solde global", () => {
    expect(s.aging.map(a => a.amount)).toEqual([100_000, 200_000, 300_000, 0, 400_000]);
  });

  it("ignore les pièces soldées", () => {
    expect(s.aging.reduce((n, a) => n + a.count, 0)).toBe(4);
  });

  it("ne compte comme échu que ce qui l'est", () => {
    expect(s.totals.overdueAmount).toBe(900_000);
  });

  it("retient la plus ancienne échéance dépassée", () => {
    expect(s.totals.oldestDueDate?.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("ne désigne aucune échéance quand rien n'est échu", () => {
    const clean = withOpenItems(buildStatement([], 0, FROM, TO),
      [{ reference: "F-A", dueDate: new Date("2026-12-01"), outstanding: 50_000 }], AS_OF);
    expect(clean.totals.overdueAmount).toBe(0);
    expect(clean.totals.oldestDueDate).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Phrase de synthèse", () => {
  const totals = (over: Partial<Parameters<typeof summarySentence>[0]> = {}) => ({
    openingBalance: 0, invoiced: 0, credited: 0, paid: 0,
    closingBalance: 0, overdueAmount: 0, oldestDueDate: null, ...over,
  });

  it("annonce un compte soldé", () => {
    expect(summarySentence(totals())).toMatch(/soldé/);
  });

  it("annonce un avoir en faveur du client sans parler de dette", () => {
    const phrase = summarySentence(totals({ closingBalance: -75_000 }));
    expect(phrase).toMatch(/avoir/);
    expect(phrase).toMatch(/votre faveur/);
    expect(phrase).not.toMatch(/-/);
  });

  it("distingue un solde entièrement à échoir d'un solde échu", () => {
    expect(summarySentence(totals({ closingBalance: 500_000 })))
      .toMatch(/aucune échéance dépassée/);
    expect(summarySentence(totals({ closingBalance: 500_000, overdueAmount: 200_000 })))
      .toMatch(/dont .* échus/);
  });

  it("date la plus ancienne échéance dépassée", () => {
    const phrase = summarySentence(totals({
      closingBalance: 500_000, overdueAmount: 200_000, oldestDueDate: new Date("2026-03-01"),
    }));
    expect(phrase).toContain("01/03/2026");
  });
});

describe("Libellés", () => {
  it("nomme les trois natures de mouvement", () => {
    expect(KIND_LABEL.invoice).toBe("Facture");
    expect(KIND_LABEL.credit_note).toBe("Avoir");
    expect(KIND_LABEL.payment).toBe("Règlement");
  });
});
