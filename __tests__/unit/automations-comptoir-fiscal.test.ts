/**
 * Tests unitaires — automatisations du comptoir, de la comptabilité et du
 * calendrier fiscal : rappels fiscaux (CGI 2026), balance âgée fournisseurs,
 * écart de marge par article, liquidation de la TVA, réglages bornés.
 *
 * Exécuter : npx jest __tests__/unit/automations-comptoir-fiscal.test.ts
 */
import { fiscalRemindersDue, agingBucket, normalizeAutomationSettings, DEFAULT_AUTOMATION_SETTINGS } from "@/lib/automations";
import { marginGap, itemEconomics } from "@/lib/comptoir-economics";
import { reorderSuggestion } from "@/lib/spot";
import { vatSettlementLines, VAT_DUE, VAT_CREDIT } from "@/lib/vat-settlement";

// Midi à Niamey (UTC+1) le jour donné.
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 11));

describe("Calendrier fiscal (CGI 2026)", () => {
  test("TVA du mois écoulé : préparation du 1er au 9, rappel du 10 au 12, dernier délai les 13 et 14", () => {
    expect(fiscalRemindersDue(at(2026, 11, 1)).map(r => r.kind)).toEqual(["tva_prepare"]);
    expect(fiscalRemindersDue(at(2026, 11, 10)).map(r => r.kind)).toEqual(["tva_due"]);
    expect(fiscalRemindersDue(at(2026, 11, 13)).map(r => r.kind)).toEqual(["tva_urgent"]);
    expect(fiscalRemindersDue(at(2026, 11, 15))).toEqual([]);
    expect(fiscalRemindersDue(at(2026, 11, 20))).toEqual([]);
  });
  test("la TVA rappelée est celle du mois précédent, échéance le 15 (janvier → décembre de l'année d'avant)", () => {
    const [r] = fiscalRemindersDue(at(2027, 1, 3));
    expect(r.period).toEqual({ year: 2026, month: 12 });
    expect(r.key).toBe("fiscal:tva_prepare:2026-12");
    expect(r.message).toContain("15/01/2027");
  });
  test("acomptes d'IS : rappel dans les 15 jours avant le 1/07, le 1/09 et le 1/11", () => {
    const june = fiscalRemindersDue(at(2026, 6, 20)).find(r => r.kind === "is_acompte");
    expect(june?.key).toBe("fiscal:is_acompte:2026-1");
    expect(june?.message.startsWith("1er acompte d'IS/IMF")).toBe(true);
    expect(fiscalRemindersDue(at(2026, 6, 10)).some(r => r.kind === "is_acompte")).toBe(false);
    expect(fiscalRemindersDue(at(2026, 8, 25)).find(r => r.kind === "is_acompte")?.period.index).toBe(2);
    expect(fiscalRemindersDue(at(2026, 10, 31)).find(r => r.kind === "is_acompte")?.period.index).toBe(3);
    expect(fiscalRemindersDue(at(2026, 11, 1)).some(r => r.kind === "is_acompte")).toBe(false);
  });
  test("DSF de l'exercice précédent rappelée en avril", () => {
    expect(fiscalRemindersDue(at(2027, 4, 5)).find(r => r.kind === "dsf")?.key).toBe("fiscal:dsf:2026");
    expect(fiscalRemindersDue(at(2027, 4, 30)).some(r => r.kind === "dsf")).toBe(true);
    expect(fiscalRemindersDue(at(2027, 5, 5)).some(r => r.kind === "dsf")).toBe(false);
  });
});

describe("Balance âgée fournisseurs", () => {
  const now = at(2026, 10, 30);
  // Échéance stockée à minuit heure de Niamey (23 h UTC la veille), quel que soit le fuseau de la machine de test.
  const niamey = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d - 1, 23));
  test("tranches selon l'échéance", () => {
    expect(agingBucket(niamey(2026, 7, 1), now)).toBe("overdue_90");
    expect(agingBucket(niamey(2026, 9, 15), now)).toBe("overdue_30");
    expect(agingBucket(niamey(2026, 10, 29), now)).toBe("overdue");
    expect(agingBucket(niamey(2026, 10, 30), now)).toBe("due_7");
    expect(agingBucket(niamey(2026, 11, 6), now)).toBe("due_7");
    expect(agingBucket(niamey(2026, 11, 20), now)).toBe("due_30");
    expect(agingBucket(niamey(2027, 1, 15), now)).toBe("later");
    expect(agingBucket(undefined, now)).toBe("no_date");
  });
  test("échéance à minuit heure de Niamey : le bon jour, pas la veille", () => {
    // Minuit à Niamey = 23 h UTC la veille.
    expect(agingBucket(new Date(Date.UTC(2026, 9, 29, 23)), now)).toBe("due_7");
  });
});

