/**
 * Test de charge — Kanoo VPS Hostinger
 * Outil : k6 (https://k6.io)
 *
 * Installation : brew install k6 | apt-get install k6
 * Exécuter : k6 run __tests__/load/k6-config.js
 * Avec rapport HTML : k6 run --out json=results.json __tests__/load/k6-config.js
 *
 * Objectifs :
 *   - 50 utilisateurs simultanés pendant 5 minutes
 *   - P95 temps de réponse < 2 secondes
 *   - Taux d'erreur < 1%
 *   - Débit > 100 req/s
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "https://kanoo.ne";

// Seuils de qualité de service
export const options = {
  scenarios: {
    // Montée en charge progressive : 0 → 50 utilisateurs en 2 min
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },   // Montée progressive
        { duration: "3m", target: 50 },   // Charge soutenue
        { duration: "1m", target: 0 },    // Descente
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // P95 < 2 secondes pour toutes les requêtes
    "http_req_duration": ["p(95)<2000"],
    // P99 < 5 secondes
    "http_req_duration": ["p(99)<5000"],
    // Taux d'erreur < 1%
    "http_req_failed": ["rate<0.01"],
    // API critique < 1 seconde
    "api_critical_duration": ["p(95)<1000"],
  },
};

// ─── Métriques personnalisées ─────────────────────────────────────────────────
const apiCriticalDuration = new Trend("api_critical_duration");
const authFailures = new Counter("auth_failures");
const businessErrors = new Rate("business_errors");

// ─── Authentification ─────────────────────────────────────────────────────────

let authToken = "";

export function setup() {
  // Authentification initiale pour obtenir un token
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: "admin@demo.ne", password: "demo1234" }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (loginRes.status !== 200) {
    console.error(`[Setup] Login échoué: ${loginRes.status} ${loginRes.body}`);
    return { token: "" };
  }

  const body = JSON.parse(loginRes.body);
  console.log(`[Setup] Authentifié — token obtenu (${body.data?.token?.slice(0, 20)}...)`);
  return { token: body.data?.token || "" };
}

// ─── Scénarios de test ────────────────────────────────────────────────────────

export default function (data) {
  const token = data.token;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };

  // Simuler un utilisateur actif typique
  const scenario = Math.random();

  if (scenario < 0.30) {
    // 30% des requêtes : lecture du dashboard et liste des factures
    testDashboard(headers);
  } else if (scenario < 0.55) {
    // 25% : navigation clients
    testClients(headers);
  } else if (scenario < 0.70) {
    // 15% : liste factures
    testInvoices(headers);
  } else if (scenario < 0.80) {
    // 10% : rapports
    testReports(headers);
  } else if (scenario < 0.90) {
    // 10% : paie et RH
    testHR(headers);
  } else {
    // 10% : comptabilité
    testAccounting(headers);
  }

  // Pause réaliste entre les actions (1-3 secondes)
  sleep(1 + Math.random() * 2);
}

function testDashboard(headers) {
  group("Dashboard", () => {
    const start = Date.now();

    const r = http.get(`${BASE_URL}/api/reports/summary`, { headers });
    apiCriticalDuration.add(Date.now() - start);

    const ok = check(r, {
      "dashboard summary — status 200 ou 401": (res) => [200, 401].includes(res.status),
      "dashboard — temps de réponse < 2s": (res) => res.timings.duration < 2000,
    });
    if (!ok) businessErrors.add(1);
  });
}

function testClients(headers) {
  group("Clients", () => {
    const r1 = http.get(`${BASE_URL}/api/clients?page=1&limit=20`, { headers });
    check(r1, {
      "liste clients — status 200": (res) => res.status === 200,
      "liste clients — body JSON": (res) => {
        try { JSON.parse(res.body); return true; } catch { return false; }
      },
    });
  });
}

function testInvoices(headers) {
  group("Factures", () => {
    const start = Date.now();
    const r1 = http.get(`${BASE_URL}/api/invoices?page=1&limit=10`, { headers });
    apiCriticalDuration.add(Date.now() - start);

    check(r1, {
      "liste factures — status 200": (res) => res.status === 200,
      "liste factures — < 1s": (res) => res.timings.duration < 1000,
    });

    // Lecture d'une facture individuelle
    if (r1.status === 200) {
      const data = JSON.parse(r1.body);
      if (data?.data?.items?.[0]) {
        const id = data.data.items[0]._id;
        const r2 = http.get(`${BASE_URL}/api/invoices/${id}`, { headers });
        check(r2, { "facture détail — status 200": (res) => res.status === 200 });
      }
    }
  });
}

function testReports(headers) {
  group("Rapports", () => {
    const r = http.get(
      `${BASE_URL}/api/reports/analytics?months=3`,
      { headers, timeout: "10s" }
    );
    check(r, {
      "analytics — status 200": (res) => res.status === 200,
      "analytics — < 5s": (res) => res.timings.duration < 5000,
    });
  });
}

function testHR(headers) {
  group("RH", () => {
    const r = http.get(`${BASE_URL}/api/employees?limit=20`, { headers });
    check(r, { "employés — status 200": (res) => res.status === 200 });
  });
}

function testAccounting(headers) {
  group("Comptabilité", () => {
    const r = http.get(`${BASE_URL}/api/accounting-entries?limit=20`, { headers });
    check(r, { "écritures — status 200": (res) => res.status === 200 });
  });
}

// ─── Rapport de fin ───────────────────────────────────────────────────────────

export function handleSummary(data) {
  const p95 = data.metrics["http_req_duration"]?.values?.["p(95)"] || 0;
  const errorRate = (data.metrics["http_req_failed"]?.values?.rate || 0) * 100;
  const rps = data.metrics["http_reqs"]?.values?.rate || 0;

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Kanoo — Rapport Test de Charge");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  Utilisateurs simultanés max : 50`);
  console.log(`  P95 temps de réponse        : ${Math.round(p95)} ms   ${p95 < 2000 ? "✅" : "❌"} (objectif < 2000ms)`);
  console.log(`  Taux d'erreur               : ${errorRate.toFixed(2)}%  ${errorRate < 1 ? "✅" : "❌"} (objectif < 1%)`);
  console.log(`  Débit                       : ${rps.toFixed(0)} req/s`);
  console.log("══════════════════════════════════════════════════════\n");

  // Recommandations
  if (p95 > 2000) {
    console.log("⚠️  Performance dégradée — Recommandations :");
    console.log("   - Ajouter un index MongoDB sur les champs filtrés fréquemment");
    console.log("   - Activer le cache Redis pour les rapports");
    console.log("   - Passer à un VPS KVM4 (4 vCPU, 8GB RAM) sur Hostinger");
  }

  return {
    stdout: `Rapport test de charge — P95: ${Math.round(p95)}ms | Erreurs: ${errorRate.toFixed(2)}% | ${rps.toFixed(0)} req/s\n`,
  };
}
