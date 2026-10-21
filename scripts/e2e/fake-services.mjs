// Faux services pour les scénarios de bout en bout — JAMAIS en production.
//
//  • /s3/<compartiment>/<clé> : stockage objet minimal (PUT, GET, HEAD,
//    DELETE). Exige un en-tête Authorization AWS4-HMAC-SHA256 portant la clé
//    d'accès attendue, et vérifie que x-amz-content-sha256 est bien l'empreinte
//    du corps reçu (la signature elle-même est éprouvée par les tests unitaires
//    sur l'exemple de référence d'AWS).
//  • /anthropic/v1/messages : imite l'API Claude pour la lecture de factures,
//    sans appel réel ni coût. Renvoie une extraction fixe et garde la dernière
//    requête reçue, que le scénario inspecte.
//  • /__s3 et /__anthropic : état, pour les vérifications.
//
// Usage : node scripts/e2e/fake-services.mjs [port]   (défaut 4599)
import http from "http";
import crypto from "crypto";

const PORT = Number(process.argv[2] || 4599);
const ACCESS_KEY = process.env.STORAGE_S3_ACCESS_KEY || "test-access-key";
const objects = new Map();
let lastAnthropic = null;
let anthropicCalls = 0;

const EXTRACTION = {
  isInvoice: true, supplierName: "Quincaillerie du Fleuve", supplierNif: "NIF-QF-2026", invoiceNumber: "F-2026-118",
  invoiceDate: "2026-10-12", dueDate: "2026-11-11", currency: "XOF",
  lines: [
    { description: "Ciment 50 kg", quantity: 10, unitPriceHT: 5000, tvaRate: 0.19, accountCode: "604000" },
    { description: "Transport", quantity: 1, unitPriceHT: 10000, tvaRate: 0, accountCode: "611000" },
  ],
  totalHT: 60000, totalTVA: 9500, totalTTC: 69500, notes: "",
};

function body(req) {
  return new Promise(resolve => { const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const data = await body(req);

  if (url.pathname === "/__s3") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify([...objects.keys()])); }
  if (url.pathname === "/__anthropic") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ calls: anthropicCalls, last: lastAnthropic })); }

  if (url.pathname.startsWith("/s3/")) {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/`) || !/Signature=[0-9a-f]{64}$/.test(auth)) { res.statusCode = 403; return res.end("SignatureDoesNotMatch"); }
    const expected = crypto.createHash("sha256").update(data).digest("hex");
    if (req.headers["x-amz-content-sha256"] !== expected) { res.statusCode = 400; return res.end("XAmzContentSHA256Mismatch"); }
    const key = decodeURIComponent(url.pathname.slice(4));
    if (req.method === "PUT") { objects.set(key, { data, type: req.headers["content-type"] }); res.statusCode = 200; return res.end(); }
    const obj = objects.get(key);
    if (req.method === "DELETE") { objects.delete(key); res.statusCode = 204; return res.end(); }
    if (!obj) { res.statusCode = 404; return res.end("NoSuchKey"); }
    if (req.method === "HEAD") { res.statusCode = 200; return res.end(); }
    res.setHeader("content-type", obj.type || "application/octet-stream");
    return res.end(obj.data);
  }

  if (url.pathname === "/anthropic/v1/messages" && req.method === "POST") {
    anthropicCalls++;
    const payload = JSON.parse(data.toString("utf8"));
    lastAnthropic = {
      headers: { beta: req.headers["anthropic-beta"] ?? null, key: Boolean(req.headers["x-api-key"]) },
      model: payload.model, fallbacks: payload.fallbacks ?? null, outputConfig: payload.output_config ?? null,
      contentTypes: (payload.messages?.[0]?.content ?? []).map(b => b.type),
      mediaType: (payload.messages?.[0]?.content ?? []).find(b => b.source)?.source?.media_type ?? null,
    };
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({
      id: "msg_fake", type: "message", role: "assistant", model: payload.model,
      content: [{ type: "text", text: JSON.stringify(EXTRACTION) }],
      stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 300 },
    }));
  }

  res.statusCode = 404; res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`faux services sur ${PORT}`));