describe("Écart entre marge attendue et marge réalisée", () => {
  const e = itemEconomics({ unitCost: 150, salePrice: 250 });
  test("ventes au prix affiché et au coût de la fiche : aucun écart", () => {
    const g = marginGap({ quantity: 10, revenueHT: 2500, costOfSales: 1500, listHT: 2500, noListQty: 0, economics: e, target: 0.3 })!;
    expect(g).toMatchObject({ expected: 1000, realized: 1000, gap: 0, priceEffect: 0, costEffect: 0, lossEffect: 0, markupRealized: 40, shortfall: 0, belowTarget: false });
  });
  test("promotion, prix saisi en caisse, achat plus cher et pertes : chaque effet à sa place", () => {
    const g = marginGap({ quantity: 10, revenueHT: 2000, costOfSales: 1700, listHT: 2500, noListQty: 0, promoHT: -300, manualHT: -200, discountHT: 0, economics: e, losses: 150, target: 0.3, tolerancePts: 5 })!;
    expect(g.expected).toBe(1000);
    expect(g.priceEffect).toBe(-500);
    expect(g.promoEffect).toBe(-300);
    expect(g.manualEffect).toBe(-200);
    expect(g.otherPriceEffect).toBe(0);
    expect(g.costEffect).toBe(-200);
    expect(g.lossEffect).toBe(-150);
    expect(g.realized).toBe(150);
    expect(g.gap).toBe(g.priceEffect + g.costEffect + g.lossEffect);
    expect(g.markupRealized).toBe(7.5);
    expect(g.shortfall).toBe(450);
    expect(g.belowTarget).toBe(true);
  });
  test("TVA de la ligne : le prix affiché HT vient de la vente, pas du taux du comptoir", () => {
    // Article exonéré vendu au prix affiché sur un comptoir à 19 % : listHT = CA HT, aucun effet prix.
    const e19 = itemEconomics({ unitCost: 200, salePrice: 300, vatRate: 0.19 });
    const g = marginGap({ quantity: 10, revenueHT: 3000, costOfSales: 2000, listHT: 3000, noListQty: 0, economics: e19, target: 0.3 })!;
    expect(g.priceEffect).toBe(0);
  });
  test("formule sans coût sur sa fiche : coût de référence = coût réel de ses ventes", () => {
    const g = marginGap({ quantity: 4, revenueHT: 2400, costOfSales: 1200, listHT: 2400, noListQty: 0, economics: itemEconomics({ salePrice: 600 }), target: 0.3 })!;
    expect(g.costEffect).toBe(0);
    expect(g.realized).toBe(1200);
  });
  test("anciennes ventes sans prix affiché : prix actuel de la fiche", () => {
    const g = marginGap({ quantity: 10, revenueHT: 2500, costOfSales: 1500, listHT: 0, noListQty: 10, economics: e, target: 0.3 })!;
    expect(g.expected).toBe(1000);
    expect(g.priceEffect).toBe(0);
  });
  test("dans la tolérance : pas sous l'objectif", () => {
    const g = marginGap({ quantity: 10, revenueHT: 2500, costOfSales: 1800, listHT: 2500, noListQty: 0, economics: e, target: 0.3, tolerancePts: 5 })!;
    expect(g.markupRealized).toBe(28);
    expect(g.belowTarget).toBe(false);
  });
  test("rien vendu au coût connu, ou ni prix ni prix affiché : pas d'écart", () => {
    expect(marginGap({ quantity: 0, revenueHT: 0, costOfSales: 0, economics: e, target: 0.3 })).toBeNull();
    expect(marginGap({ quantity: 2, revenueHT: 500, costOfSales: 100, economics: itemEconomics({ unitCost: 50 }), target: 0.3 })).toBeNull();
  });
});

