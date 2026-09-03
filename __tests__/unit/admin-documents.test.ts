/**
 * Veille des documents administratifs.
 *
 * Le module existe pour une raison : alerter à l'expiration ne sert à rien.
 * Une attestation qui expire le 30 et demande vingt et un jours d'instruction
 * devait être lancée le 9. Ces tests portent sur cette date-là.
 */

import {
  DOCUMENT_TYPES, statusOf, renewalStartDate, leadTimeFor, buildAlerts,
  suggestedExpiry, summarize, daysBetween, STATUS_LABEL,
  type AdminDocumentLike, type DocumentType,
} from "@/lib/admin-documents";

const TODAY = new Date("2026-09-03T09:00:00");

function doc(over: Partial<AdminDocumentLike> = {}): AdminDocumentLike & { _id: unknown } {
  return {
    _id: "d1",
    label: "Attestation de régularité fiscale",
    type: "arf" as DocumentType,
    expiresAt: new Date("2026-12-01"),
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Date de lancement", () => {
  it("recule l'échéance du délai d'instruction", () => {
    // On teste la propriété, pas la chaîne : comparer un ISO ramène le
    // résultat en UTC et décale d'un jour selon le fuseau du serveur.
    const expiry = new Date("2026-12-01");
    const start = renewalStartDate(doc({ expiresAt: expiry }))!;
    expect(daysBetween(start, expiry)).toBe(DOCUMENT_TYPES.arf.leadTimeDays);
  });

  it("rend une date à minuit, quel que soit le fuseau du serveur", () => {
    const start = renewalStartDate(doc())!;
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
  });

  it("préfère le délai porté par le document à celui de sa nature", () => {
    // L'expérience réelle d'une organisation avec son administration prime.
    expect(leadTimeFor(doc({ leadTimeDays: 60 }))).toBe(60);
    expect(leadTimeFor(doc())).toBe(DOCUMENT_TYPES.arf.leadTimeDays);
  });

  it("accepte un délai nul sans retomber sur le défaut", () => {
    expect(leadTimeFor(doc({ leadTimeDays: 0 }))).toBe(0);
  });

  it("ne calcule rien sur un document sans échéance", () => {
    expect(renewalStartDate(doc({ expiresAt: null }))).toBeNull();
  });
});

