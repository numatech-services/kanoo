import type { BusinessDoc, BizLine, BizParty, DocTenant, DocKind, DocStyle } from "@/lib/pdf-business";

/**
 * Passage des documents de Kanoo (facture, avoir, devis, proforma, bon de
 * livraison, bon de commande) au modèle d'impression (lib/pdf-business) :
 * mentions, lignes, totaux, conditions, signature et QR. Calcul pur.
 */

type Party = { name?: string; nif?: string; rccm?: string; code?: string; address?: string; phone?: string } | null | undefined;
type Line = { description?: string; details?: string; section?: string; unit?: string; quantity?: number; unitPrice?: number; discount?: number; tvaRate?: number; totalHT?: number };
type Mentions = { object?: string; reference?: string; period?: string; attention?: string };

const LONG = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Niamey" });
export const longDate = (d?: Date | string | null) => {
  if (!d) return "";
  const x = new Date(d);
  return isNaN(x.getTime()) ? "" : LONG.format(x);
};

/** Ville de signature : « Niamey · Niger » → « Niamey ». */
export function signaturePlace(tenant: DocTenant) {
  const city = tenant.branding?.city || "";
  return city.split(/[·,()]/)[0].trim() || undefined;
}

export function partyOf(p: Party, attention?: string): BizParty | null {
  if (!p?.name) return null;
  const lines = [p.address, p.nif ? `NIF ${p.nif}` : "", p.rccm ? `RCCM ${p.rccm}` : "", p.phone ? `Tél. ${p.phone}` : ""].filter(Boolean) as string[];
  return { name: p.name, lines, ...(attention ? { attention } : {}) };
}

export function linesOf(lines: Line[] | undefined): BizLine[] {
  return (lines ?? []).map(l => ({
    title: String(l.description || "—"), details: l.details || undefined, section: l.section || undefined, unit: l.unit || undefined,
    quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, discount: Number(l.discount) || 0,
    totalHT: l.totalHT ?? Math.round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discount) || 0) / 100)),
  }));
}

// Taux absent = taux normal, comme au calcul des totaux (computeInvoiceLines).
const rates = (lines: Line[] | undefined) => [...new Set((lines ?? []).map(l => Number(l.tvaRate ?? 0.19)).filter(r => r > 0))];

function mentionMeta(m: Mentions): Array<[string, string]> {
  return [...(m.reference ? [["Référence", m.reference] as [string, string]] : []), ...(m.period ? [["Période", m.period] as [string, string]] : [])];
}

function signatureOf(tenant: DocTenant, date?: Date | string) {
  const b = tenant.branding ?? {};
  return { place: signaturePlace(tenant), date: longDate(date), company: tenant.name || "", name: b.signatoryName, title: b.signatoryTitle, stamp: b.stamp };
}

/** « Bon pour accord » : réglage de l'organisation, sinon selon le style (celui demandé pour un aperçu, ou le sien). */
function wantsApproval(tenant: DocTenant, style?: DocStyle) {
  const b = tenant.branding ?? {};
  return b.clientApproval ?? ((style ?? b.documentStyle) !== "prestige" && (style ?? b.documentStyle) !== undefined);
}
const shortName = (name?: string) => {
  const m = /\(([^)]{2,20})\)\s*$/.exec(name ?? "");
  return m ? m[1] : (name ?? "").slice(0, 40);
};

export interface InvoiceLike extends Mentions {
  number?: string; documentType?: string; kind?: string; status?: string;
  issueDate?: Date | string; dueDate?: Date | string;
  lines?: Line[]; totalHT?: number; totalTVA?: number; totalDTS?: number; totalTTC?: number;
  paidAmount?: number; creditedAmount?: number; retentionAmount?: number; retentionRate?: number;
  termsAndConditions?: string; creditReason?: string;
  originalInvoiceId?: { number?: string; issueDate?: Date | string } | null;
  contractId?: { reference?: string; registration?: { number?: string; date?: Date | string } } | null;
  installments?: Array<{ dueDate: Date | string; amount: number; label?: string }>;
  clientId?: Party;
  secef?: { code?: string; qrPayload?: string; certifiedAt?: Date | string };
  correctedAt?: Date | string; correctionCount?: number;
}

/** Coordonnées de paiement dans le corps de la facture (et non seulement en pied de page), sauf si les conditions les donnent déjà. */
function paymentLine(tenant: DocTenant, isCredit: boolean, terms?: string) {
  const pi = tenant.branding?.paymentInstructions?.replace(/\s*\n\s*/g, " · ").trim();
  if (!pi || isCredit || (terms ?? "").includes(pi.slice(0, 20))) return "";
  return `Coordonnées de paiement — ${pi}`;
}

