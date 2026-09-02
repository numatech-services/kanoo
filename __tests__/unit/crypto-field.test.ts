import { encryptField, decryptField, isEncrypted } from "@/lib/crypto-field";

describe("Chiffrement de champ (AES-256-GCM)", () => {
  it("chiffre puis déchiffre à l'identique", () => {
    const plain = "JBSWY3DPEHPK3PXP-secret";
    const enc = encryptField(plain);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptField(enc)).toBe(plain);
  });

  it("produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    const a = encryptField("meme-valeur");
    const b = encryptField("meme-valeur");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("meme-valeur");
    expect(decryptField(b)).toBe("meme-valeur");
  });

  it("tolère une valeur en clair (déploiement progressif)", () => {
    expect(isEncrypted("valeur-en-clair")).toBe(false);
    expect(decryptField("valeur-en-clair")).toBe("valeur-en-clair");
  });

  it("détecte l'altération (tag GCM) et refuse de déchiffrer", () => {
    const enc = encryptField("integrite");
    const parts = enc.split(":");
    // corrompre le ciphertext
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("xxxx").toString("base64")].join(":");
    expect(() => decryptField(tampered)).toThrow();
  });
});
