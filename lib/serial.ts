import type { ClientSession, Model } from "mongoose";
import { SerialCounterModel } from "@/models/SerialCounter";

/**
 * Numéro suivant d'une série à format fixe « PRÉFIXE-AAAA-NNNN ».
 *
 * Remplace « nombre de documents + 1 », qui redonnait un numéro existant après
 * une suppression, ou à deux enregistrements simultanés (deux reçus de dons au
 * même numéro), et ne repartait pas à 1 chaque année. Le compteur est amorcé
 * au plus grand numéro déjà émis de l'année (reprise sans collision), puis
 * incrémenté de façon atomique. Un numéro déjà pris (saisi à la main) est
 * sauté.
 *
 * Avec `session`, le numéro est consommé dans la transaction du document :
 * pas de trou si l'enregistrement échoue.
 */
export async function nextSerial(tenantId: string, opts: {
  prefix: string; year: number; digits: number;
  model: Model<unknown>; field: string; session?: ClientSession;
}): Promise<string> {
  const key = `${opts.prefix}-${opts.year}`;
  const session = opts.session ?? null;
  const format = (n: number) => `${key}-${String(n).padStart(opts.digits, "0")}`;
  const rx = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);

  if (!(await SerialCounterModel.exists({ tenantId, key }).session(session))) {
    const docs = await opts.model.find({ tenantId, [opts.field]: rx }).select(opts.field).session(session).lean<Array<Record<string, unknown>>>();
    const seed = docs.reduce((m, d) => Math.max(m, Number(rx.exec(String(d[opts.field]))?.[1] ?? 0)), 0);
    // $max : deux amorçages simultanés donnent le même compteur, jamais un recul.
    await SerialCounterModel.updateOne({ tenantId, key }, { $max: { seq: seed } }, { upsert: true, session: opts.session });
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const c = await SerialCounterModel.findOneAndUpdate({ tenantId, key }, { $inc: { seq: 1 } }, { new: true, session: opts.session })
      .lean<{ seq: number } | null>();
    const number = format(c?.seq ?? 1);
    if (!(await opts.model.exists({ tenantId, [opts.field]: number }).session(session))) return number;
  }
  throw new Error(`Série ${key} : aucun numéro libre trouvé.`);
}
