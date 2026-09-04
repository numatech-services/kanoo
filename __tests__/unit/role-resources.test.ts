import { canPerformAction } from "@/lib/role-resources";
import type { UserRole } from "@/types";

describe("RBAC — module Activités (events)", () => {
  it("les rôles de gestion peuvent créer/modifier/supprimer", () => {
    for (const r of ["pme_admin", "pme_manager", "asso_president", "admin_ordonnateur"] as UserRole[]) {
      expect(canPerformAction(r, "events", "create")).toBe(true);
      expect(canPerformAction(r, "events", "update")).toBe(true);
      expect(canPerformAction(r, "events", "delete")).toBe(true);
    }
  });

  it("les rôles en lecture voient sans pouvoir modifier", () => {
    expect(canPerformAction("pme_viewer" as UserRole, "events", "read")).toBe(true);
    expect(canPerformAction("pme_viewer" as UserRole, "events", "create")).toBe(false);
    expect(canPerformAction("admin_viewer" as UserRole, "events", "update")).toBe(false);
  });

  it("superadmin peut tout", () => {
    expect(canPerformAction("superadmin" as UserRole, "events", "delete")).toBe(true);
  });

  it("refuse une ressource inconnue (défaut = refus)", () => {
    expect(canPerformAction("pme_admin" as UserRole, "ressource_inexistante", "read")).toBe(false);
  });
});

import {
  rolesCanPerform, rolesCanAccess, effectiveRoles, accessibleResourcesForRoles,
} from "@/lib/role-resources";

describe("Multi-rôle — union des permissions", () => {
  const accountant = "pme_accountant" as UserRole;
  const hr = "pme_hr" as UserRole;
  const viewer = "pme_viewer" as UserRole;

  it("autorise si AU MOINS UN rôle le permet", () => {
    // Le comptable gère la trésorerie ; le RH gère la paie. Cumulés, la
    // personne a les deux — ce qu'aucun rôle seul ne donne.
    expect(rolesCanPerform([accountant, hr], "treasuryAccounts", "read")).toBe(true);
    expect(rolesCanPerform([accountant, hr], "payslips", "read")).toBe(true);
  });

  it("refuse si AUCUN rôle ne le permet", () => {
    // Ni comptable ni RH ne créent d'utilisateurs (réservé à l'admin).
    expect(rolesCanPerform([accountant, hr], "users", "create")).toBe(false);
  });

  it("un rôle en lecture seule n'élargit pas les droits des autres", () => {
    // viewer ne donne que de la lecture ; il ne retire rien au comptable.
    expect(rolesCanPerform([accountant, viewer], "treasuryAccounts", "read")).toBe(true);
    expect(rolesCanPerform([viewer], "treasuryAccounts", "update")).toBe(false);
  });

  it("effectiveRoles retombe sur [role] pour un compte mono-rôle (rétrocompat)", () => {
    expect(effectiveRoles(accountant, undefined)).toEqual([accountant]);
    expect(effectiveRoles(accountant, [])).toEqual([accountant]);
    expect(effectiveRoles(accountant, [hr, viewer])).toEqual([hr, viewer]);
  });

  it("l'union par un seul rôle donne exactement le même résultat qu'avant", () => {
    // Garantie de non-régression : rolesCanPerform([r]) === canPerformAction(r).
    for (const resource of ["treasuryAccounts", "payslips", "invoices", "users"]) {
      for (const action of ["read", "create", "update", "delete"] as const) {
        expect(rolesCanPerform([accountant], resource, action))
          .toBe(canPerformAction(accountant, resource, action));
      }
    }
  });

  it("superadmin dans l'union donne tous les droits", () => {
    expect(rolesCanPerform([viewer, "superadmin" as UserRole], "users", "delete")).toBe(true);
    expect(accessibleResourcesForRoles(["superadmin" as UserRole])).toEqual(["*"]);
  });

  it("rolesCanAccess suit la même union", () => {
    expect(rolesCanAccess([accountant, hr], "payslips")).toBe(true);
    expect(rolesCanAccess([viewer], "users")).toBe(false);
  });

  it("accessibleResourcesForRoles fait bien l'union des ressources", () => {
    const union = accessibleResourcesForRoles([accountant, hr]);
    const soloAcc = accessibleResourcesForRoles([accountant]);
    // L'union contient au moins tout ce que le comptable seul voit, et plus.
    for (const r of soloAcc) expect(union).toContain(r);
    expect(union.length).toBeGreaterThanOrEqual(soloAcc.length);
  });
});
