/**
 * Créances douteuses — règles pures.
 *
 * Une créance dont le recouvrement devient incertain quitte le compte client
 * ordinaire (411) pour le 416 « créances douteuses ». Sa dépréciation (491)
 * porte sur le HORS TAXES : la TVA collectée se régularise si la créance est
 * finalement perdue, elle n'est donc pas une perte probable. La dépréciation
 * s'ajuste (dotation 6594, reprise 7594) au fil des règlements et des
 * estimations ; la perte définitive va au 651.
 */

export const DOUBTFUL_ACCOUNT = { accountCode: "416000", accountLabel: "Créances clients litigieuses ou douteuses" };
export const PROVISION_ACCOUNT = { accountCode: "491100", accountLabel: "Dépréciations des comptes clients" };
export const PROVISION_CHARGE = { accountCode: "659400", accountLabel: "Charges provisionnées sur créances (dotations)" };
export const PROVISION_REVERSAL = { accountCode: "759400", accountLabel: "Reprises de charges provisionnées sur créances" };
export const BAD_DEBT_LOSS = { accountCode: "651000", accountLabel: "Pertes sur créances clients" };
export const VAT_COLLECTED = { accountCode: "443000", accountLabel: "État, TVA facturée" };

/**
 * Taux de dépréciation suggéré selon l'ancienneté du retard : usage prudent,
 * que la direction ajuste créance par créance (procédure, solvabilité du client).
 */
export function suggestedRate(daysLate: number): number {
  if (daysLate >= 365) return 1;
  if (daysLate >= 180) return 0.5;
  if (daysLate >= 90) return 0.25;
  return 0;
}

/** Part hors taxes d'un reste dû TTC, au prorata de la facture. */
export function htShare(dueTTC: number, inv: { totalHT: number; totalTTC: number }): number {
  if (!(inv.totalTTC > 0)) return 0;
  return Math.round(dueTTC * Math.min(1, inv.totalHT / inv.totalTTC));
}

/** Dépréciation requise : taux × part HT du reste dû. */
export function requiredProvision(dueTTC: number, inv: { totalHT: number; totalTTC: number }, rate: number): number {
  return Math.round(htShare(dueTTC, inv) * Math.min(1, Math.max(0, rate)));
}

/** Écriture d'ajustement : dotation (> 0) ou reprise (< 0) pour atteindre le montant requis. */
export function provisionLines(current: number, target: number) {
  const delta = Math.round(target - current);
  if (delta > 0) return [{ ...PROVISION_CHARGE, debit: delta, credit: 0 }, { ...PROVISION_ACCOUNT, debit: 0, credit: delta }];
  if (delta < 0) return [{ ...PROVISION_ACCOUNT, debit: -delta, credit: 0 }, { ...PROVISION_REVERSAL, debit: 0, credit: -delta }];
  return [];
}

/**
 * Perte définitive : HT en 651, TVA régularisée (443 au débit) si elle est
 * récupérable, la créance (416 ou 411) soldée.
 */
export function writeOffLines(dueTTC: number, inv: { totalHT: number; totalTTC: number }, opts: { fromAccount: string; recoverVat: boolean; clientId: unknown }) {
  const ht = opts.recoverVat ? htShare(dueTTC, inv) : dueTTC;
  const vat = dueTTC - ht;
  return [
    { ...BAD_DEBT_LOSS, debit: ht, credit: 0 },
    ...(vat > 0 ? [{ ...VAT_COLLECTED, debit: vat, credit: 0 }] : []),
    { accountCode: opts.fromAccount, accountLabel: opts.fromAccount === DOUBTFUL_ACCOUNT.accountCode ? DOUBTFUL_ACCOUNT.accountLabel : "Clients", debit: 0, credit: dueTTC, thirdPartyId: opts.clientId },
  ];
}