export function invoiceDoc(inv: InvoiceLike, tenant: DocTenant, opts: { portalUrl?: string | null } = {}): BusinessDoc {
  const isCredit = inv.documentType === "credit_note";
  const kind: DocKind = isCredit ? "credit_note" : inv.kind === "deposit" ? "deposit" : "invoice";
  const meta: Array<[string, string]> = [["Date", longDate(inv.issueDate)]];
  if (isCredit && inv.originalInvoiceId?.number) meta.push(["Sur facture", `${inv.originalInvoiceId.number}${inv.originalInvoiceId.issueDate ? ` du ${longDate(inv.originalInvoiceId.issueDate)}` : ""}`]);
  if (!isCredit && inv.dueDate) meta.push(["Échéance", longDate(inv.dueDate)]);
  if (inv.contractId?.reference) {
    const reg = inv.contractId.registration;
    meta.push(["Marché", `${inv.contractId.reference}${reg?.number ? ` — enregistré n° ${reg.number}${reg.date ? ` du ${longDate(reg.date)}` : ""}` : ""}`]);
  }
  meta.push(...mentionMeta(inv));
  if (inv.secef?.code) meta.push(["Code SECeF", `${inv.secef.code}${inv.secef.certifiedAt ? ` — ${longDate(inv.secef.certifiedAt)}` : ""}`]);
  // Correction contrôlée : la version qui circule se reconnaît (même numéro).
  if (inv.correctedAt) meta.push(["Rectifiée", `le ${longDate(inv.correctedAt)} — annule et remplace la version précédente`]);
  if (inv.status === "draft") meta.push(["État", "Brouillon — non émise"]);
  if (inv.status === "cancelled") meta.push(["État", "Annulée"]);
  const retention = !isCredit && inv.status !== "cancelled" && (inv.retentionAmount ?? 0) > 0 ? { rate: inv.retentionRate ?? 0, amount: inv.retentionAmount! } : undefined;
  const instal = !isCredit && inv.installments?.length
    ? "Échéancier — " + inv.installments.slice(0, 12).map(x => `${x.label ? `${x.label} : ` : ""}${new Intl.NumberFormat("fr-FR").format(x.amount)} FCFA le ${longDate(x.dueDate)}`).join(" ; ")
    : "";
  const qrs: BusinessDoc["qrs"] = [];
  const due = (inv.totalTTC ?? 0) - (inv.creditedAmount ?? 0) - (inv.paidAmount ?? 0) - (retention?.amount ?? 0);
  if (opts.portalUrl && !isCredit && due > 0) qrs.push({ payload: opts.portalUrl, caption: "Consulter et payer en ligne" });
  if (tenant.branding?.documentQr !== false) {
    qrs.push({
      payload: inv.secef?.qrPayload || `Kanoo | ${isCredit ? "Avoir" : "Facture"} ${inv.number ?? ""} | ${tenant.name ?? ""} | ${Math.round(inv.totalTTC ?? 0)} FCFA | ${longDate(inv.issueDate)}`,
      // Sans certification, le QR n'est qu'une référence : ne pas le faire passer pour un QR fiscal.
      caption: inv.secef?.code ? "Vérification SECeF" : "Référence Kanoo",
    });
  }
  return {
    kind, number: inv.number || "—", meta,
    partyLabel: isCredit ? "Avoir à" : undefined,
    party: partyOf(inv.clientId, inv.attention), object: inv.object,
    lines: linesOf(inv.lines),
    totals: {
      ht: inv.totalHT ?? 0, tva: inv.totalTVA ?? 0, ttc: inv.totalTTC ?? 0, dts: inv.totalDTS ?? 0, vatRates: rates(inv.lines),
      ...(retention ? { retention } : {}), ...(!isCredit ? { paid: inv.paidAmount ?? 0, credited: inv.creditedAmount ?? 0 } : {}),
    },
    notice: isCredit ? inv.creditReason : undefined,
    conditions: [inv.termsAndConditions || tenant.branding?.defaultTerms || "", instal, paymentLine(tenant, isCredit, inv.termsAndConditions)].filter(Boolean).join("\n"),
    signature: signatureOf(tenant, inv.issueDate),
    qrs,
  };
}

export interface QuoteLike extends Mentions {
  number?: string; docKind?: "devis" | "proforma"; status?: string;
  issueDate?: Date | string; validUntil?: Date | string;
  lines?: Line[]; totalHT?: number; totalTVA?: number; totalTTC?: number;
  termsAndConditions?: string; notes?: string;
  clientId?: Party;
}

/** Validité : « 30 jours, jusqu'au 26 novembre 2026 ». */
export function validity(issue?: Date | string, until?: Date | string) {
  if (!until) return "";
  const days = issue ? Math.round((new Date(until).getTime() - new Date(issue).getTime()) / 86_400_000) : 0;
  return days > 0 ? `${days} jours, jusqu'au ${longDate(until)}` : `jusqu'au ${longDate(until)}`;
}

