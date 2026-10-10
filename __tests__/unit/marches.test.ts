import { computeInvoiceLines, saleEntryLines } from "@/lib/invoice-entry";
import { buildCreditNote, reversalEntryLines, type InvoiceLike } from "@/lib/credit-notes";
import { parseMilestone } from "@/lib/contract-input";
import { costCategory } from "@/lib/cost-categories";
import { DEPOSIT_ACCOUNT } from "@/lib/deposit";

const balance = (lines: Array<{ debit: number; credit: number }>) => [lines.reduce((t, l) => t + l.debit, 0), lines.reduce((t, l) => t + l.credit, 0)];

describe("Marchés : acomptes et déductions", () => {
  it("la saisie ordinaire ne peut pas glisser une ligne négative de déduction", () => {
    const { lines, totalHT } = computeInvoiceLines([{ description: "x", quantity: 1, unitPrice: 1000, kind: "deposit_deduction" }]);
    expect(lines[0].kind).toBeUndefined();
    expect(totalHT).toBe(1000);
  });

  it("facture d'acompte : avance en 419, aucun produit, écriture équilibrée", async () => {
    const t = computeInvoiceLines([{ description: "Acompte 30 %", quantity: 1, unitPrice: 300000, tvaRate: 0.19 }]);
    const lines = await saleEntryLines("000000000000000000000001", { clientId: "c", lines: t.lines, totalTVA: t.totalTVA, totalDTS: t.totalDTS, totalTTC: t.totalTTC, kind: "deposit", projectId: "p" });
    const [d, c] = balance(lines);
    expect(d).toBe(c);
    expect(lines.find(l => l.accountCode === DEPOSIT_ACCOUNT.accountCode)?.credit).toBe(300000);
    expect(lines.some(l => /^7/.test(l.accountCode))).toBe(false);
  });

  it("facture finale : produits sur tout le marché, acompte soldé au débit de 419, net à payer", async () => {
    const t = computeInvoiceLines([
      { description: "Solde", quantity: 1, unitPrice: 1000000, tvaRate: 0.19 },
      { description: "Déduction acompte", quantity: 1, unitPrice: -300000, tvaRate: 0.19, kind: "deposit_deduction", depositInvoiceId: "dep" },
    ], { allowDeduction: true });
    expect(t.totalHT).toBe(700000);
    expect(t.totalTVA).toBe(190000 - 57000);
    const lines = await saleEntryLines("000000000000000000000001", { clientId: "c", lines: t.lines, totalTVA: t.totalTVA, totalDTS: t.totalDTS, totalTTC: t.totalTTC, projectId: "p" });
    const [d, c] = balance(lines);
    expect(d).toBe(c);
    expect(lines.find(l => l.accountCode === "706000")?.credit).toBe(1000000);
    expect(lines.find(l => l.accountCode === "706000")).toMatchObject({ projectId: "p" });
    expect(lines.find(l => l.accountCode === DEPOSIT_ACCOUNT.accountCode)?.debit).toBe(300000);
  });

  it("avoir total d'une facture finale : rend l'acompte (419 au crédit), retire tout le CA du projet", () => {
    const t = computeInvoiceLines([
      { description: "Solde", quantity: 1, unitPrice: 1000000 },
      { description: "Déduction", quantity: 1, unitPrice: -300000, kind: "deposit_deduction" },
    ], { allowDeduction: true });
    const inv = { _id: "i", number: "F1", status: "sent", lines: t.lines, totalHT: t.totalHT, totalTVA: t.totalTVA, totalDTS: t.totalDTS, totalTTC: t.totalTTC } as unknown as InvoiceLike;
    const r = buildCreditNote(inv, "full");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = reversalEntryLines(r.draft, "c", { tags: { projectId: "p" } });
    const [d, c] = balance(lines);
    expect(d).toBe(c);
    expect(lines.find(l => l.accountCode === "706000")).toMatchObject({ debit: 1000000, projectId: "p" });
    expect(lines.find(l => l.accountCode === DEPOSIT_ACCOUNT.accountCode)?.credit).toBe(300000);
  });

  it("la déduction d'acompte ne se crédite pas seule ; un acompte déjà déduit ne s'annule pas", () => {
    const t = computeInvoiceLines([
      { description: "Solde", quantity: 1, unitPrice: 1000 },
      { description: "Déduction", quantity: 1, unitPrice: -300, kind: "deposit_deduction" },
    ], { allowDeduction: true });
    const inv = { _id: "i", number: "F1", status: "sent", lines: t.lines, totalHT: t.totalHT, totalTVA: t.totalTVA, totalDTS: t.totalDTS, totalTTC: t.totalTTC } as unknown as InvoiceLike;
    expect(buildCreditNote(inv, [{ lineIndex: 1, quantity: 1 }]).ok).toBe(false);
    const dep = { ...inv, kind: "deposit", depositUsedHT: 300 } as InvoiceLike;
    expect(buildCreditNote(dep, "full").ok).toBe(false);
  });

  it("avoir sur un acompte non déduit : 419 au débit, pas de produit", () => {
    const t = computeInvoiceLines([{ description: "Acompte", quantity: 1, unitPrice: 200000 }]);
    const dep = { _id: "d", number: "F0", status: "sent", kind: "deposit", depositUsedHT: 0, lines: t.lines, totalHT: t.totalHT, totalTVA: t.totalTVA, totalDTS: t.totalDTS, totalTTC: t.totalTTC } as unknown as InvoiceLike;
    const r = buildCreditNote(dep, "full");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = reversalEntryLines(r.draft, "c", { kind: "deposit" });
    const [d, c] = balance(lines);
    expect(d).toBe(c);
    expect(lines.some(l => /^7/.test(l.accountCode))).toBe(false);
  });
});

describe("Marchés : échéancier et catégories de dépenses", () => {
  it("échéance en pourcentage du marché, nature et date contrôlées", () => {
    expect(parseMilestone({ label: "Acompte", rate: 30, kind: "deposit" }, 1000000).data).toMatchObject({ amount: 300000, kind: "deposit" });
    expect(parseMilestone({ label: "", amount: 10 }, 100).error).toBeTruthy();
    expect(parseMilestone({ label: "x", amount: 0 }, 100).error).toBeTruthy();
    expect(parseMilestone({ label: "x", amount: 10, dueDate: "pas une date" }, 100).error).toBeTruthy();
  });
  it("la catégorie se lit sur le compte de charge", () => {
    expect(costCategory("646100")).toBe("registration");
    expect(costCategory("601000")).toBe("materials");
    expect(costCategory("604000")).toBe("materials");
    expect(costCategory("618000")).toBe("transport");
    expect(costCategory("621000")).toBe("services");
    expect(costCategory("661000")).toBe("personnel");
    expect(costCategory("658000")).toBe("other");
  });
});
