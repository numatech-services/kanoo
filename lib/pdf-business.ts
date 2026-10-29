import fs from "fs";
import path from "path";
import QRCode from "qrcode";

/**
 * Documents commerciaux prêts à l'envoi : facture, avoir, facture d'acompte,
 * devis, facture proforma, bon de livraison, bon de commande.
 *
 * Un seul modèle de données (BusinessDoc), deux styles au choix de
 * l'organisation (Apparence des documents) :
 *  - « prestige » : bandeau sombre avec le logo sur carte blanche, titre
 *    centré à empattements, encadré destinataire, conditions sur fond clair,
 *    signature et cachet ;
 *  - « moderne » : fond blanc, logo et identité en tête, encadrés Client et
 *    Objet, lignes regroupées par poste, double signature « Bon pour accord » ;
 *  - « signature » : maquette éditoriale (Newsreader et Hanken Grotesk) —
 *    filet bicolore, identité légale complète en tête, titre à empattements,
 *    bandeau des références, total TTC en pavé, conditions en colonnes, pied
 *    sombre avec coordonnées bancaires et contact sur chaque page.
 *
 * Chaque ligne porte un intitulé (en gras) et un descriptif ; les lignes se
 * regroupent par section (« Audiovisuel », « Travaux »…). Le tableau se
 * poursuit sur les pages suivantes avec son en-tête ; chaque page porte le
 * pied légal et « page X sur Y ».
 *
 * Polices embarquées (assets/fonts, licence OFL) : Lato pour le texte, PT
 * Serif pour les titres du style prestige ; Newsreader et Hanken Grotesk pour
 * le style signature. Sans elles, repli sur Helvetica.
 */

type PDFDoc = InstanceType<typeof import("pdfkit")>;

export const DOC_STYLES = ["prestige", "moderne", "signature"] as const;
export type DocStyle = typeof DOC_STYLES[number];
export const isDocStyle = (v: unknown): v is DocStyle => DOC_STYLES.includes(v as DocStyle);
export type DocKind = "invoice" | "credit_note" | "deposit" | "quote" | "proforma" | "delivery" | "order";

export interface BizParty { name: string; lines: string[]; attention?: string }
export interface BizLine {
  title: string; details?: string; section?: string; unit?: string;
  quantity: number; unitPrice?: number; discount?: number; totalHT?: number;
  /** Bon de livraison : quantité commandée (la quantité est celle livrée). */
  ordered?: number;
}
export interface BizTotals {
  ht: number; tva: number; ttc: number; dts?: number;
  /** Taux de TVA distincts (pour l'intitulé « TVA 19 % »). */
  vatRates?: number[];
  retention?: { rate: number; amount: number };
  paid?: number; credited?: number;
}
export interface BizSignature { place?: string; date?: string; company: string; name?: string; title?: string; stamp?: string | null }
export interface BusinessDoc {
  kind: DocKind;
  number: string;
  /** Lignes d'en-tête : [libellé, valeur] (date, validité, référence, période…). */
  meta: Array<[string, string]>;
  partyLabel?: string;
  party?: BizParty | null;
  object?: string;
  lines: BizLine[];
  totals?: BizTotals | null;
  conditions?: string;
  /** Mention en tête des conditions (motif d'un avoir…). */
  notice?: string;
  signature: BizSignature;
  /** Seconde signature (« Bon pour accord — client », « Reçu par »). */
  counterSignature?: { label: string; hint: string } | null;
  qrs?: Array<{ payload: string; caption: string }>;
}
export interface DocTenant {
  name?: string; logo?: string; nif?: string; rccm?: string; address?: string; phone?: string; email?: string;
  branding?: {
    primaryColor?: string; secondaryColor?: string; showLogo?: boolean; tagline?: string; legalFooter?: string;
    paymentInstructions?: string; defaultTerms?: string; documentQr?: boolean;
    documentStyle?: DocStyle; city?: string; website?: string; extraIds?: string;
    signatoryName?: string; signatoryTitle?: string; stamp?: string; clientApproval?: boolean;
    /** Forme et capital (« SARL au capital de 100 000 FCFA »), imprimés en tête (style signature). */
    legalForm?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Textes
// ─────────────────────────────────────────────────────────────────────────────

export const KIND_TITLE: Record<DocKind, string> = {
  invoice: "Facture", credit_note: "Avoir", deposit: "Facture d'acompte", quote: "Devis",
  proforma: "Facture proforma", delivery: "Bon de livraison", order: "Bon de commande",
};
const STOPPED: Partial<Record<DocKind, string>> = {
  invoice: "Arrêtée la présente facture", credit_note: "Arrêté le présent avoir", deposit: "Arrêtée la présente facture d'acompte",
  quote: "Arrêté le présent devis", proforma: "Arrêtée la présente facture proforma", order: "Arrêté le présent bon de commande",
};

/** 1250000 → « 1 250 000 » (espace insécable, entier). */
export function amount(n: number): string {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/[  \s]/g, " ");
}
/** Quantité : jusqu'à deux décimales, virgule (33,75). */
export function qty(n: number): string {
  return (Math.round((n || 0) * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[  \s]/g, " ");
}

/** Montant entier en toutes lettres (règles du français : vingt et un, quatre-vingts, cents, mille invariable). */
export function amountInWordsFr(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) >= 1e12) return "";
  n = Math.round(Math.abs(n));
  const u = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
  const t = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];
  if (n === 0) return "zéro";
  const below100 = (x: number): string => {
    if (x < 20) return u[x];
    const d = Math.floor(x / 10), r = x % 10;
    // Orthographe traditionnelle, comme « deux cent mille » : « vingt et un », « soixante et onze ».
    if (d === 7 || d === 9) return t[d] + (r === 1 && d === 7 ? " et onze" : "-" + u[10 + r]);
    let s = t[d];
    if (r === 1 && d >= 2 && d <= 6) s += " et un";
    else if (r > 0) s += "-" + u[r];
    else if (d === 8) s += "s";
    return s;
  };
  const below1000 = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    let s = "";
    if (h > 0) s += (h > 1 ? u[h] + " " : "") + "cent" + (h > 1 && r === 0 ? "s" : "");
    if (r > 0) s += (s ? " " : "") + below100(r);
    return s;
  };
  const parts: string[] = [];
  let rest = n;
  for (const [sing, plur, val] of [["milliard", "milliards", 1e9], ["million", "millions", 1e6]] as const) {
    const q = Math.floor(rest / val); rest %= val;
    if (q > 0) parts.push(below1000(q) + " " + (q > 1 ? plur : sing));
  }
  const q = Math.floor(rest / 1000); rest %= 1000;
  // « deux cent mille », « quatre-vingt mille » : pas de s devant mille.
  if (q > 0) parts.push((q > 1 ? below1000(q).replace(/(cent|vingt)s$/, "$1") + " " : "") + "mille");
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

