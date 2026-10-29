/**
 * Documents commerciaux (devis, proforma, facture, bon de livraison, bon de
 * commande) et correction contrôlée d'une facture émise.
 *
 * Ce qui part chez le client doit être juste au mot près : la somme en
 * lettres, les conditions, la validité. Et une facture émise ne se réécrit
 * que tant qu'aucun effet (encaissement, TVA déclarée, SECeF…) n'en dépend.
 */

import { amountInWordsFr, stoppedSentence, conditionParagraphs, renderBusinessPdf, type DocTenant } from "@/lib/pdf-business";
import { quoteDoc, invoiceDoc, deliveryDoc, validity } from "@/lib/business-doc";
import { mentionsFrom, copyMentions, invoiceTerms } from "@/lib/doc-mentions";
import { correctionBlock, contentKey, type CorrectableInvoice, type CorrectionFacts } from "@/lib/invoice-correction";

const tenant: DocTenant = {
  name: "Numatech Services SARL", address: "Niamey", nif: "79 701/R",
  branding: { documentStyle: "prestige", city: "Niamey · Niger", signatoryName: "Le Gérant", signatoryTitle: "Gérant" },
};

describe("somme en toutes lettres", () => {
  it.each([
    [0, "zéro"], [1, "un"], [21, "vingt et un"], [71, "soixante et onze"], [21_000, "vingt et un mille"], [80_000_000, "quatre-vingts millions"], [80, "quatre-vingts"], [81, "quatre-vingt-un"],
    [91, "quatre-vingt-onze"], [100, "cent"], [200, "deux cents"], [201, "deux cent un"], [1000, "mille"],
    [200_000, "deux cent mille"], [280_000, "deux cent quatre-vingt mille"], [1_000_000, "un million"],
    [5_117_000, "cinq millions cent dix-sept mille"], [2_000_000_000, "deux milliards"],
  ])("%d → %s", (n, words) => expect(amountInWordsFr(n)).toBe(words));

  it("arrête la facture à la somme TTC, avec le montant en chiffres", () => {
    const s = stoppedSentence("invoice", 5_117_000)!;
    expect(s.lead).toMatch(/^Arrêtée la présente facture/);
    expect(s.bold).toMatch(/^cinq millions cent dix-sept mille \(5\s117\s000\) francs CFA$/u);
    expect(stoppedSentence("invoice", 2_000_000)!.bold).toMatch(/^deux millions \(2\s000\s000\) de francs CFA$/u);
    expect(stoppedSentence("order", 1000)!.tail).toBe(" toutes taxes comprises.");
    expect(stoppedSentence("invoice", NaN)).toBeNull();
  });
});

describe("conditions imprimées", () => {
  it("« Titre — texte » met le titre en gras ; une ligne sans titre reste un paragraphe", () => {
    expect(conditionParagraphs("Validité — trente jours.\n\nRèglement : 50 % à la commande\nLivraison sous huit jours")).toEqual([
      { title: "Validité", body: "trente jours." },
      { title: "Règlement", body: "50 % à la commande" },
      { body: "Livraison sous huit jours" },
    ]);
  });
});

describe("mentions du document", () => {
  it("bornées et vidées proprement", () => {
    const m = mentionsFrom({ object: "x".repeat(700), reference: "  CONV-12  ", period: "", other: "ignoré" });
    expect(m.object).toHaveLength(600);
    expect(m.reference).toBe("CONV-12");
    expect("other" in m).toBe(false);
    expect(copyMentions({ object: "Objet", attention: "M. le Directeur" })).toEqual({ object: "Objet", attention: "M. le Directeur" });
  });
});

describe("conditions reprises du devis sur la facture", () => {
  it("la validité de l'offre ne passe pas sur la facture", () => {
    expect(invoiceTerms("Validité — offre valable trente (30) jours.\nRèglement — 60 % à la commande.\nOffre valable 15 jours")).toBe("Règlement — 60 % à la commande.");
    expect(invoiceTerms(undefined)).toBe("");
  });
});

