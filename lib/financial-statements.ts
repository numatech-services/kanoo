/**
 * États financiers au format SYSCOHADA révisé (système normal) : bilan, compte
 * de résultat avec soldes intermédiaires, tableau des flux de trésorerie (TFT),
 * aux références officielles (AD…BZ, CA…DZ, TA…XI, ZA…ZH) reprises par la DSF.
 *
 * Ce module est pur : il classe des soldes et des mouvements de comptes ; la
 * lecture des écritures est dans lib/financial-statements-server.
 */

/** Solde ou mouvement d'un compte : débit et crédit cumulés. */
export interface AccountAmounts { code: string; label?: string; debit: number; credit: number }

export interface StatementLine {
  ref: string;
  label: string;
  /** Montant net de l'exercice (et brut / amortissements pour l'actif immobilisé et circulant). */
  amount: number;
  gross?: number;
  depreciation?: number;
  /** Ligne de total ou de solde intermédiaire. */
  total?: boolean;
}

const starts = (code: string, prefixes: string[]) => prefixes.some(p => code.startsWith(p));
const net = (a: AccountAmounts) => a.debit - a.credit;

function pick(rows: AccountAmounts[], prefixes: string[], exclude: string[] = []) {
  return rows.filter(r => starts(r.code, prefixes) && !starts(r.code, exclude));
}
/** Σ (débit − crédit) des comptes retenus. */
const sumNet = (rows: AccountAmounts[], prefixes: string[], exclude: string[] = []) => pick(rows, prefixes, exclude).reduce((t, r) => t + net(r), 0);
/** Σ des soldes débiteurs (> 0) / créditeurs (> 0) seulement, compte par compte. */
const sumDebitBalances = (rows: AccountAmounts[], prefixes: string[], exclude: string[] = []) => pick(rows, prefixes, exclude).reduce((t, r) => t + Math.max(0, net(r)), 0);
const sumCreditBalances = (rows: AccountAmounts[], prefixes: string[], exclude: string[] = []) => pick(rows, prefixes, exclude).reduce((t, r) => t + Math.max(0, -net(r)), 0);
const sumDebits = (rows: AccountAmounts[], prefixes: string[], exclude: string[] = []) => pick(rows, prefixes, exclude).reduce((t, r) => t + r.debit, 0);
const sumCredits = (rows: AccountAmounts[], prefixes: string[], exclude: string[] = []) => pick(rows, prefixes, exclude).reduce((t, r) => t + r.credit, 0);

/** Comptes de gestion : charges, produits, hors activités ordinaires. */
export const isResultAccount = (code: string) => /^[678]/.test(code);
/** Résultat d'un ensemble de soldes : produits − charges. */
export const resultOf = (rows: AccountAmounts[]) => -rows.filter(r => isResultAccount(r.code)).reduce((t, r) => t + net(r), 0);

// ─── Bilan ────────────────────────────────────────────────────────────────

/** Comptes de tiers à l'actif quand ils sont débiteurs (créances). */
const RECEIVABLE_PREFIXES = ["409", "41", "42", "43", "44", "45", "46", "47"];

/**
 * Bilan à partir des soldes cumulés à la date (à-nouveaux compris). Le résultat
 * de l'exercice (classes 6 à 8 non soldées) s'ajoute au compte 13.
 */
