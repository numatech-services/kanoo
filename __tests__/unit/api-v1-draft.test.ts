import { parseDraft } from "@/lib/api-v1-draft";

const base = { externalRef: "ISIC-LOT-12", clientCode: "UDH", issueDate: "2026-11-07", dueDate: "2026-12-07", lines: [{ description: "Cartes primo-arrivant", quantity: 300, unitPrice: 4500 }] };

describe("parseDraft", () => {
  it("accepte un brouillon et ne garde que la liste blanche", () => {
    const r = parseDraft({ ...base, status: "paid", secef: { code: "X" }, number: "FAC-1", paidAmount: 5, lines: [{ ...base.lines[0], tvaRate: 0, discount: 100, kind: "deposit_deduction" }] });
    expect("draft" in r).toBe(true);
    if ("draft" in r) {
      expect(Object.keys(r.draft).sort()).toEqual(["clientCode", "dueDate", "externalRef", "issueDate", "lines", "object", "period", "reference"]);
      expect(r.draft.lines).toEqual([base.lines[0]]);
    }
  });

  it.each([
    [{ externalRef: "a" }], [{ externalRef: "avec espace" }], [{ externalRef: { $gt: "" } }], [{ clientCode: "" }], [{ clientCode: { $ne: null } }],
    [{ issueDate: "07/11/2026" }], [{ issueDate: "2026-13-45" }], [{ dueDate: "2026-01-01" }], [{ lines: [] }], [{ lines: "x" }],
    [{ lines: [{ description: "", quantity: 1, unitPrice: 1 }] }], [{ lines: [{ description: "x", quantity: 0, unitPrice: 1 }] }], [{ lines: [{ description: "x", quantity: 1.5, unitPrice: 1 }] }],
    [{ lines: [{ description: "x", quantity: 1, unitPrice: -1 }] }], [{ lines: [{ description: "x", quantity: "1", unitPrice: 1 }] }], [{ lines: Array(51).fill(base.lines[0]) }], [{ lines: [{ description: "x", quantity: 1000000, unitPrice: 1000000 }] }],
  ])("refuse %j", (faux) => {
    expect("error" in parseDraft({ ...base, ...faux })).toBe(true);
  });

  it("refuse un corps qui n'est pas un objet", () => {
    expect("error" in parseDraft(null)).toBe(true);
    expect("error" in parseDraft("x")).toBe(true);
  });
});
