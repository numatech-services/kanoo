/**
 * Import / export — helpers CSV (échappement, analyse, coercition).
 */
import { toCSV, parseCSV, coerce, ENTITIES } from "@/lib/data-io";

describe("CSV — export", () => {
  it("échappe guillemets, virgules et retours à la ligne", () => {
    const csv = toCSV(["a", "b"], [["x,y", 'il a dit "ok"'], ["multi\nligne", 1]]);
    // BOM en tête
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"il a dit ""ok"""');
    expect(csv).toContain('"multi\nligne"');
  });
});

describe("CSV — analyse", () => {
  it("relit ce qui a été écrit (aller-retour)", () => {
    const csv = toCSV(["code", "name"], [["CLI-1", "Boutique, du coin"], ["CLI-2", 'Nom "spécial"']]);
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(["code", "name"]);
    expect(rows[0]).toEqual(["CLI-1", "Boutique, du coin"]);
    expect(rows[1]).toEqual(["CLI-2", 'Nom "spécial"']);
  });

  it("ignore les lignes vides", () => {
    const { rows } = parseCSV("a,b\n1,2\n\n3,4\n");
    expect(rows).toEqual([["1", "2"], ["3", "4"]]);
  });
});

describe("CSV — coercition", () => {
  it("convertit nombres (virgule ou point) et booléens", () => {
    expect(coerce("1 250,50", { header: "x", field: "x", kind: "number" })).toBe(1250.5);
    expect(coerce("oui", { header: "x", field: "x", kind: "boolean" })).toBe(true);
    expect(coerce("non", { header: "x", field: "x", kind: "boolean" })).toBe(false);
  });
  it("borne les valeurs d'énumération au défaut", () => {
    expect(coerce("company", { header: "type", field: "type", enum: ["individual", "company"], default: "company" })).toBe("company");
    expect(coerce("xxx", { header: "type", field: "type", enum: ["individual", "company"], default: "company" })).toBe("company");
  });
});

describe("Registre d'entités", () => {
  it("clients/fournisseurs/produits sont importables ; factures/devis en export seul", () => {
    expect(ENTITIES.clients.import).toBeDefined();
    expect(ENTITIES.suppliers.import).toBeDefined();
    expect(ENTITIES.products.import).toBeDefined();
    expect(ENTITIES.invoices.import).toBeUndefined();
    expect(ENTITIES.devis.import).toBeUndefined();
  });
});
