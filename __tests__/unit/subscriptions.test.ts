/**
 * Moteur de rapprochement achat / revente des abonnements.
 *
 * Le cœur du module : combien de licences sont placées, quelle marge elles
 * dégagent, et quelles échéances engagent l'organisation. Chaque règle est
 * verrouillée ici plutôt que vérifiée à l'œil sur un écran.
 */

import {
  reconcile, buildAlerts, taxSummary, purchaseCost,
  suggestedWithholding, monthlyAllocation, daysBetween,
  type PurchaseLike, type SaleLike,
} from "@/lib/subscriptions";

const AS_OF = new Date("2026-06-01");

function purchase(over: Partial<PurchaseLike> = {}): PurchaseLike {
  return {
    _id: "p1",
    reference: "ABO-2026-001",
    productName: "Compilatio Magister+",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    quantity: 100,
    costAmount: 3_000_000,
    status: "active",
    ...over,
  };
}

function sale(over: Partial<SaleLike> = {}): SaleLike {
  return {
    _id: "s1",
    reference: "REV-2026-001",
    purchaseId: "p1",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    quantity: 40,
    totalHT: 2_000_000,
    totalTVA: 380_000,
    invoiceId: "inv1",
    status: "active",
    ...over,
  };
}

describe("Coût de revient d'un contrat souscrit", () => {
  it("additionne achat, retenue et frais bancaires", () => {
    const cost = purchaseCost(purchase({
      costAmount: 3_000_000, withholdingAmount: 150_000, bankFeesAmount: 25_000,
    }));
    expect(cost.total).toBe(3_175_000);
  });

  it("tient la TVA supportée hors du coût de revient", () => {
    // Elle est déductible : l'inclure écraserait artificiellement la marge.
    const cost = purchaseCost(purchase({ costAmount: 1_000_000, purchaseVatAmount: 190_000 }));
    expect(cost.total).toBe(1_000_000);
    expect(cost.recoverableVat).toBe(190_000);
  });
});

describe("Rapprochement", () => {
  it("compte les licences placées et celles qui restent", () => {
    const rec = reconcile(purchase(), [sale({ quantity: 40 }), sale({ _id: "s2", reference: "REV-002", quantity: 25 })]);
    expect(rec.quantityBought).toBe(100);
    expect(rec.quantitySold).toBe(65);
    expect(rec.quantityRemaining).toBe(35);
    expect(rec.fillRate).toBe(65);
  });

  it("calcule la marge et son taux", () => {
    const rec = reconcile(
      purchase({ costAmount: 3_000_000 }),
      [sale({ totalHT: 5_000_000 })]
    );
    expect(rec.margin).toBe(2_000_000);
    expect(rec.marginRate).toBe(40);
  });

  it("rend une marge négative telle quelle", () => {
    // Un contrat vendu à perte doit se voir, pas être ramené à zéro.
    const rec = reconcile(purchase({ costAmount: 3_000_000 }), [sale({ totalHT: 1_000_000 })]);
    expect(rec.margin).toBe(-2_000_000);
  });

  it("ignore les reventes rattachées à un autre contrat", () => {
    const rec = reconcile(purchase(), [sale({ purchaseId: "autre", quantity: 90 })]);
    expect(rec.quantitySold).toBe(0);
    expect(rec.revenue).toBe(0);
  });

  it("libère la part d'une revente annulée", () => {
    const rec = reconcile(purchase(), [
      sale({ quantity: 40 }),
      sale({ _id: "s2", reference: "REV-002", quantity: 30, status: "cancelled" }),
    ]);
    expect(rec.quantitySold).toBe(40);
    expect(rec.quantityRemaining).toBe(60);
  });

  it("signale une sur-vente", () => {
    const rec = reconcile(purchase({ quantity: 50 }), [sale({ quantity: 60 })]);
    expect(rec.overSold).toBe(true);
    expect(rec.quantityRemaining).toBe(-10);
  });

  it("signale une revente qui court au-delà du contrat amont", () => {
    const rec = reconcile(
      purchase({ endDate: "2026-12-31" }),
      [sale({ reference: "REV-DEBORD", endDate: "2027-06-30" })]
    );
    expect(rec.overrunningSales).toEqual(["REV-DEBORD"]);
  });

  it("liste les reventes actives non facturées", () => {
    const rec = reconcile(purchase(), [
      sale({ reference: "REV-A", invoiceId: undefined }),
      sale({ _id: "s2", reference: "REV-B", invoiceId: "inv2" }),
    ]);
    expect(rec.unbilledSales).toEqual(["REV-A"]);
  });

  it("compare coût unitaire et prix de revente moyen", () => {
    const rec = reconcile(
      purchase({ quantity: 100, costAmount: 3_000_000 }),
      [sale({ quantity: 40, totalHT: 2_000_000 })]
    );
    expect(rec.unitCost).toBe(30_000);
    expect(rec.averageUnitPrice).toBe(50_000);
  });

  it("ne divise pas par zéro sur un contrat sans revente", () => {
    const rec = reconcile(purchase(), []);
    expect(rec.marginRate).toBe(0);
    expect(rec.averageUnitPrice).toBe(0);
    expect(rec.fillRate).toBe(0);
  });
});

