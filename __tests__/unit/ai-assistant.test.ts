/**
 * Assistant IA — garde-fous purs (sans base ni clé).
 *
 * Vérifie ce qui ne dépend ni de MongoDB ni de l'API Claude :
 *  - les modules se chargent sans ANTHROPIC_API_KEY (pas de plantage à
 *    l'import : le client n'est construit qu'à la première génération) ;
 *  - la fonctionnalité se signale indisponible tant que la clé est absente ;
 *  - le mois de quota est au format « AAAA-MM » stable au fuseau (UTC).
 */
import { isAiConfigured } from "@/lib/ai";
import { currentMonth, AI_MONTHLY_QUOTA } from "@/lib/ai-quota";

describe("Assistant IA — configuration", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("se signale indisponible sans clé", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiConfigured()).toBe(false);
  });

  it("se signale disponible dès que la clé est posée", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(isAiConfigured()).toBe(true);
  });

  it("expose un quota mensuel par défaut positif", () => {
    expect(AI_MONTHLY_QUOTA).toBeGreaterThan(0);
  });
});

describe("Assistant IA — mois de quota", () => {
  it("formate le mois en AAAA-MM (UTC)", () => {
    expect(currentMonth(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01");
    expect(currentMonth(new Date(Date.UTC(2026, 8, 30)))).toBe("2026-09");
    expect(currentMonth(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12");
  });

  it("reste stable juste avant minuit UTC en fin de mois", () => {
    // 31 janv. 23:59 UTC appartient encore à janvier, quel que soit le fuseau local.
    expect(currentMonth(new Date(Date.UTC(2026, 0, 31, 23, 59)))).toBe("2026-01");
  });
});
