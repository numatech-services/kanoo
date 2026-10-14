/**
 * Moteur de relance.
 *
 * Les cas testés ici sont ceux qui coûtent un client quand ils passent : une
 * relance sur une facture déjà créditée, cinq messages en dix jours après
 * l'activation, une mise en demeure partie toute seule.
 */

import {
  DEFAULT_DUNNING_SETTINGS, DEFAULT_DUNNING_STEPS,
  outstandingAmount, daysPastDue, daysBetween, dueStep, supersededSteps,
  isSendDay, planRun, agingBuckets, averagePaymentDelay,
  composeSubject, composeBody, composeSms,
  type DunningSettings, type InvoiceLike, type ClientLike, type DunningHistoryEntry,
} from "@/lib/dunning";

/** fr-FR sépare les milliers par une espace fine insécable (U+202F). */
const flat = (s: string) => s.replace(/[\s\u202f\u00a0]+/g, " ");


const CLIENT: ClientLike = { _id: "c1", name: "SONIDEP", email: "compta@sonidep.ne", phone: "+22790000000" };
const CLIENTS = new Map<string, ClientLike>([["c1", CLIENT]]);

/** Un lundi, pour que le jour d'envoi ne soit jamais la variable testée. */
const MONDAY = new Date("2026-09-07T09:00:00");

function invoice(over: Partial<InvoiceLike> = {}): InvoiceLike {
  return {
    _id: "i1", number: "FA-2026-0001", totalTTC: 1_200_000, paidAmount: 0,
    status: "sent", documentType: "invoice", clientId: "c1",
    dueDate: new Date("2026-09-01T00:00:00"), ...over,
  };
}

function settings(over: Partial<DunningSettings> = {}): DunningSettings {
  return { ...DEFAULT_DUNNING_SETTINGS, enabled: true, ...over };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Restant dû", () => {
  it("retranche les règlements", () => {
    expect(outstandingAmount(invoice({ paidAmount: 200_000 }))).toBe(1_000_000);
  });

  it("retranche les avoirs — c'est la faute qui coûte le plus cher", () => {
    expect(outstandingAmount(invoice({ paidAmount: 200_000, creditedAmount: 1_000_000 }))).toBe(0);
  });

  it("ne descend jamais sous zéro", () => {
    expect(outstandingAmount(invoice({ paidAmount: 2_000_000 }))).toBe(0);
  });
});

describe("Comptage des jours", () => {
  it("compte en jours calendaires, pas en heures", () => {
    expect(daysBetween(new Date("2026-09-01T23:30:00"), new Date("2026-09-02T00:30:00"))).toBe(1);
  });

  it("rend un retard positif et une échéance à venir négative", () => {
    expect(daysPastDue(invoice(), MONDAY)).toBe(6);
    expect(daysPastDue(invoice({ dueDate: new Date("2026-09-20") }), MONDAY)).toBe(-13);
  });
});

describe("Choix de l'étape", () => {
  it("retient l'étape la plus avancée parmi celles échues", () => {
    // J+30 : les étapes -3, +3, +10 et +21 sont toutes échues.
    const chosen = dueStep(invoice(), settings(), new Set(),
      new Date("2026-10-01T09:00:00"));
    expect(chosen?.step.label).toBe("Relance ferme à J+21");
  });

  it("ne renvoie rien avant la première étape", () => {
    const chosen = dueStep(invoice({ dueDate: new Date("2026-09-30") }), settings(), new Set(), MONDAY);
    expect(chosen).toBeNull();
  });

  it("part avant l'échéance sur le rappel de courtoisie", () => {
    const chosen = dueStep(invoice({ dueDate: new Date("2026-09-09") }), settings(), new Set(), MONDAY);
    expect(chosen?.step.tone).toBe("courtesy");
  });

  it("ne renvoie rien si l'étape due est déjà partie", () => {
    expect(dueStep(invoice(), settings(), new Set([1]), MONDAY)).toBeNull();
  });

  it("marque comme dépassées les étapes antérieures non envoyées", () => {
    // Étape 3 (J+21) choisie : 0, 1 et 2 ne partiront jamais.
    expect(supersededSteps(settings(), 3, new Set()).sort()).toEqual([0, 1, 2]);
  });

  it("ne redéclare pas dépassée une étape déjà envoyée", () => {
    expect(supersededSteps(settings(), 3, new Set([0, 1])).sort()).toEqual([2]);
  });

  it("ne considère pas comme dépassée une étape postérieure", () => {
    expect(supersededSteps(settings(), 1, new Set())).toEqual([0]);
  });
});

