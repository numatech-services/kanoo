import crypto from "crypto";
import path from "path";
import { mkdir, writeFile, readFile, unlink, stat } from "fs/promises";

/**
 * Stockage des fichiers téléversés.
 *
 * **Hors de `public/`, délibérément.** L'implémentation précédente écrivait
 * dans `public/uploads/` : Next y sert tout en statique, sans passer par la
 * moindre autorisation. Un bulletin de paie, un contrat, un justificatif de
 * note de frais devenaient lisibles par quiconque connaissait l'URL — et une
 * URL fuit par un courriel transféré, un historique de navigateur, un
 * en-tête `Referer`. Le nom en UUID rendait la devinette difficile ; il ne
 * remplaçait pas un contrôle d'accès.
 *
 * Ici, rien n'est servi directement. Les octets sortent uniquement par
 * `/api/attachments/:id`, qui vérifie l'organisation et le droit avant de
 * transmettre.
 */

/** Racine du stockage. Configurable pour pointer un volume monté sur le VPS. */
const ROOT = process.env.UPLOAD_DIR
  || path.join(process.cwd(), "var", "uploads");

export const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 Mo

/**
 * Types acceptés.
 *
 * Liste blanche par type MIME **et** par extension : les deux doivent
 * concorder, et pour les formats qui ont une signature, les octets de tête
 * doivent concorder aussi. Un `.pdf` qui commence par `<script` n'est pas un
 * PDF, quel que soit ce que le navigateur a déclaré.
 */
export const ACCEPTED: Record<string, { ext: string[]; magic?: number[][] }> = {
  "application/pdf": { ext: [".pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
  "image/jpeg": { ext: [".jpg", ".jpeg"], magic: [[0xff, 0xd8, 0xff]] },
  "image/png": { ext: [".png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/webp": { ext: [".webp"], magic: [[0x52, 0x49, 0x46, 0x46]] },
  "image/heic": { ext: [".heic"] },
  // Les formats Office modernes sont des archives ZIP : même signature.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    { ext: [".docx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    { ext: [".xlsx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "application/msword": { ext: [".doc"], magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  "application/vnd.ms-excel": { ext: [".xls"], magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  "text/csv": { ext: [".csv"] },
  "text/plain": { ext: [".txt"] },
};

/**
 * Ce qui est refusé sans discussion.
 *
 * Un SVG est un document exécutable : il embarque du script, et servi depuis
 * l'origine de l'application il vaut une faille XSS stockée. Le HTML aussi.
 * Aucun besoin métier ne les réclame ici — les refuser coûte moins cher que
 * de les servir prudemment.
 */
const FORBIDDEN_EXT = new Set([
  ".svg", ".html", ".htm", ".xhtml", ".js", ".mjs", ".php", ".sh",
  ".exe", ".bat", ".cmd", ".ps1", ".jar", ".app", ".dmg",
]);

export interface StoredFile {
  storageKey: string;
  sha256: string;
  size: number;
  mime: string;
  /** Nom d'origine, nettoyé. Sert à l'affichage et au téléchargement. */
  filename: string;
}

export type StorageError =
  | "empty" | "too_large" | "forbidden_type" | "unknown_type"
  | "extension_mismatch" | "content_mismatch";

export const STORAGE_MESSAGES: Record<StorageError, string> = {
  empty: "Fichier vide.",
  too_large: `Fichier trop volumineux (${Math.round(MAX_FILE_SIZE / 1024 / 1024)} Mo au maximum).`,
  forbidden_type: "Ce type de fichier n'est pas accepté : il peut contenir du code exécutable.",
  unknown_type: "Type de fichier non pris en charge. Formats acceptés : PDF, images, Word, Excel, CSV, texte.",
  extension_mismatch: "L'extension ne correspond pas au type déclaré du fichier.",
  content_mismatch: "Le contenu du fichier ne correspond pas à son type déclaré.",
};

/**
 * Nom d'affichage : on retire tout chemin et les caractères de contrôle, on
 * borne la longueur. Espaces et accents sont conservés — c'est un nom lisible
 * par un humain, pas un identifiant : le nom réel sur disque est l'empreinte.
 */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name || "fichier")
    // eslint-disable-next-line no-control-regex -- on retire précisément ceux-là
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return base.slice(0, 180) || "fichier";
}

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, i) => buffer[i] === byte);
}

