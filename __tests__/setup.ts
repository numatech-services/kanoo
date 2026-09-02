/**
 * Configuration Jest — Kanoo Tests
 * Chargé avant chaque suite de tests
 */

// Timeout global pour les tests d'intégration
jest.setTimeout(30_000);

// Variables d'environnement de test
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || "mongodb://localhost:27017/kanoo_test";
process.env.JWT_SECRET = "test_secret_jwt_kanoo_32_chars_minimum";
process.env.EMAIL_PROVIDER = "console";
process.env.PAYDUNYA_MODE = "test";

// Supprimer les logs en mode test (sauf erreurs)
if (!process.env.TEST_VERBOSE) {
  console.log = jest.fn();
  console.info = jest.fn();
}
