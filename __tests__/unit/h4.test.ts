import { holidaysOf, holidaySet, easterSunday } from "@/lib/holidays";
import { workingDays } from "@/lib/leaves";
import { finalSettlement } from "@/lib/final-settlement";
import { scheduleState, validateSchedule, splitEvenly, scheduleBase } from "@/lib/installments";
import { fecRows, fecDate, FEC_HEADER } from "@/lib/fec";
import { foreignAmount, rateOf } from "@/lib/currency";
import { nextPeriod } from "@/lib/contract-billing";
import { composeBody, composeSms } from "@/lib/dunning";

describe("Jours fériés du Niger", () => {
  test("Pâques 2026 le 5 avril, lundi de Pâques férié", () => {
    expect(easterSunday(2026).toDateString()).toBe(new Date(2026, 3, 5).toDateString());
    expect(holidaysOf(2026).some(h => h.date === "2026-04-06" && /Pâques/.test(h.label))).toBe(true);
  });
  test("fêtes civiles et Tabaski 2026", () => {
    const d = holidaysOf(2026).map(h => h.date);
    for (const x of ["2026-01-01", "2026-04-24", "2026-05-01", "2026-08-03", "2026-12-18", "2026-12-25", "2026-05-27"]) expect(d).toContain(x);
  });
  test("ajout et retrait propres à l'organisation", () => {
    const d = holidaysOf(2026, { extra: [{ date: "2026-05-28", label: "Tabaski (arrêté)" }], removed: ["2026-05-27"] }).map(h => h.date);
    expect(d).toContain("2026-05-28");
    expect(d).not.toContain("2026-05-27");
  });
  test("un congé couvrant le 3 août ne le consomme pas", () => {
    // Du lundi 3 au samedi 8 août 2026 : 6 jours ouvrables, dont le 3 férié.
    const a = new Date(2026, 7, 3), b = new Date(2026, 7, 8);
    expect(workingDays(a, b)).toBe(6);
    expect(workingDays(a, b, false, false, holidaySet(a, b))).toBe(5);
  });
});

describe("Solde de tout compte", () => {
  test("sortie le 15 : demi-salaire et congés restants", () => {
    const s = finalSettlement({ exitDate: new Date(2026, 9, 15), startDate: new Date(2024, 0, 1), monthlyBase: 260_000, employeeType: "employee", leaveAvailable: 13 });
    expect(s.proratedBase).toBe(130_000);              // 260 000 × 15 / 30
    expect(s.leaveIndemnity).toBe(130_000);            // 13 j × 260 000 / 26
    expect(s.totalGross).toBe(260_000);
  });
  test("sortie le dernier jour : mois complet", () => {
    const s = finalSettlement({ exitDate: new Date(2026, 1, 28), startDate: new Date(2020, 0, 1), monthlyBase: 100_000, employeeType: "employee", leaveAvailable: 0 });
    expect(s.fullMonth).toBe(true);
    expect(s.proratedBase).toBe(100_000);
  });
  test("entrée et sortie dans le même mois", () => {
    const s = finalSettlement({ exitDate: new Date(2026, 9, 20), startDate: new Date(2026, 9, 11), monthlyBase: 90_000, employeeType: "employee", leaveAvailable: 0 });
    expect(s.daysPresent).toBe(10);
    expect(s.proratedBase).toBe(30_000);
  });
  test("stagiaire : pas d'indemnité de congés", () => {
    expect(finalSettlement({ exitDate: new Date(2026, 9, 15), startDate: new Date(2026, 0, 1), monthlyBase: 50_000, employeeType: "intern", leaveAvailable: 10 }).leaveIndemnity).toBe(0);
  });
});

