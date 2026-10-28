import { assessRegistration, registrationDueDate, receptionStamp, isPublicBuyer } from "@/lib/registration";

describe("Droits d'enregistrement des marchés (CGI 2026)", () => {
  test("commande publique : 5 % HT + timbre de 25 000 sur l'original", () => {
    const r = assessRegistration({ buyerType: "state", instrument: "market", amountHT: 10_000_000 });
    expect(r.kind).toBe("proportional_public");
    expect(r.duty).toBe(500_000);
    expect(r.stamp).toBe(25_000);
    expect(r.total).toBe(525_000);
  });

  test("projet financé par un bailleur : commande publique", () => {
    expect(isPublicBuyer("project")).toBe(true);
    expect(assessRegistration({ buyerType: "project", amountHT: 2_000_000 }).duty).toBe(100_000);
  });

  test("contrat entre personnes privées ou avec une ONG : 2 % HT, sans timbre d'original", () => {
    for (const buyerType of ["private", "ngo"]) {
      const r = assessRegistration({ buyerType, amountHT: 5_000_000 });
      expect(r.kind).toBe("proportional_private");
      expect(r.duty).toBe(100_000);
      expect(r.stamp).toBe(0);
    }
  });

  test("bon de commande public de moins de 1 000 000 : timbre de dimension par page, pas d'enregistrement", () => {
    const r = assessRegistration({ buyerType: "local_authority", instrument: "purchase_order", amountHT: 800_000, pages: 2 });
    expect(r.kind).toBe("dimension_stamp");
    expect(r.duty).toBe(0);
    expect(r.stamp).toBe(3_000);
  });

  test("bon de commande public d'au moins 1 000 000 : 5 %", () => {
    expect(assessRegistration({ buyerType: "state", instrument: "purchase_order", amountHT: 1_000_000 }).duty).toBe(50_000);
  });

  test("sous-traitance prévue au marché : droit fixe de 50 000", () => {
    const r = assessRegistration({ buyerType: "state", amountHT: 30_000_000, isSubcontract: true });
    expect(r.total).toBe(50_000);
  });

  test("échéance : un mois après l'approbation, à défaut la signature", () => {
    expect(registrationDueDate(new Date(2026, 0, 15))?.getTime()).toBe(new Date(2026, 1, 15).getTime());
    expect(registrationDueDate(null, new Date(2026, 4, 2))?.getTime()).toBe(new Date(2026, 5, 2).getTime());
    expect(registrationDueDate(null, null)).toBeNull();
  });

  test("timbre du PV de réception définitive : marchés publics seulement", () => {
    expect(receptionStamp("state")).toBe(25_000);
    expect(receptionStamp("private")).toBe(0);
  });
});
