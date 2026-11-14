import {
  reminderStep, normalizeRemindDays, nextOccurrence, dueWording, daysLeft, alertTone, checkAlertInput, parseAlertDate,
  parseRemindDays, isOwnKey, ALERT_CATEGORIES, alertReminderMessage, emailStep, alertReminderEmail,
} from "@/lib/alerts";
import { registrationDueDate, registrationFollowUp, registrationReminderText } from "@/lib/registration";
import { rolesCanPerform } from "@/lib/role-resources";

const at = (s: string) => new Date(`${s}T09:00:00`);

describe("Alertes — délais de prévenance", () => {
  it("normalise la saisie : entiers 0-365, sans doublon, du plus lointain au plus proche", () => {
    expect(normalizeRemindDays("1, 30 ;7 7 abc -2 400")).toEqual([30, 7, 1]);
    expect(normalizeRemindDays([0, 3])).toEqual([3, 0]);
    expect(normalizeRemindDays("")).toEqual([7, 1]);
    expect(normalizeRemindDays(undefined)).toEqual([7, 1]);
    expect(normalizeRemindDays([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(6);
  });
});

describe("Alertes — saisie stricte des délais", () => {
  it("refuse ce qui n'est pas un nombre de jours, au lieu de le remplacer en silence", () => {
    expect(parseRemindDays("30, 7, 1")).toEqual({ days: [30, 7, 1] });
    expect(parseRemindDays("")).toEqual({ days: [7, 1] });
    expect(parseRemindDays(undefined)).toEqual({ days: [7, 1] });
    expect(parseRemindDays("1 mois")).toHaveProperty("error");
    expect(parseRemindDays("quinze")).toHaveProperty("error");
    expect(parseRemindDays("400")).toHaveProperty("error");
    expect(parseRemindDays({})).toHaveProperty("error");
    expect(parseRemindDays("1,2,3,4,5,6,7")).toHaveProperty("error");
  });
});

describe("Alertes — messages", () => {
  it("l'intitulé figure dans le message : deux alertes le même jour ne se confondent pas", () => {
    const a = alertReminderMessage({ title: "Déclaration TVA", dueDate: parseAlertDate("2026-12-14")! }, 7);
    const b = alertReminderMessage({ title: "Acompte ISB", dueDate: parseAlertDate("2026-12-14")! }, 7);
    expect(a.message).not.toBe(b.message);
    expect(alertReminderMessage({ title: "X", dueDate: parseAlertDate("2026-12-14")! }, -2).title).toMatch(/^Alerte en retard/);
  });
  it("e-mail : premier rappel, jour J, premier retard seulement ; contenu échappé", () => {
    expect(emailStep("J-7", [7, 1])).toBe(true);
    expect(emailStep("J-1", [7, 1])).toBe(false);
    expect(emailStep("J0", [7, 1])).toBe(true);
    expect(emailStep("R0", [7, 1])).toBe(true);
    expect(emailStep("R1", [7, 1])).toBe(false);
    const m = alertReminderEmail("<b>", { title: "<script>", dueDate: parseAlertDate("2026-12-14")! }, 1, "https://x/alertes?alerte=1");
    expect(m.html).not.toMatch(/<script>|<b>/);
  });
});

describe("Enregistrement des marchés — échéance et suivi", () => {
  const now = new Date(2026, 10, 14, 9);
  it("fin de mois bornée : 31 janvier → 28 février (et non 3 mars)", () => {
    expect(registrationDueDate(new Date(2026, 0, 31))?.toDateString()).toBe(new Date(2026, 1, 28).toDateString());
    expect(registrationDueDate(null, new Date(2026, 7, 31))?.toDateString()).toBe(new Date(2026, 8, 30).toDateString());
  });
  it("marché seulement signé : suivi à partir de la signature", () => {
    const f = registrationFollowUp({ signedDate: new Date(2026, 10, 1) }, now);
    expect(f?.due.toDateString()).toBe(new Date(2026, 11, 1).toDateString());
    expect(f?.daysLeft).toBe(17);
  });
  it("acte payé : plus suivi, même si le timbre du PV de réception reste dû", () => {
    expect(registrationFollowUp({ signedDate: new Date(2025, 0, 10), registration: { assessedAt: new Date(2025, 0, 12), duty: 100000, stamp: 25000, paid: 125000 } }, now)).toBeNull();
  });
  it("acte constaté non payé : suivi, montant restant", () => {
    expect(registrationFollowUp({ approvalDate: new Date(2026, 9, 1), registration: { assessedAt: new Date(2026, 9, 2), duty: 100000, stamp: 25000, paid: 25000 } }, now)?.amount).toBe(100000);
  });
  it("quittance saisie : enregistré", () => {
    expect(registrationFollowUp({ signedDate: new Date(2026, 10, 1), registration: { number: "Q-12" } }, now)).toBeNull();
  });
  it("ancien marché jamais constaté dans Kanoo : réputé enregistré hors de Kanoo", () => {
    expect(registrationFollowUp({ signedDate: new Date(2024, 0, 1) }, now)).toBeNull();
  });
  it("message prudent, selon l'acheteur", () => {
    expect(registrationReminderText("state")).toMatch(/approbation du marché/);
    expect(registrationReminderText("private")).toMatch(/signature du contrat/);
    expect(registrationReminderText(undefined)).toMatch(/taux à confirmer/);
  });
});

describe("Alertes — étape de rappel", () => {
  const due = "2026-12-14";
  it("rien avant le premier délai", () => {
    expect(reminderStep(parseAlertDate(due)!, [7, 1], at("2026-12-01"))).toBeNull();
  });
  it("J-7 dès le 7e jour avant, rattrapé les jours suivants", () => {
    expect(reminderStep(parseAlertDate(due)!, [7, 1], at("2026-12-07"))).toEqual({ key: "J-7", left: 7 });
    expect(reminderStep(parseAlertDate(due)!, [7, 1], at("2026-12-09"))).toEqual({ key: "J-7", left: 5 });
  });
  it("J-1 la veille, J0 le jour même", () => {
    expect(reminderStep(parseAlertDate(due)!, [7, 1], at("2026-12-13"))?.key).toBe("J-1");
    expect(reminderStep(parseAlertDate(due)!, [7, 1], at("2026-12-14"))?.key).toBe("J0");
  });
  it("en retard : une étape par semaine", () => {
    expect(reminderStep(parseAlertDate(due)!, [7, 1], at("2026-12-15"))).toEqual({ key: "R0", left: -1 });
    expect(reminderStep(parseAlertDate(due)!, [7, 1], at("2026-12-21"))?.key).toBe("R0");
    expect(reminderStep(parseAlertDate(due)!, [7, 1], at("2026-12-22"))?.key).toBe("R1");
  });
  it("alerte créée tardivement : rappel immédiat au délai le plus proche atteint", () => {
    expect(reminderStep(parseAlertDate(due)!, [30, 7, 1], at("2026-12-11"))?.key).toBe("J-7");
  });
});

describe("Alertes — dates", () => {
  it("une date saisie reste le même jour quel que soit le fuseau (midi)", () => {
    const d = parseAlertDate("2026-12-14")!;
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(12);
    expect(parseAlertDate("n'importe quoi")).toBeNull();
    expect(parseAlertDate("")).toBeNull();
    // Dates impossibles et valeurs qui ne sont pas des dates : refusées.
    expect(parseAlertDate("2026-02-30")).toBeNull();
    expect(parseAlertDate("2026-02-29")).toBeNull();
    expect(parseAlertDate("2028-02-29")?.getDate()).toBe(29);
    expect(parseAlertDate(0)).toBeNull();
    expect(parseAlertDate("1")).toBeNull();
    expect(parseAlertDate([2026, 12, 14])).toBeNull();
    expect(parseAlertDate("Dec 14 2026")).toBeNull();
    // Heure ISO : seul le jour compte, quel que soit le fuseau du serveur.
    expect(parseAlertDate("2026-12-14T23:30:00Z")?.getDate()).toBe(14);
    expect(parseAlertDate("2026-12-14T00:00:00Z")?.getDate()).toBe(14);
  });
  it("jours restants et libellés", () => {
    expect(daysLeft(parseAlertDate("2026-12-14")!, at("2026-12-14"))).toBe(0);
    expect(dueWording(0)).toBe("aujourd'hui");
    expect(dueWording(1)).toBe("demain");
    expect(dueWording(5)).toBe("dans 5 jours");
    expect(dueWording(-1)).toBe("en retard d'un jour");
    expect(dueWording(-3)).toBe("en retard de 3 jours");
    expect(alertTone(-2)).toBe("neg");
    expect(alertTone(5)).toBe("warn");
    expect(alertTone(20)).toBe("info");
  });
  it("occurrence suivante : fin de mois conservée, pas de débordement", () => {
    expect(nextOccurrence(new Date(2026, 0, 31, 12), "monthly")?.toDateString()).toBe(new Date(2026, 1, 28).toDateString());
    expect(nextOccurrence(new Date(2026, 10, 15, 12), "quarterly")?.toDateString()).toBe(new Date(2027, 1, 15).toDateString());
    expect(nextOccurrence(new Date(2028, 1, 29, 12), "yearly")?.toDateString()).toBe(new Date(2029, 1, 28).toDateString());
    expect(nextOccurrence(new Date(2026, 0, 31), "none")).toBeNull();
    // Quantième d'origine : pas de dérive 31 → 28 → 28.
    expect(nextOccurrence(new Date(2026, 1, 28, 12), "monthly", 31)?.getDate()).toBe(31);
    expect(nextOccurrence("zzz", "monthly")).toBeNull();
  });
  it("contrôle de saisie", () => {
    expect(checkAlertInput({ title: "", dueDate: "2026-12-14" })).toMatch(/intitulé/);
    expect(checkAlertInput({ title: "Bail", dueDate: "" })).toMatch(/échéance/);
    expect(checkAlertInput({ title: "Bail", dueDate: "1890-01-01" })).toMatch(/invalide/);
    expect(checkAlertInput({ title: "Bail", dueDate: "2026-12-14", category: "inconnue" })).toMatch(/Catégorie/);
    expect(checkAlertInput({ title: "Bail", dueDate: "2026-12-14", repeat: "weekly" })).toMatch(/Périodicité/);
    expect(checkAlertInput({ title: "Bail", dueDate: "2026-12-14", category: "contrat", repeat: "yearly" })).toBeNull();
    // Noms hérités d'un objet JavaScript : ni catégorie ni périodicité.
    expect(checkAlertInput({ title: "Bail", dueDate: "2026-12-14", category: "constructor" })).toMatch(/Catégorie/);
    expect(checkAlertInput({ title: "Bail", dueDate: "2026-12-14", repeat: "toString" })).toMatch(/Périodicité/);
    expect(isOwnKey(ALERT_CATEGORIES, "__proto__")).toBe(false);
    // Intitulé : une chaîne.
    expect(checkAlertInput({ title: {} as unknown as string, dueDate: "2026-12-14" })).toMatch(/intitulé/);
    expect(checkAlertInput({ title: null, dueDate: "2026-12-14" })).toMatch(/intitulé/);
  });
});

describe("Alertes — droits", () => {
  it("direction, comptabilité et administration créent ; les autres lisent et marquent traitées", () => {
    for (const r of ["pme_admin", "pme_accountant", "pme_manager", "asso_president", "admin_ordonnateur"] as const) {
      expect(rolesCanPerform([r], "alerts", "create")).toBe(true);
    }
    expect(rolesCanPerform(["pme_sales"], "alerts", "create")).toBe(false);
    expect(rolesCanPerform(["pme_sales"], "alerts", "read")).toBe(true);
    expect(rolesCanPerform(["pme_sales"], "alerts", "update")).toBe(true);
    // Comptable employée : gère les alertes ; stagiaire : seulement les siennes.
    expect(rolesCanPerform(["svc_compta"], "alerts", "create", undefined, { svc_compta: "employe" })).toBe(true);
    expect(rolesCanPerform(["svc_compta"], "alerts", "create", undefined, { svc_compta: "chef" })).toBe(true);
    expect(rolesCanPerform(["svc_compta"], "alerts", "create", undefined, { svc_compta: "stagiaire" })).toBe(false);
    expect(rolesCanPerform(["svc_compta"], "alerts", "read", undefined, { svc_compta: "stagiaire" })).toBe(true);
    // Administration : le chef seulement.
    expect(rolesCanPerform(["svc_admin"], "alerts", "create", undefined, { svc_admin: "chef" })).toBe(true);
    expect(rolesCanPerform(["svc_admin"], "alerts", "create", undefined, { svc_admin: "employe" })).toBe(false);
    // Liste d'accès individuelle : elle restreint.
    expect(rolesCanPerform(["pme_accountant"], "alerts", "create", ["invoices"])).toBe(false);
  });
});
