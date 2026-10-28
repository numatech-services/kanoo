import { parseEvent, payMethodFor, lossReasonFor, withPreorders, sameName, catalogueVersion, preorderPending } from "@/lib/easypay";

const at = "2026-10-28T12:30:00.000Z";
const item = (id: string, name: string) => ({ id, name });
const sale = (over: Record<string, unknown> = {}) => ({
  id: "evt-sale-0001", type: "sale", occurred_at: at,
  data: {
    sale_id: "0192aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee", number: "T-12", profile: "student",
    lines: [
      { item: item("pastel-1", "Pastel"), quantity: 2, unit_price: 200 },
      { item: item("formule-eco", "Formule éco étudiant"), quantity: 1, unit_price: 600, components: [{ item: item("riz-gras", "Riz au gras"), quantity: 1 }, { item: item("yaourt", "Yaourt"), quantity: 1 }] },
    ],
    payments: [{ method: "card", amount: 700 }, { method: "cash", amount: 300 }],
    ...over,
  },
});

describe("EasyPay — lecture des événements", () => {
  it("lit une vente : lignes, composants d'une formule, moyens de paiement", () => {
    const r = parseEvent(sale());
    expect(r.ok).toBe(true);
    if (!r.ok || r.event.type !== "sale") return;
    expect(r.event.data.lines).toHaveLength(2);
    expect(r.event.data.lines[1].components.map(c => c.item.id)).toEqual(["riz-gras", "yaourt"]);
    expect(r.event.data.payments).toEqual([{ method: "easypay", amount: 700 }, { method: "cash", amount: 300 }]);
  });

  it("refuse un ticket mal payé, un montant non entier, un moyen inconnu", () => {
    const short = parseEvent(sale({ payments: [{ method: "cash", amount: 900 }] }));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/900.*1000/);
    expect(parseEvent(sale({ payments: [{ method: "cash", amount: 999.5 }, { method: "card", amount: 0.5 }] })).ok).toBe(false);
    expect(parseEvent(sale({ payments: [{ method: "bitcoin", amount: 1000 }] })).ok).toBe(false);
  });

  it("refuse un id invalide ou une date future, et rend l'id pour la trace", () => {
    expect(parseEvent({ ...sale(), id: "x" }).ok).toBe(false);
    const future = parseEvent({ ...sale(), occurred_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.id).toBe("evt-sale-0001");
  });

  it("recharge : espèces seulement ; stock : réception, perte, inventaire", () => {
    expect(parseEvent({ id: "evt-topup-01", type: "topup", occurred_at: at, data: { topup_id: "topup-000001", amount: 2000 } }).ok).toBe(true);
    expect(parseEvent({ id: "evt-topup-02", type: "topup", occurred_at: at, data: { topup_id: "topup-000002", amount: 2000, method: "agent" } }).ok).toBe(false);
    const count = parseEvent({ id: "evt-stock-01", type: "stock_movement", occurred_at: at, data: { movement_id: "mv-0000001", kind: "count", item: item("coca-33", "Coca 33 cl"), counted_quantity: 0 } });
    expect(count.ok && count.event.type === "stock_movement" && count.event.data.countedQuantity).toBe(0);
    const loss = parseEvent({ id: "evt-stock-02", type: "stock_movement", occurred_at: at, data: { movement_id: "mv-0000002", kind: "loss", item: item("coca-33", "Coca 33 cl"), quantity: -3, reason: "Bouteille cassée" } });
    expect(loss.ok && loss.event.type === "stock_movement" && loss.event.data.quantity).toBe(3);
  });

  it("pré-commande : statut et jour de retrait contrôlés", () => {
    const ok = parseEvent({ id: "evt-order-01", type: "preorder", occurred_at: at, data: { order_id: "order-0000001", status: "booked", pickup_day: "2026-10-29", lines: [{ item: item("poulet-b", "¼ poulet braisé"), quantity: 3 }] } });
    expect(ok.ok).toBe(true);
    expect(parseEvent({ id: "evt-order-02", type: "preorder", occurred_at: at, data: { order_id: "order-0000002", status: "eaten", pickup_day: "2026-10-29", lines: [] } }).ok).toBe(false);
  });
});

describe("EasyPay — correspondances", () => {
  it("moyens : carte, QR et solde chez Numatech ; mobile money au compte de l'organisation", () => {
    expect(payMethodFor("card")).toBe("easypay");
    expect(payMethodFor("balance")).toBe("easypay");
    expect(payMethodFor("CASH")).toBe("cash");
    expect(payMethodFor("mobile_money")).toBe("orange_money");
    expect(payMethodFor("cheque")).toBeNull();
  });

  it("motif libre d'une perte → motif de Kanoo", () => {
    expect(lossReasonFor("Périmé (DLC dépassée)")).toBe("expired");
    expect(lossReasonFor("bouteille cassée")).toBe("broken");
    expect(lossReasonFor("offert au client")).toBe("offered");
    expect(lossReasonFor("repas du personnel")).toBe("staff");
    expect(lossReasonFor("??")).toBe("unknown");
  });

  it("noms comparés sans casse, accents ni ponctuation", () => {
    expect(sameName("Café au lait", "CAFE AU LAIT")).toBe(true);
    expect(sameName("Jus de bissap (maison)", "jus de bissap maison")).toBe(true);
    expect(sameName("Thé", "Thé vert")).toBe(false);
  });
});

describe("EasyPay — production et catalogue", () => {
  it("on prépare au moins ce qui est pré-commandé", () => {
    const rows = withPreorders(new Map([["a", 10], ["b", 2]]), new Map([["b", 5], ["c", 3]]));
    const by = Object.fromEntries(rows.map(r => [r.itemId, r.planned]));
    expect(by).toEqual({ a: 10, b: 5, c: 3 });
    expect(preorderPending("booked") && preorderPending("ready") && !preorderPending("picked_up") && !preorderPending("cancelled")).toBe(true);
  });

  it("l'empreinte du catalogue change avec un prix, pas avec l'ordre", () => {
    const a = [{ id: "1", name: "Pastel", price: 200 }, { id: "2", name: "Coca", price: 500 }];
    expect(catalogueVersion(a)).toBe(catalogueVersion([...a].reverse()));
    expect(catalogueVersion(a)).not.toBe(catalogueVersion([{ ...a[0], price: 250 }, a[1]]));
  });
});
