import { computePnl, chargeCategory, costRise, supplySuggestion, staffCost, menuEngineering, monthBounds, isMonth } from "@/lib/restaurant";
import { EXPENSE_ACCOUNTS } from "@/lib/expense-categories";

describe("restaurant — rubriques de charges", () => {
  it("range les comptes SYSCOHADA dans leur rubrique", () => {
    expect(chargeCategory("605100")).toBe("eau");
    expect(chargeCategory("605200")).toBe("electricite");
    expect(chargeCategory("622000")).toBe("loyer");
    expect(chargeCategory("661100")).toBe("personnel");
    expect(chargeCategory("624000")).toBe("entretien");
    expect(chargeCategory("681000")).toBe("amortissements");
    expect(chargeCategory("658000")).toBe("autres");
  });
  it("exclut les achats de marchandises et matières (déjà au coût des ventes) et ce qui n'est pas une charge", () => {
    expect(chargeCategory("601100")).toBeNull();
    expect(chargeCategory("602100")).toBeNull();
    expect(chargeCategory("603100")).toBeNull();
    expect(chargeCategory("701100")).toBeNull();
  });
  it("chaque nature de dépense de caisse (hors achats) tombe dans une rubrique de charges", () => {
    for (const [k, a] of Object.entries(EXPENSE_ACCOUNTS)) {
      if (k === "supply" || k === "ingredients") expect(a).toBeNull();
      else expect(chargeCategory(a!.accountCode)).not.toBeNull();
    }
  });
});

describe("restaurant — compte de résultat de gestion", () => {
  const base = { revenueHT: 1_000_000, costOfSales: 350_000, unvaluedRevenueHT: 0, tickets: 800, losses: 20_000, inventoryGap: -10_000,
    charges: { personnel: 250_000, electricite: 60_000, eau: 15_000, loyer: 100_000 }, planned: { loyer: 100_000, electricite: 50_000 }, openDays: 25 };
  it("marge brute, marge matière, charges et résultat", () => {
    const p = computePnl(base);
    expect(p.grossMargin).toBe(650_000);
    expect(p.materialMargin).toBe(620_000);
    expect(p.totalCharges).toBe(425_000);
    expect(p.result).toBe(195_000);
    expect(p.plannedCharges).toBe(150_000);
  });
  it("ratios : coût matière (ventes + pertes + manquants), personnel, ticket, point mort par jour", () => {
    const q = computePnl(base).ratios;
    expect(q.foodCostPct).toBe(38);
    expect(q.staffCostPct).toBe(25);
    expect(q.primeCostPct).toBe(63);
    expect(q.averageTicket).toBe(1250);
    expect(q.marginRate).toBe(62);
    expect(q.breakEvenRevenue).toBe(Math.round(425_000 / 0.62));
    expect(q.breakEvenPerDay).toBe(Math.round(Math.round(425_000 / 0.62) / 25));
  });
  it("sans vente : ratios inconnus, résultat = − charges", () => {
    const p = computePnl({ ...base, revenueHT: 0, costOfSales: 0, tickets: 0, losses: 0, inventoryGap: 0 });
    expect(p.result).toBe(-425_000);
    expect(p.ratios.foodCostPct).toBeNull();
    expect(p.ratios.breakEvenRevenue).toBeNull();
  });
});

