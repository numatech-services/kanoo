import { daysUntil, reminderDue, reminderMessage } from "@/lib/appels";
import { rankBrief, type BriefCandidate } from "@/lib/daily-brief";
import { notificationHref } from "@/lib/notification-link";
import { WITHHOLDING_SUFFERED } from "@/lib/payments";
import { SYSCOHADA_ACCOUNTS } from "@/lib/syscohada";

describe("Appels d'offres — rappels de date limite", () => {
  const now = new Date(2026, 9, 14, 9, 30);
  it("compte les jours civils restants, le jour même valant 0", () => {
    expect(daysUntil(new Date(2026, 9, 14, 23, 0), now)).toBe(0);
    expect(daysUntil(new Date(2026, 9, 15, 0, 5), now)).toBe(1);
    expect(daysUntil(new Date(2026, 9, 21), now)).toBe(7);
  });
  it("ne rappelle qu'à J-7, J-3, J-1 et le jour même", () => {
    const due = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(d => reminderDue(new Date(2026, 9, 14 + d), now));
    expect(due).toEqual([0, 1, 3, 7]);
  });
  it("signale les pièces manquantes", () => {
    const m = reminderMessage({ title: "Fourniture de matériel", reference: "AO-12", organism: "Mairie", requiredDocuments: [{ provided: true }, { provided: false }, { provided: false }] }, 1);
    expect(m).toContain("demain");
    expect(m).toContain("2 pièces encore à réunir");
    expect(reminderMessage({ title: "X", requiredDocuments: [{ provided: true }] }, 0)).toContain("Dossier complet");
  });
  it("mène la notification vers l'appel", () => {
    expect(notificationHref({ type: "tender_deadline", linkedId: "a1" })).toBe("/appels/a1");
  });
  it("passe un dépôt imminent devant des devis qui expirent", () => {
    const c = (kind: BriefCandidate["kind"], extra: Partial<BriefCandidate>): BriefCandidate => ({ kind, title: kind, why: "", href: "/", cta: "", ...extra });
    const r = rankBrief([c("quotes_expiring", { amount: 2_000_000, daysLeft: 5 }), c("tender_deadline", { amount: 2_000_000, daysLeft: 1 })]);
    expect(r[0].kind).toBe("tender_deadline");
    expect(r[0].tone).toBe("warn");
  });
});

describe("Retenue à la source subie", () => {
  it("se porte au compte 449200, présent au plan", () => {
    expect(WITHHOLDING_SUFFERED.accountCode).toBe("449200");
    expect(SYSCOHADA_ACCOUNTS.some((a: { code: string }) => a.code === "449200")).toBe(true);
  });
});
