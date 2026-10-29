/**
 * Inactivité et brouillons : passer sur WhatsApp le temps d'un paiement ne
 * fait plus perdre la session ni la saisie ; un autre utilisateur du même
 * téléphone ne voit jamais les brouillons du précédent.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_IDLE_MINUTES, DEFAULT_SESSION_IDLE_MINUTES, sessionIdleMinutes } from "@/lib/idle";
import { purgeDrafts, DRAFT_PREFIX } from "@/lib/use-draft";

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe("Inactivité", () => {
  it("15 minutes côté navigateur, 20 côté serveur (au-dessus), réglables", () => {
    expect(DEFAULT_IDLE_MINUTES).toBe(15);
    expect(DEFAULT_SESSION_IDLE_MINUTES).toBeGreaterThan(DEFAULT_IDLE_MINUTES);
    expect(sessionIdleMinutes(undefined)).toBe(20);
    expect(sessionIdleMinutes("")).toBe(20);
    expect(sessionIdleMinutes("0")).toBe(20);
    expect(sessionIdleMinutes("45")).toBe(45);
  });

  it("le retour sur l'onglet compte comme une activité (si le délai n'est pas dépassé)", () => {
    const src = readFileSync(join(__dirname, "../../components/shared/IdleTimeout.tsx"), "utf-8");
    expect(src).toMatch(/visibilitychange/);
    expect(src).toContain('from "@/lib/idle"');
    expect(src).not.toMatch(/NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES \|\| "2"/);
  });
});

describe("Brouillons des formulaires", () => {
  const g = globalThis as unknown as { localStorage?: MemoryStorage };
  beforeEach(() => { g.localStorage = new MemoryStorage(); });
  afterAll(() => { delete g.localStorage; });

  it("un autre utilisateur se connecte : les brouillons des autres partent, les siens restent", () => {
    g.localStorage!.setItem(`${DRAFT_PREFIX}awa@test.ne.invoice-new`, "{}");
    g.localStorage!.setItem(`${DRAFT_PREFIX}moussa@test.ne.invoice-new`, "{}");
    g.localStorage!.setItem("kanoo.lastActivity", "1");
    purgeDrafts("Moussa@test.ne");
    expect(g.localStorage!.getItem(`${DRAFT_PREFIX}awa@test.ne.invoice-new`)).toBeNull();
    expect(g.localStorage!.getItem(`${DRAFT_PREFIX}moussa@test.ne.invoice-new`)).toBe("{}");
    expect(g.localStorage!.getItem("kanoo.lastActivity")).toBe("1");
  });

  it("déconnexion volontaire : tous les brouillons partent", () => {
    g.localStorage!.setItem(`${DRAFT_PREFIX}awa@test.ne.devis-new`, "{}");
    purgeDrafts();
    expect(g.localStorage!.length).toBe(0);
  });

  it("facture, devis et dépense gardent un brouillon à la création, l'effacent après l'enregistrement", () => {
    const root = join(__dirname, "../..");
    for (const [page, form] of [["app/(dashboard)/invoices/new/page.tsx", "components/pme/InvoiceForm.tsx"], ["app/(dashboard)/devis/new/page.tsx", "components/pme/DevisForm.tsx"], ["app/(dashboard)/depenses/nouvelle/page.tsx", "components/achats/PurchaseForm.tsx"]]) {
      expect(readFileSync(join(root, page), "utf-8")).toMatch(/draftKey/);
      const src = readFileSync(join(root, form), "utf-8");
      expect(src).toMatch(/useFormDraft\(/);
      expect(src).toMatch(/draft\.clear\(\)/);
    }
  });
});