describe("Alertes", () => {
  it("annonce un contrat qui approche de son terme", () => {
    const alerts = buildAlerts([purchase({ endDate: "2026-06-20" })], [], AS_OF);
    const a = alerts.find(x => x.kind === "purchase_expiring");
    expect(a).toBeDefined();
    expect(a!.daysLeft).toBe(19);
  });

  it("passe en critique à moins de quinze jours", () => {
    const alerts = buildAlerts([purchase({ endDate: "2026-06-10" })], [], AS_OF);
    expect(alerts.find(x => x.kind === "purchase_expiring")!.level).toBe("critical");
  });

  it("signale un contrat déjà expiré", () => {
    const alerts = buildAlerts([purchase({ endDate: "2026-05-01" })], [], AS_OF);
    const a = alerts.find(x => x.kind === "purchase_expired");
    expect(a?.level).toBe("critical");
  });

  it("distingue l'échéance de préavis de la fin du contrat", () => {
    // Reconduction tacite, fin au 31/12, préavis de 90 jours : la date qui
    // engage est le 02/10, pas le 31/12.
    const alerts = buildAlerts(
      [purchase({ endDate: "2026-08-15", autoRenew: true, noticeDays: 60 })],
      [], AS_OF
    );
    const notice = alerts.find(x => x.kind === "notice_deadline");
    expect(notice).toBeDefined();
    expect(notice!.daysLeft).toBe(daysBetween(AS_OF, new Date("2026-08-15")) - 60);
  });

  it("annonce le préavis dépassé comme une reconduction acquise", () => {
    const alerts = buildAlerts(
      [purchase({ endDate: "2026-06-20", autoRenew: true, noticeDays: 60 })],
      [], AS_OF
    );
    const notice = alerts.find(x => x.kind === "notice_deadline");
    expect(notice?.level).toBe("critical");
    expect(notice?.message).toContain("reconduction est acquise");
  });

  it("remonte la sur-vente", () => {
    const alerts = buildAlerts([purchase({ quantity: 10 })], [sale({ quantity: 15 })], AS_OF);
    expect(alerts.some(a => a.kind === "over_sold" && a.level === "critical")).toBe(true);
  });

  it("remonte une revente qui dépasse la couverture", () => {
    const alerts = buildAlerts(
      [purchase({ endDate: "2026-12-31" })],
      [sale({ reference: "REV-X", endDate: "2027-03-31" })],
      AS_OF
    );
    expect(alerts.some(a => a.kind === "sale_beyond_purchase" && a.reference === "REV-X")).toBe(true);
  });

  it("remonte une revente active non facturée", () => {
    const alerts = buildAlerts([purchase()], [sale({ invoiceId: undefined })], AS_OF);
    expect(alerts.some(a => a.kind === "unbilled_sale")).toBe(true);
  });

  it("ne réclame pas de facture pour un brouillon", () => {
    const alerts = buildAlerts([purchase()], [sale({ invoiceId: undefined, status: "draft" })], AS_OF);
    expect(alerts.some(a => a.kind === "unbilled_sale")).toBe(false);
  });

  it("ignore complètement un contrat annulé", () => {
    const alerts = buildAlerts([purchase({ status: "cancelled", endDate: "2020-01-01" })], [], AS_OF);
    expect(alerts).toEqual([]);
  });

  it("classe le plus urgent en premier", () => {
    const alerts = buildAlerts(
      [purchase({ endDate: "2026-06-05" }), purchase({ _id: "p2", reference: "ABO-2", endDate: "2026-07-20" })],
      [], AS_OF
    );
    expect(alerts[0].level).toBe("critical");
  });

  it("est reproductible : la date d'appréciation est un paramètre", () => {
    const p = [purchase({ endDate: "2026-06-20" })];
    expect(buildAlerts(p, [], AS_OF)).toEqual(buildAlerts(p, [], new Date("2026-06-01")));
  });
});

