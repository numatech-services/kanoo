import { USER_ROLES, type UserRole } from "@/types";
import { UserModel } from "@/models/User";
import { canPerformAction, getAccessibleResources } from "@/lib/role-resources";
import { ASSIGNABLE_BY_TENANT, ROLE_UI, assignableRoles } from "@/lib/roles-ui";
import { NAV_RESOURCE, resourceForHref } from "@/lib/nav-resources";
import { courrierReminderPlan, courrierReminderEmail } from "@/lib/courriers";
import { notificationHref } from "@/lib/notification-link";
import { parseAttachment, MAX_DATA_URI_LENGTH } from "@/lib/attachment";

/**
 * Câblage transversal : ces tests échouent si une liste de rôles, un droit ou
 * un lien de navigation diverge — la classe de bug « proposé à l'écran mais
 * refusé par l'API / la base ».
 */

describe("Rôles — source unique", () => {
  it("l'enum Mongoose (role et roles) est exactement USER_ROLES", () => {
    expect([...UserModel.schema.path("role").options.enum].sort()).toEqual([...USER_ROLES].sort());
    const rolesPath = UserModel.schema.path("roles") as unknown as { caster?: { options: { enum: string[] } }; options: { enum?: string[] } };
    const rolesEnum = rolesPath.caster?.options.enum ?? rolesPath.options.enum;
    expect([...(rolesEnum ?? [])].sort()).toEqual([...USER_ROLES].sort());
  });

  it("tout rôle proposé à l'écran existe et possède une description", () => {
    for (const roles of Object.values(ASSIGNABLE_BY_TENANT)) {
      for (const r of roles) {
        expect(USER_ROLES).toContain(r);
        expect(ROLE_UI[r]?.label).toBeTruthy();
      }
    }
  });

  it("une PME attribue le gérant et les services, plus les anciens rôles ni ceux d'un autre espace", () => {
    const pme = assignableRoles({ role: "pme_admin", tenantType: "pme" });
    expect(pme).toEqual(["pme_admin", "svc_admin", "svc_comm", "svc_prosp", "svc_dev", "svc_prod", "svc_spot", "svc_secu", "svc_compta"]);
    for (const legacy of ["pme_viewer", "pme_sales", "pme_isic_operator", "pme_activity_manager"]) expect(pme).not.toContain(legacy);
    expect(pme).not.toContain("admin_ordonnateur");
    expect(pme).not.toContain("superadmin");
    expect(assignableRoles({ role: "superadmin" })).toContain("superadmin");
    expect(assignableRoles({ role: "pme_admin", tenantType: "inconnu" })).toEqual([]);
  });
});

describe("RBAC — comptoir The Spot", () => {
  it("le gestionnaire dédié gère le comptoir et rien d'autre de la comptabilité", () => {
    const r = "pme_activity_manager" as UserRole;
    for (const a of ["create", "read", "update", "delete"] as const) expect(canPerformAction(r, "comptoir", a)).toBe(true);
    for (const res of ["invoices", "payments", "accountingEntries", "treasuryAccounts", "analytics", "payslips", "users"]) {
      expect(canPerformAction(r, res, "read")).toBe(false);
    }
  });

  it("le comptable principal et la direction supervisent aussi le comptoir", () => {
    for (const r of ["pme_admin", "pme_manager", "pme_accountant"] as UserRole[]) {
      expect(canPerformAction(r, "comptoir", "read")).toBe(true);
    }
    expect(canPerformAction("pme_sales" as UserRole, "comptoir", "read")).toBe(false);
  });
});

describe("RBAC — administrateurs d'organisation", () => {
  it("chaque administrateur d'organisation gère les comptes et la fiche organisation", () => {
    for (const r of ["pme_admin", "asso_president", "admin_ordonnateur"] as UserRole[]) {
      expect(canPerformAction(r, "users", "create")).toBe(true);
      expect(canPerformAction(r, "users", "update")).toBe(true);
      expect(canPerformAction(r, "companies", "update")).toBe(true);
    }
  });

  it("les rôles restreints ne voient pas les réglages d'organisation", () => {
    expect(canPerformAction("pme_activity_manager" as UserRole, "companies", "read")).toBe(false);
    expect(resourceForHref("/settings/numbering")).toBe("companies");
    expect(resourceForHref("/company/branding")).toBe("companies");
  });
});

describe("RBAC — stock", () => {
  it("Achats & stock crée les articles et fait les inventaires, sans pouvoir supprimer", () => {
    const r = "pme_purchases" as UserRole;
    for (const a of ["create", "read", "update"] as const) expect(canPerformAction(r, "products", a)).toBe(true);
    expect(canPerformAction(r, "products", "delete")).toBe(false);
  });

  it("le comptable consulte le stock sans pouvoir le modifier", () => {
    const r = "pme_accountant" as UserRole;
    expect(canPerformAction(r, "products", "read")).toBe(true);
    for (const a of ["create", "update", "delete"] as const) expect(canPerformAction(r, "products", a)).toBe(false);
  });
});

