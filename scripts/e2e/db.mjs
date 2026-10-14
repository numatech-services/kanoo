// Accès direct à la base de test, sans Docker : les scénarios préparent ainsi
// des cas que l'API ne permet pas de créer (ancien format, jeton expiré…).
import { createRequire } from "module";

export async function withDb(root, fn) {
  const require = createRequire(`${root}/package.json`);
  const mongoose = require("mongoose");
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27099/kanoo_e2e?directConnection=true";
  const conn = await mongoose.createConnection(uri).asPromise();
  try { return await fn(conn.db); } finally { await conn.close(); }
}