describe("Réassort : seuil et quantités déjà commandées", () => {
  test("article en rupture sans ventes récentes, sous son seuil : à commander, urgent", () => {
    const r = reorderSuggestion({ stock: 0, soldInWindow: 0, windowDays: 28, leadDays: 2, coverDays: 7, threshold: 5 });
    expect(r.urgent).toBe(true);
    expect(r.quantity).toBeGreaterThanOrEqual(6);
  });
  test("quantité déjà en commande déduite : pas de seconde commande", () => {
    const base = { stock: 2, soldInWindow: 56, windowDays: 28, leadDays: 2, coverDays: 7 };
    expect(reorderSuggestion(base).quantity).toBe(16);
    const r = reorderSuggestion({ ...base, onOrder: 16 });
    expect(r.quantity).toBe(0);
    expect(r.urgent).toBe(false);
  });
});

describe("Liquidation de la TVA", () => {
  const sum = (ls: Array<{ debit: number; credit: number }>, k: "debit" | "credit") => ls.reduce((t, l) => t + l[k], 0);
  test("TVA nette positive sans crédit : 443 soldé, 445 soldé, TVA due au 4441", () => {
    const r = vatSettlementLines([{ accountCode: "443000", net: -190_000 }, { accountCode: "445200", net: 40_000 }], 0);
    expect(r.due).toBe(150_000);
    expect(r.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "443000", debit: 190_000, credit: 0 }),
      expect.objectContaining({ accountCode: "445200", debit: 0, credit: 40_000 }),
      expect.objectContaining({ accountCode: VAT_DUE.accountCode, credit: 150_000 }),
    ]));
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
  });
  test("crédit reporté imputé d'abord sur la TVA due", () => {
    const r = vatSettlementLines([{ accountCode: "443000", net: -100_000 }, { accountCode: "445200", net: 20_000 }], 30_000);
    expect(r.creditUsed).toBe(30_000);
    expect(r.due).toBe(50_000);
    expect(r.creditCarried).toBe(0);
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
  });
  test("crédit supérieur à la TVA nette : rien à payer, le reste du crédit est reporté", () => {
    const r = vatSettlementLines([{ accountCode: "443000", net: -10_000 }], 25_000);
    expect(r.due).toBe(0);
    expect(r.creditUsed).toBe(10_000);
    expect(r.creditCarried).toBe(15_000);
  });
  test("TVA nette négative : crédit à reporter au 4449", () => {
    const r = vatSettlementLines([{ accountCode: "443000", net: -10_000 }, { accountCode: "445100", net: 60_000 }], 0);
    expect(r.net).toBe(-50_000);
    expect(r.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: VAT_CREDIT.accountCode, debit: 50_000, credit: 0 })]));
    expect(r.creditCarried).toBe(50_000);
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
  });
  test("mois sans TVA : aucune ligne", () => {
    expect(vatSettlementLines([], 0).lines).toEqual([]);
  });
});

describe("Réglages des nouvelles automatisations", () => {
  test("alertes internes actives d'office ; bons de commande et e-mails à activer", () => {
    const d = DEFAULT_AUTOMATION_SETTINGS;
    expect([d.comptoirMargins.enabled, d.easypayRecon.enabled, d.comptoirReorder.enabled, d.accountingChecks.enabled, d.fiscalCalendar.enabled, d.supplierPayments.enabled, d.tenderFollowup.enabled]).toEqual([true, true, true, true, true, true, true]);
    expect(d.comptoirReorder.autoOrder).toBe(false);
    expect(d.accountingChecks.email).toBe(false);
    expect(d.accountingChecks.day).toBe(10);
  });
  test("valeurs bornées, champs absents remplacés par les défauts", () => {
    const s = normalizeAutomationSettings({ comptoirMargins: { tolerancePts: 400 }, accountingChecks: { day: 31, email: "oui" }, tenderFollowup: { afterDays: 1 }, supplierPayments: { horizonDays: "x" } });
    expect(s.comptoirMargins.tolerancePts).toBe(50);
    expect(s.accountingChecks.day).toBe(28);
    expect(s.accountingChecks.email).toBe(false);
    expect(s.tenderFollowup.afterDays).toBe(7);
    expect(s.supplierPayments.horizonDays).toBe(7);
  });
});
