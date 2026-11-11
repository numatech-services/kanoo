import { Types } from "mongoose";
import { entryCore, entryMutable, auditCore, currentSealKey, signText, verifyText, isSerious } from "@/lib/audit-seal";

const id = new Types.ObjectId();
const entry = { _id: id, tenantId: new Types.ObjectId(), journalCode: "OD", entryDate: new Date("2026-11-01"), reference: "R1", label: "L1",
  lines: [{ accountCode: "627000", accountLabel: "Publicité", debit: 1000, credit: 0, thirdPartyId: undefined }, { accountCode: "471000", accountLabel: "Divers", debit: 0, credit: 1000 }],
  createdBy: new Types.ObjectId() };

describe("empreintes du scellement", () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });
  it("le libellé et la référence ne touchent pas le noyau", () => {
    expect(entryCore({ ...entry, label: "autre", reference: "R2" })).toBe(entryCore(entry));
    expect(entryMutable({ ...entry, label: "autre" })).not.toBe(entryMutable(entry));
  });
  it("montant, compte, tiers ou date changent le noyau", () => {
    const base = entryCore(entry);
    expect(entryCore({ ...entry, lines: [{ ...entry.lines[0], debit: 1001 }, entry.lines[1]] })).not.toBe(base);
    expect(entryCore({ ...entry, lines: [{ ...entry.lines[0], thirdPartyId: new Types.ObjectId() }, entry.lines[1]] })).not.toBe(base);
    expect(entryCore({ ...entry, entryDate: new Date("2026-10-01") })).not.toBe(base);
  });
  it("journal d'audit : l'adresse IP et le rôle font partie de l'empreinte", () => {
    const a = { _id: id, tenantId: id, action: "UPDATE", resource: "users", ip: "1.1.1.1", userRole: "pme_admin", createdAt: new Date() };
    expect(auditCore({ ...a, ip: "2.2.2.2" })).not.toBe(auditCore(a));
    expect(auditCore({ ...a, userRole: "x" })).not.toBe(auditCore(a));
  });
  it("clé : obligatoire en production, distincte de JWT_SECRET, 32 caractères", () => {
    process.env = { ...OLD, NODE_ENV: "production", AUDIT_SEAL_KEY: "" };
    expect(() => currentSealKey()).toThrow(/absente/);
    process.env = { ...OLD, NODE_ENV: "production", AUDIT_SEAL_KEY: "court" };
    expect(() => currentSealKey()).toThrow(/courte/);
    process.env = { ...OLD, NODE_ENV: "production", AUDIT_SEAL_KEY: "k".repeat(40), JWT_SECRET: "k".repeat(40) };
    expect(() => currentSealKey()).toThrow(/différer/);
  });
  it("signature d'un rapport figé : vérifiée, et refusée après altération ou avec une clé inconnue", () => {
    process.env = { ...OLD, NODE_ENV: "production", AUDIT_SEAL_KEY: "a".repeat(40), JWT_SECRET: "b".repeat(40) };
    const { kid, sig } = signText("rapport|abc");
    expect(verifyText("rapport|abc", kid, sig)).toBe(true);
    expect(verifyText("rapport|abd", kid, sig)).toBe(false);
    process.env = { ...OLD, NODE_ENV: "production", AUDIT_SEAL_KEY: "c".repeat(40), JWT_SECRET: "b".repeat(40) };
    expect(verifyText("rapport|abc", kid, sig)).toBe(false);
    process.env = { ...OLD, NODE_ENV: "production", AUDIT_SEAL_KEY: "c".repeat(40), AUDIT_SEAL_KEYS_OLD: "a".repeat(40), JWT_SECRET: "b".repeat(40) };
    expect(verifyText("rapport|abc", kid, sig)).toBe(true);
  });
  it("gravité : seule une modification tracée et le premier scellement tardif sont bénins", () => {
    expect(isSerious({ type: "modified", traced: true, seq: 1, detail: "" })).toBe(false);
    expect(isSerious({ type: "modified", traced: false, seq: 1, detail: "" })).toBe(true);
    expect(isSerious({ type: "late", seq: 1, detail: "" })).toBe(false);
    expect(isSerious({ type: "late", seq: 3, detail: "" })).toBe(true);
    expect(isSerious({ type: "backdated", seq: 2, detail: "" })).toBe(true);
  });
});
