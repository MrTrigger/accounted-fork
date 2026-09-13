/**
 * Card resources: a second view of a payment account that some ASPSPs expose
 * next to the account itself (Svea Bank, issue #2564). Its transactions are
 * the account's own card purchases mirrored with the sign flipped and no text
 * at all, so syncing it doubles every purchase as an income-looking
 * "Okänd transaktion" row.
 *
 * One signal, deliberately narrow: no IBAN AND a product-code style name or
 * product carrying a `Debit` token bound by underscores (`BOKIO_Debit_Business`,
 * `SVEA_MQ_Debit_B2B`), the shapes observed in production. Underscore-bound on
 * purpose: a holder named "Debit AB" must not match.
 *
 * `cash_account_type === 'CARD'` is captured and logged but is NOT a signal:
 * SEB lists standalone credit cards ("SEB Credit", "Eurocard Gold") with no
 * IBAN, and those are real feeds with their own purchases, not mirrors.
 * Whether Svea even types its mirror CARD is unknown until the callback log
 * says so; a type-based rule would ship blind against every other bank.
 */
export const CARD_PRODUCT_CODE = /(^|_)debit(_|$)/i

export interface CardResourceInput {
  product?: string | null
  name?: string | null
  iban?: string | null
}

export function isCardResource(account: CardResourceInput): boolean {
  if (account.iban) return false
  return CARD_PRODUCT_CODE.test(account.product ?? '') || CARD_PRODUCT_CODE.test(account.name ?? '')
}

/** Picker note under an unchecked card resource. */
export const CARD_RESOURCE_NOTE = 'Kortvy av huvudkontot: samma köp finns redan på huvudkontot'