describe("restaurant — personnel, réassort, coûts, carte", () => {
  it("coût du personnel au prorata du temps, coût employeur ou brut + CNSS patronale", () => {
    expect(staffCost([{ employeeId: "a", employerCost: 200_000 }, { employeeId: "b", grossTotal: 100_000, cnssEmployer: 16_400 }, { employeeId: "c", employerCost: 999_999 }],
      [{ employeeId: "a", share: 0.5 }, { employeeId: "b", share: 1 }])).toBe(216_400);
  });
  it("monter de la réserve : jusqu'au double du seuil, en paquets entiers, dans la limite de la réserve", () => {
    expect(supplySuggestion({ desk: 4, reserve: 100, threshold: 10, packSize: 6 })).toBe(18);
    expect(supplySuggestion({ desk: 4, reserve: 5, threshold: 10, packSize: 6 })).toBe(5);
    expect(supplySuggestion({ desk: 11, reserve: 100, threshold: 10 })).toBe(0);
    expect(supplySuggestion({ desk: 0, reserve: 100 })).toBe(0);
  });
  it("hausse de coût signalée à partir de 5 %", () => {
    expect(costRise(100, 104)).toBeNull();
    expect(costRise(100, 112)).toBe(12);
    expect(costRise(0, 50)).toBeNull();
  });
  it("analyse de la carte : locomotive, vache à lait, énigme, poids mort", () => {
    const m = menuEngineering([
      { id: "a", name: "Riz", quantity: 100, marginHT: 50_000 }, { id: "b", name: "Jus", quantity: 90, marginHT: 9_000 },
      { id: "c", name: "Poulet", quantity: 5, marginHT: 5_000 }, { id: "d", name: "Soupe", quantity: 5, marginHT: 500 },
    ]);
    expect(Object.fromEntries(m.map(x => [x.id, x.class]))).toEqual({ a: "star", b: "plowhorse", c: "puzzle", d: "dog" });
  });
  it("mois : bornes et contrôle", () => {
    expect(monthBounds("2026-02")).toMatchObject({ fromDay: "2026-02-01", toDay: "2026-02-28" });
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-10")).toBe(true);
  });
});

describe("restaurant — corrections du second passage", () => {
  const base = { revenueHT: 1_000_000, costOfSales: 350_000, unvaluedRevenueHT: 0, tickets: 800, losses: 20_000, inventoryGap: 0,
    charges: { loyer: 100_000 }, planned: { loyer: 300_000 }, openDays: 25 };
  it("ventes sans coût connu : hors marge, ratios rapportés au CA au coût connu", () => {
    const p = computePnl({ ...base, unvaluedRevenueHT: 200_000 });
    expect(p.valuedRevenueHT).toBe(800_000);
    expect(p.grossMargin).toBe(450_000);
    expect(p.ratios.foodCostPct).toBe(Math.round((370_000 / 800_000) * 1000) / 10);
  });
  it("achats de caisse hors réception : dans la marge brute et le coût matière", () => {
    const p = computePnl({ ...base, cashPurchases: 50_000 });
    expect(p.grossMargin).toBe(600_000);
    expect(p.ratios.foodCostPct).toBe(42);
  });
  it("repas du personnel et offerts : retirés de la marge matière, pas du coût matière", () => {
    const p = computePnl({ ...base, staffAndOffered: 30_000 });
    expect(p.materialMargin).toBe(600_000);
    expect(p.ratios.foodCostPct).toBe(37);
  });
  it("point mort : prévu si plus élevé pour le mois en cours, réel pour un mois écoulé", () => {
    expect(computePnl(base).ratios.breakEvenRevenue).toBe(Math.round(300_000 / 0.63));
    expect(computePnl({ ...base, pastMonth: true }).ratios.breakEvenRevenue).toBe(Math.round(100_000 / 0.63));
  });
  it("analyse de la carte par famille : une boisson ne se compare pas à un plat", () => {
    const m = menuEngineering([
      { id: "a", name: "Riz", quantity: 100, marginHT: 50_000, category: "Plats" }, { id: "b", name: "Soupe", quantity: 10, marginHT: 1_000, category: "Plats" },
      { id: "c", name: "Coca", quantity: 300, marginHT: 30_000, category: "Boissons" }, { id: "d", name: "Jus", quantity: 20, marginHT: 4_000, category: "Boissons" },
    ]);
    expect(m.find(x => x.id === "a")?.class).toBe("star");
    expect(m.find(x => x.id === "c")?.category).toBe("Boissons");
    expect(m.find(x => x.id === "d")?.class).toBe("puzzle");
  });
});