describe("Jours d'envoi", () => {
  it("refuse le samedi quand le barème s'arrête au jeudi", () => {
    expect(isSendDay(settings(), new Date("2026-09-12T09:00:00"))).toBe(false); // samedi
  });

  it("accepte tous les jours quand la liste est vide", () => {
    expect(isSendDay(settings({ sendDays: [] }), new Date("2026-09-13T09:00:00"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Plan d'exécution", () => {
  it("ne planifie rien quand le module est désactivé, et le dit", () => {
    const plan = planRun([invoice()], CLIENTS, settings({ enabled: false }), [], MONDAY);
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("disabled");
  });

  it("relance une facture échue", () => {
    const plan = planRun([invoice()], CLIENTS, settings(), [], MONDAY);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].step.label).toBe("Relance à J+3");
    expect(plan.actions[0].outstanding).toBe(1_200_000);
    expect(plan.targetedAmount).toBe(1_200_000);
  });

  it("ne relance jamais un avoir", () => {
    const plan = planRun([invoice({ documentType: "credit_note" })], CLIENTS, settings(), [], MONDAY);
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("not_an_invoice");
  });

  it("ne relance ni un brouillon ni une facture annulée", () => {
    const plan = planRun(
      [invoice({ _id: "a", status: "draft" }), invoice({ _id: "b", status: "cancelled" })],
      CLIENTS, settings(), [], MONDAY
    );
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped.map(s => s.reason)).toEqual(["draft_or_cancelled", "draft_or_cancelled"]);
  });

  it("ne relance pas une facture soldée par un avoir", () => {
    const plan = planRun([invoice({ creditedAmount: 1_200_000 })], CLIENTS, settings(), [], MONDAY);
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("settled");
  });

  it("laisse passer les montants sous le seuil, avec le montant dans le motif", () => {
    const plan = planRun([invoice({ totalTTC: 3_000 })], CLIENTS, settings(), [], MONDAY);
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("below_min_amount");
    expect(flat(plan.skipped[0].message)).toContain("3 000 FCFA, sous le seuil de 5 000");
  });

  it("suspend la relance d'une facture en litige", () => {
    const plan = planRun([invoice({ disputedAt: new Date("2026-09-04") })], CLIENTS, settings(), [], MONDAY);
    expect(plan.skipped[0].reason).toBe("disputed");
  });

  it("relance quand même un litige si le paramètre le dit", () => {
    const plan = planRun(
      [invoice({ disputedAt: new Date("2026-09-04") })], CLIENTS,
      settings({ respectDisputes: false }), [], MONDAY
    );
    expect(plan.actions).toHaveLength(1);
  });

  it("n'envoie pas deux fois la même étape", () => {
    const history: DunningHistoryEntry[] = [
      { invoiceId: "i1", stepIndex: 1, sentAt: new Date("2026-09-04") },
    ];
    const plan = planRun([invoice()], CLIENTS, settings(), history, MONDAY);
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("already_sent");
  });

  it("respecte l'intervalle minimum même si une étape plus avancée devient due", () => {
    // Étape 2 (J+10) due au 11/09, mais l'étape 1 est partie le 09/09.
    const history: DunningHistoryEntry[] = [
      { invoiceId: "i1", stepIndex: 1, sentAt: new Date("2026-09-09") },
    ];
    const plan = planRun([invoice()], CLIENTS, settings(), history,
      new Date("2026-09-11T09:00:00"));
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("too_soon");
  });

  it("n'envoie pas un jour non retenu", () => {
    const plan = planRun([invoice()], CLIENTS, settings(), [], new Date("2026-09-12T09:00:00"));
    expect(plan.skipped[0].reason).toBe("not_a_send_day");
  });

  it("signale l'absence de coordonnées plutôt que d'enregistrer un envoi fictif", () => {
    const mute = new Map<string, ClientLike>([["c1", { _id: "c1", name: "SONIDEP" }]]);
    const plan = planRun([invoice()], mute, settings(), [], MONDAY);
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("no_contact");
    expect(plan.skipped[0].message).toContain("SONIDEP");
  });

  it("ne retient que les canaux réellement praticables", () => {
    const emailOnly = new Map<string, ClientLike>([
      ["c1", { _id: "c1", name: "SONIDEP", email: "compta@sonidep.ne" }],
    ]);
    // J+12 : étape 2, courriel + SMS. Sans téléphone, le SMS disparaît.
    const plan = planRun([invoice()], emailOnly, settings(), [],
      new Date("2026-09-14T09:00:00"));
    expect(plan.actions[0].channels).toEqual(["email"]);
  });

  it("marque la mise en demeure comme requérant une validation", () => {
    const plan = planRun([invoice()], CLIENTS, settings(), [],
      new Date("2026-11-02T09:00:00")); // un lundi, J+62
    expect(plan.actions[0].step.tone).toBe("formal_notice");
    expect(plan.actions[0].needsApproval).toBe(true);
  });

  it("n'envoie qu'un message par facture le jour de l'activation sur un portefeuille ancien", () => {
    // Le cas qui justifie tout le reste : trois factures très en retard le jour
    // où l'on active. Chacune reçoit un seul message, celui qui correspond à
    // son ancienneté — pas la séquence complète du barème.
    const old = [
      invoice({ _id: "a", number: "F-1", dueDate: new Date("2026-08-25") }), // J+13
      invoice({ _id: "b", number: "F-2", dueDate: new Date("2026-08-01") }), // J+37
      invoice({ _id: "c", number: "F-3", dueDate: new Date("2026-06-01") }), // J+98
    ];
    const plan = planRun(old, CLIENTS, settings(), [], MONDAY);
    expect(plan.actions).toHaveLength(3);
    expect(plan.actions.map(a => a.step.offsetDays)).toEqual([10, 21, 45]);
    // Une action par facture, jamais deux.
    expect(new Set(plan.actions.map(a => a.invoiceId)).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Balance âgée", () => {
  const portfolio: InvoiceLike[] = [
    invoice({ _id: "a", totalTTC: 100_000, dueDate: new Date("2026-09-20") }), // à échoir
    invoice({ _id: "b", totalTTC: 200_000, dueDate: new Date("2026-09-01") }), // J+6
    invoice({ _id: "c", totalTTC: 300_000, dueDate: new Date("2026-08-01") }), // J+37
    invoice({ _id: "d", totalTTC: 400_000, dueDate: new Date("2026-05-01") }), // J+129
    invoice({ _id: "e", totalTTC: 500_000, dueDate: new Date("2026-08-01"), status: "paid", paidAmount: 500_000 }),
  ];

  it("répartit les impayés par ancienneté", () => {
    const buckets = agingBuckets(portfolio, MONDAY);
    expect(buckets.map(b => b.amount)).toEqual([100_000, 200_000, 300_000, 0, 400_000]);
  });

  it("exclut ce qui est soldé", () => {
    const buckets = agingBuckets(portfolio, MONDAY);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
  });

  it("exclut les avoirs, qui ne sont pas des créances", () => {
    const withCredit = [...portfolio, invoice({ _id: "f", documentType: "credit_note", totalTTC: 90_000 })];
    const buckets = agingBuckets(withCredit, MONDAY);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
  });
});

describe("Délai moyen de règlement", () => {
  it("pondère par les montants", () => {
    // 10 000 réglés à J+0, 1 000 000 réglés à J+60.
    const delay = averagePaymentDelay([
      { ...invoice({ _id: "a", totalTTC: 10_000 }), paidAt: new Date("2026-09-01") },
      { ...invoice({ _id: "b", totalTTC: 1_000_000 }), paidAt: new Date("2026-10-31") },
    ]);
    // Une moyenne simple donnerait 30 jours ; la réalité est proche de 60.
    expect(delay).toBe(59);
  });

  it("ne renvoie pas zéro faute de données", () => {
    expect(averagePaymentDelay([])).toBeNull();
    expect(averagePaymentDelay([{ ...invoice(), paidAt: null }])).toBeNull();
  });
});

describe("Rédaction", () => {
  const ctx = {
    clientName: "SONIDEP", invoiceNumber: "FA-2026-0001", outstanding: 1_200_000,
    dueDate: new Date("2026-09-01"), daysPastDue: 6, tenantName: "NUMATECH SERVICES",
  };

  it("nomme la facture et le montant dans tous les tons", () => {
    for (const step of DEFAULT_DUNNING_STEPS) {
      const body = composeBody(step.tone, ctx);
      expect(body).toContain("FA-2026-0001");
      expect(flat(body)).toContain("1 200 000 FCFA");
      expect(composeSubject(step.tone, ctx)).toContain("FA-2026-0001");
    }
  });

  it("laisse au client la possibilité d'avoir déjà payé, sur le rappel de courtoisie", () => {
    expect(composeBody("courtesy", ctx)).toContain("déjà parti");
  });

  it("n'emploie le vocabulaire juridique que sur la mise en demeure", () => {
    expect(composeBody("reminder", ctx)).not.toMatch(/mettons en demeure|recouvrement/);
    expect(composeBody("formal_notice", ctx)).toContain("mettons en demeure");
  });

  it("tient le SMS sous la limite d'un message", () => {
    for (const step of DEFAULT_DUNNING_STEPS) {
      expect(composeSms(step.tone, ctx).length).toBeLessThanOrEqual(160);
    }
  });
});
