/**
 * Card resources: a second view of a payment account that some ASPSPs expose
 * next to the account itself (Svea Bank, issue #2564). Its transactions are
 * the account's own card purchases mirrored with the sign flipped and no text
 * at all, so syncing it doubles every purchase as an income-looking
 * "Okänd transaktion" row.
 *
 * Two signals, either one suffices, and both require that the resource has
 * no IBAN of its own. A card account WITH an IBAN (a credit card at another
 * bank) carries its own transactions and stays an ordinary account.
 *
 *   1. `cash_account_type === 'CARD'` (Enable Banking CashAccountType:
 *      "Account used for card payments only").
 *   2. A product-code style name or product carrying a `Debit` token bound by
 *      underscores: `BOKIO_Debit_Business`, `SVEA_MQ_Debit_B2B`. This is the
 *      shape observed in production before the type was captured, and covers
 *      an ASPSP that types the resource CACC. Underscore-bound on purpose: a
 *      holder named "Debit AB" must not match.
 */
export const CARD_PRODUCT_CODE = /(^|_)debit(_|$)/i

export interface CardResourceInput {
  cash_account_type?: string | null
  product?: string | null
  name?: string | null
  iban?: string | null
}

export function isCardResource(account: CardResourceInput): boolean {
  if (account.iban) return false
  if ((account.cash_account_type ?? '').toUpperCase() === 'CARD') return true
  return CARD_PRODUCT_CODE.test(account.product ?? '') || CARD_PRODUCT_CODE.test(account.name ?? '')
}

/** Picker note under an unchecked card resource. */
export const CARD_RESOURCE_NOTE = 'Kortvy av huvudkontot: samma köp finns redan på huvudkontot'
