/**
 * Politique de mot de passe.
 *
 * Jusqu'ici il n'y en avait aucune : un compte pouvait être créé avec le mot
 * de passe « a ». Ces tests fixent ce qui passe et ce qui ne passe pas.
 */

import {
  MIN_LENGTH, checkPassword, passwordErrors, isAcceptable, temporaryPassword,
} from "@/lib/password-policy";

const IDENTITY = {
  email: "aicha.moussa@numatech.ne",
  firstName: "Aïcha",
  lastName: "Moussa",
  tenantName: "NUMATECH SERVICES",
};

describe("Ce qui est accepté", () => {
  it("accepte une phrase de passe simple", () => {
    // La longueur suffit : c'est le choix de fond de la politique.
    expect(isAcceptable("le thé de 16h à Dosso", IDENTITY)).toBe(true);
  });

  it("n'exige ni majuscule, ni chiffre, ni symbole", () => {
    // Les règles de composition produisent « Passw0rd! » — plus faible et
    // systématiquement noté sur un papier.
    expect(isAcceptable("marchandeoignon", IDENTITY)).toBe(true);
  });

  it("accepte un mot de passe long généré par un gestionnaire", () => {
    expect(isAcceptable("xK9#mLp2$vQr7!nWz4", IDENTITY)).toBe(true);
  });
});

describe("Ce qui est refusé", () => {
  it("refuse en dessous du minimum", () => {
    expect(checkPassword("court")).toContain("too_short");
    expect(checkPassword("a".repeat(MIN_LENGTH - 1))).toContain("too_short");
  });

  it("refuse les mots de passe les plus répandus", () => {
    expect(checkPassword("motdepasse123")).toContain("common");
    expect(checkPassword("azerty123456")).toContain("common");
  });

  it("ignore casse, accents et séparateurs dans la comparaison", () => {
    // « M0tDePasse-123 » n'est pas plus sûr que « motdepasse123 ».
    expect(checkPassword("MotDePasse-123")).toContain("common");
  });

  it("refuse un caractère répété, même assez long", () => {
    expect(checkPassword("aaaaaaaaaaaaaaaa")).toContain("repeated");
  });

  it("refuse une suite de touches voisines", () => {
    expect(checkPassword("azertyuiop")).toEqual(
      expect.arrayContaining(["sequential"])
    );
    expect(checkPassword("0123456789012")).toContain("sequential");
  });

  it("refuse ce qui dérive du nom ou de l'organisation", () => {
    for (const candidate of [
      "aichaaicha1234", "moussamoussa12", "numatechservices2026", "aicha.moussa2026",
    ]) {
      expect(checkPassword(candidate, IDENTITY)).toContain("contains_identity");
    }
  });

  it("ne se laisse pas contourner par les accents du prénom", () => {
    expect(checkPassword("aïchaaïcha1234", IDENTITY)).toContain("contains_identity");
  });

  it("ignore les fragments d'identité trop courts pour signifier quelque chose", () => {
    // Un nom de trois lettres ne doit pas interdire la moitié du dictionnaire.
    expect(checkPassword("ali est un prénom", { firstName: "Ali" }))
      .not.toContain("contains_identity");
  });

  it("refuse un mot de passe fait d'espaces", () => {
    expect(checkPassword(" ".repeat(14))).toContain("whitespace_only");
  });
});

describe("Restitution des problèmes", () => {
  it("les renvoie tous d'un coup, pas un par un", () => {
    // Corriger un défaut pour se heurter au suivant, trois fois de suite, est
    // la façon la plus sûre de faire choisir « Motdepasse2026! ».
    const problems = checkPassword("aicha", IDENTITY);
    expect(problems.length).toBeGreaterThan(1);
  });

  it("explique en français ce qu'il faut corriger", () => {
    const messages = passwordErrors("court", IDENTITY);
    expect(messages[0]).toMatch(/12 caractères/);
    expect(messages[0]).toMatch(/phrase/);
  });

  it("ne renvoie rien sur un mot de passe valable", () => {
    expect(passwordErrors("le thé de 16h à Dosso", IDENTITY)).toEqual([]);
  });
});

describe("Mot de passe temporaire", () => {
  it("satisfait la politique qu'il doit servir", () => {
    for (let i = 0; i < 50; i++) {
      expect(isAcceptable(temporaryPassword())).toBe(true);
    }
  });

  it("reste dictable au téléphone", () => {
    const value = temporaryPassword();
    // Aucun `0` ni `1` : sans eux, les lettres `o` et `i` ne peuvent se
    // confondre avec un chiffre à la dictée.
    expect(value).not.toMatch(/[01lLqQ]/);
    expect(value.split("-")).toHaveLength(4);
  });

  it("ne se répète pas", () => {
    const seen = new Set(Array.from({ length: 200 }, () => temporaryPassword()));
    expect(seen.size).toBe(200);
  });
});