describe("restaurant — fiches techniques (portions et rendement)", () => {
  it("quantité brute par portion = nette ÷ rendement ÷ portions", async () => {
    const { perPortion, portionRecipe } = await import("@/lib/restaurant");
    expect(perPortion({ quantity: 1, yield: 0.8 }, 10)).toBe(0.125);
    expect(perPortion({ quantity: 0.2 }, undefined)).toBe(0.2);
    expect(perPortion({ quantity: 0.2, yield: 1.5 }, 0)).toBe(0.2);
    expect(portionRecipe([{ itemId: "a", quantity: 2, yield: 0.5 }], 4)[0].quantity).toBe(1);
  });
});

describe("monthShares — affectations datées ramenées au mois", () => {
  it("sans dates : la part vaut pour tout le mois", async () => {
    const { monthShares } = await import("@/lib/restaurant");
    expect(monthShares([{ employeeId: "a", share: 0.5 }], 2026, 10)).toEqual([{ employeeId: "a", share: 0.5 }]);
  });
  it("à partir du 16 octobre : 16 jours sur 31", async () => {
    const { monthShares, staffCost } = await import("@/lib/restaurant");
    const s = monthShares([{ employeeId: "a", share: 1, from: "2026-10-16" }], 2026, 10);
    expect(staffCost([{ employeeId: "a", employerCost: 120_000 }], s)).toBe(61_935);
  });
  it("deux périodes successives du même collaborateur s'additionnent ; hors du mois : rien", async () => {
    const { monthShares } = await import("@/lib/restaurant");
    const s = monthShares([{ employeeId: "a", share: 1, to: "2026-10-15" }, { employeeId: "a", share: 0.5, from: "2026-10-16" }, { employeeId: "b", share: 1, to: "2026-09-30" }], 2026, 10);
    expect(s).toHaveLength(1);
    expect(s[0].share).toBeCloseTo((15 + 0.5 * 16) / 31, 5);
  });
});

describe("shiftHours — durée d'un poste", () => {
  it("compte les heures, y compris un service qui finit après minuit", async () => {
    const { shiftHours } = await import("@/lib/restaurant-staff");
    expect(shiftHours("10:00", "15:00")).toBe(5);
    expect(shiftHours("18:30", "00:30")).toBe(6);
    expect(shiftHours("08:00", "08:00")).toBe(24);
  });
});

describe("volumeSimulation — fixes, variables, point mort", () => {
  it("sépare les charges et calcule le point mort et les baisses de volume", async () => {
    const { volumeSimulation } = await import("@/lib/restaurant");
    // CA 1 000 000, marge matière 650 000 (matière 350 000), consommables 50 000 (variables), personnel 300 000 et loyer 100 000 (fixes).
    const s = volumeSimulation({ revenueHT: 1_000_000, materialMargin: 650_000, charges: [
      { category: "consommables", label: "", actual: 50_000, planned: 0 }, { category: "personnel", label: "", actual: 300_000, planned: 0 }, { category: "loyer", label: "", actual: 100_000, planned: 0 },
    ] });
    expect(s.variable).toBe(400_000);
    expect(s.fixed).toBe(400_000);
    expect(s.contributionPct).toBe(60);
    expect(s.breakEvenRevenue).toBe(666_667);
    expect(s.safetyMarginPct).toBe(33.3);
    expect(s.scenarios.map(x => x.result)).toEqual([140_000, 80_000, 20_000]);
  });
  it("sans marge sur coûts variables : pas de point mort", async () => {
    const { volumeSimulation } = await import("@/lib/restaurant");
    expect(volumeSimulation({ revenueHT: 100, materialMargin: -10, charges: [] }).breakEvenRevenue).toBeNull();
  });
});

