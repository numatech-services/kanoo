import crypto from "crypto";

/**
 * Politique de mot de passe.
 *
 * Le choix de fond : **la longueur plutôt que la composition**. Exiger une
 * majuscule, un chiffre et un symbole produit `Passw0rd!` — long à taper sur un
 * clavier de téléphone, facile à deviner, et systématiquement noté sur un
 * papier collé à l'écran. Une phrase de passe de douze caractères résiste
 * infiniment mieux et se retient.
 *
 * Ce qui est réellement filtré : le trop court, le trop évident, et ce qui
 * dérive de l'identité de la personne ou de son organisation — les trois
 * sources de la quasi-totalité des mots de passe cassés en pratique.
 */

export const MIN_LENGTH = 12;
export const MAX_LENGTH = 200;

/**
 * Les mots de passe les plus répandus, dans les formes qu'on rencontre ici.
 *
 * Liste courte et assumée : une liste de dix mille entrées embarquée dans le
 * paquet coûterait plus qu'elle ne rapporte face à un minimum de douze
 * caractères, qui élimine déjà la quasi-totalité de ces entrées.
 */
const COMMON = new Set([
  "motdepasse", "password", "azertyuiop", "qwertyuiop", "123456789012",
  "administrateur", "changemeplease", "passwordpassword", "motdepasse123",
  "azerty123456", "kanoo1234567", "niamey123456", "bienvenue123",
]);

export type PasswordProblem =
  | "too_short" | "too_long" | "common" | "contains_identity"
  | "repeated" | "sequential" | "whitespace_only";

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Trop court : ${MIN_LENGTH} caractères au minimum. Une phrase courte fait un bon mot de passe — « le thé de 16h à Dosso » se retient et se tape vite.`,
  too_long: `Trop long : ${MAX_LENGTH} caractères au maximum.`,
  common: "Ce mot de passe figure parmi les plus utilisés au monde : il serait trouvé en quelques secondes.",
  contains_identity: "Il contient votre nom, votre adresse ou celui de votre organisation — les trois premières choses que quelqu'un essaiera.",
  repeated: "Il ne contient qu'un caractère répété.",
  sequential: "Une suite de touches voisines se devine aussi vite qu'elle se tape.",
  whitespace_only: "Un mot de passe ne peut pas être composé uniquement d'espaces.",
};

export interface IdentityHints {
  email?: string;
  firstName?: string;
  lastName?: string;
  tenantName?: string;
}

/** Normalise pour comparer : accents, casse et séparateurs ne protègent rien. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const KEYBOARD_RUNS = [
  "azertyuiop", "qwertyuiop", "qsdfghjklm", "asdfghjkl",
  "wxcvbn", "zxcvbn", "0123456789", "9876543210",
];

/**
 * Valide un mot de passe.
 *
 * Renvoie **tous** les problèmes, pas seulement le premier : corriger un
 * défaut pour se heurter au suivant, trois fois de suite, est la façon la plus
 * sûre de faire choisir `Motdepasse2026!` à quelqu'un.
 */
export function checkPassword(password: string, identity: IdentityHints = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const value = password ?? "";

  if (value.trim().length === 0 && value.length > 0) problems.push("whitespace_only");
  if (value.length < MIN_LENGTH) problems.push("too_short");
  if (value.length > MAX_LENGTH) problems.push("too_long");

  const folded = fold(value);
  if (folded.length > 0 && COMMON.has(folded)) problems.push("common");

  // Un seul caractère répété : « aaaaaaaaaaaa » passe la longueur sans rien valoir.
  if (value.length >= MIN_LENGTH && new Set(value).size <= 2) problems.push("repeated");

  if (folded.length >= 8) {
    for (const run of KEYBOARD_RUNS) {
      if (run.includes(folded) || folded.includes(run.slice(0, 8))) {
        problems.push("sequential");
        break;
      }
    }
  }

  // L'identité : nom, prénom, partie locale de l'adresse, nom de l'organisation.
  const needles = [
    identity.firstName, identity.lastName, identity.tenantName,
    identity.email?.split("@")[0],
  ]
    .filter((v): v is string => Boolean(v))
    .map(fold)
    .filter(v => v.length >= 4);

  if (folded && needles.some(n => folded.includes(n))) {
    problems.push("contains_identity");
  }

  return problems;
}

export function passwordErrors(password: string, identity: IdentityHints = {}): string[] {
  return checkPassword(password, identity).map(p => PASSWORD_MESSAGES[p]);
}

export function isAcceptable(password: string, identity: IdentityHints = {}): boolean {
  return checkPassword(password, identity).length === 0;
}

/**
 * Mot de passe temporaire, lisible à voix haute.
 *
 * Un administrateur transmet ce mot de passe par téléphone ou de vive voix :
 * `Il3O0l` s'épelle mal et se recopie de travers. On tire donc des syllabes
 * prononçables, séparées par des tirets, et on écarte les caractères qui se
 * confondent à l'oral comme à l'écrit.
 */
export function temporaryPassword(): string {
  // Les consonnes excluent `l` et `q` (confondus avec `1` et `9` à l'écrit) ;
  // les voyelles gardent `i` et `o`, indispensables à des syllabes
  // prononçables. Les chiffres sont donc tirés de 2 à 9 : sans `0` ni `1` dans
  // la chaîne, aucune paire ambiguë ne peut se former.
  const consonants = "bcdfghjkmnprstvz";
  const vowels = "aeiou";
  const digits = "23456789";

  // `crypto.randomInt` et non `Math.random` : ce dernier est prédictible, et un
  // mot de passe devinable ouvre le compte qu'il devait protéger le temps que
  // son titulaire le change.
  const pick = (set: string) => set[crypto.randomInt(set.length)];

  const syllable = () => pick(consonants) + pick(vowels) + pick(consonants);
  const number = () => Array.from({ length: 4 }, () => pick(digits)).join("");

  // Trois syllabes et quatre chiffres : seize caractères, au-dessus du
  // minimum, et dictable en une phrase.
  return `${syllable()}-${syllable()}-${syllable()}-${number()}`;
}
