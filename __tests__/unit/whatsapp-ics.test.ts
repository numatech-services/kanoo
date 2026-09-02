import { normalizePhone } from "@/lib/whatsapp";
import { buildIcs } from "@/lib/ics";

describe("WhatsApp — normalisation des numéros", () => {
  it("préfixe l'indicatif Niger pour un numéro local à 8 chiffres", () => {
    expect(normalizePhone("90123456")).toBe("22790123456");
    expect(normalizePhone("90 12 34 56")).toBe("22790123456");
  });
  it("gère le format international", () => {
    expect(normalizePhone("+22790123456")).toBe("22790123456");
    expect(normalizePhone("0022790123456")).toBe("22790123456");
  });
});

describe("ICS — invitation calendrier", () => {
  const ics = buildIcs({
    uid: "x@kanoo",
    title: "Assemblée, générale",
    location: "Niamey; Palais",
    start: new Date("2026-09-15T09:00:00Z"),
    end: new Date("2026-09-15T11:00:00Z"),
  });

  it("contient un VEVENT bien formé", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("DTSTART:20260915T090000Z");
    expect(ics).toContain("DTEND:20260915T110000Z");
  });

  it("échappe les caractères spéciaux (virgule, point-virgule)", () => {
    expect(ics).toContain("SUMMARY:Assemblée\\, générale");
    expect(ics).toContain("LOCATION:Niamey\\; Palais");
  });
});
