import crypto from "crypto";

/**
 * Client S3 minimal (Signature AWS v4), sans dépendance : PUT, GET, DELETE
 * d'un objet, en chemin de style « endpoint/compartiment/clé ». Compatible
 * Backblaze B2, Cloudflare R2, AWS S3, Wasabi, MinIO.
 *
 * Sert à la sauvegarde de la base (lib/backup.ts, BACKUP_S3_*) et au
 * stockage des pièces jointes (lib/storage.ts, STORAGE_S3_*).
 */

export interface S3Config { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string; prefix: string }

const sha256hex = (data: Buffer | string) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();

/** Encodage d'un segment de chemin selon S3 (RFC 3986, « / » conservé). */
function encodePath(p: string): string {
  return p.split("/").map(s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

/**
 * En-têtes signés (AWS Signature Version 4) d'une requête S3 sans paramètres
 * de requête. `headers` peut ajouter des en-têtes à signer (Range…).
 */
export function signS3Request(opts: {
  method: string; url: string; region: string; accessKey: string; secretKey: string;
  payloadHash: string; now: Date; headers?: Record<string, string>;
}): Record<string, string> {
  const u = new URL(opts.url);
  const amzDate = opts.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: u.host,
    "x-amz-content-sha256": opts.payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    opts.method, encodePath(decodeURIComponent(u.pathname)), "",
    names.map(n => `${n}:${headers[n]}\n`).join(""), names.join(";"), opts.payloadHash,
  ].join("\n");
  const scope = `${date}/${opts.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${opts.secretKey}`, date), opts.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

/**
 * Configuration lue dans les variables `<PREFIX>_ENDPOINT`, `_BUCKET`,
 * `_REGION`, `_ACCESS_KEY`, `_SECRET_KEY`, `_PREFIX` ; null si incomplète.
 */
export function s3ConfigFrom(envPrefix: string, defaultKeyPrefix: string): S3Config | null {
  const e = process.env;
  const v = (k: string) => e[`${envPrefix}_${k}`];
  if (!v("ENDPOINT") || !v("BUCKET") || !v("ACCESS_KEY") || !v("SECRET_KEY")) return null;
  return {
    endpoint: v("ENDPOINT")!.replace(/\/+$/, ""), bucket: v("BUCKET")!,
    region: v("REGION") || "us-east-1", accessKey: v("ACCESS_KEY")!, secretKey: v("SECRET_KEY")!,
    prefix: (v("PREFIX") ?? defaultKeyPrefix).replace(/^\/+/, ""),
  };
}

/** Requête signée sur un objet. `key` est la clé complète (préfixe compris). */
export async function s3Request(c: S3Config, method: "PUT" | "GET" | "DELETE" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = `${c.endpoint}/${c.bucket}/${encodePath(key)}`;
  const payloadHash = sha256hex(body ?? "");
  const headers = signS3Request({ method, url, region: c.region, accessKey: c.accessKey, secretKey: c.secretKey, payloadHash, now: new Date() });
  delete headers.host; // posé par fetch
  return fetch(url, {
    method,
    headers: { ...headers, ...(body ? { "content-type": contentType || "application/octet-stream" } : {}) },
    body: body ? new Uint8Array(body) : undefined,
  });
}