describe("devis et proforma", () => {
  const q = {
    number: "PRO-2026-005", issueDate: new Date("2026-10-27T10:00:00Z"), validUntil: new Date("2026-11-26T10:00:00Z"),
    clientId: { name: "École nationale de santé publique (ENSP)", address: "Niamey" }, object: "Abonnement annuel", reference: "CONV-12",
    lines: [{ description: "Abonnement", details: "Licence annuelle", quantity: 1, unitPrice: 100_000, tvaRate: 0.19, discount: 0, totalHT: 100_000, totalTVA: 19_000, totalTTC: 119_000 }],
    totalHT: 100_000, totalTVA: 19_000, totalTTC: 119_000, docKind: "proforma" as const, termsAndConditions: "Règlement — à trente jours.",
  };
  it("la proforma porte son titre, sa validité, ses mentions et ses conditions", () => {
    const d = quoteDoc(q, tenant);
    expect(d.kind).toBe("proforma");
    expect(d.meta).toEqual(expect.arrayContaining([["Validité", validity(q.issueDate, q.validUntil)], ["Référence", "CONV-12"]]));
    expect(validity(q.issueDate, q.validUntil)).toMatch(/^30 jours, jusqu'au 26 novembre 2026$/);
    expect(d.object).toBe("Abonnement annuel");
    expect(d.conditions).toBe("Règlement — à trente jours.\nNature du document — facture proforma : offre de prix, elle ne vaut pas facture.");
    expect(d.lines[0]).toMatchObject({ title: "Abonnement", details: "Licence annuelle" });
  });
  it("un ancien devis sans conditions imprime ses notes ; un devis aux conditions vidées n'imprime rien", () => {
    const devis = { ...q, docKind: "devis" as const };
    expect(quoteDoc({ ...devis, termsAndConditions: undefined, notes: "Ancienne note" }, tenant).conditions).toBe("Ancienne note");
    expect(quoteDoc({ ...devis, termsAndConditions: "", notes: "Note interne" }, tenant).conditions).toBe("");
  });
  it("le style moderne ajoute « Bon pour accord » ; le réglage de l'organisation l'emporte", () => {
    expect(quoteDoc(q, { ...tenant, branding: { documentStyle: "moderne" } }).counterSignature?.label).toMatch(/^Bon pour accord/);
    expect(quoteDoc(q, { ...tenant, branding: { documentStyle: "moderne", clientApproval: false } }).counterSignature).toBeFalsy();
  });

  it("conditions très longues : le PDF se pagine sans erreur", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Clause ${i + 1} — ${"texte de la clause ".repeat(20)}`).join("\n");
    for (const style of ["prestige", "moderne"] as const) {
      const buf = await renderBusinessPdf(quoteDoc({ ...q, termsAndConditions: long }, tenant), tenant, { style });
      expect(buf.subarray(0, 4).toString()).toBe("%PDF");
      expect((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    }
  }, 30_000);

  it("style signature : PDF valide, polices Newsreader et Hanken Grotesk intégrées, une page", async () => {
    const t2: DocTenant = { ...tenant, branding: { ...tenant.branding, documentStyle: "signature", legalForm: "SARL au capital de 100 000 FCFA", paymentInstructions: "Orabank Niger\nIBAN NE58 0000" } };
    const buf = await renderBusinessPdf(quoteDoc(q, t2), t2);
    const raw = buf.toString("latin1");
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(raw).toMatch(/Newsreader/);
    expect(raw).toMatch(/HankenGrotesk/);
    expect(raw.match(/\/Type \/Page\b/g)).toHaveLength(1);
    // Accord du client par défaut dans ce style, comme en moderne.
    expect(quoteDoc(q, t2).counterSignature?.label).toMatch(/^Bon pour accord/);
  }, 20_000);

  // Le texte du PDF (police intégrée) est relu par le scénario e2e-docs : unpdf ne se charge pas sous jest.
  it("le PDF est un vrai PDF, d'une page pour un devis court", async () => {
    const buf = await renderBusinessPdf(quoteDoc(q, tenant), tenant);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
    const moderne = await renderBusinessPdf(quoteDoc(q, tenant), tenant, { style: "moderne" });
    expect(moderne.subarray(0, 4).toString()).toBe("%PDF");
  }, 20_000);
});

describe("facture et bon de livraison", () => {
  it("la facture affiche le payé et le reste ; le BL reprend les quantités commandées", () => {
    const inv = {
      number: "FAC-2026-00042", issueDate: new Date("2026-10-28"), dueDate: new Date("2026-11-27"), status: "partial", documentType: "invoice",
      clientId: { name: "OBEECS" }, lines: [{ description: "Écran", quantity: 2, unitPrice: 1000, tvaRate: 0.19, totalHT: 2000, totalTVA: 380, totalTTC: 2380 }],
      totalHT: 2000, totalTVA: 380, totalTTC: 2380, paidAmount: 1000,
    };
    expect(invoiceDoc(inv, tenant).totals).toMatchObject({ ttc: 2380, paid: 1000 });
    const rect = invoiceDoc({ ...inv, correctedAt: new Date("2026-10-30") }, { ...tenant, branding: { ...tenant.branding, paymentInstructions: "Orabank, IBAN NE58 0000" } });
    expect(rect.meta).toEqual(expect.arrayContaining([["Rectifiée", expect.stringMatching(/^le 30 octobre 2026 — annule et remplace/)]]));
    expect(rect.conditions).toContain("Coordonnées de paiement — Orabank, IBAN NE58 0000");
    expect(rect.qrs?.[0]?.caption).toBe("Référence Kanoo");
    const bl = deliveryDoc({ number: "BL-1", date: new Date("2026-10-29"), clientId: { name: "OBEECS" }, invoiceId: inv,
      lines: [{ description: "Écran", quantity: 1, invoiceLineIndex: 0 }] } as Parameters<typeof deliveryDoc>[0], tenant);
    expect(bl.kind).toBe("delivery");
    expect(bl.lines[0]).toMatchObject({ quantity: 1, ordered: 2 });
  });
});

describe("correction contrôlée d'une facture émise", () => {
  const inv: CorrectableInvoice = { status: "sent", documentType: "invoice", issueDate: new Date("2026-10-10T09:00:00Z") };
  const free: CorrectionFacts = { payments: 0, deliveries: 0, lockedUntil: null, vatDeclared: false };

  it("permise tant que rien n'en dépend", () => expect(correctionBlock(inv, free)).toBeNull());

  it.each<[string, Partial<CorrectableInvoice>, Partial<CorrectionFacts>, RegExp]>([
    ["certifiée SECeF", { secef: { code: "ABC" } }, {}, /SECeF/],
    ["encaissement", {}, { payments: 1 }, /encaissements/],
    ["payée en partie", { paidAmount: 500 }, {}, /encaissements/],
    ["avoir émis", { creditedAmount: 100 }, {}, /avoir a déjà été émis/],
    ["un avoir", { documentType: "credit_note" }, {}, /avoir ne se corrige pas/],
    ["facture de marché", { contractId: "c1" }, {}, /marché/],
    ["acompte déduit", { kind: "deposit", depositUsedHT: 10 }, {}, /Acompte déjà déduit/],
    ["déduction d'acompte", { lines: [{ kind: "deposit_deduction" }] }, {}, /déduit des acomptes/],
    ["bon de livraison", {}, { deliveries: 1 }, /bons de livraison/],
    ["période verrouillée", {}, { lockedUntil: new Date("2026-10-31T12:00:00Z") }, /verrouillée/],
    ["TVA déclarée", {}, { vatDeclared: true }, /TVA/],
    ["créance douteuse", { doubtfulAt: new Date() }, {}, /douteuse/],
    ["annulée", { status: "cancelled" }, {}, /annulée/],
  ])("refusée : %s", (_l, over, facts, re) => expect(correctionBlock({ ...inv, ...over }, { ...free, ...facts })).toMatch(re));

  it("la nouvelle date ne change pas d'année ni ne tombe dans une période verrouillée", () => {
    expect(correctionBlock(inv, free, new Date("2027-01-05T09:00:00Z"))).toMatch(/année/);
    expect(correctionBlock(inv, { ...free, lockedUntil: new Date("2026-09-30T12:00:00Z") }, new Date("2026-09-15T09:00:00Z"))).toMatch(/nouvelle date/);
    expect(correctionBlock(inv, free, new Date("2026-10-20T09:00:00Z"))).toBeNull();
  });

  it("seul un vrai changement de contenu déclenche une correction", () => {
    const base = { clientId: "c1", issueDate: "2026-10-10", lines: [{ description: "A", quantity: 1, unitPrice: 10, tvaRate: 0.19, discount: 0, totalHT: 10 }] };
    expect(contentKey(base)).toBe(contentKey({ ...base, issueDate: new Date("2026-10-10T08:00:00Z"), lines: [{ ...base.lines[0], totalHT: 999 }] }));
    expect(contentKey(base)).not.toBe(contentKey({ ...base, lines: [{ ...base.lines[0], unitPrice: 11 }] }));
    expect(contentKey(base)).not.toBe(contentKey({ ...base, clientId: "c2" }));
  });
});
