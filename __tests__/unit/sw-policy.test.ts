/**
 * Service worker (public/sw-policy.js) : ce qui est mis en cache, ce qui est
 * mis en file hors ligne, et comment un rejeu est jugé.
 */
import { readFileSync } from "fs";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const P = require("../../public/sw-policy.js") as {
  mutationMode: (o: { pathname: string; method: string; contentType?: string | null; offlineHeader?: string | null }) => "network" | "critical" | "queue";
  readMode: (o: { pathname: string; sameOrigin?: boolean; isNavigate?: boolean; isRsc?: boolean }) => "static" | "swr" | "page" | "network";
  replayDecision: (status: number, error?: string) => "done" | "auth" | "retry" | "failed";
  DATA_CACHE: string; STATIC_CACHE: string;
};

describe("Service worker — écritures", () => {
  it("l'authentification n'est jamais mise en file (mot de passe stocké, déconnexion rejouée)", () => {
    for (const p of ["/api/auth/login", "/api/auth/logout", "/api/auth/ping", "/api/auth/2fa/verify"]) {
      expect(P.mutationMode({ pathname: p, method: "POST" })).toBe("network");
    }
  });

  it("un fichier envoyé, l'API publique et les écrans qui gèrent leur attente passent tels quels", () => {
    expect(P.mutationMode({ pathname: "/api/attachments", method: "POST", contentType: "multipart/form-data; boundary=x" })).toBe("network");
    expect(P.mutationMode({ pathname: "/api/v1/spot/events", method: "POST" })).toBe("network");
    expect(P.mutationMode({ pathname: "/api/comptoir/sales", method: "POST", offlineHeader: "page" })).toBe("network");
  });

  it("une création à numéro légal est bloquée hors ligne ; le reste part en file", () => {
    expect(P.mutationMode({ pathname: "/api/invoices", method: "POST" })).toBe("critical");
    expect(P.mutationMode({ pathname: "/api/invoices/abc", method: "PATCH" })).toBe("queue");
    expect(P.mutationMode({ pathname: "/api/clients", method: "POST" })).toBe("queue");
    expect(P.mutationMode({ pathname: "/dashboard", method: "POST" })).toBe("network");
  });
});

describe("Service worker — lectures", () => {
  it("les données connectées ne sont pas mises en cache, sauf les listes de référence", () => {
    expect(P.readMode({ pathname: "/api/payslips" })).toBe("network");
    expect(P.readMode({ pathname: "/api/invoices" })).toBe("network");
    expect(P.readMode({ pathname: "/api/auth/me" })).toBe("network");
    expect(P.readMode({ pathname: "/api/clients" })).toBe("swr");
    expect(P.readMode({ pathname: "/api/clients/123" })).toBe("swr");
    expect(P.readMode({ pathname: "/api/clientsx" })).toBe("network");
  });

  it("pages : réseau seulement (page hors ligne en secours) ; flux RSC jamais gardé ; assets en cache", () => {
    expect(P.readMode({ pathname: "/payslips", isNavigate: true })).toBe("page");
    expect(P.readMode({ pathname: "/payslips", isRsc: true })).toBe("network");
    expect(P.readMode({ pathname: "/_next/static/chunks/app.js" })).toBe("static");
    expect(P.readMode({ pathname: "/_next/static/x.js", sameOrigin: false })).toBe("network");
  });

  it("le service worker ne met en cache ni pages ni réponses hors des règles, et les anciens caches partent", () => {
    const sw = readFileSync(join(__dirname, "../../public/sw.js"), "utf-8");
    expect(sw).toContain('importScripts("/sw-policy.js")');
    expect(sw).not.toMatch(/PRECACHE_URLS|"\/dashboard"|networkFirstWithFallback/);
    // La clé d'idempotence est posée avant le premier envoi.
    expect(sw).toMatch(/headers\.set\("Idempotency-Key", key\)[\s\S]*await fetch\(request\.url/);
    expect(P.DATA_CACHE).not.toBe(P.STATIC_CACHE);
  });
});

describe("Service worker — rejeu", () => {
  it("2xx fait, 401 session à rouvrir, 409 « en cours » réessayé, autre 4xx en échec", () => {
    expect(P.replayDecision(201)).toBe("done");
    expect(P.replayDecision(401)).toBe("auth");
    expect(P.replayDecision(409, "Requête identique en cours de traitement.")).toBe("retry");
    expect(P.replayDecision(409, "Cette clé d'idempotence a déjà servi pour une requête différente.")).toBe("failed");
    expect(P.replayDecision(503)).toBe("retry");
    expect(P.replayDecision(400, "Montant invalide")).toBe("failed");
  });
});