/** « Arrêtée la présente facture à la somme de cinq millions… (5 117 000) francs CFA toutes taxes comprises. » */
export function stoppedSentence(kind: DocKind, ttc: number): { lead: string; bold: string; tail: string } | null {
  const lead = STOPPED[kind];
  const words = amountInWordsFr(ttc);
  if (!lead || !words) return null;
  // « deux millions de francs », mais « deux millions cent mille francs ».
  const de = /(million|milliard)s?$/.test(words) ? "de " : "";
  return { lead: `${lead} à la somme de `, bold: `${words} (${amount(ttc).replace(/\s/g, "\u00a0")}) ${de}francs CFA`, tail: " toutes taxes comprises." };
}

/** Conditions : un paragraphe par ligne ; « Titre — texte » met le titre en gras. */
export function conditionParagraphs(text: string): Array<{ title?: string; body: string }> {
  return text.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = /^([^—:]{2,60}?)\s*(?:—|:)\s+(.+)$/.exec(l);
    return m ? { title: m[1], body: m[2] } : { body: l };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Couleurs et polices
// ─────────────────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/;
function tint(hex: string, w: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * w);
  return `#${[mix(n >> 16), mix((n >> 8) & 255), mix(n & 255)].map(x => x.toString(16).padStart(2, "0")).join("")}`;
}
function shade(hex: string, w: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * (1 - w));
  return `#${[mix(n >> 16), mix((n >> 8) & 255), mix(n & 255)].map(x => x.toString(16).padStart(2, "0")).join("")}`;
}
function palette(t: DocTenant, style: DocStyle) {
  const b = t.branding ?? {};
  const def = { prestige: ["#12324F", "#B85C6E"], moderne: ["#1F5AA6", "#1F5AA6"], signature: ["#2F78C2", "#B25E72"] }[style];
  const primary = HEX.test(b.primaryColor ?? "") ? b.primaryColor! : def[0];
  const accent = HEX.test(b.secondaryColor ?? "") ? b.secondaryColor! : def[1];
  return {
    primary, accent, ink: "#1A1D23", muted: "#5B616B", faint: "#8A929E", line: "#E2E6EC", soft: tint(primary, 0.92), panel: "#F2F3F5",
    // Style signature : bleu nuit (titres, tableau, pied) tiré de la couleur principale.
    navy: shade(primary, 0.51),
  };
}

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONT_FILES = {
  body: "Lato-Regular.ttf", bold: "Lato-Bold.ttf", italic: "Lato-Italic.ttf", black: "Lato-Black.ttf",
  serif: "PT_Serif-Web-Regular.ttf", serifBold: "PT_Serif-Web-Bold.ttf",
} as const;
/** Style signature : mêmes rôles, autres familles (texte Hanken Grotesk, titres Newsreader). */
const SIGNATURE_FONT_FILES: Record<keyof typeof FONT_FILES, string> = {
  body: "HankenGrotesk-Regular.ttf", bold: "HankenGrotesk-SemiBold.ttf", italic: "Newsreader-Italic.ttf", black: "HankenGrotesk-SemiBold.ttf",
  serif: "Newsreader-Regular.ttf", serifBold: "Newsreader-Medium.ttf",
};
const FALLBACK_FONTS: Record<keyof typeof FONT_FILES, string> = {
  body: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", black: "Helvetica-Bold", serif: "Times-Roman", serifBold: "Times-Bold",
};
type FontKey = keyof typeof FONT_FILES;

function registerFonts(doc: PDFDoc, style: DocStyle): Record<FontKey, string> {
  const names = {} as Record<FontKey, string>;
  const files: Record<FontKey, string> = style === "signature" ? SIGNATURE_FONT_FILES : FONT_FILES;
  for (const key of Object.keys(FONT_FILES) as FontKey[]) {
    const file = path.join(FONT_DIR, files[key]);
    if (fs.existsSync(file)) { doc.registerFont(`k-${key}`, file); names[key] = `k-${key}`; }
    else names[key] = FALLBACK_FONTS[key];
  }
  return names;
}