describe("État d'un document", () => {
  it("est à jour tant que la date de lancement n'est pas atteinte", () => {
    expect(statusOf(doc({ expiresAt: new Date("2026-12-01") }), TODAY)).toBe("valid");
  });

  it("passe à renouveler le jour du lancement", () => {
    // 21 jours d'instruction : lancement le 24/09 pour une échéance au 15/10.
    expect(statusOf(doc({ expiresAt: new Date("2026-09-24") }), TODAY)).toBe("renewal_due");
  });

  it("passe en retard quand la moitié de la marge est consommée", () => {
    // Échéance dans 9 jours pour 21 jours d'instruction : c'est trop tard.
    expect(statusOf(doc({ expiresAt: new Date("2026-09-12") }), TODAY)).toBe("renewal_late");
  });

  it("se tait quand le renouvellement est engagé", () => {
    const engaged = doc({
      expiresAt: new Date("2026-09-20"),
      renewalStartedAt: new Date("2026-09-01"),
    });
    expect(statusOf(engaged, TODAY)).toBe("in_progress");
  });

  it("reparle quand l'échéance approche malgré la démarche engagée", () => {
    // Un dossier peut dormir sur un bureau : à moins d'une semaine, on relance.
    const engaged = doc({
      expiresAt: new Date("2026-09-08"),
      renewalStartedAt: new Date("2026-08-01"),
    });
    expect(statusOf(engaged, TODAY)).toBe("expiring");
  });

  it("reconnaît un document périmé", () => {
    expect(statusOf(doc({ expiresAt: new Date("2026-08-20") }), TODAY)).toBe("expired");
  });

  it("sort de la veille un document remplacé ou archivé", () => {
    const replaced = doc({ expiresAt: new Date("2026-08-20"), replacedAt: new Date("2026-08-19") });
    expect(statusOf(replaced, TODAY)).toBe("perpetual");
  });

  it("classe sans échéance ce qui n'en a pas", () => {
    expect(statusOf(doc({ type: "rccm", expiresAt: null }), TODAY)).toBe("perpetual");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Alertes", () => {
  it("ne dit rien sur ce qui est à jour", () => {
    expect(buildAlerts([doc({ expiresAt: new Date("2027-06-01") })], TODAY)).toEqual([]);
  });

  it("dit quoi faire et quand, pas seulement ce qui ne va pas", () => {
    const [alert] = buildAlerts([doc({ expiresAt: new Date("2026-09-24") })], TODAY);
    // « Expire dans 21 jours » laisserait le lecteur calculer s'il a le temps.
    expect(alert.message).toMatch(/lancer/);
    expect(alert.message).toMatch(/21 jours d'instruction/);
  });

  it("dit de combien on est en retard sur le lancement", () => {
    const [alert] = buildAlerts([doc({ expiresAt: new Date("2026-09-12") })], TODAY);
    expect(alert.level).toBe("critical");
    expect(alert.message).toMatch(/aurait dû commencer/);
  });

  it("hausse le niveau sur un document qui conditionne l'activité", () => {
    // Une assurance qui se renouvelle est un avertissement ; une attestation
    // fiscale sans laquelle l'offre est écartée est une urgence.
    const bloquant = buildAlerts([doc({ type: "arf", expiresAt: new Date("2026-09-24") })], TODAY);
    const souple = buildAlerts([doc({ type: "assurance", expiresAt: new Date("2026-09-25") })], TODAY);
    expect(bloquant[0].level).toBe("critical");
    expect(souple[0].level).toBe("warning");
  });

  it("rappelle la conséquence quand le document est périmé et bloquant", () => {
    const [alert] = buildAlerts([doc({ expiresAt: new Date("2026-08-01") })], TODAY);
    expect(alert.message).toMatch(/conditionne votre activité/);
  });

  it("met l'urgence en tête, pas l'ordre alphabétique", () => {
    const alerts = buildAlerts([
      doc({ _id: "a", label: "Assurance", type: "assurance", expiresAt: new Date("2026-09-30") }),
      doc({ _id: "b", label: "Attestation fiscale", type: "arf", expiresAt: new Date("2026-08-01") }),
      doc({ _id: "c", label: "Patente", type: "patente", expiresAt: new Date("2026-09-20") }),
    ], TODAY);
    expect(alerts[0].documentId).toBe("b");
    expect(alerts[0].level).toBe("critical");
  });

  it("ignore ce qui est archivé", () => {
    const archived = doc({ expiresAt: new Date("2026-08-01"), archivedAt: new Date("2026-08-02") });
    expect(buildAlerts([archived], TODAY)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Échéance suggérée", () => {
  it("dérive l'échéance de la nature et de la date de délivrance", () => {
    // ARF : 90 jours de validité.
    const expiry = suggestedExpiry("arf", new Date("2026-09-01"))!;
    expect(daysBetween(new Date("2026-09-01"), expiry)).toBe(90);
  });

  it("ne suggère rien pour un document sans durée de validité", () => {
    expect(suggestedExpiry("rccm", new Date("2026-09-01"))).toBeNull();
  });
});

describe("Synthèse", () => {
  const portfolio = [
    doc({ _id: "a", type: "rccm", expiresAt: null }),
    doc({ _id: "b", expiresAt: new Date("2027-01-01") }),
    doc({ _id: "c", expiresAt: new Date("2026-09-24") }),
    doc({ _id: "d", expiresAt: new Date("2026-09-10") }),
    doc({ _id: "e", expiresAt: new Date("2026-07-01") }),
  ];

  it("compte chaque document dans une seule catégorie", () => {
    const s = summarize(portfolio, TODAY);
    expect(s.total).toBe(5);
    expect(s.valid + s.toRenew + s.late + s.expired).toBe(5);
  });

  it("désigne le plus urgent", () => {
    expect(summarize(portfolio, TODAY).mostUrgent?.documentId).toBe("e");
  });

  it("ne désigne rien quand tout est à jour", () => {
    const s = summarize([doc({ expiresAt: new Date("2027-06-01") })], TODAY);
    expect(s.mostUrgent).toBeNull();
    expect(s.valid).toBe(1);
  });
});

describe("Libellés", () => {
  it("nomme chaque état en français", () => {
    for (const label of Object.values(STATUS_LABEL)) {
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it("donne à chaque nature un délai d'instruction non nul", () => {
    for (const spec of Object.values(DOCUMENT_TYPES)) {
      expect(spec.leadTimeDays).toBeGreaterThan(0);
    }
  });
});
