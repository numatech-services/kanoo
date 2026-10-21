/**
 * Automatisations (lot D) : réglages, calendrier à l'heure de Niamey, seuils
 * budgétaires, découvert prévu, brief, sauvegarde (signature S3, chiffrement,
 * relecture), contrôles de la lecture de factures.
 *
 * Exécuter : npx jest __tests__/unit/automations.test.ts
 */
import zlib from "zlib";
import mongoose from "mongoose";
import {
  DEFAULT_AUTOMATION_SETTINGS, normalizeAutomationSettings, niameyDate, dayKey, previousMonth,
  packetPeriodDue, payrollReminderDue, isLastDayOfMonth, isSendDay, consumption, crossedThresholds,
  treasuryBreach, briefText, briefHtml, dateLabel,
} from "@/lib/automations";
import { signS3Request, encryptBackup, decryptBackup, parseBackup } from "@/lib/backup";
import { checkInvoice, normalizeExtraction, type ExtractedInvoice } from "@/lib/ai-invoice";

describe("réglages des automatisations", () => {
  it("vide → valeurs par défaut ; écrits et écritures désactivés d'office", () => {
    const s = normalizeAutomationSettings(undefined);
    expect(s).toEqual(DEFAULT_AUTOMATION_SETTINGS);
    expect(s.morningBrief.enabled).toBe(false);
    expect(s.accountantPacket.enabled).toBe(false);
    expect(s.depreciation.enabled).toBe(false);
    expect(s.cotisationReminders.enabled).toBe(false);
    expect(s.treasuryAlert.enabled).toBe(true);
    expect(s.approvalReminders.enabled).toBe(true);
  });

  it("borne les nombres, filtre canaux, jours, adresses et identifiants", () => {
    const s = normalizeAutomationSettings({
      morningBrief: { enabled: true, channels: ["email", "fax", "email"], days: [1, 9, 3, "x"], recipientIds: ["507f1f77bcf86cd799439011", "pas-un-id"] },
      payroll: { reminderDay: 45 },
      approvalReminders: { afterHours: 1 },
      accountantPacket: { enabled: true, emails: ["Cabinet@Exemple.ne", "faux@", "cabinet@exemple.ne"], day: 0 },
      budgetAlerts: { thresholds: [100, 80, 5, 80] },
      cotisationReminders: { channels: [] },
    });
    expect(s.morningBrief.channels).toEqual(["email"]);
    expect(s.morningBrief.days).toEqual([1, 3]);
    expect(s.morningBrief.recipientIds).toEqual(["507f1f77bcf86cd799439011"]);
    expect(s.payroll.reminderDay).toBe(28);
    expect(s.approvalReminders.afterHours).toBe(12);
    expect(s.accountantPacket.emails).toEqual(["cabinet@exemple.ne"]);
    expect(s.accountantPacket.day).toBe(1);
    expect(s.budgetAlerts.thresholds).toEqual([80, 100]);
    expect(s.cotisationReminders.channels).toEqual([]);
  });
});

