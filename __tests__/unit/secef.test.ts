/**
 * Couche de certification SECeF.
 *
 * Les tests portent sur ce qui relève de Kanoo — sélection du pilote, contrôles
 * de saisie, refus explicites — et jamais sur le format d'échange avec la DGI,
 * qui n'est pas publié. Un test écrit contre un format inventé donnerait une
 * fausse assurance.
 */

import { PortalSecefDriver, ESECEF_PORTAL_URL } from "@/lib/secef/portal";
import { EmcfSecefDriver } from "@/lib/secef/emcf";
import { readinessChecklist, REQUIRED_INVOICE_MENTIONS } from "@/lib/secef";

const portal = new PortalSecefDriver();

describe("Pilote portail e-SECeF", () => {
  it("est toujours disponible : il ne dépend d'aucun secret", () => {
    expect(portal.isConfigured()).toBe(true);
    expect(portal.automatic).toBe(false);
  });

  it("pointe vers le portail officiel", () => {
    expect(ESECEF_PORTAL_URL).toBe("https://sygmef.impots.gouv.ne");
  });

  it("refuse de certifier de lui-même et dit quoi faire", async () => {
    const res = await portal.certify();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("e-SECeF");
      expect(res.retryable).toBe(false);
    }
  });

  it("enregistre une certification relevée sur le portail", () => {
    const res = portal.record({
      code: "SECEF-2026-000123",
      qrPayload: "https://sygmef.impots.gouv.ne/verify/ABC123",
      certifiedAt: new Date("2026-03-01T10:00:00Z"),
      mcfId: "MCF-001",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.certification.code).toBe("SECEF-2026-000123");
      expect(res.certification.driver).toBe("portal");
      expect(res.certification.mcfId).toBe("MCF-001");
    }
  });

  it("exige le code SECeF/DGI", () => {
    const res = portal.record({ code: "  ", qrPayload: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("code SECeF/DGI");
  });

  it("exige le contenu du QR code : c'est lui qui permet la vérification", () => {
    const res = portal.record({ code: "SECEF-1", qrPayload: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("QR code");
  });

  it("refuse une date de certification dans le futur", () => {
    const res = portal.record({
      code: "SECEF-1", qrPayload: "x",
      certifiedAt: new Date(Date.now() + 3 * 86_400_000),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("futur");
  });

  it("refuse une date invalide", () => {
    const res = portal.record({ code: "SECEF-1", qrPayload: "x", certifiedAt: new Date("pas une date") });
    expect(res.ok).toBe(false);
  });

  it("renvoie vers l'avoir plutôt que d'annuler", async () => {
    // Réglementairement, une facture certifiée ne se supprime pas.
    const res = await portal.cancel();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("avoir");
  });
});

describe("Pilote e-MCF", () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it("se déclare non configuré sans adresse ni jeton", () => {
    delete process.env.SECEF_EMCF_BASE_URL;
    delete process.env.SECEF_EMCF_TOKEN;
    expect(new EmcfSecefDriver().isConfigured()).toBe(false);
  });

  it("exige les deux variables, pas une seule", () => {
    process.env.SECEF_EMCF_BASE_URL = "https://exemple.test";
    delete process.env.SECEF_EMCF_TOKEN;
    expect(new EmcfSecefDriver().isConfigured()).toBe(false);
  });

  it("explique ce qui manque plutôt que d'échouer en silence", async () => {
    delete process.env.SECEF_EMCF_BASE_URL;
    const res = await new EmcfSecefDriver().certify(
      {} as never, { nif: "12345" }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("SECEF_EMCF_BASE_URL");
      expect(res.retryable).toBe(false);
    }
  });

  it("réclame l'identifiant ISF une fois configuré", async () => {
    process.env.SECEF_EMCF_BASE_URL = "https://exemple.test";
    process.env.SECEF_EMCF_TOKEN = "jeton";
    const res = await new EmcfSecefDriver().certify({} as never, { nif: "12345" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ISF");
  });

  it("annonce clairement que l'intégration attend les spécifications DGI", async () => {
    // Ce test verrouille l'honnêteté du module : tant qu'il passe, personne ne
    // peut croire que la certification automatique fonctionne.
    process.env.SECEF_EMCF_BASE_URL = "https://exemple.test";
    process.env.SECEF_EMCF_TOKEN = "jeton";
    const res = await new EmcfSecefDriver().certify(
      {} as never, { nif: "12345", isf: "ISF-001" }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("docs/SECEF.md");
  });
});

describe("Prérequis à la certification", () => {
  it("signale tout ce qui manque quand rien n'est renseigné", () => {
    const list = readinessChecklist({});
    expect(list.filter(i => i.done)).toHaveLength(0);
    expect(list.map(i => i.key)).toEqual(["nif", "isf", "mcf", "driver"]);
  });

  it("valide les éléments effectivement renseignés", () => {
    const list = readinessChecklist({ nif: "12345678", isf: "ISF-001" });
    expect(list.find(i => i.key === "nif")?.done).toBe(true);
    expect(list.find(i => i.key === "isf")?.done).toBe(true);
    expect(list.find(i => i.key === "mcf")?.done).toBe(false);
  });

  it("chaque prérequis explique ce qu'il attend", () => {
    for (const item of readinessChecklist({})) {
      expect(item.hint.length).toBeGreaterThan(10);
    }
  });
});

describe("Mentions obligatoires d'une facture certifiée", () => {
  it("couvre le code, le QR et l'identité du MCF", () => {
    expect(REQUIRED_INVOICE_MENTIONS).toContain("Code SECeF/DGI");
    expect(REQUIRED_INVOICE_MENTIONS).toContain("QR code de vérification");
    expect(REQUIRED_INVOICE_MENTIONS).toContain("Identifiant du MCF");
  });
});
