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
