import { canPerformAction, SERVICE_ROLES } from "@/lib/role-resources";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { resourceForHref } from "@/lib/nav-resources";
import type { UserRole } from "@/types";

const LEVELS = ["chef", "employe", "stagiaire"] as const;

describe("Cloisonnement : droits universels", () => {
  it("chaque rôle de service, à chaque niveau, lit et marque ses notifications", () => {
    for (const r of SERVICE_ROLES) for (const l of LEVELS) {
      expect(canPerformAction(r as UserRole, "notifications", "read", undefined, l)).toBe(true);
      expect(canPerformAction(r as UserRole, "notifications", "update", undefined, l)).toBe(true);
    }
  });
  it("tout le monde peut ouvrir un ticket d'assistance et joindre des pièces (contrôle par document)", () => {
    for (const r of [...SERVICE_ROLES, "pme_viewer", "pme_isic_operator"] as UserRole[]) {
      expect(canPerformAction(r, "supportTickets", "create", undefined, "stagiaire")).toBe(true);
      expect(canPerformAction(r, "attachments", "create", undefined, "stagiaire")).toBe(true);
    }
  });
});

describe("Cloisonnement : congés et notes de frais", () => {
  it("le chef comptable valide les congés de son équipe ; l'employé non", () => {
    expect(canPerformAction("svc_compta", "leaves", "approve", undefined, "chef")).toBe(true);
    expect(canPerformAction("svc_compta", "leaves", "approve", undefined, "employe")).toBe(false);
  });
  it("les RH gèrent les congés", () => {
    expect(canPerformAction("pme_hr", "leaves", "approve")).toBe(true);
  });
  it("un employé de service crée sa note de frais sans pouvoir la valider", () => {
    expect(canPerformAction("svc_comm", "expenses", "create", undefined, "employe")).toBe(true);
    expect(canPerformAction("svc_comm", "expenses", "approve", undefined, "employe")).toBe(false);
    expect(canPerformAction("svc_comm", "expenses", "approve", undefined, "chef")).toBe(true);
  });
});

describe("Cloisonnement : administration publique", () => {
  it("le comptable public mandate, le DAF ne fait que consulter les engagements", () => {
    expect(canPerformAction("admin_public_accountant", "paymentOrders", "create")).toBe(true);
    expect(canPerformAction("admin_daf", "commitmentOrders", "create")).toBe(false);
  });
  it("les écrans d'engagement et de mandatement suivent ces droits", () => {
    expect(resourceForHref("/administration/budget/engagements")).toBe("commitmentOrders");
    expect(resourceForHref("/administration/budget/mandatements/new")).toBe("paymentOrders");
  });
});

describe("Cloisonnement : administrateurs multi-rôles", () => {
  it("un gérant reste administrateur même si « gérant » n'est pas son premier rôle", () => {
    expect(hasTenantAdminRole({ role: "svc_compta", roles: ["svc_compta", "pme_admin"] })).toBe(true);
    expect(hasTenantAdminRole({ role: "svc_compta", roles: ["svc_compta"] })).toBe(false);
  });
  it("le portefeuille d'abonnements (marges) est un écran financier", () => {
    expect(resourceForHref("/abonnements")).toBe("accountingEntries");
    expect(resourceForHref("/abonnements/reventes")).toBe("subscriptions");
  });
});