export function quoteDoc(q: QuoteLike, tenant: DocTenant, opts: { proforma?: boolean; style?: DocStyle } = {}): BusinessDoc {
  const proforma = opts.proforma ?? q.docKind === "proforma";
  const meta: Array<[string, string]> = [["Date", longDate(q.issueDate)]];
  if (q.validUntil) meta.push(["Validité", validity(q.issueDate, q.validUntil)]);
  meta.push(...mentionMeta(q));
  const approval = wantsApproval(tenant, opts.style) && q.clientId?.name ? { label: `Bon pour accord — ${shortName(q.clientId.name)}`, hint: "Nom, qualité, date" } : null;
  return {
    kind: proforma ? "proforma" : "quote", number: q.number || "—", meta,
    party: partyOf(q.clientId, q.attention), object: q.object,
    lines: linesOf(q.lines),
    totals: { ht: q.totalHT ?? 0, tva: q.totalTVA ?? 0, ttc: q.totalTTC ?? 0, vatRates: rates(q.lines) },
    // Conditions imprimées ; les anciens devis n'en avaient pas et imprimaient leurs notes.
    conditions: [
      q.termsAndConditions || (q.termsAndConditions === undefined ? q.notes : "") || tenant.branding?.defaultTerms || "",
      proforma ? "Nature du document — facture proforma : offre de prix, elle ne vaut pas facture." : "",
    ].filter(Boolean).join("\n"),
    signature: signatureOf(tenant, q.issueDate),
    counterSignature: approval,
    qrs: tenant.branding?.documentQr !== false ? [{ payload: `Kanoo | ${proforma ? "Proforma" : "Devis"} ${q.number ?? ""} | ${tenant.name ?? ""} | ${Math.round(q.totalTTC ?? 0)} FCFA | ${longDate(q.issueDate)}`, caption: "Référence Kanoo" }] : [],
  };
}

export interface DeliveryLike {
  number?: string; deliveryDate?: Date | string; createdAt?: Date | string; status?: string;
  lines?: Array<Line & { invoiceLineIndex?: number; serialNumber?: string; notes?: string }>;
  deliveryAddress?: string; notes?: string;
  clientId?: Party;
  invoiceId?: { number?: string; lines?: Line[] } | null;
}

export function deliveryDoc(dn: DeliveryLike, tenant: DocTenant): BusinessDoc {
  const meta: Array<[string, string]> = [["Date", longDate(dn.deliveryDate ?? dn.createdAt)]];
  if (dn.invoiceId?.number) meta.push(["Facture", dn.invoiceId.number]);
  if (dn.deliveryAddress) meta.push(["Livré à", dn.deliveryAddress]);
  const lines = (dn.lines ?? []).map(l => {
    const src = l.invoiceLineIndex != null ? dn.invoiceId?.lines?.[l.invoiceLineIndex] : undefined;
    const extra = [l.serialNumber ? `N° de série : ${l.serialNumber}` : "", l.notes ?? ""].filter(Boolean).join(" — ");
    return {
      title: String(l.description || "—"), details: [l.details, extra].filter(Boolean).join("\n") || undefined, section: l.section || undefined,
      unit: l.unit || undefined, quantity: Number(l.quantity) || 0, ...(src ? { ordered: Number(src.quantity) || 0 } : {}),
    };
  });
  return {
    kind: "delivery", number: dn.number || "—", meta,
    party: partyOf(dn.clientId), lines, totals: null,
    conditions: dn.notes || "",
    signature: { ...signatureOf(tenant, dn.deliveryDate ?? dn.createdAt), stamp: tenant.branding?.stamp },
    counterSignature: { label: `Reçu par — ${shortName(dn.clientId?.name) || "le client"}`, hint: "Nom, date, signature — réserves éventuelles :" },
  };
}

export interface OrderLike {
  number?: string; orderDate?: Date | string; expectedDeliveryDate?: Date | string; object?: string; notes?: string;
  lines?: Line[]; totalHT?: number; totalTVA?: number; totalTTC?: number;
  supplierId?: Party;
}

export function orderDoc(o: OrderLike, tenant: DocTenant): BusinessDoc {
  const meta: Array<[string, string]> = [["Date", longDate(o.orderDate)]];
  if (o.expectedDeliveryDate) meta.push(["Livraison attendue", longDate(o.expectedDeliveryDate)]);
  return {
    kind: "order", number: o.number || "—", meta, partyLabel: "Fournisseur",
    party: partyOf(o.supplierId), object: o.object,
    lines: linesOf(o.lines),
    totals: { ht: o.totalHT ?? 0, tva: o.totalTVA ?? 0, ttc: o.totalTTC ?? 0, vatRates: rates(o.lines) },
    conditions: o.notes || "",
    signature: signatureOf(tenant, o.orderDate),
    counterSignature: { label: `Accusé de réception — ${shortName(o.supplierId?.name) || "fournisseur"}`, hint: "Nom, qualité, date" },
  };
}
