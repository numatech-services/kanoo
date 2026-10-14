import { proposeLetters, type LetterLine } from "@/lib/auto-lettering";
import { goScore, recommend, suggestions, CRITERIA } from "@/lib/go-no-go";

const L = (entryId: string, amount: number, extra: Partial<LetterLine> = {}): LetterLine =>
  ({ entryId, amount, date: `2026-0${entryId.length}-01`, thirdPartyId: "A", ...extra });

describe("Lettrage automatique", () => {
  it("lettre une facture avec ses règlements et son avoir", () => {
    const g = proposeLetters([L("f", 1000, { docKey: "inv:1" }), L("p1", -600, { docKey: "inv:1" }), L("av", -400, { docKey: "inv:1" })]);
    expect(g).toEqual([expect.objectContaining({ rule: "document", entryIds: ["f", "p1", "av"], total: 1000 })]);
  });
  it("une facture en partie réglée reste ouverte", () => {
    expect(proposeLetters([L("f", 1000, { docKey: "inv:1" }), L("p1", -600, { docKey: "inv:1" })])).toEqual([]);
  });
  it("une écriture et son extourne d'abord, puis le reste par montant", () => {
    const g = proposeLetters([
      L("f", 500, { docKey: "inv:1" }), L("p", -500, { docKey: "inv:1", reversalKey: "p" }), L("px", 500, { reversalKey: "p" }), L("p2", -500, { docKey: "inv:1" }),
    ]);
    expect(g.map(x => [x.rule, x.entryIds.sort()])).toEqual([["reversal", ["p", "px"]], ["document", ["f", "p2"]]]);
  });
  it("même montant, même tiers, du plus ancien au plus récent ; jamais entre tiers", () => {
    const g = proposeLetters([L("a", 300), L("bb", 300), L("ccc", -300), L("x", -300, { thirdPartyId: "B" })]);
    expect(g).toEqual([expect.objectContaining({ rule: "amount", entryIds: ["a", "ccc"] })]);
  });
  it("solde nul d'un tiers sur plusieurs pièces", () => {
    const g = proposeLetters([L("a", 300), L("bb", 200), L("ccc", -450), L("dddd", -50)]);
    expect(g.map(x => x.rule)).toEqual(["balance"]);
  });
});

describe("Go/No-Go", () => {
  const all = (v: number) => Object.fromEntries(CRITERIA.map(c => [c.key, v]));
  it("note sur 100 et recommandation", () => {
    expect(goScore(all(5))).toBe(100);
    expect(recommend(all(4))).toBe("go");
    expect(recommend(all(3))).toBe("review");
    expect(recommend(all(2))).toBe("no_go");
  });
  it("critère éliminatoire : No-Go malgré une bonne note", () => {
    expect(recommend({ ...all(5), compliance: 1 })).toBe("no_go");
  });
  it("pré-évaluations : délai, pièces, trésorerie, passé avec l'organisme", () => {
    const s = suggestions({ daysLeft: 10, requiredDocs: [{ provided: true }, { provided: false }], cash: 2_000_000, estimatedAmount: 10_000_000, history: { won: 1, lost: 1 } });
    expect(s).toMatchObject({ lead: 3, compliance: 3, finance: 4, winChance: 4 });
    expect(suggestions({ daysLeft: -2, requiredDocs: [], cash: 0, estimatedAmount: 0, history: { won: 0, lost: 0 } })).toMatchObject({ lead: 0 });
  });
});