function image(src?: string | null): Buffer | null {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec((src ?? "").trim());
  if (!m) return null;
  try { return Buffer.from(m[2], "base64"); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendu
// ─────────────────────────────────────────────────────────────────────────────

const W = 595.28, H = 841.89, M = 48, CW = W - 2 * M;
const FOOTER_TOP_DEFAULT = H - 64;
/** Style signature : pied sombre de 56 pt et filet bicolore sous lui. */
const SIG_FOOTER_H = 56;

export async function renderBusinessPdf(d: BusinessDoc, tenant: DocTenant, opts: { style?: DocStyle } = {}): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const style: DocStyle = opts.style ?? tenant.branding?.documentStyle ?? "prestige";
  const c = palette(tenant, style);
  const sig = style === "signature";
  const FOOTER_TOP = sig ? H - SIG_FOOTER_H - 14 : FOOTER_TOP_DEFAULT;
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `${KIND_TITLE[d.kind]} ${d.number}`, Author: tenant.name ?? "" } });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const F = registerFonts(doc, style);
  const title = KIND_TITLE[d.kind];
  const priced = d.kind !== "delivery";
  let y = 0;

  const font = (k: FontKey, size: number, color = c.ink) => doc.font(F[k]).fontSize(size).fillColor(color);
  const h = (text: string, k: FontKey, size: number, width: number, extra: Record<string, unknown> = {}) => { doc.font(F[k]).fontSize(size); return doc.heightOfString(text || " ", { width, ...extra }); };
  const newPage = () => {
    doc.addPage();
    // Pages suivantes : un filet de couleur et la référence, discrets.
    if (style === "prestige") { doc.rect(0, 0, W, 8).fill(c.primary); doc.rect(0, 8, W, 2).fill(c.accent); }
    if (sig) bicolor(0, 4);
    font("bold", 8.5, c.faint).text(`${title} ${d.number}`, M, 22, { width: CW, align: "right" });
    y = 44;
  };
  /** Filet bicolore : 5/6 couleur principale, 1/6 couleur d'accent. */
  const bicolor = (yy: number, hh: number) => { doc.rect(0, yy, W * 5 / 6, hh).fill(c.primary); doc.rect(W * 5 / 6, yy, W / 6, hh).fill(c.accent); };
  const room = (need: number) => { if (y + need > FOOTER_TOP - 4) { newPage(); return true; } return false; };

  // ── En-tête ────────────────────────────────────────────────────────────────
  const b = tenant.branding ?? {};
  const logo = b.showLogo === false ? null : image(tenant.logo);
  if (sig) {
    bicolor(0, 4);
    const top = 30;
    let tx = M;
    if (logo) { try { doc.image(logo, M, top, { fit: [40, 40], valign: "center" }); } catch { /* image illisible */ } tx = M + 50; }
    font("serifBold", 16, c.primary).text(tenant.name ?? "", tx, top + 7, { width: 240, lineBreak: false, ellipsis: true });
    if (b.tagline) font("body", 6.8, c.accent).text(b.tagline, tx, top + 27, { width: 240, characterSpacing: 0.55, lineBreak: false, ellipsis: true });
    // Identité légale complète, à droite.
    const rx = W - M - 250;
    const legalLines = [
      tenant.address ? `Siège : ${tenant.address}` : "",
      [tenant.rccm ? `RCCM ${tenant.rccm}` : "", tenant.nif ? `NIF ${tenant.nif}` : ""].filter(Boolean).join(" · "),
      b.extraIds ?? "",
    ].filter(Boolean);
    let ry = top + 1;
    font("bold", 6.6, c.navy).text([tenant.name, b.legalForm].filter(Boolean).join(" — "), rx, ry, { width: 250, align: "right" }); ry = doc.y + 1;
    for (const l of legalLines) { font("body", 6.6, c.muted).text(l, rx, ry, { width: 250, align: "right" }); ry = doc.y + 1; }
    const rule = Math.max(top + 44, ry + 4);
    doc.moveTo(M, rule).lineTo(W - M, rule).lineWidth(0.75).strokeColor(c.primary).stroke();
    // Titre et numéro, centrés.
    font("serif", 26, c.navy).text(title, M, rule + 18, { width: CW, align: "center" });
    font("bold", 7.2, c.accent).text(`N° ${d.number}`.toUpperCase(), M, doc.y + 1, { width: CW, align: "center", characterSpacing: 1.7 });
    y = doc.y + 11;
    // Bandeau des références : « Libellé valeur », centrés, sur une ou plusieurs lignes.
    if (d.meta.length) {
      const items = d.meta.map(([k, v]) => ({ k, v, w: doc.font(F.body).fontSize(7.6).widthOfString(`${k}  `) + doc.font(F.bold).fontSize(7.6).widthOfString(v) }));
      const rows: Array<typeof items> = [[]];
      let rw = 0;
      for (const it of items) {
        const add = (rows[rows.length - 1].length ? 20 : 0) + it.w;
        if (rw + add > CW - 24 && rows[rows.length - 1].length) { rows.push([it]); rw = it.w; } else { rows[rows.length - 1].push(it); rw += add; }
      }
      const bandH = rows.length * 12 + 13;
      doc.rect(M, y, CW, bandH).fill(c.soft);
      rows.forEach((row, ri) => {
        const total = row.reduce((s2, it) => s2 + it.w, 0) + (row.length - 1) * 20;
        let x = M + (CW - Math.min(total, CW - 24)) / 2;
        for (const it of row) {
          font("body", 7.6, c.primary).text(`${it.k}  `, x, y + 7 + ri * 12, { lineBreak: false, continued: true });
          font("bold", 7.6, c.navy).text(it.v, { lineBreak: false });
          x += it.w + 20;
        }
      });
      y += bandH + 16;
    }
  } else if (style === "prestige") {
    doc.rect(0, 0, W, 108).fill(c.primary);
    doc.rect(0, 108, W, 5).fill(c.accent);
    // Motif discret à droite (réseau de cercles), dans la couleur du bandeau.
    doc.save().opacity(0.12).lineWidth(2.2).strokeColor("#FFFFFF");
    for (const [x, yy, r] of [[520, 20, 13], [560, 54, 17], [505, 76, 10], [578, 96, 8], [540, 99, 6]] as const) doc.circle(x, yy, r).stroke();
    doc.moveTo(520, 20).lineTo(560, 54).lineTo(505, 76).lineTo(540, 99).lineTo(578, 96).stroke();
    doc.restore();
    let textX = M;
    if (logo) {
      doc.roundedRect(M, 15, 150, 78, 9).fill("#FFFFFF");
      try { doc.image(logo, M + 10, 22, { fit: [130, 64], align: "center", valign: "center" }); } catch { /* image illisible */ }
      textX = M + 172;
    }
    const tw = W - textX - 70;
    font("serifBold", 22, "#FFFFFF").text((tenant.name ?? "").toUpperCase(), textX, 26, { width: tw, lineBreak: false, ellipsis: true });
    doc.rect(textX, 55, 34, 2.5).fill(c.accent);
    if (b.tagline) font("body", 11.5, "#FFFFFF").text(b.tagline, textX, 64, { width: tw, lineBreak: false, ellipsis: true });
    const city = b.city || tenant.address;
    if (city) { doc.fillOpacity(0.75); font("body", 9.5, "#FFFFFF").text(city, textX, 81, { width: tw, lineBreak: false, ellipsis: true }); doc.fillOpacity(1); }
    // Titre du document, centré.
    font("serifBold", 21, c.primary).text(title.toUpperCase(), M, 130, { width: CW, align: "center", characterSpacing: 3 });
    doc.rect(W / 2 - 12, 159, 24, 2).fill(c.accent);
    y = 176;
  } else {
    let ly = 40;
    if (logo) { try { doc.image(logo, M, ly, { fit: [120, 52] }); } catch { /* image illisible */ } ly += 60; }
    const idLines = [
      [tenant.name, b.tagline].filter(Boolean).join(" — "),
      [tenant.address, tenant.phone].filter(Boolean).join(" · "),
      [tenant.email, b.website].filter(Boolean).join(" · "),
    ].filter(Boolean);
    font("body", 9.5, c.muted);
    for (const l of idLines) { doc.text(l, M, ly, { width: 300 }); ly = doc.y + 1; }
    const head = `${title.toUpperCase()} N° ${d.number}`;
    let hs = 15; doc.font(F.black); while (hs > 10 && doc.fontSize(hs).widthOfString(head) > W - M - 250) hs -= 0.5;
    font("black", hs, c.primary).text(head, 250, 44, { width: W - M - 250, align: "right" });
    let ry = doc.y + 4;
    font("body", 9.5, c.muted);
    const ids = [[tenant.rccm ? `RCCM ${tenant.rccm}` : "", tenant.nif ? `NIF ${tenant.nif}` : ""].filter(Boolean).join(" · "), b.extraIds ?? ""].filter(Boolean);
    for (const [lab, val] of d.meta) { doc.text(`${lab} : ${val}`, 260, ry, { width: W - M - 260, align: "right" }); ry = doc.y + 1.5; }
    for (const l of ids) { doc.text(l, 260, ry, { width: W - M - 260, align: "right" }); ry = doc.y + 1.5; }
    // Pas de second titre : « TITRE N° … » ci-dessus et l'encadré Objet suffisent
    // (le doublon repoussait conditions et signatures en page suivante).
    y = Math.max(ly, ry) + 14;
    doc.rect(M, y, 40, 3).fill(c.primary);
    y += 18;
  }

  // ── Destinataire, références, objet ───────────────────────────────────────
  const partyLabel = (d.partyLabel ?? (d.kind === "order" ? "Fournisseur" : style === "moderne" ? "Client" : "Destinataire")).toUpperCase();
  if (sig) {
    const colW = (CW - 24) / 2, top = y;
    let ly = top;
    if (d.party) {
      const p = d.party;
      font("bold", 6.4, c.accent).text(partyLabel, M, ly, { characterSpacing: 1.4 }); ly = doc.y + 4;
      const bx = M + 9, bwid = colW - 9, bTop = ly;
      font("bold", 8.6, c.navy).text(p.name, bx, ly, { width: bwid }); ly = doc.y + 1;
      for (const l of p.lines) { font("body", 7.8, c.ink).text(l, bx, ly, { width: bwid }); ly = doc.y; }
      if (p.attention) { font("body", 7.8, c.muted).text(p.attention, bx, ly + 1, { width: bwid }); ly = doc.y; }
      doc.rect(M, bTop - 1, 1.6, ly - bTop + 2).fill(c.accent);
    }
    let oy = top;
    if (d.object) {
      const ox = d.party ? M + colW + 24 : M, ow = d.party ? colW : CW;
      font("bold", 6.4, c.primary).text("OBJET", ox, oy, { characterSpacing: 1.4 }); oy = doc.y + 4;
      font("serif", 9.6, c.ink).text(d.object, ox, oy, { width: ow, lineGap: 1.4 }); oy = doc.y;
    }
    y = Math.max(ly, oy) + 16;
  } else if (style === "prestige") {
    const bw = 250, pad = 13;
    const p = d.party;
    const nameH = p ? h(p.name, "serifBold", 12.5, bw - 2 * pad) : 0;
    const linesText = p ? p.lines.join("\n") : "";
    const linesH = p && linesText ? h(linesText, "body", 9.5, bw - 2 * pad, { lineGap: 1.5 }) : 0;
    const attH = p?.attention ? h(p.attention, "italic", 9.5, bw - 2 * pad) : 0;
    const boxH = p ? pad + 12 + nameH + 4 + linesH + (attH ? attH + 2 : 0) + pad : 0;
    if (p) {
      doc.rect(M, y, bw, boxH).fill(c.panel);
      doc.rect(M, y, bw, 2.5).fill(c.primary);
      font("bold", 7.5, c.accent).text(partyLabel, M + pad, y + pad, { characterSpacing: 1.6 });
      font("serifBold", 12.5, c.primary).text(p.name, M + pad, y + pad + 12, { width: bw - 2 * pad });
      let py = doc.y + 4;
      if (linesText) { font("body", 9.5, c.ink).text(linesText, M + pad, py, { width: bw - 2 * pad, lineGap: 1.5 }); py = doc.y; }
      if (p.attention) font("italic", 9.5, c.ink).text(p.attention, M + pad, py + 2, { width: bw - 2 * pad });
    }
    let my = y + 12;
    const mx = M + bw + 20, lw = 62, vw = W - M - mx - lw;
    for (const [lab, val] of [["N°", d.number] as [string, string], ...d.meta]) {
      const vh = h(val, "bold", 9.5, vw);
      font("body", 9.5, c.faint).text(lab, mx, my, { width: lw });
      font("bold", 9.5, c.primary).text(val, mx + lw, my, { width: vw });
      my += Math.max(vh, 12) + 4;
    }
    y = Math.max(y + boxH, my) + 16;
    if (d.object) {
      font("bold", 9.6, c.primary).text("Objet : ", M, y, { continued: true });
      font("body", 9.6, c.ink).text(d.object, { width: CW, lineGap: 1.3 });
      y = doc.y + 10;
    }
  } else {
    const gap = 14, bw = d.object ? (CW - gap) / 2 : CW, pad = 13;
    const p = d.party;
    const clientText = p ? [p.name, ...p.lines, p.attention ?? ""].filter(Boolean).join("\n") : "";
    const hc = p ? h(clientText, "body", 9.5, bw - 2 * pad, { lineGap: 1.5 }) : 0;
    const ho = d.object ? h(d.object, "body", 9.5, bw - 2 * pad, { lineGap: 1.5 }) : 0;
    const boxH = pad + 14 + Math.max(hc, ho) + pad;
    if (p) {
      doc.roundedRect(M, y, bw, boxH, 7).fill(c.soft);
      font("bold", 7.5, c.primary).text(partyLabel, M + pad, y + pad, { characterSpacing: 1.6 });
      font("body", 9.5, c.ink).text(clientText, M + pad, y + pad + 14, { width: bw - 2 * pad, lineGap: 1.5 });
    }
    if (d.object) {
      const ox = p ? M + bw + gap : M;
      doc.roundedRect(ox, y, bw, boxH, 7).fill(c.soft);
      font("bold", 7.5, c.primary).text("OBJET", ox + pad, y + pad, { characterSpacing: 1.6 });
      font("body", 9.5, c.ink).text(d.object, ox + pad, y + pad + 14, { width: bw - 2 * pad, lineGap: 1.5 });
    }
    y += (p || d.object ? boxH : 0) + 16;
  }

  // ── Tableau des lignes ────────────────────────────────────────────────────
  const hasUnit = d.lines.some(l => l.unit && l.unit !== "unité");
  const anyDiscount = priced && d.lines.some(l => (l.discount ?? 0) > 0);
  type Col = { key: string; label: string; w: number; align: "left" | "center" | "right" };
  const cols: Col[] = [{ key: "n", label: "N°", w: 26, align: "left" }, { key: "des", label: style === "moderne" ? "Poste et désignation" : sig ? "Désignation" : "Désignation et caractéristiques", w: 0, align: "left" }];
  if (hasUnit) cols.push({ key: "unit", label: "Unité", w: 40, align: "center" });
  if (d.kind === "delivery") {
    if (d.lines.some(l => l.ordered != null)) cols.push({ key: "ordered", label: "Commandé", w: 76, align: "center" });
    cols.push({ key: "qty", label: "Livré", w: 56, align: "center" });
  } else {
    cols.push({ key: "qty", label: "Qté", w: 32, align: "center" });
    if (anyDiscount) cols.push({ key: "disc", label: "Rem.", w: 34, align: "center" });
    cols.push({ key: "pu", label: "P.U. HT", w: 66, align: "right" }, { key: "tot", label: "Total HT", w: 70, align: "right" });
  }
  cols[1].w = CW - cols.reduce((s, x) => s + x.w, 0);
  const xs: number[] = []; { let x = M; for (const col of cols) { xs.push(x); x += col.w; } }
  // Montants sans unité répétée dans les cellules : « FCFA » figure une fois, sur le total.
  const unitF = "";
  const header = () => {
    if (sig) {
      doc.rect(M, y, CW, 20).fill(c.navy);
      // Chiffres alignés à droite, en-têtes avec eux ; l'unité reste centrée.
      cols.forEach((col, i) => font("bold", 6.2, "#FFFFFF").text(col.label.toUpperCase(), xs[i] + (i === 0 ? 6 : 4), y + 7.2, { width: col.w - (i === 0 ? 6 : 10), align: col.align === "center" && col.key !== "unit" ? "right" : col.align, characterSpacing: 0.9, lineBreak: false }));
      y += 20;
      return;
    }
    doc.rect(M, y, CW, 24).fill(c.primary);
    cols.forEach((col, i) => {
      const lab = style === "moderne" ? col.label.toUpperCase() : col.label;
      font("bold", style === "moderne" ? 8 : 9, "#FFFFFF").text(lab, xs[i] + (i === 0 ? 8 : 4), y + 8, { width: col.w - (i === 0 ? 8 : 10), align: col.align, characterSpacing: style === "moderne" ? 1.1 : 0, lineBreak: false });
    });
    y += 24;
  };
  header();
  let currentSection: string | undefined;
  d.lines.forEach((l, i) => {
    const desW = cols[1].w - 12;
    // Style signature : intitulé à empattements, descriptif plus petit, numéro « 01 ».
    const tKey: FontKey = sig ? "serif" : "bold", tSize = sig ? 9.6 : 9.8, dSize = sig ? 7.6 : 8.3;
    const tH = h(l.title, tKey, tSize, desW);
    const dH = l.details ? h(l.details, "body", dSize, desW, { lineGap: 1.1 }) + 3 : 0;
    const rowH = Math.max(tH + dH, 12) + (style === "moderne" ? 16 : 13);
    if (l.section && l.section !== currentSection) {
      if (room(24 + rowH)) header();
      if (sig) {
        font("bold", 6.4, c.accent).text(l.section.toUpperCase(), M + 6, y + 9, { width: CW - 12, characterSpacing: 1.4 });
        y += 20;
        doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.75).strokeColor(c.accent).stroke();
      } else {
        doc.rect(M, y, CW, 22).fill(c.soft);
        font("bold", 8.2, c.primary).text(l.section.toUpperCase(), M + 8, y + 7.5, { width: CW - 16, characterSpacing: 1.6 });
        y += 22;
      }
      currentSection = l.section;
    }
    if (room(rowH)) header();
    const ty = y + (style === "moderne" ? 9 : 7);
    cols.forEach((col, k) => {
      const x = xs[k] + (k === 0 ? (sig ? 6 : 8) : 4), w = col.w - (k === 0 ? 8 : 10);
      if (col.key === "n") font("bold", sig ? 8 : 9.8, sig ? c.primary : style === "prestige" ? c.accent : c.ink).text(sig ? String(i + 1).padStart(2, "0") : String(i + 1), x, ty + (sig ? 1.5 : 0), { width: w });
      else if (col.key === "des") {
        font(tKey, tSize, sig ? c.navy : style === "prestige" ? c.primary : c.ink).text(l.title, x, ty, { width: desW });
        if (l.details) font("body", dSize, c.muted).text(l.details, x, doc.y + 2, { width: desW, lineGap: 1.1, align: sig ? "left" : "justify" });
      } else if (sig) {
        const v = col.key === "unit" ? (l.unit && l.unit !== "unité" ? l.unit : "—")
          : col.key === "qty" ? qty(l.quantity) : col.key === "ordered" ? (l.ordered != null ? qty(l.ordered) : "—")
          : col.key === "disc" ? (l.discount ? `${qty(l.discount)} %` : "")
          : col.key === "pu" ? amount(l.unitPrice ?? 0) : amount(l.totalHT ?? 0);
        font(col.key === "tot" ? "bold" : "body", 8, col.key === "unit" ? c.muted : c.ink).text(v, x, ty + 1.5, { width: w, align: col.align === "center" && col.key !== "unit" ? "right" : col.align, lineBreak: false });
      } else {
        const v = col.key === "unit" ? (l.unit && l.unit !== "unité" ? l.unit : "u")
          : col.key === "qty" ? qty(l.quantity) : col.key === "ordered" ? (l.ordered != null ? qty(l.ordered) : "—")
          : col.key === "disc" ? (l.discount ? `${qty(l.discount)} %` : "")
          : col.key === "pu" ? `${amount(l.unitPrice ?? 0)}${unitF}` : `${amount(l.totalHT ?? 0)}${unitF}`;
        font("body", 9.8, c.ink).text(v, x, ty, { width: w, align: col.align, lineBreak: false });
      }
    });
    y += rowH;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(c.line).stroke();
  });
  if (style === "prestige") { doc.moveTo(M, y).lineTo(W - M, y).lineWidth(2).strokeColor(c.primary).stroke(); }
  y += sig ? 12 : 6;

  // ── Totaux ─────────────────────────────────────────────────────────────────
  const t = d.totals;
  if (priced && t && sig) {
    // Somme en lettres en italique à gauche, montants et pavé TTC à droite.
    const bw = 196, bx = W - M - bw;
    const rows: Array<[string, string, string?]> = [["Total hors taxes", amount(t.ht)]];
    if (t.tva > 0) rows.push([t.vatRates?.length === 1 ? `TVA ${qty(t.vatRates[0] * 100)} %` : "TVA", amount(t.tva)]);
    if ((t.dts ?? 0) > 0) rows.push(["Droit de timbre", amount(t.dts!)]);
    const after: Array<[string, string, string]> = [];
    if (t.retention && t.retention.amount > 0) {
      after.push([`Retenue de garantie (${qty(t.retention.rate * 100)} %)`, `− ${amount(t.retention.amount)}`, c.ink]);
      after.push(["Net à payer", amount(t.ttc - t.retention.amount), c.navy]);
    }
    if ((t.paid ?? 0) > 0) {
      after.push(["Déjà encaissé", amount(t.paid!), "#1C5D4C"]);
      const due = t.ttc - (t.credited ?? 0) - (t.paid ?? 0) - (t.retention?.amount ?? 0);
      if (due > 0) after.push(["Reste dû", amount(due), "#B23B2E"]);
    }
    const s = stoppedSentence(d.kind, t.ttc);
    const words = s ? s.lead + s.bold + s.tail : "";
    const wordsW = CW - bw - 26;
    const wordsH = words ? h(words, "italic", 9.2, wordsW, { lineGap: 1.4 }) : 0;
    const blockH = rows.length * 13 + 8 + 30 + after.length * 13;
    room(Math.max(blockH, wordsH) + 6);
    const top = y;
    let ry = y;
    for (const [lab, val] of rows) {
      font("body", 8, c.muted).text(lab, bx + 4, ry, { width: 110 });
      font("body", 8, c.ink).text(val, bx + 110, ry, { width: bw - 114, align: "right" });
      ry += 13;
    }
    doc.moveTo(bx, ry + 1).lineTo(W - M, ry + 1).lineWidth(0.6).strokeColor(c.line).stroke();
    ry += 7;
    doc.rect(bx, ry, bw, 30).fill(c.primary);
    font("bold", 6.8, "#FFFFFF").text(d.kind === "credit_note" ? "TOTAL DE L'AVOIR" : "TOTAL TTC", bx + 10, ry + 12, { characterSpacing: 0.9, lineBreak: false });
    const cfa = " F CFA";
    doc.font(F.body).fontSize(7.5); const cfaW = doc.widthOfString(cfa);
    font("serif", 15.5, "#FFFFFF").text(amount(t.ttc), bx + 70, ry + 7, { width: bw - 80 - cfaW, align: "right", lineBreak: false });
    font("body", 7.5, "#FFFFFF").text(cfa, W - M - 10 - cfaW, ry + 13, { lineBreak: false });
    ry += 34;
    for (const [lab, val, color] of after) {
      font("bold", 8, color).text(lab, bx + 4, ry, { width: 120 });
      font("bold", 8, color).text(val, bx + 110, ry, { width: bw - 114, align: "right" });
      ry += 13;
    }
    // Phrase alignée sur le bas du pavé TTC.
    if (words && s) {
      const wy = Math.max(top, top + rows.length * 13 + 8 + 30 - wordsH);
      font("italic", 9.2, c.muted).text(s.lead, M, wy, { continued: true, width: wordsW, lineGap: 1.4 });
      font("italic", 9.2, c.navy).text(s.bold, { continued: true });
      font("italic", 9.2, c.muted).text(s.tail);
    }
    y = Math.max(ry, top + wordsH) + 16;
  } else if (priced && t) {
    const rows: Array<[string, string, "normal" | "strong" | "neg" | "pos"]> = [];
    rows.push(["Total hors taxes", amount(t.ht) + unitF, "normal"]);
    if (t.tva > 0) rows.push([t.vatRates?.length === 1 ? `TVA ${qty(t.vatRates[0] * 100)} %` : "TVA", amount(t.tva) + unitF, "normal"]);
    if ((t.dts ?? 0) > 0) rows.push(["Droit de timbre", amount(t.dts!) + unitF, "normal"]);
    const after: typeof rows = [];
    if (t.retention && t.retention.amount > 0) {
      after.push([`Retenue de garantie (${qty(t.retention.rate * 100)} %)`, `− ${amount(t.retention.amount)}${unitF}`, "normal"]);
      after.push(["Net à payer", amount(t.ttc - t.retention.amount) + unitF, "strong"]);
    }
    if ((t.paid ?? 0) > 0) {
      after.push(["Déjà encaissé", amount(t.paid!) + unitF, "pos"]);
      const due = t.ttc - (t.credited ?? 0) - (t.paid ?? 0) - (t.retention?.amount ?? 0);
      if (due > 0) after.push(["Reste dû", amount(due) + unitF, "neg"]);
    }
    room(rows.length * 22 + 34 + after.length * 20);
    const lx = style === "prestige" ? M : 300, lw = style === "prestige" ? CW - 110 : 150;
    const vx = W - M - 110, vw = 102;
    for (const [lab, val] of rows) {
      font("body", 10, c.muted).text(lab, lx, y + 5, { width: lw, align: style === "prestige" ? "right" : "left" });
      font("body", 10, c.ink).text(val, vx, y + 5, { width: vw, align: "right" });
      y += style === "prestige" ? 19 : 22;
      if (style === "prestige") doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(c.line).stroke();
    }
    const totalLabel = d.kind === "credit_note" ? "TOTAL DE L'AVOIR (FCFA)" : style === "prestige" ? "TOTAL TOUTES TAXES COMPRISES (FCFA)" : "Total TTC (FCFA)";
    if (style === "prestige") {
      doc.rect(M, y, CW, 26).fill(c.panel);
      font("bold", 10.5, c.primary).text(totalLabel, lx, y + 8, { width: lw, align: "right" });
      font("black", 12.5, c.primary).text(amount(t.ttc), vx, y + 6.5, { width: vw, align: "right" });
      y += 30;
    } else {
      doc.moveTo(300, y + 2).lineTo(W - M, y + 2).lineWidth(2).strokeColor(c.primary).stroke();
      font("black", 13, c.primary).text(totalLabel, lx, y + 10, { width: lw });
      font("black", 13, c.primary).text(amount(t.ttc) + unitF, vx - 20, y + 10, { width: vw + 20, align: "right" });
      y += 34;
    }
    for (const [lab, val, tone] of after) {
      const color = tone === "neg" ? "#B23B2E" : tone === "pos" ? "#1C5D4C" : c.ink;
      font(tone === "normal" ? "body" : "bold", 10, color).text(lab, lx, y, { width: lw, align: style === "prestige" ? "right" : "left" });
      font(tone === "normal" ? "body" : "bold", 10, color).text(val, vx, y, { width: vw, align: "right" });
      y += 18;
    }
    const s = stoppedSentence(d.kind, t.ttc);
    if (s) {
      y += 6;
      const full = s.lead + s.bold + s.tail;
      room(h(full, "bold", 10, CW) + 8);
      font("body", 10, c.ink).text(s.lead, M, y, { continued: true, width: CW, lineGap: 1.5 });
      font("bold", 10, c.primary).text(s.bold, { continued: true });
      font(style === "prestige" ? "bold" : "body", 10, style === "prestige" ? c.primary : c.ink).text(s.tail);
      y = doc.y + 10;
    }
  } else y += 10;

  // ── Conditions, signatures, QR ─────────────────────────────────────────────
  const paras = [...(d.notice ? [{ title: "Motif", body: d.notice }] : []), ...conditionParagraphs(d.conditions ?? "")];
  const stamp = image(d.signature.stamp);
  const qrs = await Promise.all((d.qrs ?? []).map(async q => ({ ...q, png: await QRCode.toBuffer(q.payload, { type: "png", margin: 0, width: 180, errorCorrectionLevel: "M" }) })));
  // Deux signatures (bon pour accord, reçu par, accusé de réception) : côte à
  // côte et au même niveau, dans les deux styles. Une seule (facture
  // prestige) : colonne à droite des conditions.
  const twoCol = style !== "prestige" || Boolean(d.counterSignature);
  // Les QR se rangent à droite des conditions (prestige à une signature :
  // sous les conditions), jamais dans la zone réservée au cachet.
  const qrW = qrs.length * 74 - 18;
  const qrBeside = qrs.length > 0 && paras.length > 0;
  const condW = !twoCol ? (qrBeside ? 312 - qrW - 14 : 312) : qrBeside ? CW - qrW - 22 : CW;
  const sx = !twoCol && paras.length ? M + 312 + 18 : W - M - 220, sw = W - M - sx;
  const place = [d.signature.place, d.signature.date].filter(Boolean).join(", le ");
  const signer = [d.signature.name, d.signature.title].filter(Boolean).join(", ");
  // Place pour signer et apposer le cachet : 3 cm, réduite jusqu'à 2 cm
  // plutôt que d'envoyer la seule signature en page suivante.
  const STAMP_ROOM = 84, STAMP_MIN = 56;
  const signH = twoCol ? 58 + STAMP_ROOM + (qrs.length && !qrBeside ? 80 : 0)
    : 12 + (place ? h(place, "body", 9.5, sw) + 5 : 0) + h(`Pour ${d.signature.company}`, "serifBold", 11.5, sw) + 2
      + (signer ? h(signer, "body", 9.5, sw) : 0)
      + 14 + STAMP_ROOM;
  const qrUnder = !twoCol && qrs.length > 0 && !qrBeside ? 78 : 0;

  // Corps des conditions : 8,4 pt, réduit jusqu'à 7,6 pt s'il manque un peu de
  // place pour garder conditions et signature avec le reste.
  let condSize = 8.4;
  const paraH = (p: { title?: string; body: string }, sz: number) => h(`${p.title ? `${p.title} — ` : ""}${p.body}`, "body", sz, condW - 30, { lineGap: 1.1 }) + 3;
  const condHAt = (sz: number) => paras.length ? 26 + paras.reduce((s2, p) => s2 + paraH(p, sz), 0) : 0;
  const free = FOOTER_TOP + 2 - y - (twoCol ? 18 + signH : qrUnder);
  while (condSize > 7.6 && condHAt(condSize) > free) condSize -= 0.1;
  if (condHAt(condSize) > free) condSize = 8.4;
  const condH = condHAt(condSize);
  const LIMIT = FOOTER_TOP - 6;

  /**
   * Encadré des conditions, coupé proprement entre deux paragraphes quand il
   * ne tient pas (fond redessiné sur chaque page, jamais sur le pied).
   * Rend le bas de l'encadré sur la dernière page.
   */
  const drawConditions = (x: number, w: number) => {
    let i = 0, first = true;
    for (;;) {
      if (first && y + 26 + paraH(paras[0], condSize) > LIMIT) newPage();
      const top = y;
      let segH = first ? 23 : 10, j = i;
      while (j < paras.length && (top + segH + paraH(paras[j], condSize) <= LIMIT || j === i)) { segH += paraH(paras[j], condSize); j++; }
      segH += 3;
      doc.rect(x, top, w, segH).fill(c.panel);
      doc.rect(x, top, 3.5, segH).fill(c.accent);
      if (first) font("bold", 7.5, c.accent).text("CONDITIONS", x + 16, top + 10, { characterSpacing: 1.6 });
      let py = top + (first ? 23 : 10);
      for (const p of paras.slice(i, j)) {
        if (p.title) { font("bold", condSize, c.ink).text(`${p.title} — `, x + 16, py, { continued: true, width: w - 30, lineGap: 1.1 }); font("body", condSize, c.ink).text(p.body); }
        else font("body", condSize, c.ink).text(p.body, x + 16, py, { width: w - 30, lineGap: 1.1 });
        py = doc.y + 3;
      }
      i = j; first = false;
      if (i >= paras.length) return top + segH;
      newPage();
    }
  };
  const drawQrs = (x: number, top: number) => {
    qrs.forEach((q, i) => {
      const qx = x + i * 74;
      doc.image(q.png, qx, top, { width: 56 });
      font("body", 6.5, c.faint).text(q.caption, qx - 8, top + 58, { width: 72, align: "center" });
    });
  };

  if (sig) {
    // Conditions en colonnes (trois par rang), chacune sous un filet ; les
    // coordonnées bancaires sont dans le pied de page, pas répétées ici.
    const bank = Boolean(b.paymentInstructions?.trim());
    // La nature d'une proforma tient sur une ligne discrète, pas dans une colonne.
    const nature = paras.find(p => p.title === "Nature du document");
    const cps = paras.filter(p => p !== nature && !(bank && p.title === "Coordonnées de paiement"))
      .map(p => (p.title ? { ...p, body: p.body.charAt(0).toUpperCase() + p.body.slice(1) } : p));
    const per = 3, gap = 16, cw = (CW - gap * (per - 1)) / per;
    const cellH = (p: { title?: string; body: string }) => 9 + (p.title ? h(p.title, "bold", 7.6, cw) + 2 : 0) + h(p.body, "body", 7.2, cw, { lineGap: 1.1 });
    for (let i = 0; i < cps.length; i += per) {
      const row = cps.slice(i, i + per);
      const rh = Math.max(...row.map(cellH));
      room(rh + 6);
      row.forEach((p, k) => {
        const x = M + k * (cw + gap);
        doc.rect(x, y, cw, 1.5).fill(c.primary);
        let py = y + 7;
        if (p.title) { font("bold", 7.6, c.navy).text(p.title, x, py, { width: cw }); py = doc.y + 2; }
        font("body", 7.2, c.muted).text(p.body, x, py, { width: cw, lineGap: 1.1 });
      });
      y += rh + 10;
    }
    if (nature) {
      room(14);
      font("italic", 8.4, c.faint).text(nature.body.charAt(0).toUpperCase() + nature.body.slice(1), M, y, { width: CW });
      y = doc.y + 8;
    }
    y += 4;
    // Signatures : l'organisation à gauche, l'accord du client dans un cadre pointillé.
    const colW = (CW - 24) / 2;
    const fixedH = 12 + 11 + (signer ? 11 : 0) + 10;
    const sh = fixedH + Math.max(STAMP_MIN, Math.min(STAMP_ROOM, FOOTER_TOP + 2 - y - fixedH));
    room(fixedH + STAMP_MIN);
    const top = y, bottom = top + Math.max(fixedH + STAMP_MIN, Math.min(sh, FOOTER_TOP - 4 - top));
    const tw = colW - Math.min(qrs.length, 2) * 54; // le texte s'arrête avant les QR
    font("italic", 8.6, c.muted).text(place || (d.signature.date ?? ""), M, top, { width: tw });
    font("bold", 7.8, c.navy).text(`Pour ${d.signature.company}`, M, doc.y + 1, { width: tw });
    if (signer) font("body", 7.8, c.ink).text(signer, M, doc.y, { width: tw });
    if (stamp) { try { doc.image(stamp, M, doc.y + 4, { fit: [90, bottom - doc.y - 16] }); } catch { /* image illisible */ } }
    font("body", 6.4, c.faint).text("Signature et cachet", M, bottom - 9, { width: colW, lineBreak: false });
    // QR en haut à droite de la colonne de l'organisation : hors de la zone du cachet (à gauche).
    qrs.slice(0, 2).forEach((q, k) => {
      const qx = M + colW - 44 - k * 54;
      doc.image(q.png, qx, top, { width: 44 });
      font("body", 5.6, c.faint).text(q.caption, qx - 8, top + 46, { width: 60, align: "center" });
    });
    if (d.counterSignature) {
      const x = M + colW + 24;
      doc.save().dash(2, { space: 2 }).lineWidth(0.6).strokeColor("#B9C6D6").rect(x, top - 4, colW, bottom - top + 8).stroke().restore();
      font("bold", 7.8, c.navy).text(d.counterSignature.label, x + 9, top + 3, { width: colW - 18 });
      font("body", 7.6, c.muted).text(d.counterSignature.hint, x + 9, doc.y + 1, { width: colW - 18 });
      font("body", 6.4, c.faint).text("Signature et cachet", x + 9, bottom - 9, { width: colW - 18, lineBreak: false });
    }
    y = bottom + 12;
  } else if (!twoCol) {
    // Prestige, une signature : conditions (et QR à leur droite) à gauche, signature à droite.
    const leftH = Math.max(condH, qrBeside ? 72 : 0) + qrUnder;
    if (y + Math.max(leftH, signH - (STAMP_ROOM - STAMP_MIN)) > FOOTER_TOP + 2 && leftH < LIMIT - 60) newPage();
    const top = y;
    let left = paras.length ? drawConditions(M, condW) : top;
    if (qrBeside && y === top) { drawQrs(M + condW + 14, top + 2); left = Math.max(left, top + 72); }
    else if (qrs.length) {
      if (left + 10 + 78 > LIMIT) { newPage(); left = y - 10; }
      drawQrs(M, left + 10); left += 10 + 78;
    }
    let sy = y + 12; // à côté des conditions, ou en haut de la page où elles finissent
    const fixed = signH - STAMP_ROOM - 12; // signH compte déjà la marge de 12 ajoutée à sy
    let stampRoom = Math.min(STAMP_ROOM, FOOTER_TOP + 2 - sy - fixed);
    if (stampRoom < STAMP_MIN) { newPage(); sy = y + 12; left = y; stampRoom = STAMP_ROOM; }
    if (place) { font("body", 9.5, c.muted).text(place, sx, sy, { width: sw, align: "center" }); sy = doc.y + 5; }
    font("serifBold", 11.5, c.primary).text(`Pour ${d.signature.company}`, sx, sy, { width: sw, align: "center" }); sy = doc.y + 2;
    if (signer) { font("body", 9.5, c.ink).text(signer, sx, sy, { width: sw, align: "center" }); sy = doc.y; }
    if (stamp) { try { doc.image(stamp, sx + sw / 2 - 45, sy + 6, { fit: [90, stampRoom - 6], align: "center" }); } catch { /* image illisible */ } }
    else font("italic", 8.5, c.faint).text("Signature et cachet", sx, sy + 8, { width: sw, align: "center" });
    sy += 14 + stampRoom;
    y = Math.max(left, sy) + 10;
  } else {
    if (paras.length) {
      // Conditions et signatures ensemble quand la page le permet.
      if (y + Math.max(condH, qrBeside ? 70 : 0) + 18 + signH > FOOTER_TOP + 2 && condH + 18 + signH < LIMIT - 60) newPage();
      const top = y;
      const bottom = drawConditions(M, condW);
      const paged = y !== top;
      if (qrBeside && !paged) drawQrs(W - M - qrW, top + 2);
      y = Math.max(bottom, qrBeside && !paged ? top + 72 : 0) + 18;
      // Conditions coupées sur plusieurs pages : les QR suivent sous elles.
      if (qrBeside && paged) { room(80); drawQrs(W - M - qrW, y); y += 78; }
    }
    room(signH);
    const colW = (CW - 24) / 2;
    const sig = (x: number, label: string, linesTxt: string[], withStamp: boolean) => {
      doc.moveTo(x, y).lineTo(x + colW, y).lineWidth(0.8).strokeColor("#B8BEC6").stroke();
      font("bold", 10.5, c.primary).text(label, x, y + 10, { width: colW });
      let sy = doc.y + 1;
      for (const l of linesTxt) { font("body", 10, c.ink).text(l, x, sy, { width: colW }); sy = doc.y; }
      if (withStamp && stamp) { try { doc.image(stamp, x, sy + 6, { fit: [90, 78] }); } catch { /* image illisible */ } }
      return sy + STAMP_ROOM;
    };
    const left = sig(M, `Pour ${d.signature.company}`, [[place, [d.signature.name, d.signature.title].filter(Boolean).join(", ")].filter(Boolean).join(" — "), "Signature et cachet"].filter(Boolean), true);
    let right = y;
    if (d.counterSignature) right = sig(M + colW + 24, d.counterSignature.label, [d.counterSignature.hint, "Signature et cachet"], false);
    y = Math.max(left, right) + 10;
    if (qrs.length && !qrBeside) { room(80); drawQrs(W - M - qrW, y); y += 78; }
  }

  // ── Pied de page sur chaque page ──────────────────────────────────────────
  /** Une ligne de pied, centrée ou à gauche, réduite jusqu'à tenir sur la largeur (jamais coupée). */
  const fitLine = (parts: Array<{ text: string; key: FontKey; color: string }>, yy: number, width: number, x = M, align: "center" | "left" = "center", size = 7.6) => {
    const widthAt = (sz: number) => parts.reduce((s2, p) => s2 + doc.font(F[p.key]).fontSize(sz).widthOfString(p.text), 0);
    while (size > 5.6 && widthAt(size) > width) size -= 0.2;
    let px = align === "center" ? x + (width - widthAt(size)) / 2 : x;
    for (const p of parts) { font(p.key, size, p.color).text(p.text, px, yy, { lineBreak: false }); px += doc.widthOfString(p.text); }
  };
  const range = doc.bufferedPageRange();
  const legal = b.legalFooter || [tenant.rccm ? `RCCM ${tenant.rccm}` : "", tenant.nif ? `NIF ${tenant.nif}` : "", b.extraIds ?? "", tenant.address].filter(Boolean).join(" · ");
  // Facture : les coordonnées de paiement sont dans le corps (lib/business-doc), pas répétées en pied.
  const payInFooter = !["invoice", "deposit"].includes(d.kind);
  const contact = [tenant.email, tenant.phone, b.website, payInFooter ? b.paymentInstructions?.replace(/\s*\n\s*/g, " · ") : ""].filter(Boolean).join(" · ");
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const ref = `${title} ${d.number}`;
    if (sig) {
      // Pied sombre : coordonnées bancaires (ou identité légale) et contact.
      const top = H - 4 - SIG_FOOTER_H;
      doc.rect(0, top, W, SIG_FOOTER_H).fill(c.navy);
      bicolor(H - 4, 4);
      const head = tint(c.primary, 0.55);
      const lw = CW * 0.6, rx = M + lw + 18, rw = CW - lw - 18;
      const bank = (b.paymentInstructions ?? "").split(/\n/).map(x => x.trim()).filter(Boolean).join("\n");
      font("bold", 6, head).text(bank ? "COORDONNÉES BANCAIRES" : "MENTIONS LÉGALES", M, top + 10, { characterSpacing: 1, lineBreak: false });
      // Trois lignes au plus (le texte saisi revient à la ligne, jamais coupé au milieu d'un IBAN).
      font("body", 7, "#FFFFFF").text(bank || legal, M, top + 20, { width: lw, height: 30, lineGap: 1.4, ellipsis: true });
      font("bold", 6, head).text("CONTACT", rx, top + 10, { characterSpacing: 1, lineBreak: false });
      const contactLines = [[tenant.email, tenant.phone].filter(Boolean).join(" · "), b.website ?? "", `${ref} · page ${i + 1} sur ${range.count}`].filter(Boolean);
      let cy = top + 20;
      for (const l of contactLines) { font("body", 7, "#FFFFFF").text(l, rx, cy, { width: rw, lineBreak: false, ellipsis: true }); cy += 9.5; }
    } else if (style === "prestige") {
      doc.moveTo(M, FOOTER_TOP + 6).lineTo(W - M, FOOTER_TOP + 6).lineWidth(0.6).strokeColor(c.line).stroke();
      fitLine([{ text: tenant.name ?? "", key: "bold", color: c.primary }, ...(legal ? [{ text: ` · ${legal}`, key: "body" as FontKey, color: c.faint }] : [])], FOOTER_TOP + 13, CW);
      if (contact) fitLine([{ text: contact, key: "body", color: c.faint }], FOOTER_TOP + 25, CW);
      font("body", 7.6, c.faint).text(ref, M, H - 24, { width: 200, lineBreak: false });
      font("body", 7.6, c.faint).text(`page ${i + 1} sur ${range.count}`, M + CW / 2 - 60, H - 24, { width: 120, align: "center", lineBreak: false });
    } else {
      font("body", 7.4, c.faint).text([tenant.name, legal, contact].filter(Boolean).join(" · "), M, FOOTER_TOP + 14, { width: CW - 150, height: 34, ellipsis: true });
      font("body", 7.4, c.faint).text(`${ref} · p. ${i + 1}/${range.count}`, W - M - 150, FOOTER_TOP + 14, { width: 150, align: "right", lineBreak: false });
    }
    doc.page.margins.bottom = saved;
  }
  doc.end();
  return done;
}
