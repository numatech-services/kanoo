/**
 * Tests unitaires — exports comptables : encodage Windows-1252 de l'export Sage.
 * Les contrôles de l'export complet sont testés de bout en bout
 * (scripts/e2e/e2e-exportfin.mjs) : ils lisent la base.
 *
 * Exécuter : npx jest __tests__/unit/financial-export.test.ts
 */
import { encodeWindows1252 } from "@/lib/csv";

describe("encodeWindows1252", () => {
  test("accents français sur un octet", () => {
    expect([...encodeWindows1252("éèàçôÉ")]).toEqual([0xe9, 0xe8, 0xe0, 0xe7, 0xf4, 0xc9]);
  });
  test("caractères propres à Windows-1252 : €, œ, apostrophe typographique, tirets", () => {
    expect([...encodeWindows1252("€œ’–—…")]).toEqual([0x80, 0x9c, 0x92, 0x96, 0x97, 0x85]);
  });
  test("espace fine insécable (toLocaleString fr-FR) : espace insécable", () => {
    expect([...encodeWindows1252((1250000).toLocaleString("fr-FR"))]).toEqual([0x31, 0xa0, 0x32, 0x35, 0x30, 0xa0, 0x30, 0x30, 0x30]);
  });
  test("ASCII inchangé ; caractère sans équivalent remplacé par « ? »", () => {
    expect(Buffer.from(encodeWindows1252("VT;411000;\r\n")).toString("latin1")).toBe("VT;411000;\r\n");
    expect([...encodeWindows1252("中")]).toEqual([0x3f]);
  });
});
