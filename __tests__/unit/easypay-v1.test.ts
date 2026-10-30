import { createHmac } from "crypto";
import { verifySignature, challengeResponse, parseHandshake, planV1, isV1Body } from "@/lib/easypay-v1";
import { parseEvent } from "@/lib/easypay";

const SECRET = "a".repeat(64);
const sign = (t: number, raw: string, secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
const NOW = 1_800_000_000_000;
const env = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  spec_version: "1", event_id: "0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a7b", type, sequence: 42, site: { id: "the-spot", name: "The Spot" },
  occurred_at: "2026-10-29T12:03:11+01:00", business_date: "2026-10-29", recorded_at: "2026-10-29T12:03:12+01:00", data, ...extra,
});

describe("contrat EasyPay v1 — signature", () => {
  const raw = JSON.stringify({ a: 1 });
  const t = NOW / 1000;
  it("accepte une signature juste dans la fenêtre de 300 s", () => {
    expect(verifySignature(sign(t, raw), raw, SECRET, NOW)).toBe(true);
    expect(verifySignature(sign(t - 299, raw), raw, SECRET, NOW)).toBe(true);
  });
  it("refuse une horloge écartée, un corps modifié, un autre secret, un en-tête mal formé", () => {
    expect(verifySignature(sign(t - 301, raw), raw, SECRET, NOW)).toBe(false);
    expect(verifySignature(sign(t, raw), raw + " ", SECRET, NOW)).toBe(false);
    expect(verifySignature(sign(t, raw, "b".repeat(64)), raw, SECRET, NOW)).toBe(false);
    expect(verifySignature(null, raw, SECRET, NOW)).toBe(false);
    expect(verifySignature(`t=${t}`, raw, SECRET, NOW)).toBe(false);
  });
  it("prend le secret tel quel (chaîne de 64 caractères), sans décodage hexadécimal", () => {
    expect(challengeResponse("abc", SECRET)).toBe(createHmac("sha256", SECRET).update("abc").digest("hex"));
  });
});

describe("contrat EasyPay v1 — poignée de main", () => {
  it("lit la poignée de main et refuse un secret mal formé", () => {
    const hs = { spec_version: "1", type: "handshake", site: { id: "the-spot", name: "The Spot" }, signing_secret: SECRET, challenge: "3b7f0c2d9a8e4f6b1c5d7e9f0a2b4c6d" };
    expect(parseHandshake(hs)).toMatchObject({ ok: true, siteId: "the-spot", secret: SECRET });
    expect(parseHandshake({ ...hs, signing_secret: "xyz" }).ok).toBe(false);
    expect(parseHandshake({ ...hs, spec_version: "2" }).ok).toBe(false);
  });
});

describe("contrat EasyPay v1 — événements", () => {
  const sale = env("sale.recorded", {
    sale_id: "01a18a27-f8c0-7b21-9d55-1c2e3f4a5b6c", ticket_number: 118, price_category: "student",
    total_amount: 1400, payments: [{ method: "card", amount: 800 }, { method: "cash", amount: 600 }, { method: "mobile_money", amount: 0 }],
    lines: [
      { kind: "formula", ref_id: "f-ameliore", label: "Formule améliorée", quantity: 1, unit_price_amount: 800, amount: 800, component_labels: ["Riz"] },
      { kind: "item", ref_id: "kilichi", label: "Kilichi", quantity: 1, unit_price_amount: 600, amount: 600, component_labels: [] },
    ],
  });
  it("distingue le contrat v1 de l'ancien lot", () => {
    expect(isV1Body(sale)).toBe(true);
    expect(isV1Body({ events: [] })).toBe(false);
  });
  it("une vente devient un ticket Kanoo lisible : solde EasyPay et espèces, paiement nul écarté", () => {
    const p = planV1(sale);
    expect(p.kind).toBe("apply");
    const parsed = parseEvent((p as { raw: unknown }).raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.event.type === "sale") {
      expect(parsed.event.data.payments).toEqual([{ method: "easypay", amount: 800 }, { method: "cash", amount: 600 }]);
      expect(parsed.event.data.number).toBe("118");
      expect(parsed.event.data.lines.map(l => l.item.id)).toEqual(["f-ameliore", "kilichi"]);
    }
  });
  it("vente annulée avant d'arriver au serveur, tiroir ouvert : gardés pour trace, sans écriture", () => {
    expect(planV1({ ...sale, data: { ...sale.data, voided_before_arrival: true } }).kind).toBe("log");
    expect(planV1(env("drawer.opened", { reason: "Monnaie" })).kind).toBe("log");
  });
  it("commande : statut converti et rang conservé pour l'ordre", () => {
    const p = planV1(env("order.updated", { order_id: "01a18a2a-2e33-7a5c-8c6d-7e8f9a0b1c2d", status: "handed_over", pickup_date: "2026-10-29", total_amount: 1000,
      lines: [{ kind: "item", ref_id: "premium-poulet", label: "Poulet braisé", quantity: 1, unit_price_amount: null, amount: null }] }));
    const parsed = parseEvent((p as { raw: unknown }).raw);
    expect(parsed.ok && parsed.event.type === "preorder" && parsed.event.data).toMatchObject({ status: "picked_up", pickupDay: "2026-10-29", sequence: 42, amount: 1000 });
  });
  it("bilan du jour : jour et révision ; type inconnu ignoré ; enveloppe invalide refusée", () => {
    expect(planV1(env("day.closed", { business_date: "2026-10-29", revision: 2 }))).toMatchObject({ kind: "day", businessDate: "2026-10-29", revision: 2 });
    expect(planV1(env("loyalty.points", {})).kind).toBe("ignored");
    expect(planV1({ ...sale, sequence: 0 }).kind).toBe("invalid");
    expect(planV1({ ...sale, event_id: "x" }).kind).toBe("invalid");
    expect(planV1(env("order.placed", { status: "lost" })).kind).toBe("invalid");
  });
});