describe("monthlyDepreciation — dotation du mois au prorata des jours", () => {
  const four = { acquisitionDate: "2025-01-01", acquisitionCost: 1_200_000, usefulLifeYears: 5, depreciationMethod: "linear" };
  it("linéaire : base × jours du mois ÷ jours de la durée", async () => {
    const { monthlyDepreciation } = await import("@/lib/restaurant");
    expect(monthlyDepreciation(four, 2026, 10)).toBe(Math.round(1_200_000 * 31 / 1826));
  });
  it("rien avant l'acquisition, après la fin de durée ou la cession ; prorata le mois d'acquisition", async () => {
    const { monthlyDepreciation } = await import("@/lib/restaurant");
    expect(monthlyDepreciation(four, 2024, 12)).toBe(0);
    expect(monthlyDepreciation(four, 2030, 1)).toBe(0);
    expect(monthlyDepreciation({ ...four, disposalDate: "2026-09-30" }, 2026, 10)).toBe(0);
    expect(monthlyDepreciation({ ...four, acquisitionDate: "2026-10-17" }, 2026, 10)).toBe(Math.round(1_200_000 * 15 / 1826));
    expect(monthlyDepreciation({ ...four, depreciationMethod: "none" }, 2026, 10)).toBe(0);
  });
  it("sur toute la durée, les dotations font la base amortissable", async () => {
    const { monthlyDepreciation } = await import("@/lib/restaurant");
    let t = 0;
    for (let y = 2025; y <= 2029; y++) for (let m = 1; m <= 12; m++) t += monthlyDepreciation(four, y, m);
    expect(Math.abs(t - 1_200_000)).toBeLessThanOrEqual(60);
  });
});

describe("codes-barres — unité, carton, autres", () => {
  const rows = [
    { name: "Coca 33 cl", barcode: "5449000000996", packBarcode: "15449000000993", altBarcodes: ["6111000000011"] },
    { name: "Fanta 33 cl", barcode: "5449000011527" },
    { name: "Eau Belvie 1,5 L" },
  ];
  it("le code du carton désigne l'article en carton, les autres codes en unité", async () => {
    const { matchCode } = await import("@/lib/barcodes");
    expect(matchCode(rows, "15449000000993")).toEqual({ row: rows[0], pack: true });
    expect(matchCode(rows, " 5449000000996 ")).toEqual({ row: rows[0], pack: false });
    expect(matchCode(rows, "6111000000011")?.pack).toBe(false);
    expect(matchCode(rows, "belvie")?.row.name).toBe("Eau Belvie 1,5 L");
    expect(matchCode(rows, "33 cl")).toBeNull();
    expect(matchCode(rows, "0000")).toBeNull();
  });
  it("codesOf rassemble les codes non vides", async () => {
    const { codesOf } = await import("@/lib/barcodes");
    expect(codesOf({ barcode: "A1", packBarcode: "", altBarcodes: ["B 2", ""] })).toEqual(["A1", "B2"]);
  });
});

describe("rythme des articles — comptage du samedi", () => {
  it("chaque semaine : toujours ; chaque mois : la première semaine ; deux semaines : un samedi sur deux", async () => {
    const { countDue } = await import("@/lib/restaurant");
    expect(countDue(undefined, "2026-11-14")).toBe(true);
    expect(countDue("month", "2026-11-07")).toBe(true);
    expect(countDue("month", "2026-11-14")).toBe(false);
    const sats = ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28", "2026-12-05", "2026-12-26", "2027-01-02"].map(d => countDue("fortnight", d));
    expect(sats.slice(0, 5)).toEqual([sats[0], !sats[0], sats[0], !sats[0], sats[0]]);
    expect(sats[6]).toBe(!sats[5]);
  });
});

describe("gasStats — le gaz du mois", () => {
  it("coût par ticket et par jour, durée moyenne d'une bouteille", async () => {
    const { gasStats } = await import("@/lib/restaurant-standing");
    const g = gasStats([{ startedAt: "2026-10-20T08:00:00Z" }, { startedAt: "2026-10-30T08:00:00Z" }, { startedAt: "2026-11-08T08:00:00Z" }], "2026-11", 39_000, 1_300, 26);
    expect(g.perTicket).toBe(30);
    expect(g.perDay).toBe(1500);
    expect(g.bottlesInMonth).toBe(1);
    expect(g.avgBottleDays).toBe(9.5);
  });
});
