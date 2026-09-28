/**
 * Agenda — portée de visibilité et accès universel à la ressource.
 */
import { visibleFilter } from "@/lib/agenda";
import { canPerformAction } from "@/lib/role-resources";
import { TokenPayload } from "@/lib/auth";

const OID = "5f9f1b9b9b9b9b9b9b9b9b9b";
const OID2 = "5f9f1b9b9b9b9b9b9b9b9bcc";

function auth(over: Partial<TokenPayload> = {}): TokenPayload {
  return {
    userId: OID, tenantId: OID2, tenantType: "pme", role: "pme_viewer",
    roles: ["pme_viewer"], email: "u@x.ne", subscriptionStatus: "active",
    planModules: ["*"], sessionVersion: 1,
    ...over,
  } as TokenPayload;
}

describe("Agenda — visibilité", () => {
  it("laisse voir : partagés, ses propres entrées, celles où l'on est convié", () => {
    const f = visibleFilter(auth()) as { $or: Array<Record<string, unknown>>; tenantId: unknown };
    expect(f.tenantId).toBeDefined();
    const kinds = f.$or.map((c) => Object.keys(c)[0]);
    expect(kinds).toEqual(expect.arrayContaining(["visibility", "ownerId", "participants"]));
    // La branche « partagé » ne dépend pas de l'utilisateur.
    expect(f.$or).toContainEqual({ visibility: "shared" });
  });

  it("porte le tenant de l'utilisateur", () => {
    const f = visibleFilter(auth()) as { tenantId: { toString(): string } };
    expect(f.tenantId.toString()).toBe(OID2);
  });
});

describe("Agenda — accès universel", () => {
  it("est accordé à un rôle restreint (pme_viewer) en création", () => {
    expect(canPerformAction("pme_viewer", "agenda", "create")).toBe(true);
    expect(canPerformAction("pme_viewer", "agenda", "read")).toBe(true);
  });

  it("est accordé côté association et administration", () => {
    expect(canPerformAction("asso_member_portal", "agenda", "create")).toBe(true);
    expect(canPerformAction("admin_viewer", "agenda", "update")).toBe(true);
  });
});

describe("Ressources universelles — messagerie & ISIC", () => {
  it("la messagerie est accordée à tous les rôles", () => {
    expect(canPerformAction("pme_viewer", "messages", "read")).toBe(true);
    expect(canPerformAction("pme_viewer", "messages", "create")).toBe(true);
  });
  it("le module ISIC est accordé", () => {
    expect(canPerformAction("pme_sales", "isic", "create")).toBe(true);
    expect(canPerformAction("pme_admin", "isic", "delete")).toBe(true);
  });
});
