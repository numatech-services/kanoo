import type { UserRole } from "@/types";
import {
  canPerformAction, rolesCanPerform, accessibleResourcesForRoles, authCan, hasFinanceAccess,
  isInternFor, bestLevelFor, SERVICE_ROLES, type RoleLevel,
} from "@/lib/role-resources";
import { ROLE_UI, ASSIGNABLE_BY_TENANT } from "@/lib/roles-ui";
import { maskPayroll, maskMoney, stripPayrollWrites } from "@/lib/payroll-mask";
import { deskScope } from "@/lib/comptoir";
import { expenseAuthority, canReimburse } from "@/lib/expense-scope";
import { toLevels } from "@/lib/session";
import type { TokenPayload } from "@/lib/auth";

/**
 * Organisation cloisonnée de Numatech : 8 services + gérant, 3 niveaux.
 * Règle de base : seuls le gérant et la comptabilité voient les finances.
 */
const FINANCE = ["invoices", "payments", "treasuryAccounts", "accountingEntries", "fiscalDeclarations",
  "fixedAssets", "recurringCharges", "payslips", "analytics", "isicFinance"];
const auth = (roles: string[], roleLevels: Record<string, RoleLevel> = {}, extra: Partial<TokenPayload> = {}) =>
  ({ userId: "u1", tenantId: "t1", tenantType: "pme", role: roles[0], roles, roleLevels, email: "x@y.ne",
    subscriptionStatus: "active", planModules: [], ...extra }) as unknown as TokenPayload;

describe("Organisation — cloisonnement des finances", () => {
  it("aucun service autre que la comptabilité ne voit une information financière, à aucun niveau", () => {
    for (const svc of SERVICE_ROLES.filter(r => r !== "svc_compta")) {
      for (const lvl of ["chef", "employe", "stagiaire"] as RoleLevel[]) {
        const res = accessibleResourcesForRoles([svc as UserRole], undefined, { [svc]: lvl });
        const leak = res.filter(r => FINANCE.includes(r));
        expect({ svc, lvl, leak }).toEqual({ svc, lvl, leak: [] });
      }
    }
  });

  it("la comptabilité voit les finances ; la paie est réservée au chef comptable", () => {
    expect(hasFinanceAccess(auth(["svc_compta"], { svc_compta: "employe" }))).toBe(true);
    expect(authCan(auth(["svc_compta"], { svc_compta: "employe" }), "payslips")).toBe(false);
    expect(authCan(auth(["svc_compta"], { svc_compta: "stagiaire" }), "payslips")).toBe(false);
    expect(authCan(auth(["svc_compta"], { svc_compta: "chef" }), "payslips")).toBe(true);
    expect(authCan(auth(["pme_admin"]), "payslips")).toBe(true);
  });

  it("seule la comptabilité (et le gérant) émet les factures", () => {
    for (const svc of SERVICE_ROLES) {
      expect({ svc, can: canPerformAction(svc as UserRole, "invoices", "create", undefined, "chef") })
        .toEqual({ svc, can: svc === "svc_compta" });
    }
  });
});

describe("Organisation — niveaux", () => {
  it("l'employé ne supprime pas, le chef oui ; le stagiaire ne valide pas", () => {
    expect(canPerformAction("svc_admin", "clients", "delete", undefined, "employe")).toBe(false);
    expect(canPerformAction("svc_admin", "clients", "delete", undefined, "chef")).toBe(true);
    expect(canPerformAction("svc_admin", "clients", "create", undefined, "stagiaire")).toBe(true);
    expect(canPerformAction("svc_comm", "expenses", "approve", undefined, "chef")).toBe(true);
    expect(canPerformAction("svc_comm", "expenses", "approve", undefined, "employe")).toBe(false);
  });

  it("le comptable (employé) garde le remboursement des notes de frais", () => {
    expect(canPerformAction("svc_compta", "expenses", "approve", undefined, "employe")).toBe(true);
    expect(canPerformAction("svc_compta", "expenses", "approve", undefined, "stagiaire")).toBe(false);
  });

  it("cumul : le niveau se règle par service", () => {
    const levels = { svc_comm: "chef", svc_dev: "stagiaire" } as Record<string, RoleLevel>;
    const roles = ["svc_comm", "svc_dev"] as UserRole[];
    expect(rolesCanPerform(roles, "projects", "delete", undefined, levels)).toBe(true);  // via Communication (chef)
    expect(rolesCanPerform(roles, "supportTickets", "delete", undefined, levels)).toBe(false); // Développement (stagiaire) seulement
    expect(bestLevelFor(roles, "projects", "read", undefined, levels)).toBe("chef");
    expect(bestLevelFor(roles, "subscriptions", "read", undefined, levels)).toBe("stagiaire"); // seul le Développement les voit
  });

  it("un stagiaire ne peut pas exporter ; un employé si", () => {
    expect(isInternFor(auth(["svc_prod"], { svc_prod: "stagiaire" }), "isic")).toBe(true);
    expect(isInternFor(auth(["svc_prod"], { svc_prod: "employe" }), "isic")).toBe(false);
    expect(isInternFor(auth(["svc_prod", "pme_admin"], { svc_prod: "stagiaire" }), "isic")).toBe(false);
  });

  it("les niveaux lus en base ignorent les valeurs inconnues", () => {
    expect(toLevels(new Map([["svc_comm", "chef"], ["svc_dev", "patron"]]))).toEqual({ svc_comm: "chef" });
    expect(toLevels(undefined)).toBeUndefined();
  });
});