export function syscohadaBalanceSheet(rows: AccountAmounts[], opts: { currentYearResult?: number } = {}) {
  const gd = (gross: string[], dep: string[], gx: string[] = []) => {
    const gross_ = sumNet(rows, gross, [...gx, "28", "29", "39", "49", "59"]);
    const depreciation = -sumNet(rows, dep);
    return { gross: gross_, depreciation, amount: gross_ - depreciation };
  };
  const AD = gd(["20", "21"], ["281", "291"]);
  // Amortissements des immobilisations corporelles : tout le 28/29 hors incorporel et financier
  // (y compris un compte « 28 » générique).
  const AI = (() => {
    const gross = sumNet(rows, ["22", "23", "24", "25"]);
    const depreciation = -sumNet(rows, ["28", "29"], ["281", "291", "296", "297"]);
    return { gross, depreciation, amount: gross - depreciation };
  })();
  const AQ = gd(["26", "27"], ["296", "297"]);
  const AZ = { gross: AD.gross + AI.gross + AQ.gross, depreciation: AD.depreciation + AI.depreciation + AQ.depreciation, amount: AD.amount + AI.amount + AQ.amount };
  const BA = sumDebitBalances(rows, ["485", "488"]);
  const BB = gd(["3"], ["39"]);
  const BH = sumDebitBalances(rows, ["409"]);
  const clientsGross = sumDebitBalances(rows, ["41"]);
  const clientsDep = -sumNet(rows, ["491"]);
  const BI = { gross: clientsGross, depreciation: clientsDep, amount: clientsGross - clientsDep };
  const otherGross = sumDebitBalances(rows, RECEIVABLE_PREFIXES, ["409", "41", "478"]) + sumDebitBalances(rows, ["40"], ["409"]) + sumDebitBalances(rows, ["48"], ["485", "488"]);
  const otherDep = -sumNet(rows, ["49"], ["491", "499"]);
  const BJ = { gross: otherGross, depreciation: otherDep, amount: otherGross - otherDep };
  const BG = { gross: BH + BI.gross + BJ.gross, depreciation: BI.depreciation + BJ.depreciation, amount: BH + BI.amount + BJ.amount };
  const BK = { gross: BA + BB.gross + BG.gross, depreciation: BB.depreciation + BG.depreciation, amount: BA + BB.amount + BG.amount };
  const BQ = sumDebitBalances(rows, ["50"]);
  const BR = sumDebitBalances(rows, ["51"]);
  const BS = sumDebitBalances(rows, ["52", "53", "54", "55", "56", "57", "58", "59"]);
  const BT = BQ + BR + BS;
  const BU = sumDebitBalances(rows, ["478"]);
  const BZ = AZ.amount + BK.amount + BT + BU;

  const cr = (p: string[], x: string[] = []) => -sumNet(rows, p, x);
  const CA = cr(["10"], ["105", "106", "109"]);
  const CB = cr(["109"]);
  const CD = cr(["105"]);
  const CE = cr(["106"]);
  const CF = cr(["111", "112"]);
  const CG = cr(["11"], ["111", "112"]);
  // Exercices antérieurs non clôturés : leur résultat attend l'affectation, il va au report à nouveau.
  const cumulated = resultOf(rows);
  const current = opts.currentYearResult ?? cumulated;
  const CH = cr(["12"]) + (cumulated - current);
  const CJ = cr(["13"]) + current;
  const CL = cr(["14"]);
  const CM = cr(["15"]);
  const CP = CA + CB + CD + CE + CF + CG + CH + CJ + CL + CM;
  const DA = cr(["16", "18"]);
  const DB = cr(["17"]);
  const DC = cr(["19"]);
  const DD = DA + DB + DC;
  const DF = CP + DD;
  const DH = sumCreditBalances(rows, ["481", "482", "484"]);
  const DI = sumCreditBalances(rows, ["41"]);
  const DJ = sumCreditBalances(rows, ["40"]);
  const DK = sumCreditBalances(rows, ["42", "43", "44"]);
  const DM = sumCreditBalances(rows, ["45", "46", "47", "48"], ["479", "481", "482", "484"]);
  const DN = cr(["499"]);
  const DP = DH + DI + DJ + DK + DM + DN;
  const DQ = sumCreditBalances(rows, ["565"]);
  const DR = sumCreditBalances(rows, ["5"], ["565"]);
  const DT = DQ + DR;
  const DV = sumCreditBalances(rows, ["479"]);
  const DZ = DF + DP + DT + DV;

  const L = (ref: string, label: string, v: number | { gross: number; depreciation: number; amount: number }, total = false): StatementLine =>
    typeof v === "number" ? { ref, label, amount: v, ...(total ? { total } : {}) } : { ref, label, ...v, ...(total ? { total } : {}) };
  return {
    actif: [
      L("AD", "Immobilisations incorporelles", AD),
      L("AI", "Immobilisations corporelles", AI),
      L("AQ", "Immobilisations financières", AQ),
      L("AZ", "TOTAL ACTIF IMMOBILISÉ", AZ, true),
      L("BA", "Actif circulant HAO", BA),
      L("BB", "Stocks et encours", BB),
      L("BG", "Créances et emplois assimilés", BG, true),
      L("BH", "Fournisseurs, avances versées", BH),
      L("BI", "Clients", BI),
      L("BJ", "Autres créances", BJ),
      L("BK", "TOTAL ACTIF CIRCULANT", BK, true),
      L("BQ", "Titres de placement", BQ),
      L("BR", "Valeurs à encaisser", BR),
      L("BS", "Banques, chèques postaux, caisse et assimilés", BS),
      L("BT", "TOTAL TRÉSORERIE-ACTIF", BT, true),
      L("BU", "Écart de conversion-Actif", BU),
      L("BZ", "TOTAL GÉNÉRAL", BZ, true),
    ],
    passif: [
      L("CA", "Capital", CA), L("CB", "Apporteurs capital non appelé (−)", CB), L("CD", "Primes liées au capital social", CD),
      L("CE", "Écarts de réévaluation", CE), L("CF", "Réserves indisponibles", CF), L("CG", "Réserves libres", CG),
      L("CH", "Report à nouveau (+ ou −)", CH), L("CJ", "Résultat net de l'exercice (bénéfice + ou perte −)", CJ),
      L("CL", "Subventions d'investissement", CL), L("CM", "Provisions réglementées", CM),
      L("CP", "TOTAL CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES", CP, true),
      L("DA", "Emprunts et dettes financières diverses", DA), L("DB", "Dettes de location-acquisition", DB), L("DC", "Provisions pour risques et charges", DC),
      L("DD", "TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES", DD, true),
      L("DF", "TOTAL RESSOURCES STABLES", DF, true),
      L("DH", "Dettes circulantes HAO", DH), L("DI", "Clients, avances reçues", DI), L("DJ", "Fournisseurs d'exploitation", DJ),
      L("DK", "Dettes fiscales et sociales", DK), L("DM", "Autres dettes", DM), L("DN", "Provisions pour risques à court terme", DN),
      L("DP", "TOTAL PASSIF CIRCULANT", DP, true),
      L("DQ", "Banques, crédits d'escompte", DQ), L("DR", "Banques, établissements financiers et crédits de trésorerie", DR),
      L("DT", "TOTAL TRÉSORERIE-PASSIF", DT, true),
      L("DV", "Écart de conversion-Passif", DV),
      L("DZ", "TOTAL GÉNÉRAL", DZ, true),
    ],
    totalActif: BZ, totalPassif: DZ, resultat: current,
  };
}