describe("calendrier (heure de Niamey, UTC+1)", () => {
  it("23 h 30 UTC le 31 est déjà le 1er à Niamey", () => {
    const d = niameyDate(new Date("2026-10-31T23:30:00Z"));
    expect([d.year, d.month, d.day]).toEqual([2026, 11, 1]);
    expect(dayKey(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });
  it("mois précédent, y compris en janvier", () => {
    expect(previousMonth(2027, 1)).toEqual({ year: 2026, month: 12 });
    expect(previousMonth(2026, 10)).toEqual({ year: 2026, month: 9 });
  });
  it("dossier du comptable dû à partir du jour réglé, pour le mois écoulé", () => {
    expect(packetPeriodDue(new Date("2026-11-04T08:00:00Z"), 5)).toBeNull();
    expect(packetPeriodDue(new Date("2026-11-05T08:00:00Z"), 5)).toEqual({ year: 2026, month: 10 });
    expect(packetPeriodDue(new Date("2026-11-09T08:00:00Z"), 5)).toEqual({ year: 2026, month: 10 }); // rattrapage
  });
  it("rappel de paie et dernier jour du mois", () => {
    expect(payrollReminderDue(new Date("2026-10-24T08:00:00Z"), 25)).toBeNull();
    expect(payrollReminderDue(new Date("2026-10-25T08:00:00Z"), 25)).toEqual({ year: 2026, month: 10 });
    expect(isLastDayOfMonth(new Date("2026-02-28T08:00:00Z"))).toBe(true);
    expect(isLastDayOfMonth(new Date("2028-02-28T08:00:00Z"))).toBe(false); // bissextile
  });
  it("jours d'envoi du brief (lundi–vendredi)", () => {
    expect(isSendDay(new Date("2026-10-19T06:00:00Z"), [1, 2, 3, 4, 5])).toBe(true);  // lundi
    expect(isSendDay(new Date("2026-10-18T06:00:00Z"), [1, 2, 3, 4, 5])).toBe(false); // dimanche
    expect(dateLabel(new Date("2026-10-19T06:00:00Z"))).toBe("lundi 19 octobre");
  });
});

describe("seuils budgétaires", () => {
  it("consommation et seuil le plus haut franchi", () => {
    expect(consumption(850_000, 1_000_000)).toBe(85);
    expect(consumption(10, 0)).toBeNull();
    expect(crossedThresholds(85, [80, 100])).toEqual([80]);
    expect(crossedThresholds(120, [80, 100])).toEqual([100, 80]);
    expect(crossedThresholds(50, [80, 100])).toEqual([]);
    expect(crossedThresholds(null, [80])).toEqual([]);
  });
});

describe("découvert prévu", () => {
  const now = new Date("2026-10-21T00:00:00Z");
  const week = (i: number, balance: number) => ({ start: new Date(now.getTime() + i * 7 * 86_400_000), balance });
  it("première semaine sous le seuil, et point le plus bas dans l'horizon", () => {
    const r = treasuryBreach([week(0, 500_000), week(1, -200_000), week(2, -650_000), week(3, 100_000)], 0, 30, now);
    expect(r?.balance).toBe(-200_000);
    expect(r?.lowest).toBe(-650_000);
  });
  it("au-delà de l'horizon, rien n'est signalé", () => {
    expect(treasuryBreach([week(0, 100), week(6, -1)], 0, 30, now)).toBeNull();
  });
  it("seuil positif (matelas de sécurité)", () => {
    expect(treasuryBreach([week(0, 900_000), week(1, 400_000)], 500_000, 30, now)?.balance).toBe(400_000);
  });
});

describe("brief du matin", () => {
  const opts = { firstName: "Awa", tenantName: "Numa <test>", cash: 1_250_000, items: [{ title: "Relancer 2 factures", why: "Échues depuis 12 jours", href: "/invoices" }], baseUrl: "https://kanoo.ne", dateLabel: "lundi 19 octobre" };
  it("texte WhatsApp : trésorerie, priorités numérotées, lien", () => {
    const t = briefText(opts);
    expect(t).toContain("Bonjour Awa");
    expect(t).toContain("1 250 000 FCFA");
    expect(t).toContain("1. Relancer 2 factures — Échues depuis 12 jours");
    expect(t).toContain("https://kanoo.ne/dashboard");
  });
  it("HTML échappé : un nom d'organisation ne peut pas injecter de balise", () => {
    const h = briefHtml(opts);
    expect(h).toContain("Numa &lt;test&gt;");
    expect(h).not.toContain("<test>");
    expect(h).toContain('href="https://kanoo.ne/invoices"');
  });
  it("rien d'urgent", () => {
    expect(briefText({ ...opts, items: [], cash: null })).toContain("Rien d'urgent");
  });
});

describe("sauvegarde", () => {
  it("signature AWS v4 : exemple de référence de la documentation S3 (GET Object)", () => {
    const h = signS3Request({
      method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", region: "us-east-1",
      accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      now: new Date("2013-05-24T00:00:00Z"), headers: { Range: "bytes=0-9" },
    });
    expect(h.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("chiffrement : aller-retour, mauvaise clé et fichier altéré refusés", () => {
    const key = "une-phrase-de-passe-assez-longue";
    const blob = encryptBackup(Buffer.from("données"), key);
    expect(blob.subarray(0, 4).toString()).toBe("KNB1");
    expect(decryptBackup(blob, key).toString()).toBe("données");
    expect(() => decryptBackup(blob, "une-autre-phrase-de-passe-longue")).toThrow(/clé incorrecte/);
    const altered = Buffer.from(blob); altered[altered.length - 1] ^= 1;
    expect(() => decryptBackup(altered, key)).toThrow(/altéré/);
    expect(() => decryptBackup(Buffer.from("pas une archive"), key)).toThrow(/invalide/);
  });

  it("relecture : les types (ObjectId, dates) sont restaurés", () => {
    const EJSON = mongoose.mongo.BSON.EJSON;
    const id = new mongoose.Types.ObjectId();
    const doc = { _id: id, at: new Date("2026-10-21T08:00:00Z"), amount: 1500 };
    const lines = [
      JSON.stringify({ kanooBackup: 1, createdAt: "2026-10-21T02:00:00Z", database: "kanoo", collections: { invoices: 1 } }),
      JSON.stringify({ c: "invoices", d: EJSON.serialize(doc, { relaxed: false }) }),
    ];
    const { header, collections } = parseBackup(zlib.gzipSync(Buffer.from(lines.join("\n") + "\n")));
    expect(header.collections).toEqual({ invoices: 1 });
    const [back] = collections.get("invoices") as Array<typeof doc>;
    expect(back._id).toBeInstanceOf(mongoose.mongo.ObjectId);
    expect(String(back._id)).toBe(String(id));
    expect(back.at).toBeInstanceOf(Date);
    // EJSON canonique : le type BSON exact revient (Int32 ici), pour une
    // restauration à l'identique — pas un nombre JavaScript générique.
    expect((back.amount as unknown as { _bsontype?: string })._bsontype).toBe("Int32");
    expect(Number(back.amount)).toBe(1500);
  });
});

describe("lecture des factures fournisseurs", () => {
  const base: ExtractedInvoice = {
    isInvoice: true, supplierName: " Quincaillerie du Fleuve ", supplierNif: "", invoiceNumber: "F-2026-118",
    invoiceDate: "2026-10-12", dueDate: "31/10/2026", currency: "xof",
    lines: [
      { description: "Ciment 50 kg", quantity: 10, unitPriceHT: 5_000, tvaRate: 0.19, accountCode: "604000" },
      { description: "", quantity: 1, unitPriceHT: 100, tvaRate: 0, accountCode: "604000" },
      { description: "Transport", quantity: 1, unitPriceHT: 10_000, tvaRate: 0.33, accountCode: "999999" },
    ],
    totalHT: 60_000, totalTVA: 9_500, totalTTC: 69_500, notes: "",
  };
  it("normalise : dates non ISO vidées, taux et comptes hors liste ramenés, lignes vides retirées", () => {
    const x = normalizeExtraction(base);
    expect(x.supplierName).toBe("Quincaillerie du Fleuve");
    expect(x.dueDate).toBe("");
    expect(x.currency).toBe("XOF");
    expect(x.lines).toHaveLength(2);
    expect(x.lines[1].tvaRate).toBe(0);
    expect(x.lines[1].accountCode).toBe("605500");
  });
  it("signale un TTC qui ne retombe pas sur HT + TVA, et une devise étrangère", () => {
    const x = normalizeExtraction(base);
    expect(checkInvoice(x)).toEqual([]);
    expect(checkInvoice({ ...x, totalTTC: 80_000 }).join(" ")).toMatch(/ne retombe pas sur le TTC/);
    expect(checkInvoice({ ...x, currency: "EUR" }).join(" ")).toMatch(/convertissez/);
  });
});

describe("journal des erreurs : regroupement", () => {
  // Import local : lib/error-log tire la connexion à la base, inutile ici.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fingerprint } = require("@/lib/error-log") as typeof import("@/lib/error-log");
  it("navigateur : même message, avec ou sans pile, une seule ligne", () => {
    expect(fingerprint({ source: "client", message: "TypeError: x is undefined", stack: "at f (app.js:1:2)" }))
      .toBe(fingerprint({ source: "client", message: "TypeError: x is undefined" }));
  });
  it("identifiants et nombres variables ignorés", () => {
    expect(fingerprint({ source: "api", message: "Facture 6ad8ccdba1cdbaa241349e74 introuvable (412)" }))
      .toBe(fingerprint({ source: "api", message: "Facture 6ad8cceda1cdbaa24134a177 introuvable (9)" }));
  });
  it("serveur : deux pannes de même message à deux endroits restent distinctes", () => {
    expect(fingerprint({ source: "api", message: "Error: boom", stack: "Error: boom\n    at a (/app/lib/x.js:10:5)" }))
      .not.toBe(fingerprint({ source: "api", message: "Error: boom", stack: "Error: boom\n    at b (/app/lib/y.js:3:1)" }));
  });
});