describe("Échéancier de paiement", () => {
  const inv = { totalTTC: 300_000, status: "sent" };
  test("répartition égale, total exact", () => {
    const l = splitEvenly(100_000, 3, new Date(2026, 0, 31));
    expect(l.map(x => x.amount)).toEqual([33_333, 33_333, 33_334]);
    expect(validateSchedule(100_000, l)).toBeNull();
  });
  test("refuse un total faux ou des dates en désordre", () => {
    expect(validateSchedule(100, [{ dueDate: "2026-01-01", amount: 50 }])).toMatch(/total/);
    expect(validateSchedule(100, [{ dueDate: "2026-02-01", amount: 50 }, { dueDate: "2026-01-01", amount: 50 }])).toMatch(/suivre/);
  });
  test("base : avoirs et retenue déduits", () => {
    expect(scheduleBase({ totalTTC: 1000, creditedAmount: 100, retentionAmount: 50, status: "sent" })).toBe(850);
  });
  test("les règlements couvrent les premiers versements ; l'échéance en cours suit", () => {
    const installments = [{ dueDate: "2026-01-31", amount: 100_000 }, { dueDate: "2026-02-28", amount: 100_000 }, { dueDate: "2026-03-31", amount: 100_000 }];
    const s = scheduleState({ ...inv, paidAmount: 150_000, installments }, new Date(2026, 2, 5));
    expect(s.currentIndex).toBe(1);
    expect(s.rows.map(r => r.status)).toEqual(["paid", "late", "due"]);
    expect(s.dueNow).toBe(50_000);
  });
  test("sans échéancier : exigible à l'échéance de la facture", () => {
    const s = scheduleState({ ...inv, paidAmount: 100_000, dueDate: "2026-01-31" }, new Date(2026, 1, 1));
    expect(s.dueNow).toBe(200_000);
  });
});

describe("FEC", () => {
  const entries = [{
    _id: "e1", journalCode: "VT", entryDate: new Date("2026-10-27T23:30:00.000Z"), reference: "FAC-2026-00001", label: "Facture | client", createdAt: new Date("2026-10-27T23:30:00.000Z"),
    lines: [
      { accountCode: "411000", accountLabel: "Clients", debit: 119_000, credit: 0, thirdPartyId: "c1", letterRef: "AA", letteredAt: new Date("2026-11-02T10:00:00Z") },
      { accountCode: "706000", accountLabel: "Prestations", debit: 0, credit: 100_000 },
      { accountCode: "443000", accountLabel: "TVA", debit: 0, credit: 19_000 },
    ],
  }];
  const rows = fecRows(entries, new Map([["c1", { num: "CLI-001", name: "Société A" }]]));
  test("un numéro par écriture, pas par ligne", () => {
    expect(rows[0]).toBe(FEC_HEADER);
    expect(new Set(rows.slice(1).map(r => r.split("|")[2]))).toEqual(new Set(["00000001"]));
  });
  test("tiers sur la ligne de classe 4, lettrage daté", () => {
    const c = rows[1].split("|");
    expect(c[6]).toBe("CLI-001");
    expect(c[7]).toBe("Société A");
    expect(c[13]).toBe("AA");
    expect(c[14]).toBe("20261102");
    expect(rows[2].split("|")[6]).toBe("");
  });
  test("date au jour de Niamey (UTC+1) et montants à virgule", () => {
    expect(fecDate(new Date("2026-10-27T23:30:00.000Z"))).toBe("20261028");
    expect(rows[1].split("|")[11]).toBe("119000,00");
    expect(rows[1]).not.toMatch(/Facture \| client/);
  });
});

describe("Devises et contrats", () => {
  test("euro à parité fixe ; autre devise au cours saisi", () => {
    expect(rateOf("EUR")).toBe(655.957);
    expect(foreignAmount(655_957, "EUR")).toBe(1000);
    expect(foreignAmount(60_000, "USD")).toBeNull();
    expect(foreignAmount(60_000, "USD", 600)).toBe(100);
    expect(foreignAmount(1000, "XOF")).toBeNull();
  });
  test("période suivante d'un contrat récurrent", () => {
    expect(nextPeriod(new Date(2026, 0, 15), "quarterly").getMonth()).toBe(3);
    expect(nextPeriod(new Date(2026, 0, 15), "annual").getFullYear()).toBe(2027);
    expect(nextPeriod(new Date(2026, 0, 15)).getMonth()).toBe(1);
  });
});

describe("Relance avec lien de paiement", () => {
  const ctx = { clientName: "Société A", invoiceNumber: "FAC-1", outstanding: 50_000, dueDate: new Date(2026, 0, 1), daysPastDue: 10, tenantName: "NUMA", payLink: "https://kanoo.test/client/abc" };
  test("le lien est dans le corps, avant la signature", () => {
    const b = composeBody("reminder", ctx);
    expect(b).toContain("régler en ligne");
    expect(b.indexOf(ctx.payLink)).toBeLessThan(b.indexOf("Cordialement"));
  });
  test("sans lien : texte inchangé ; SMS avec lien sur deux messages au plus", () => {
    expect(composeBody("reminder", { ...ctx, payLink: undefined })).not.toContain("en ligne");
    expect(composeSms("firm", ctx).length).toBeLessThanOrEqual(306);
    expect(composeSms("firm", ctx)).toContain(ctx.payLink);
  });
});
