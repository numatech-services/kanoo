import { generateSecret, generateTotp, verifyTotp, buildOtpauthUri, generateBackupCodes } from "@/lib/totp";

describe("TOTP (2FA)", () => {
  it("génère un secret base32 non trivial", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(30);
    expect(generateSecret()).not.toBe(s); // aléatoire
  });

  it("accepte le code courant et refuse un mauvais code", () => {
    const s = generateSecret();
    const code = generateTotp(s);
    expect(verifyTotp(s, code)).toBe(true);
    expect(verifyTotp(s, "000000")).toBe(false);
  });

  it("refuse un format invalide", () => {
    const s = generateSecret();
    expect(verifyTotp(s, "abc")).toBe(false);
    expect(verifyTotp(s, "12345")).toBe(false);
    expect(verifyTotp(s, "1234567")).toBe(false);
  });

  it("tolère une dérive d'horloge d'un pas (±30 s)", () => {
    const s = generateSecret();
    const prev = generateTotp(s, Date.now() - 30_000);
    const next = generateTotp(s, Date.now() + 30_000);
    expect(verifyTotp(s, prev, 1)).toBe(true);
    expect(verifyTotp(s, next, 1)).toBe(true);
  });

  it("refuse un code trop ancien hors fenêtre", () => {
    const s = generateSecret();
    const old = generateTotp(s, Date.now() - 5 * 60_000);
    expect(verifyTotp(s, old, 1)).toBe(false);
  });

  it("produit une URI otpauth valide", () => {
    const s = generateSecret();
    const uri = buildOtpauthUri(s, "user@kanoo.ne", "Kanoo");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${s}`);
    expect(uri).toContain("issuer=Kanoo");
  });

  it("génère des codes de secours uniques au bon format", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    codes.forEach((c) => expect(c).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/));
    expect(new Set(codes).size).toBe(10);
  });
});
