import { Types } from "mongoose";
import { DeskForecastEventModel } from "@/models/DeskForecastEvent";

const scope = (deskId: string) => ({ $or: [{ deskIds: { $size: 0 } }, { deskIds: new Types.ObjectId(deskId) }] });

/** Facteur de la prévision d'un site pour un jour : le produit des événements qui le couvrent. */
export async function forecastFactor(tenantId: string, deskId: string, day: string) {
  const list = await DeskForecastEventModel.find({ tenantId, from: { $lte: day }, to: { $gte: day }, ...scope(deskId) }).select("label factor").lean<Array<{ label: string; factor: number }>>();
  return { factor: list.reduce((t, e) => t * e.factor, 1), events: list.map(e => e.label) };
}

/** Facteur moyen sur une période à venir, pour un réassort qui couvre plusieurs jours. */
export async function averageFactor(tenantId: string, deskId: string, fromDay: string, days: number) {
  const d0 = new Date(`${fromDay}T12:00:00`);
  const dayAt = (k: number) => { const d = new Date(d0); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const list = await DeskForecastEventModel.find({ tenantId, from: { $lte: dayAt(days - 1) }, to: { $gte: fromDay }, ...scope(deskId) }).select("from to factor").lean<Array<{ from: string; to: string; factor: number }>>();
  if (!list.length || days < 1) return 1;
  let sum = 0;
  for (let k = 0; k < days; k++) { const day = dayAt(k); sum += list.filter(e => e.from <= day && e.to >= day).reduce((t, e) => t * e.factor, 1); }
  return sum / days;
}
