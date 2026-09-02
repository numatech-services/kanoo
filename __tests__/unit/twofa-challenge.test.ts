import { signTwoFactorChallenge, verifyTwoFactorChallenge, signToken, verifyToken } from "@/lib/auth";

const payload = {
  userId: "u1", tenantId: "t1", tenantType: "pme", role: "pme_admin",
  email: "a@b.ne", subscriptionStatus: "active", planModules: ["*"],
} as unknown as Parameters<typeof signToken>[0];

describe("Défi 2FA (auth)", () => {
  it("fait un aller-retour valide", () => {
    const token = signTwoFactorChallenge("u1");
    expect(verifyTwoFactorChallenge(token)).toEqual({ uid: "u1" });
  });

  it("rejette un jeton invalide", () => {
    expect(verifyTwoFactorChallenge("garbage")).toBeNull();
  });

  it("un jeton de session n'est PAS un défi 2FA valide", () => {
    const session = signToken(payload);
    expect(verifyTwoFactorChallenge(session)).toBeNull();
  });

  it("un défi 2FA ne peut JAMAIS servir de session (secret dérivé)", () => {
    const challenge = signTwoFactorChallenge("u1");
    expect(() => verifyToken(challenge)).toThrow();
  });

  it("le jeton de session reste vérifiable normalement", () => {
    const session = signToken(payload);
    expect(verifyToken(session).userId).toBe("u1");
  });
});
