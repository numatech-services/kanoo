import { workingDays, serviceMonths } from "@/lib/leaves";
import { computeInvoiceLines } from "@/lib/invoice-entry";
import { buildPurchaseLines, PurchaseError } from "@/lib/purchases";
import { receptionStatus } from "@/lib/commande";
import { ledgerFor } from "@/lib/treasury";
import { cleanItems } from "@/lib/payroll-run";
import { canPerformAction, rolesCanPerform } from "@/lib/role-resources";
import { NAV_RESOURCE } from "@/lib/nav-resources";
import { isCostCenter } from "@/lib/cost-centers";
import { EXPENSE_ACCOUNTS, SYSCOHADA_ACCOUNTS } from "@/lib/syscohada";

describe("Congés", () => {
  it("compte les jours ouvrables du lundi au samedi, demi-journées déduites", () => {
    // Lundi 5 → dimanche 11 octobre 2026 : 6 jours ouvrables.
    expect(workingDays(new Date(2026, 9, 5), new Date(2026, 9, 11))).toBe(6);
    expect(workingDays(new Date(2026, 9, 5), new Date(2026, 9, 6), true, false)).toBe(1.5);
    expect(workingDays(new Date(2026, 9, 11), new Date(2026, 9, 11))).toBe(0); // dimanche
    expect(workingDays(new Date(2026, 9, 7), new Date(2026, 9, 5))).toBe(0);
  });
  it("mesure l'ancienneté en mois complets (2,5 jours acquis par mois)", () => {
    expect(serviceMonths(new Date(2026, 0, 15), new Date(2026, 3, 14))).toBe(2);
    expect(serviceMonths(new Date(2026, 0, 15), new Date(2026, 3, 15))).toBe(3);
    expect(serviceMonths(new Date(2027, 0, 1), new Date(2026, 0, 1))).toBe(0);
  });
});

describe("Factures et devis — totaux serveur", () => {
  it("somme des lignes arrondies, TVA et droit de timbre", () => {
    const t = computeInvoiceLines([{ quantity: 3, unitPrice: 1000.4, tvaRate: 0.19 }, { quantity: 1, unitPrice: 500, tvaRate: 0, discount: 10 }]);
    expect(t.lines[0].totalHT).toBe(3001);
    expect(t.lines[1].totalHT).toBe(450);
    expect(t.totalHT).toBe(3451);
    expect(t.totalTTC).toBe(t.totalHT + t.totalTVA + t.totalDTS);
  });
});

describe("Achats — lignes contrôlées", () => {
  it("refuse un compte hors classes 6 / 2 et un montant nul", async () => {
    await expect(buildPurchaseLines("000000000000000000000000", [{ description: "Taxi", accountCode: "411000", amountHT: 1000 }])).rejects.toBeInstanceOf(PurchaseError);
    await expect(buildPurchaseLines("000000000000000000000000", [{ description: "Taxi", accountCode: "618000", amountHT: 0 }])).rejects.toBeInstanceOf(PurchaseError);
  });
  it("calcule HT, TVA et totaux ; libellé de compte par défaut", async () => {
    const b = await buildPurchaseLines("000000000000000000000000", [
      { description: "Ramettes", accountCode: "605500", quantity: 10, unitPrice: 3000, tvaRate: 0.19 },
      { description: "Ordinateur", accountCode: "244100", amountHT: 450000 },
    ]);
    expect(b.totalHT).toBe(480000);
    expect(b.totalTVA).toBe(5700);
    expect(b.lines[0].accountLabel).toBe("Fournitures de bureau");
    expect(b.totalTTC).toBe(485700);
  });
});

describe("Commandes — réception", () => {
  it("statut selon les quantités reçues", () => {
    expect(receptionStatus([{ quantity: 5, receivedQty: 0 }])).toBe("confirmed");
    expect(receptionStatus([{ quantity: 5, receivedQty: 2 }, { quantity: 1, receivedQty: 0 }])).toBe("partially_received");
    expect(receptionStatus([{ quantity: 5, receivedQty: 5 }, { quantity: 1, receivedQty: 1 }])).toBe("received");
  });
});

describe("Trésorerie — compte comptable réel", () => {
  it("banque 521, caisse 571, mobile money 5218", () => {
    expect(ledgerFor("bank")).toMatchObject({ accountCode: "521000", journalCode: "BQ" });
    expect(ledgerFor("cash")).toMatchObject({ accountCode: "571000", journalCode: "CA" });
    expect(ledgerFor("mobile_money").accountCode).toBe("521800");
  });
});

describe("Paie — primes et retenues saisies", () => {
  it("écarte les lignes vides ou négatives et normalise le sens", () => {
    expect(cleanItems([{ label: "Prime", amount: 10000 }, { label: "", amount: 5 }, { label: "Avance", amount: -3, type: "deduction" }, { label: "Avance", amount: 2000, type: "deduction" }]))
      .toEqual([{ label: "Prime", amount: 10000, type: "addition" }, { label: "Avance", amount: 2000, type: "deduction" }]);
  });
});

describe("Droits des nouveaux modules", () => {
  it("achats et plan comptable : gérant et comptabilité seulement", () => {
    expect(canPerformAction("pme_admin", "purchases", "delete")).toBe(true);
    expect(canPerformAction("svc_compta", "purchases", "create", undefined, "employe")).toBe(true);
    expect(canPerformAction("svc_compta", "purchases", "delete", undefined, "employe")).toBe(false);
    for (const r of ["svc_admin", "svc_comm", "svc_dev", "svc_prod", "svc_spot", "svc_secu", "svc_prosp"] as const) {
      expect(canPerformAction(r, "purchases", "read", undefined, "chef")).toBe(false);
      expect(canPerformAction(r, "ledgerAccounts", "read", undefined, "chef")).toBe(false);
    }
  });
  it("congés : chacun demande, le chef valide, l'employé non", () => {
    expect(canPerformAction("svc_dev", "leaves", "create", undefined, "stagiaire")).toBe(true);
    expect(canPerformAction("svc_dev", "leaves", "approve", undefined, "employe")).toBe(false);
    expect(canPerformAction("svc_dev", "leaves", "approve", undefined, "chef")).toBe(true);
    expect(rolesCanPerform(["svc_admin"], "leaves", "approve", undefined, { svc_admin: "chef" })).toBe(true);
    expect(canPerformAction("pme_admin", "leaves", "approve")).toBe(true);
  });
  it("les nouveaux écrans sont rattachés à leur droit", () => {
    expect(NAV_RESOURCE["/depenses"]).toBe("purchases");
    expect(NAV_RESOURCE["/conges"]).toBe("leaves");
    expect(NAV_RESOURCE["/accounting/plan"]).toBe("ledgerAccounts");
  });
});

describe("Référentiels", () => {
  it("services et plan SYSCOHADA cohérents", () => {
    expect(isCostCenter("compta")).toBe(true);
    expect(isCostCenter("inconnu")).toBe(false);
    expect(EXPENSE_ACCOUNTS.every(a => /^[26]/.test(a.code))).toBe(true);
    expect(new Set(SYSCOHADA_ACCOUNTS.map(a => a.code)).size).toBe(SYSCOHADA_ACCOUNTS.length);
  });
});