describe("Organisation — services", () => {
  it("chaque service a une description et figure dans les rôles attribuables d'une PME", () => {
    for (const svc of SERVICE_ROLES) {
      expect(ROLE_UI[svc]?.label).toBeTruthy();
      expect(ASSIGNABLE_BY_TENANT.pme).toContain(svc);
    }
    expect(ROLE_UI.pme_admin?.label).toBe("Gérant");
  });

  it("la Sécurité contrôle les entrées sans pouvoir modifier les événements", () => {
    expect(canPerformAction("svc_secu", "eventCheckin", "update", undefined, "employe")).toBe(true);
    expect(canPerformAction("svc_secu", "events", "update", undefined, "chef")).toBe(false);
    const res = accessibleResourcesForRoles(["svc_secu"], undefined, { svc_secu: "chef" });
    for (const r of ["clients", "devis", "products", "comptoir", "isic"]) expect(res).not.toContain(r);
    // Ceux qui géraient déjà les événements gardent le contrôle d'entrée.
    expect(canPerformAction("svc_comm", "eventCheckin", "update", undefined, "employe")).toBe(true);
    expect(canPerformAction("pme_admin", "eventCheckin", "update")).toBe(true);
  });

  it("la Prospection gère prospects, devis et appels d'offres", () => {
    for (const r of ["clients", "devis", "appels"]) expect(canPerformAction("svc_prosp", r, "create", undefined, "employe")).toBe(true);
    expect(canPerformAction("svc_prosp", "products", "read", undefined, "chef")).toBe(false);
  });

  it("Production & Cartes gère ISIC sans voir les coûts ; l'Administration n'a plus ISIC", () => {
    expect(canPerformAction("svc_prod", "isic", "update", undefined, "employe")).toBe(true);
    expect(canPerformAction("svc_prod", "isicFinance", "read", undefined, "chef")).toBe(false);
    expect(canPerformAction("svc_admin", "isic", "read", undefined, "chef")).toBe(false);
  });
});

describe("Organisation — données masquées et périmètres", () => {
  it("salaires masqués hors paie, et non modifiables", () => {
    const emp = { firstName: "A", grossSalary: 250000, bankAccount: "NE01", position: "Agent" };
    expect(maskPayroll(emp, auth(["svc_admin"], { svc_admin: "chef" }))).toMatchObject({ firstName: "A", position: "Agent", payrollHidden: true });
    expect(maskPayroll(emp, auth(["svc_admin"], { svc_admin: "chef" }))).not.toHaveProperty("grossSalary");
    expect(maskPayroll(emp, auth(["svc_compta"], { svc_compta: "chef" }))).toHaveProperty("grossSalary", 250000);
    expect(stripPayrollWrites({ grossSalary: 1, position: "x" }, auth(["svc_admin"]))).toEqual({ position: "x" });
  });

  it("montants d'abonnements masqués hors finances", () => {
    const doc = { name: "Licence", costAmount: 100, unitPrice: 150, withholdingAmount: 5, endDate: "2026" };
    expect(maskMoney(doc, auth(["svc_dev"], { svc_dev: "chef" }))).toEqual({ name: "Licence", endDate: "2026", amountsHidden: true });
    expect(maskMoney(doc, auth(["svc_compta"]))).toEqual(doc);
  });

  it("The Spot : l'employé est limité à ses sites, le chef et la comptabilité voient tout", () => {
    expect(deskScope(auth(["svc_spot"], { svc_spot: "employe" }, { siteIds: ["a", "b"] }))).toEqual(["a", "b"]);
    expect(deskScope(auth(["svc_spot"], { svc_spot: "stagiaire" }))).toEqual([]);
    expect(deskScope(auth(["svc_spot"], { svc_spot: "chef" }))).toBeNull();
    // Le niveau donne les droits, les sites attribués le périmètre : un chef affecté reste sur ses sites.
    expect(deskScope(auth(["svc_spot"], { svc_spot: "chef" }, { siteIds: ["a"] }))).toEqual(["a"]);
    expect(deskScope(auth(["svc_compta"]))).toBeNull();
    expect(deskScope(auth(["svc_spot", "pme_admin"], { svc_spot: "employe" }, { siteIds: ["a"] }))).toBeNull();
  });

  it("notes de frais : chef = son équipe, comptabilité = toutes et rembourse", () => {
    expect(expenseAuthority(auth(["svc_comm"], { svc_comm: "chef" }))).toEqual({ kind: "team", services: ["svc_comm"] });
    expect(expenseAuthority(auth(["svc_comm"], { svc_comm: "employe" }))).toEqual({ kind: "own" });
    expect(expenseAuthority(auth(["svc_compta"], { svc_compta: "employe" }))).toEqual({ kind: "all" });
    expect(canReimburse(auth(["svc_comm"], { svc_comm: "chef" }))).toBe(false);
    expect(canReimburse(auth(["svc_compta"], { svc_compta: "employe" }))).toBe(true);
  });
});