// ─── Compte de résultat ─────────────────────────────────────────────────

/**
 * Compte de résultat et soldes intermédiaires de gestion, à partir des
 * mouvements de l'exercice des classes 6, 7 et 8. Le 707 suit le plan de
 * l'application (ventes de marchandises en négoce).
 */
export function syscohadaIncomeStatement(rows: AccountAmounts[]) {
  const p = (prefixes: string[], x: string[] = []) => -sumNet(rows, prefixes, x);   // produit
  const c = (prefixes: string[], x: string[] = []) => sumNet(rows, prefixes, x);    // charge
  const TA = p(["701", "707"]);
  const RA = c(["601"]);
  const RB = c(["6031"]);
  const XA = TA - RA - RB;
  const TB = p(["702", "703", "704"]);
  const TC = p(["705", "706"]);
  const TD = p(["70"], ["701", "702", "703", "704", "705", "706", "707"]);
  const XB = TA + TB + TC + TD;
  const TE = p(["73"]);
  const TF = p(["72"]);
  const TG = p(["71", "74"]);
  const TH = p(["75"]);
  const TI = p(["78"], ["787"]);
  const RC = c(["602"]);
  const RD = c(["6032"]);
  const RE = c(["60"], ["601", "602", "6031", "6032", "6033"]);
  const RF = c(["6033"]);
  const RG = c(["61"]);
  const RH = c(["62", "63"]);
  const RI = c(["64"]);
  const RJ = c(["65"]);
  const XC = XB + TE + TF + TG + TH + TI - RA - RB - RC - RD - RE - RF - RG - RH - RI - RJ;
  const RK = c(["66"]);
  const XD = XC - RK;
  const TJ = p(["79"], ["797"]);
  const RL = c(["68", "69"], ["687", "697"]);
  const XE = XD + TJ - RL;
  const TK = p(["76", "77"]);
  const TL = p(["797"]);
  const TM = p(["787"]);
  const RM = c(["67"]);
  const RN = c(["687", "697"]);
  const XF = TK + TL + TM - RM - RN;
  const XG = XE + XF;
  const TN = p(["82"]);
  const TO = p(["84", "86", "88"]);
  const RO = c(["81"]);
  const RP = c(["83", "85"]);
  const XH = TN + TO - RO - RP;
  const RQ = c(["87"]);
  const RS = c(["89"]);
  const XI = XG + XH - RQ - RS;
  // Comptes de gestion non repris par une rubrique (classe 6/7 hors nomenclature) : ajoutés aux « autres ».
  const L = (ref: string, label: string, amount: number, total = false): StatementLine => ({ ref, label, amount, ...(total ? { total } : {}) });
  return {
    lines: [
      L("TA", "Ventes de marchandises", TA), L("RA", "Achats de marchandises", -RA), L("RB", "Variation de stocks de marchandises", -RB),
      L("XA", "MARGE COMMERCIALE", XA, true),
      L("TB", "Ventes de produits fabriqués", TB), L("TC", "Travaux, services vendus", TC), L("TD", "Produits accessoires", TD),
      L("XB", "CHIFFRE D'AFFAIRES", XB, true),
      L("TE", "Production stockée (ou déstockage)", TE), L("TF", "Production immobilisée", TF), L("TG", "Subventions d'exploitation", TG),
      L("TH", "Autres produits", TH), L("TI", "Transferts de charges d'exploitation", TI),
      L("RC", "Achats de matières premières et fournitures liées", -RC), L("RD", "Variation de stocks de matières premières", -RD),
      L("RE", "Autres achats", -RE), L("RF", "Variation de stocks d'autres approvisionnements", -RF),
      L("RG", "Transports", -RG), L("RH", "Services extérieurs", -RH), L("RI", "Impôts et taxes", -RI), L("RJ", "Autres charges", -RJ),
      L("XC", "VALEUR AJOUTÉE", XC, true),
      L("RK", "Charges de personnel", -RK),
      L("XD", "EXCÉDENT BRUT D'EXPLOITATION", XD, true),
      L("TJ", "Reprises d'amortissements, provisions et dépréciations", TJ), L("RL", "Dotations aux amortissements, provisions et dépréciations", -RL),
      L("XE", "RÉSULTAT D'EXPLOITATION", XE, true),
      L("TK", "Revenus financiers et assimilés", TK), L("TL", "Reprises de provisions et dépréciations financières", TL), L("TM", "Transferts de charges financières", TM),
      L("RM", "Frais financiers et charges assimilées", -RM), L("RN", "Dotations aux provisions et dépréciations financières", -RN),
      L("XF", "RÉSULTAT FINANCIER", XF, true),
      L("XG", "RÉSULTAT DES ACTIVITÉS ORDINAIRES", XG, true),
      L("TN", "Produits des cessions d'immobilisations", TN), L("TO", "Autres produits HAO", TO),
      L("RO", "Valeurs comptables des cessions d'immobilisations", -RO), L("RP", "Autres charges HAO", -RP),
      L("XH", "RÉSULTAT HORS ACTIVITÉS ORDINAIRES", XH, true),
      L("RQ", "Participation des travailleurs", -RQ), L("RS", "Impôts sur le résultat", -RS),
      L("XI", "RÉSULTAT NET", XI, true),
    ],
    chiffreAffaires: XB, ebe: XD, resultatExploitation: XE, resultat: XI,
    /** Écart avec le résultat comptable : comptes de gestion hors nomenclature (doit être nul). */
    unclassified: resultOf(rows) - XI,
  };
}

