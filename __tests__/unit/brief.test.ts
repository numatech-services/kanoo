import { rankBrief, scoreCandidate, type BriefCandidate } from "@/lib/daily-brief";

const c = (kind: BriefCandidate["kind"], extra: Partial<BriefCandidate> = {}): BriefCandidate =>
  ({ kind, title: kind, why: "", href: "/", cta: "", ...extra });

describe("Brief du jour", () => {
  it("place le manque de trésorerie avant tout le reste", () => {
    const r = rankBrief([c("stock_low"), c("overdue_receivables", { amount: 500_000, daysLate: 10 }), c("treasury_shortfall", { amount: 200_000, daysLeft: 15 })]);
    expect(r[0].kind).toBe("treasury_shortfall");
    expect(r[0].tone).toBe("neg");
  });

  it("monte un retard client avec l'enjeu et l'ancienneté", () => {
    const small = scoreCandidate(c("overdue_receivables", { amount: 50_000, daysLate: 3 }));
    const big = scoreCandidate(c("overdue_receivables", { amount: 5_000_000, daysLate: 3 }));
    const old = scoreCandidate(c("overdue_receivables", { amount: 50_000, daysLate: 60 }));
    expect(big).toBeGreaterThan(small);
    expect(old).toBeGreaterThan(small);
  });

  it("rend une échéance plus pressante à mesure qu'elle approche", () => {
    expect(scoreCandidate(c("vat_deadline", { daysLeft: 1 }))).toBeGreaterThan(scoreCandidate(c("vat_deadline", { daysLeft: 9 })));
  });

  it("ne garde que trois actions, une par catégorie", () => {
    const r = rankBrief([
      c("overdue_receivables", { amount: 100_000 }), c("overdue_receivables", { amount: 900_000 }),
      c("draft_invoices"), c("quotes_expiring"), c("stock_low"), c("desk_unlinked"),
    ]);
    expect(r).toHaveLength(3);
    expect(new Set(r.map(x => x.kind)).size).toBe(3);
    expect(r.find(x => x.kind === "overdue_receivables")?.amount).toBe(900_000);
  });

  it("ne propose rien quand rien ne presse", () => {
    expect(rankBrief([])).toEqual([]);
  });
});
