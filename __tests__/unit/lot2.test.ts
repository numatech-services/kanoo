import { retentionFor, releasableFrom, retentionState } from "@/lib/retention";
import { guaranteeAlert, commitments, daysToExpiry } from "@/lib/guarantees";
import { invoiceDue } from "@/lib/payments";
import { outstandingAmount } from "@/lib/dunning";

describe("Retenue de garantie", () => {
  it("5 % du TTC des factures de travaux, rien sur un acompte, plafonnée à 10 %", () => {
    expect(retentionFor(1_190_000, 0.05)).toBe(59_500);
    expect(retentionFor(1_190_000, 0.05, "deposit")).toBe(0);
    expect(retentionFor(1_000_000, 0.25)).toBe(100_000);
  });
  it("réclamable à la réception définitive, ou un an après la provisoire", () => {
    expect(releasableFrom({})).toBeNull();
    expect(releasableFrom({ receptionProvisoireDate: new Date(2025, 5, 30) })!.getFullYear()).toBe(2026);
    expect(releasableFrom({ receptionProvisoireDate: new Date(2025, 5, 30), receptionDefinitiveDate: new Date(2025, 11, 1) })!.getMonth()).toBe(11);
  });
  it("reste à récupérer : retenu moins reversé, factures annulées exclues", () => {
    const s = retentionState([{ retentionAmount: 50_000, status: "paid" }, { retentionAmount: 30_000, status: "cancelled" }, { retentionAmount: 20_000, status: "sent" }],
      { retentionReleases: [{ amount: 10_000 }], receptionProvisoireDate: new Date(2024, 0, 1) }, new Date(2026, 0, 1));
    expect(s).toMatchObject({ held: 70_000, released: 10_000, outstanding: 60_000, claimable: true });
  });
  it("n'est ni exigible ni relancée", () => {
    const inv = { totalTTC: 1_000_000, paidAmount: 950_000, retentionAmount: 50_000, status: "paid" };
    expect(invoiceDue(inv)).toBe(0);
    expect(outstandingAmount({ _id: 1, number: "F", ...inv })).toBe(0);
    expect(invoiceDue({ ...inv, status: "cancelled", paidAmount: 0, creditedAmount: 1_000_000 })).toBe(0);
  });
});

describe("Cautions bancaires", () => {
  const now = new Date(2026, 9, 14);
  it("alerte à 30 jours, puis échue tant que la mainlevée manque", () => {
    expect(guaranteeAlert({ status: "active", expiryDate: new Date(2026, 11, 31) }, now)).toBeNull();
    expect(guaranteeAlert({ status: "active", expiryDate: new Date(2026, 10, 1) }, now)).toBe("expiring");
    expect(guaranteeAlert({ status: "active", expiryDate: new Date(2026, 9, 1) }, now)).toBe("expired");
    expect(guaranteeAlert({ status: "released", expiryDate: new Date(2026, 9, 1) }, now)).toBeNull();
    expect(daysToExpiry(new Date(2026, 9, 13), now)).toBe(-1);
  });
  it("engagements hors bilan : seules les cautions en cours", () => {
    const c = commitments([{ type: "soumission", amount: 500_000, status: "active", collateral: 100_000 }, { type: "bonne_execution", amount: 2_000_000, status: "active" }, { type: "soumission", amount: 300_000, status: "released" }]);
    expect(c).toMatchObject({ total: 2_500_000, collateral: 100_000, count: 2 });
    expect(c.byType.soumission).toBe(500_000);
  });
});