// ─── Tableau des flux de trésorerie ─────────────────────────────────────

/** Créances d'exploitation (variation FD) ; le reste de la classe 4 est du passif circulant (FE). */
const RECEIVABLES = ["409", "411", "412", "413", "414", "415", "416", "417", "418", "445", "449", "476", "478", "491"];
const INVESTMENT_PAYABLES = ["481", "482", "484", "404"];

/**
 * TFT (méthode indirecte) à partir des mouvements de l'exercice HORS à-nouveaux
 * et de la trésorerie d'ouverture. Chaque compte hors trésorerie relève d'une
 * seule rubrique : la somme des flux égale exactement la variation de la
 * trésorerie (classe 5), contrôle `gap` à zéro.
 */
export function syscohadaCashFlow(moves: AccountAmounts[], openingCash: number) {
  const mv = (p: string[], x: string[] = []) => sumNet(moves, p, x);
  const R = resultOf(moves);
  // CAFG : résultat hors dotations nettes et hors résultat de cession.
  const FA = R - mv(["15", "19", "28", "29"]) + sumCredits(moves, ["20", "21", "22", "23", "24", "25"]) + mv(["82"]);
  const FB = -mv(["485", "488"]);
  const FC = -mv(["3"]);
  const FD = -mv(RECEIVABLES);
  const FE = -mv(["4"], [...RECEIVABLES, ...INVESTMENT_PAYABLES, "465", "485", "488"]);
  const ZB = FA + FB + FC + FD + FE;
  const FF = -sumDebits(moves, ["20", "21"]);
  const FG = -sumDebits(moves, ["22", "23", "24", "25"]) - mv(INVESTMENT_PAYABLES);
  const FH = -sumDebits(moves, ["26", "27"]);
  const FI = -mv(["82"]);
  const FJ = sumCredits(moves, ["26", "27"]);
  const ZC = FF + FG + FH + FI + FJ;
  const FK = -mv(["10"]);
  const FL = -mv(["14"]);
  const FM = 0;
  const FN = -mv(["11", "12", "13"]) - mv(["465"]);
  const ZD = FK + FL + FM + FN;
  const FO = sumCredits(moves, ["16", "18"]);
  const FP = sumCredits(moves, ["17"]);
  const FQ = -sumDebits(moves, ["16", "17", "18"]);
  const ZE = FO + FP + FQ;
  const ZF = ZD + ZE;
  const ZG = ZB + ZC + ZF;
  const ZA = openingCash;
  const ZH = ZA + ZG;
  const actualClosing = openingCash + mv(["5"]);
  const L = (ref: string, label: string, amount: number, total = false): StatementLine => ({ ref, label, amount, ...(total ? { total } : {}) });
  return {
    lines: [
      L("ZA", "Trésorerie nette au 1er janvier", ZA, true),
      L("FA", "Capacité d'autofinancement globale (CAFG)", FA),
      L("FB", "(−) Variation de l'actif circulant HAO", FB),
      L("FC", "(−) Variation des stocks", FC),
      L("FD", "(−) Variation des créances", FD),
      L("FE", "(+) Variation du passif circulant", FE),
      L("ZB", "Flux de trésorerie provenant des activités opérationnelles", ZB, true),
      L("FF", "(−) Décaissements liés aux acquisitions d'immobilisations incorporelles", FF),
      L("FG", "(−) Décaissements liés aux acquisitions d'immobilisations corporelles", FG),
      L("FH", "(−) Décaissements liés aux acquisitions d'immobilisations financières", FH),
      L("FI", "(+) Encaissements liés aux cessions d'immobilisations incorporelles et corporelles", FI),
      L("FJ", "(+) Encaissements liés aux cessions d'immobilisations financières", FJ),
      L("ZC", "Flux de trésorerie provenant des activités d'investissement", ZC, true),
      L("FK", "(+) Augmentations de capital par apports nouveaux", FK),
      L("FL", "(+) Subventions d'investissement reçues", FL),
      L("FM", "(−) Prélèvements sur le capital", FM),
      L("FN", "(−) Dividendes versés", FN),
      L("ZD", "Flux de trésorerie provenant des capitaux propres", ZD, true),
      L("FO", "(+) Emprunts", FO),
      L("FP", "(+) Autres dettes financières diverses", FP),
      L("FQ", "(−) Remboursements des emprunts et autres dettes financières", FQ),
      L("ZE", "Flux de trésorerie provenant des capitaux étrangers", ZE, true),
      L("ZF", "Flux de trésorerie provenant des activités de financement", ZF, true),
      L("ZG", "VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE", ZG, true),
      L("ZH", "Trésorerie nette au 31 décembre", ZH, true),
    ],
    openingCash: ZA, closingCash: ZH, variation: ZG,
    /** ZH comparé à la trésorerie réellement comptabilisée : doit être nul. */
    gap: ZH - actualClosing,
  };
}
