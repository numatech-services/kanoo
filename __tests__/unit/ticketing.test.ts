import { generateTicketCode, signTicket, buildQrPayload, parseQrPayload, verifyTicket } from "@/lib/ticketing";

describe("Billetterie — codes & QR signés", () => {
  it("génère un code de secours lisible et unique", () => {
    const c = generateTicketCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/); // sans I,O,0,1,L
    const many = new Set(Array.from({ length: 200 }, () => generateTicketCode()));
    expect(many.size).toBe(200);
  });

  it("signe de façon déterministe", () => {
    const sig1 = signTicket("attendee1", "ABCDE-FGHJK");
    const sig2 = signTicket("attendee1", "ABCDE-FGHJK");
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(32);
    expect(signTicket("attendee2", "ABCDE-FGHJK")).not.toBe(sig1);
  });

  it("fait un aller-retour QR payload → parse", () => {
    const payload = buildQrPayload("attendee1", "ABCDE-FGHJK");
    const parsed = parseQrPayload(payload);
    expect(parsed).toEqual({ attendeeId: "attendee1", ticketCode: "ABCDE-FGHJK", sig: expect.any(String) });
  });

  it("rejette un payload malformé", () => {
    expect(parseQrPayload("n'importe quoi")).toBeNull();
    expect(parseQrPayload("KANOO1.a.b")).toBeNull();
    expect(parseQrPayload("AUTRE.a.b.c")).toBeNull();
  });

  it("vérifie un billet authentique et rejette les contrefaçons", () => {
    const id = "attendee1", code = "ABCDE-FGHJK";
    const payload = buildQrPayload(id, code);
    const { sig } = parseQrPayload(payload)!;
    expect(verifyTicket(id, code, sig)).toBe(true);
    // signature falsifiée
    expect(verifyTicket(id, code, "0".repeat(32))).toBe(false);
    // code modifié
    expect(verifyTicket(id, "ZZZZZ-ZZZZZ", sig)).toBe(false);
    // id modifié
    expect(verifyTicket("attendeeX", code, sig)).toBe(false);
  });
});
