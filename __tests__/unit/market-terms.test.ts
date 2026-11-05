import { amountsMismatch, dayNumber, deliveryDeadline, dueFrom, lateInterest, marketBase, paymentDaysOf, penaltyEstimate, regulationEstimate } from "@/lib/market-terms";
import { costCategory } from "@/lib/cost-categories";
import { labelKey } from "@/lib/market-costs";
import { contractUpdate } from "@/lib/contract-input";

const LOT1 = { amount: 18_085_200, amountTTC: 21_521_388 };
const LOT2 = { amount: 23_737_477, amountTTC: 28_247_598 };
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("redevance de régulation et FSSP", () => {
  it("calcule 1,05 % du TTC sur un marché public", () => {
    expect(regulationEstimate(LOT1, "public_establishment").estimate).toBe(225_975);
    expect(regulationEstimate(LOT2, "public_establishment").estimate).toBe(296_600);
  });
  it("s'applique à partir du seuil, pas en dessous", () => {
    expect(regulationEstimate({ amount: 5_000_000 }, "state").applicable).toBe(true);
    expect(regulationEstimate({ amount: 4_999_999 }, "state").estimate).toBe(0);
  });
  it("ne s'applique pas d'office à un marché privé", () => {
    expect(regulationEstimate(LOT1, "private").estimate).toBe(0);
    expect(regulationEstimate(LOT1).estimate).toBe(0);
  });
  it("suit le taux du marché, y compris 0", () => {
    expect(regulationEstimate({ ...LOT1, regulationRate: 0.02 }, "private").estimate).toBe(430_428);
    expect(regulationEstimate({ ...LOT1, regulationRate: 0 }, "state").estimate).toBe(0);
    expect(regulationEstimate({ amount: 3_000_000, regulationThreshold: 1_000_000 }, "state").estimate).toBe(31_500);
  });
});

describe("pénalités de retard", () => {
  const base = { ...LOT1, serviceOrderDate: d("2026-11-10"), executionDelay: 1, executionUnit: "months", penaltyDivisor: 2000 };
  it("date limite en mois, fin de mois comprise", () => {
    expect(deliveryDeadline(base)?.toISOString().slice(0, 10)).toBe("2026-12-10");
    expect(deliveryDeadline({ serviceOrderDate: d("2027-01-31"), executionDelay: 1, executionUnit: "months" })?.toISOString().slice(0, 10)).toBe("2027-02-28");
    expect(deliveryDeadline({ serviceOrderDate: d("2026-11-10"), executionDelay: 30 })?.toISOString().slice(0, 10)).toBe("2026-12-10");
  });
  it("aucune pénalité avant la date limite", () => {
    expect(penaltyEstimate(base, d("2026-12-10"))?.estimate).toBe(0);
  });
  it("1/2000e du marché par jour de retard", () => {
    const p = penaltyEstimate(base, d("2026-12-20"));
    expect(p).toMatchObject({ daysLate: 10, perDay: 10_761, estimate: 107_607 });
  });
  it("la livraison arrête le décompte", () => {
    expect(penaltyEstimate({ ...base, deliveredAt: d("2026-12-13") }, d("2027-03-01"))?.daysLate).toBe(3);
    expect(penaltyEstimate({ ...base, receptionProvisoireDate: d("2026-12-12") }, d("2027-03-01"))?.daysLate).toBe(2);
  });
  it("respecte le plafond quand il existe", () => {
    const p = penaltyEstimate({ ...base, penaltyCapRate: 0.05 }, d("2028-12-10"));
    expect(p).toMatchObject({ estimate: 1_076_069, capped: true });
  });
  it("marché public : plafond de 10 % sans clause contraire", () => {
    expect(penaltyEstimate(base, d("2028-12-10"), "public_establishment")).toMatchObject({ estimate: 2_152_139, capped: true });
    expect(penaltyEstimate(base, d("2028-12-10"), "private")?.capped).toBe(false);
  });
  it("sans ordre de service, pas de calcul", () => {
    expect(penaltyEstimate(LOT1)).toBeNull();
  });
});

