import { getDocumentProxy } from "unpdf";
import { BusinessRuleError } from "@/lib/errors";
import { parsePlanningItems, type TextItem } from "@/lib/timetable-pdf";

/** Pages lues au plus (certains exports ajoutent des milliers de pages blanches). */
const MAX_PAGES = 30;

/** Texte positionné des premières pages d'un PDF, puis lecture du planning. */
export async function readPlanningPdf(bytes: Uint8Array) {
  let pdf;
  try { pdf = await getDocumentProxy(bytes); } catch { throw new BusinessRuleError("PDF illisible."); }
  const items: TextItem[] = [];
  let blank = 0;
  for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const found = tc.items.filter((i): i is typeof i & { str: string; transform: number[] } => "str" in i && !!(i as { str: string }).str.trim());
    for (const i of found) items.push({ s: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), page: p });
    // Après le tableau, trois pages vides de suite : on s'arrête.
    blank = found.length ? 0 : blank + 1;
    if (blank >= 3 && items.length) break;
  }
  if (!items.length) throw new BusinessRuleError("Aucun texte dans ce PDF (planning scanné ?) : saisissez les cours ou importez un CSV.");
  return parsePlanningItems(items);
}
