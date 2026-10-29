/**
 * Claude dans Kanoo : clé par organisation, plafond, et devis préparés.
 *
 * Deux garanties : la clé d'une organisation ne fuit pas (seul « sk-ant-…abcd »
 * se montre), et Kanoo reste maître des prix — un article du catalogue garde
 * son prix quoi qu'en dise le modèle, un élément inconnu reste « à chiffrer ».
 */

import { API_KEY_RE, keyHint, isKnownModel, AI_MODELS } from "@/lib/ai-client";
import { effectiveQuota, OWN_KEY_DEFAULT_QUOTA, AI_MONTHLY_QUOTA } from "@/lib/ai-quota";
import { reconcileQuote, QUOTE_SCHEMA, type QuoteDraftRaw, type CatalogueItem } from "@/lib/ai-devis";

describe("clé d'API de l'organisation", () => {
  it("accepte une clé Anthropic, refuse le reste", () => {
    expect(API_KEY_RE.test("sk-ant-api03-" + "a".repeat(40))).toBe(true);
    expect(API_KEY_RE.test("sk-proj-" + "a".repeat(40))).toBe(false);
    expect(API_KEY_RE.test("sk-ant- espace")).toBe(false);
  });
  it("n'affiche que les quatre derniers caractères", () => {
    const key = "sk-ant-api03-" + "x".repeat(40) + "WXYZ";
    expect(keyHint(key)).toBe("sk-ant-…WXYZ");
    expect(keyHint(key)).not.toContain("xxxx");
  });
  it("modèles proposés : Opus 5.5 par défaut, rien d'inconnu", () => {
    expect(AI_MODELS[0].id).toBe("claude-opus-5-5");
    expect(isKnownModel("claude-sonnet-5-5")).toBe(true);
    expect(isKnownModel("gpt-5")).toBe(false);
  });
});

describe("plafond mensuel", () => {
  it("clé propre : le plafond de l'organisation, 500 par défaut, 0 suspend", () => {
    expect(effectiveQuota({ ai: { keyHint: "sk-ant-…abcd" } })).toBe(OWN_KEY_DEFAULT_QUOTA);
    expect(effectiveQuota({ ai: { keyHint: "sk-ant-…abcd", monthlyQuota: 2000 } })).toBe(2000);
    expect(effectiveQuota({ ai: { keyHint: "sk-ant-…abcd", monthlyQuota: 0 } })).toBe(0);
  });
  it("clé de la plateforme : son plafond — celui que l'organisation se fixerait ne compte pas", () => {
    expect(effectiveQuota({ ai: { monthlyQuota: 9999 } })).toBe(AI_MONTHLY_QUOTA);
    expect(effectiveQuota({ aiUsage: { monthlyQuota: 7 } })).toBe(7);
    expect(effectiveQuota(null)).toBe(AI_MONTHLY_QUOTA);
    expect(effectiveQuota({ ai: { keyHint: "x", monthlyQuota: Infinity } })).toBe(OWN_KEY_DEFAULT_QUOTA);
    expect(effectiveQuota({ ai: { keyHint: "x", monthlyQuota: 2.5 } })).toBe(2);
  });
});

describe("devis préparé par Claude", () => {
  const catalogue: CatalogueItem[] = [{ _id: "p1", code: "ECR-86", label: "Écran interactif 86\"", unit: "u", unitPrice: 3_467_660, tvaRate: 0.19 }];
  const raw = (lines: QuoteDraftRaw["lines"], missing: string[] = []): QuoteDraftRaw => ({
    object: "  Équipement de la salle de réunion  ", reference: "", period: "", attention: "Monsieur le Directeur", lines,
    terms: "Validité — 30 jours.", missing,
  });
  const line = (over: Partial<QuoteDraftRaw["lines"][number]>): QuoteDraftRaw["lines"][number] => ({
    section: "", title: "Ligne", details: "", unit: "u", quantity: 1, catalogCode: "", unitPrice: 0, tvaRate: 0.19, ...over,
  });

  it("un article du catalogue prend le prix du catalogue, pas celui du modèle", () => {
    const d = reconcileQuote(raw([line({ title: "Écran 86 pouces", catalogCode: "ecr-86", unitPrice: 1, tvaRate: 0 })]), catalogue);
    expect(d.lines[0]).toMatchObject({ productId: "p1", unitPrice: 3_467_660, tvaRate: 0.19, description: "Écran 86 pouces" });
    expect(d.warnings).toEqual([expect.stringMatching(/article du catalogue retenu ECR-86/)]);
  });
  it("hors catalogue sans prix : à chiffrer, signalé", () => {
    const d = reconcileQuote(raw([line({ title: "Pose de moquette", unit: "m²", quantity: 33.75 })], ["Surface exacte à confirmer"]), catalogue);
    expect(d.lines[0]).toMatchObject({ unitPrice: 0, quantity: 33.75, unit: "m²" });
    expect(d.lines[0]).not.toHaveProperty("productId");
    expect(d.warnings).toEqual(["Surface exacte à confirmer", "« Pose de moquette » : prix à chiffrer."]);
  });
  it("hors catalogue : un prix n'est gardé que s'il figure dans la demande", () => {
    const l = [line({ title: "Pose", unitPrice: 3150 }), line({ title: "Peinture", unitPrice: 1820 })];
    const d = reconcileQuote(raw(l), catalogue, "Pose de moquette à 3 150 F le m²");
    expect(d.lines.map(x => x.unitPrice)).toEqual([3150, 0]);
    expect(d.warnings).toContain("« Peinture » : prix à chiffrer.");
  });
  it("réponse incomplète du modèle : pas d'exception", () => {
    expect(() => reconcileQuote({ lines: [{ quantity: 0.001 }] } as unknown as QuoteDraftRaw, catalogue)).not.toThrow();
    expect(reconcileQuote({ lines: [{ title: "x", quantity: 0.001 }] } as unknown as QuoteDraftRaw, catalogue).lines[0].quantity).toBe(0.01);
  });
  it("mentions bornées et nettoyées ; lignes vides retirées ; TVA hors barème ramenée à 19 %", () => {
    const d = reconcileQuote(raw([line({ title: "  " }), line({ title: "Formation", unitPrice: 79_800.4, tvaRate: 0.07, quantity: 0 })]), catalogue, "formation à 79 800 F");
    expect(d.mentions.object).toBe("Équipement de la salle de réunion");
    expect(d.mentions.attention).toBe("Monsieur le Directeur");
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ unitPrice: 79_800, tvaRate: 0.19, quantity: 1 });
  });
  it("le schéma impose tous les champs (sorties structurées)", () => {
    expect(QUOTE_SCHEMA.required).toEqual(expect.arrayContaining(["object", "lines", "terms", "missing"]));
    expect(QUOTE_SCHEMA.properties.lines.items.additionalProperties).toBe(false);
  });
});