/**
 * Valide un fichier avant écriture.
 *
 * L'ordre compte : on refuse d'abord ce qui est dangereux, puis ce qui est
 * inconnu, puis ce qui ne concorde pas. Un message précis à chaque étape —
 * « type non pris en charge » et « l'extension ne correspond pas » appellent
 * deux corrections différentes de la part de l'utilisateur.
 */
export function validate(
  filename: string, declaredMime: string, buffer: Buffer
): { ok: true; mime: string } | { ok: false; error: StorageError } {
  if (buffer.length === 0) return { ok: false, error: "empty" };
  if (buffer.length > MAX_FILE_SIZE) return { ok: false, error: "too_large" };

  const ext = path.extname(sanitizeFilename(filename)).toLowerCase();
  if (FORBIDDEN_EXT.has(ext)) return { ok: false, error: "forbidden_type" };

  // Le type déclaré par le navigateur n'engage personne : on retient celui
  // que l'extension permet, et on vérifie ensuite les octets.
  const mime = declaredMime in ACCEPTED
    ? declaredMime
    : Object.keys(ACCEPTED).find(m => ACCEPTED[m].ext.includes(ext));
  if (!mime) return { ok: false, error: "unknown_type" };

  const spec = ACCEPTED[mime];
  if (!spec.ext.includes(ext)) return { ok: false, error: "extension_mismatch" };

  if (spec.magic && !spec.magic.some(sig => startsWith(buffer, sig))) {
    return { ok: false, error: "content_mismatch" };
  }

  return { ok: true, mime };
}

/**
 * Écrit un fichier et rend sa clé de stockage.
 *
 * Le contenu est adressé par son empreinte : deux téléversements identiques
 * dans la même organisation partagent le même octet sur disque. Le même
 * justificatif joint à deux notes de frais ne pèse qu'une fois.
 *
 * La clé est **construite**, jamais dérivée du nom fourni : aucun `../` ne
 * peut remonter hors de la racine.
 */
export async function store(
  tenantId: string, filename: string, mime: string, buffer: Buffer
): Promise<StoredFile> {
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const ext = path.extname(sanitizeFilename(filename)).toLowerCase();

  // Deux niveaux de sous-dossiers : un répertoire de dizaines de milliers de
  // fichiers devient lent à lister sur bien des systèmes de fichiers.
  const key = path.posix.join(
    String(tenantId), sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}${ext}`
  );

  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });

  // Déjà présent : rien à réécrire, l'empreinte garantit l'identité.
  const exists = await stat(full).then(() => true).catch(() => false);
  if (!exists) await writeFile(full, buffer, { mode: 0o640 });

  return { storageKey: key, sha256, size: buffer.length, mime, filename: sanitizeFilename(filename) };
}

/**
 * Chemin absolu d'une clé, avec garde contre la traversée.
 *
 * Les clés viennent de la base, donc de nous ; la garde tient quand même,
 * parce qu'une injection en base ne doit pas devenir une lecture de
 * `/etc/passwd`.
 */
export function resolveKey(key: string): string {
  const full = path.resolve(ROOT, key);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw new Error("Clé de stockage hors de la racine.");
  }
  return full;
}

export async function read(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

/**
 * Supprime le fichier physique.
 *
 * À n'appeler que lorsque **plus aucune** pièce jointe ne référence
 * l'empreinte : le contenu étant partagé entre doublons, effacer sur la
 * première suppression viderait les autres.
 */
export async function remove(key: string): Promise<void> {
  await unlink(resolveKey(key)).catch(() => { /* déjà absent : rien à faire */ });
}

export const STORAGE_ROOT = ROOT;
