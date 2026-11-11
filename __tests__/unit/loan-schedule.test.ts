import { addMonths, buildSchedule, scheduleTotals } from "@/lib/loan-schedule";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("tableau d'amortissement", () => {
  it("échéances constantes : 10 M à 12 % sur 12 mois = 888 488 par mois", () => {
    const s = buildSchedule({ principal: 10_000_000, annualRate: 0.12, durationMonths: 12, frequency: "monthly", method: "annuity", firstDueDate: d("2026-02-15") });
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ interest: 100_000, principal: 788_488, total: 888_488 });
    expect(s[11].remaining).toBe(0);
    expect(scheduleTotals(s).principal).toBe(10_000_000);
    expect(s.slice(0, 11).every(x => x.total === 888_488)).toBe(true);
  });
  it("amortissement constant : même capital, intérêts dégressifs", () => {
    const s = buildSchedule({ principal: 1_200_000, annualRate: 0.12, durationMonths: 12, frequency: "quarterly", method: "constant", firstDueDate: d("2026-03-31") });
    expect(s.map(x => x.principal)).toEqual([300_000, 300_000, 300_000, 300_000]);
    expect(s.map(x => x.interest)).toEqual([36_000, 27_000, 18_000, 9_000]);
  });
  it("in fine : intérêts seuls, capital à la dernière échéance", () => {
    const s = buildSchedule({ principal: 5_000_000, annualRate: 0.1, durationMonths: 24, frequency: "annual", method: "bullet", firstDueDate: d("2027-01-01") });
    expect(s.map(x => [x.principal, x.interest])).toEqual([[0, 500_000], [5_000_000, 500_000]]);
  });
  it("différé : intérêts seuls pendant le différé", () => {
    const s = buildSchedule({ principal: 6_000_000, annualRate: 0.12, durationMonths: 6, frequency: "monthly", method: "constant", deferralPeriods: 2, firstDueDate: d("2026-02-01") });
    expect(s.slice(0, 2).map(x => x.principal)).toEqual([0, 0]);
    expect(s.slice(2).map(x => x.principal)).toEqual([1_500_000, 1_500_000, 1_500_000, 1_500_000]);
  });
  it("taux nul et assurance fixe", () => {
    const s = buildSchedule({ principal: 1_000_000, annualRate: 0, durationMonths: 4, frequency: "monthly", method: "annuity", firstDueDate: d("2026-01-31"), insurancePerPeriod: 2_500 });
    expect(s.map(x => x.total)).toEqual([252_500, 252_500, 252_500, 252_500]);
  });
  it("le 31 + 1 mois tombe sur le dernier jour du mois suivant", () => {
    expect(addMonths(d("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

import { nextCommission, guaranteeCost } from "@/lib/guarantees";
describe("commissions de caution", () => {
  const g = { amount: 10_000_000, issueDate: "2026-01-15", expiryDate: "2026-12-31", status: "active", feeRate: 0.02, feePeriod: "quarterly" };
  it("trimestrielle à 2 % l'an : 50 000 par trimestre, à partir du 15/04, jusqu'à la mainlevée", () => {
    const c = nextCommission(g, 5);
    expect(c.map(x => x.amount)).toEqual([50_000, 50_000, 50_000, 50_000, 50_000]);
    expect(c[0].date.toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(c[3].date.toISOString().slice(0, 10)).toBe("2027-01-15");
  });
  it("plus aucune commission après la mainlevée", () => {
    expect(nextCommission({ ...g, status: "released" })).toEqual([]);
  });
  it("après une commission passée, la suivante est celle de juillet", () => {
    expect(nextCommission({ ...g, charges: [{ kind: "commission", date: "2026-04-15" }] })[0].date.toISOString().slice(0, 10)).toBe("2026-07-15");
  });
  it("ni commission pour une caution reçue, ni pour une commission unique", () => {
    expect(nextCommission({ ...g, direction: "received" })).toEqual([]);
    expect(nextCommission({ ...g, feePeriod: "once" })).toEqual([]);
  });
  it("coût = commission d'émission + frais", () => {
    expect(guaranteeCost({ fee: 30_000, charges: [{ amount: 50_000 }, { amount: 25_000 }] })).toBe(105_000);
  });
});
