import type { BASAccount } from '@/types'
import {
  defaultRateForVatTreatment,
  suggestVatTreatment,
  type AccountVatTreatment,
} from '@/lib/vat/account-vat-treatment'
import type { AccountMapping } from './types'

/**
 * Prefill identity mappings with the momskod the source system has on each
 * account. SIE4 carries no VAT code, so this runs server-side after the
 * provider's chart was fetched next to the SIE export (Fortnox /accounts);
 * `codesByAccount` is source account number to the provider's verbatim code
 * and `translate` turns a code into a treatment for the account's class, or
 * null when the code has no equivalent.
 *
 * A translated code lands as reviewed: it is the user's own configuration
 * in the system they are leaving, which outranks a guess from the label.
 * The code is kept on the row either way (providerVatCode) so the mapping
 * step can show it, and an untranslated code changes nothing else: the row
 * still gets the label suggestion in enrichAccountMappingsWithVat.
 *
 * Only class 3-6 identity mappings are touched, the same rows the label
 * suggestion covers: a remapped account gets the target's treatment, and
 * classes 1-2 and 7-8 carry no treatment.
 */
export function applySourceVatCodes(
  mappings: AccountMapping[],
  codesByAccount: ReadonlyMap<string, string>,
  translate: (code: string, accountClass: number) => AccountVatTreatment | null,
): AccountMapping[] {
  return mappings.map((mapping) => {
    if (!mapping.targetAccount || mapping.sourceAccount !== mapping.targetAccount) return mapping
    const accountClass = Number(mapping.sourceAccount.charAt(0))
    if (accountClass < 3 || accountClass > 6) return mapping

    const code = codesByAccount.get(mapping.sourceAccount)?.trim()
    if (!code) return mapping

    const treatment = translate(code, accountClass)
    if (!treatment) return { ...mapping, providerVatCode: code }

    return {
      ...mapping,
      providerVatCode: code,
      vatTreatmentSource: 'provider',
      defaultVatTreatment: treatment,
      defaultVatRate: defaultRateForVatTreatment(treatment, accountClass),
      vatTreatmentSuggested: false,
      vatTreatmentReviewed: true,
      requiresVatTreatmentReview: false,
    }
  })
}

/**
 * Add reviewable VAT suggestions to identity mappings. SIE itself has no VAT
 * treatment record, so suggestions come only from the account label and are
 * never considered reviewed until the user continues from the mapping step.
 * Two sources outrank the label and are kept as reviewed: a treatment the
 * company already set on the account in its chart, and one translated from
 * the source system's momskod (applySourceVatCodes).
 */
export function enrichAccountMappingsWithVat(
  mappings: AccountMapping[],
  existingAccounts: BASAccount[],
): AccountMapping[] {
  const existingByNumber = new Map(
    existingAccounts.map((account) => [account.account_number, account]),
  )

  return mappings.map((mapping) => {
    if (!mapping.targetAccount || mapping.sourceAccount !== mapping.targetAccount) {
      return {
        ...mapping,
        defaultVatTreatment: null,
        defaultVatRate: null,
        vatTreatmentSuggested: false,
        vatTreatmentReviewed: true,
        requiresVatTreatmentReview: false,
      }
    }
    const accountClass = Number(mapping.sourceAccount.charAt(0))
    if (accountClass < 3 || accountClass > 6) return mapping

    const existing = existingByNumber.get(mapping.targetAccount)
    if (existing?.default_vat_treatment) {
      return {
        ...mapping,
        defaultVatTreatment: existing.default_vat_treatment,
        defaultVatRate: existing.default_vat_rate,
        vatTreatmentReviewed: true,
        vatTreatmentSuggested: false,
        requiresVatTreatmentReview: false,
      }
    }

    if (mapping.vatTreatmentSource === 'provider' && mapping.defaultVatTreatment) {
      return {
        ...mapping,
        vatTreatmentReviewed: true,
        vatTreatmentSuggested: false,
        requiresVatTreatmentReview: false,
      }
    }

    const suggestion = suggestVatTreatment(mapping.sourceAccount, mapping.sourceName)
    return {
      ...mapping,
      defaultVatTreatment: suggestion?.treatment ?? null,
      defaultVatRate: existing?.default_vat_rate ?? suggestion?.rate ?? null,
      vatTreatmentSuggested: Boolean(suggestion),
      vatTreatmentReviewed: false,
      requiresVatTreatmentReview: accountClass === 3 || accountClass === 4 || Boolean(suggestion),
    }
  })
}

export function applyVatTreatmentReview(
  mappings: AccountMapping[],
  sourceAccount: string,
  treatment: AccountVatTreatment | null,
  rate: number | null,
): AccountMapping[] {
  return mappings.map((mapping) =>
    mapping.sourceAccount === sourceAccount
      ? {
          ...mapping,
          defaultVatTreatment: treatment,
          defaultVatRate: rate,
          vatTreatmentSuggested: false,
          vatTreatmentReviewed: true,
        }
      : mapping
  )
}

export function enrichChangedAccountMappingWithVat(
  mappings: AccountMapping[],
  sourceAccount: string,
  existingAccounts: BASAccount[],
): AccountMapping[] {
  return mappings.map((mapping) =>
    mapping.sourceAccount === sourceAccount
      ? enrichAccountMappingsWithVat([mapping], existingAccounts)[0]
      : mapping
  )
}

/**
 * Accept the suggested VAT treatment for every mapping still awaiting review,
 * in one action. Exactly the per-row "Bekräfta" semantics batched: each row
 * keeps its current suggested default (or null when there is none) and is
 * marked reviewed. Added because a Fortnox chart routinely puts 70+ class 3/4
 * accounts behind the review gate, and clicking them one by one across
 * paginated pages was an observed migration dead end (2026-08-18).
 */
export function applyVatTreatmentReviewAll(mappings: AccountMapping[]): AccountMapping[] {
  return mappings.map((mapping) =>
    mapping.requiresVatTreatmentReview && !mapping.vatTreatmentReviewed
      ? {
          ...mapping,
          vatTreatmentSuggested: false,
          vatTreatmentReviewed: true,
        }
      : mapping
  )
}