describe("délai de paiement et intérêts moratoires", () => {
  it("30 jours par défaut, le délai du marché sinon", () => {
    expect(paymentDaysOf({})).toBe(30);
    expect(paymentDaysOf({ paymentDays: 60 })).toBe(60);
    expect(paymentDaysOf({ paymentDays: 0 })).toBe(0);
    expect(dueFrom(d("2026-12-15"), 60).toISOString().slice(0, 10)).toBe("2027-02-13");
  });
  it("intérêt simple jusqu'à aujourd'hui sur une facture impayée", () => {
    const r = lateInterest({ dueDate: d("2027-01-01"), amountDue: 3_650_000, payments: [], annualRate: 0.1, asOf: d("2027-01-11") });
    expect(r).toEqual({ interest: 10_000, daysLate: 10, unpaid: 3_650_000 });
  });
  it("rien avant l'échéance ni si le règlement est à temps", () => {
    expect(lateInterest({ dueDate: d("2027-01-11"), amountDue: 1_000_000, payments: [], annualRate: 0.1, asOf: d("2027-01-01") }).interest).toBe(0);
    expect(lateInterest({ dueDate: d("2027-01-11"), amountDue: 1_000_000, payments: [{ date: d("2027-01-05"), amount: 1_000_000 }], annualRate: 0.1, asOf: d("2027-06-01") })).toEqual({ interest: 0, daysLate: 0, unpaid: 0 });
  });
  it("un règlement tardif garde ses intérêts, et s'arrête à la date du règlement", () => {
    const r = lateInterest({ dueDate: d("2027-01-01"), amountDue: 3_650_000, payments: [{ date: d("2027-01-21"), amount: 3_650_000 }], annualRate: 0.1, asOf: d("2027-06-01") });
    expect(r).toEqual({ interest: 20_000, daysLate: 20, unpaid: 0 });
  });
  it("un acompte réduit la base à partir de sa date", () => {
    const r = lateInterest({ dueDate: d("2027-01-01"), amountDue: 3_650_000, payments: [{ date: d("2027-01-11"), amount: 1_825_000 }], annualRate: 0.1, asOf: d("2027-01-21") });
    expect(r.interest).toBe(15_000);
    expect(r.unpaid).toBe(1_825_000);
  });
});

describe("divers", () => {
  it("la référence est le TTC s'il est renseigné", () => {
    expect(marketBase(LOT1)).toEqual({ amount: 21_521_388, kind: "TTC" });
    expect(marketBase({ amount: 100 })).toEqual({ amount: 100, kind: "HT" });
    expect(marketBase({ amount: 18_085_200, tvaRate: 0.19 })).toEqual({ amount: 21_521_388, kind: "TTC" });
    expect(marketBase({ amount: 100, tvaRate: 0 })).toEqual({ amount: 100, kind: "HT" });
  });
  it("signale un HT et un TTC qui ne concordent pas", () => {
    expect(amountsMismatch({ ...LOT1, tvaRate: 0.19 })).toBe(false);
    expect(amountsMismatch({ amount: 21_521_388, amountTTC: 21_521_388, tvaRate: 0.19 })).toBe(true);
    expect(amountsMismatch({ amount: 200, amountTTC: 100 })).toBe(true);
  });
  it("les jours se comptent sur le calendrier, pas sur l'heure", () => {
    expect(dayNumber(new Date("2026-11-05T23:59:00Z")) - dayNumber(new Date("2026-11-05T00:01:00Z"))).toBe(0);
  });
  it("les frais bancaires ont leur catégorie, la redevance tombe dans les impôts et taxes", () => {
    expect(costCategory("631000")).toBe("bank");
    expect(costCategory("632400")).toBe("services");
    expect(costCategory("648000")).toBe("registration");
    expect(costCategory("658000")).toBe("other");
  });
  it("deux noms ne diffèrent pas par la casse ou les accents", () => {
    expect(labelKey(" Frais  de Dédouanement ")).toBe(labelKey("frais de dedouanement"));
  });
  it("une condition vidée s'efface, le reste s'écrit", () => {
    expect(contractUpdate({ paymentDays: 60, regulationRate: null, title: "X" })).toEqual({ $set: { paymentDays: 60, title: "X" }, $unset: { regulationRate: 1 } });
  });
});