describe("Charges fiscales du portefeuille", () => {
  it("établit le solde de TVA", () => {
    const tax = taxSummary(
      [purchase({ purchaseVatAmount: 300_000 })],
      [sale({ totalTVA: 380_000 })]
    );
    expect(tax.vatCollected).toBe(380_000);
    expect(tax.vatRecoverable).toBe(300_000);
    expect(tax.vatDue).toBe(80_000);
  });

  it("rend un crédit de TVA en négatif plutôt que zéro", () => {
    const tax = taxSummary([purchase({ purchaseVatAmount: 500_000 })], [sale({ totalTVA: 100_000 })]);
    expect(tax.vatDue).toBe(-400_000);
  });

  it("estime l'IS au taux normal sur la marge", () => {
    const tax = taxSummary([purchase({ costAmount: 1_000_000 })], [sale({ totalHT: 3_000_000 })]);
    expect(tax.grossMargin).toBe(2_000_000);
    expect(tax.estimatedCorporateTax).toBe(600_000);
    expect(tax.marginAfterTax).toBe(1_400_000);
  });

  it("n'estime aucun IS sur une marge négative", () => {
    const tax = taxSummary([purchase({ costAmount: 5_000_000 })], [sale({ totalHT: 1_000_000 })]);
    expect(tax.estimatedCorporateTax).toBe(0);
  });

  it("exclut les brouillons du chiffre d'affaires", () => {
    const tax = taxSummary([purchase()], [sale({ status: "draft", totalHT: 9_000_000 })]);
    expect(tax.grossMargin).toBe(-3_000_000);
  });
});

describe("Retenue à la source sur prestataire étranger", () => {
  it("applique 5 % sur une prestation de service (CGI art. 118)", () => {
    expect(suggestedWithholding(2_000_000, true)).toBe(100_000);
  });

  it("ne retient rien sur un prestataire local", () => {
    expect(suggestedWithholding(2_000_000, false)).toBe(0);
  });
});

describe("Étalement mensuel", () => {
  it("répartit une année pleine sur douze mois", () => {
    const buckets = monthlyAllocation(1_200_000, "2026-01-01", "2026-12-31");
    expect(buckets).toHaveLength(12);
    expect(buckets[0].month).toBe(1);
    expect(buckets[11].month).toBe(12);
  });

  it("la somme des parts égale exactement le montant", () => {
    // L'écart d'arrondi doit être absorbé, pas laissé à traîner.
    for (const amount of [1_000_000, 999_999, 7, 3_141_593]) {
      const total = monthlyAllocation(amount, "2026-03-15", "2027-02-14")
        .reduce((sum, b) => sum + b.amount, 0);
      expect(total).toBe(amount);
    }
  });

  it("proratise le premier et le dernier mois", () => {
    const buckets = monthlyAllocation(300_000, "2026-01-16", "2026-03-31");
    // Janvier ne compte que 16 jours sur 75 : sa part est la plus faible.
    expect(buckets[0].amount).toBeLessThan(buckets[1].amount);
    expect(buckets).toHaveLength(3);
  });

  it("chevauche deux exercices en gardant l'année de chaque part", () => {
    const buckets = monthlyAllocation(120_000, "2026-11-01", "2027-02-28");
    expect(buckets[0].year).toBe(2026);
    expect(buckets.at(-1)!.year).toBe(2027);
  });

  it("ne produit rien pour un montant nul ou une période inversée", () => {
    expect(monthlyAllocation(0, "2026-01-01", "2026-12-31")).toEqual([]);
    expect(monthlyAllocation(1000, "2026-12-31", "2026-01-01")).toEqual([]);
  });
});