describe("Navigation — lien → ressource", () => {
  it("résout par plus long préfixe et ignore la requête", () => {
    expect(resourceForHref("/invoices/new")).toBe("invoices");
    expect(resourceForHref("/invoices?overdue=true")).toBe("invoices");
    expect(resourceForHref("/fiscalite/tva")).toBe("fiscalDeclarations");
    expect(resourceForHref("/documents-administratifs")).toBe("documents");
    expect(resourceForHref("/users/acces")).toBe("users");
    expect(resourceForHref("/agenda")).toBeUndefined();
    expect(resourceForHref("/settings/securite")).toBeUndefined();
  });

  it("chaque ressource de la table est accordée à au moins un rôle (pas de faute de frappe)", () => {
    const granted = new Set(USER_ROLES.filter(r => r !== "superadmin").flatMap(r => getAccessibleResources(r)));
    for (const res of new Set(Object.values(NAV_RESOURCE))) expect(granted).toContain(res);
  });
});

describe("Courriers — relances", () => {
  const now = new Date("2026-09-28T09:00:00Z");
  const day = 86_400_000;
  const base = { _id: "x", subject: "S", direction: "incoming" };

  it("classe en retard / bientôt, et ignore le reste", () => {
    const plan = courrierReminderPlan([
      { ...base, _id: "late", dueDate: new Date(now.getTime() - day) },
      { ...base, _id: "soon", dueDate: new Date(now.getTime() + day) },
      { ...base, _id: "far", dueDate: new Date(now.getTime() + 10 * day) },
      { ...base, _id: "handled", dueDate: new Date(now.getTime() - day), handled: true },
      { ...base, _id: "archived", dueDate: new Date(now.getTime() - day), archived: true },
      { ...base, _id: "outgoing", direction: "outgoing", dueDate: new Date(now.getTime() - day) },
      { ...base, _id: "nodate" },
    ], now);
    expect(plan.overdue.map(l => l._id)).toEqual(["late"]);
    expect(plan.dueSoon.map(l => l._id)).toEqual(["soon"]);
  });

  it("espace les relances de 3 jours", () => {
    const l = { ...base, dueDate: new Date(now.getTime() - 5 * day) };
    expect(courrierReminderPlan([{ ...l, lastReminderAt: new Date(now.getTime() - day) }], now).overdue).toHaveLength(0);
    expect(courrierReminderPlan([{ ...l, lastReminderAt: new Date(now.getTime() - 4 * day) }], now).overdue).toHaveLength(1);
  });

  it("l'e-mail récapitulatif échappe le HTML et pointe vers les courriers", () => {
    const mail = courrierReminderEmail("Awa", { overdue: [{ ...base, subject: "<script>", reference: "CR-2026-0001", dueDate: now }], dueSoon: [] }, "https://app.test/");
    expect(mail.subject).toMatch(/en retard/);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("https://app.test/courriers");
    expect(mail.text).toContain("CR-2026-0001");
  });
});

describe("Notifications — lien vers l'écran", () => {
  it("mène au bon écran selon le type", () => {
    expect(notificationHref({ type: "invoice_overdue", linkedId: "abc" })).toBe("/invoices/abc");
    expect(notificationHref({ type: "stock_alert", linkedTo: "comptoir" })).toBe("/comptoir");
    expect(notificationHref({ type: "stock_alert", linkedTo: "stock" })).toBe("/stock?alertOnly=true");
    expect(notificationHref({ type: "stock_alert", linkedTo: "stock_lots" })).toBe("/stock/lots");
    expect(notificationHref({ type: "courrier_due", linkedTo: "documents" })).toBe("/courriers");
    expect(notificationHref({ type: "inconnu" })).toBeNull();
  });
});

describe("Pièces jointes", () => {
  it("valide format et taille ; null retire la pièce", () => {
    expect(parseAttachment(null)).toEqual({ ok: true, value: null });
    expect(parseAttachment({ name: "a.pdf", dataUri: "data:application/pdf;base64,AAAA" }).ok).toBe(true);
    expect(parseAttachment({ dataUri: "https://ailleurs.test/x.pdf" }).ok).toBe(false);
    expect(parseAttachment({ dataUri: "data:x;base64," + "A".repeat(MAX_DATA_URI_LENGTH) }).ok).toBe(false);
    expect(parseAttachment("texte").ok).toBe(false);
  });
});
