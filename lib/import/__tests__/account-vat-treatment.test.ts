import { describe, expect, it } from 'vitest'
import {
  applySourceVatCodes,
  applyVatTreatmentReview,
  enrichChangedAccountMappingWithVat,
  enrichAccountMappingsWithVat,
  applyVatTreatmentReviewAll,
} from '../account-vat-treatment'
import type { AccountMapping } from '../types'

function mapping(account: string, name: string): AccountMapping {
  return {
    sourceAccount: account,
    sourceName: name,
    targetAccount: account,
    targetName: name,
    confidence: 1,
    matchType: 'exact',
    isOverride: false,
  }
}

describe('enrichAccountMappingsWithVat', () => {
  it('marks label suggestions for user review', () => {
    const [result] = enrichAccountMappingsWithVat(
      [mapping('4056', 'Inköp varor 25% EU')],
      [],
    )
    expect(result).toMatchObject({
      defaultVatTreatment: 'reverse_charge_eu_goods',
      defaultVatRate: 0.25,
      vatTreatmentSuggested: true,
      vatTreatmentReviewed: false,
      requiresVatTreatmentReview: true,
    })
  })

  it('suggests oss from an OSS label and leaves the BAS 3106 label for review', () => {
    const [oss, b2c] = enrichAccountMappingsWithVat(
      [
        mapping('3111', 'Försäljning enl. OSS (Spanien 21%)'),
        mapping('3106', 'Försäljning varor till annat EU-land, momspliktig'),
      ],
      [],
    )
    expect(oss).toMatchObject({
      defaultVatTreatment: 'oss',
      defaultVatRate: null,
      vatTreatmentSuggested: true,
      vatTreatmentReviewed: false,
      requiresVatTreatmentReview: true,
    })
    expect(b2c).toMatchObject({
      defaultVatTreatment: null,
      vatTreatmentSuggested: false,
      vatTreatmentReviewed: false,
      requiresVatTreatmentReview: true,
    })
  })

  it('keeps an existing account treatment without asking again', () => {
    const [result] = enrichAccountMappingsWithVat(
      [mapping('3041', 'Försäljning tjänst 25% sv')],
      [{
        account_number: '3041',
        default_vat_treatment: 'standard_25',
        default_vat_rate: 0.25,
      } as never],
    )
    expect(result).toMatchObject({
      defaultVatTreatment: 'standard_25',
      vatTreatmentSuggested: false,
      vatTreatmentReviewed: true,
      requiresVatTreatmentReview: false,
    })
  })

  it('preserves an existing booking rate when suggesting a missing treatment', () => {
    const [result] = enrichAccountMappingsWithVat(
      [mapping('3041', 'Försäljning tjänst 25% sv')],
      [{
        account_number: '3041',
        default_vat_treatment: null,
        default_vat_rate: 0.12,
      } as never],
    )
    expect(result.defaultVatTreatment).toBe('standard_25')
    expect(result.defaultVatRate).toBe(0.12)
  })

  it('requires review for a suggested class 6 service treatment', () => {
    const [result] = enrichAccountMappingsWithVat(
      [mapping('6545', 'Inköp tjänster utanför EU 25%')],
      [],
    )
    expect(result).toMatchObject({
      defaultVatTreatment: 'reverse_charge_non_eu_services',
      requiresVatTreatmentReview: true,
      vatTreatmentReviewed: false,
    })
  })
})

describe('applyVatTreatmentReview', () => {
  it('persists a suggestion only after an explicit row confirmation', () => {
    const mappings = enrichAccountMappingsWithVat([
      mapping('4056', 'Inköp varor 25% EU'),
    ], [])

    expect(mappings[0].vatTreatmentReviewed).toBe(false)
    const reviewed = applyVatTreatmentReview(
      mappings,
      '4056',
      mappings[0].defaultVatTreatment ?? null,
      mappings[0].defaultVatRate ?? null,
    )
    expect(reviewed[0]).toMatchObject({
      defaultVatTreatment: 'reverse_charge_eu_goods',
      vatTreatmentReviewed: true,
      vatTreatmentSuggested: false,
    })
  })

  it('clears hidden review state on remap and restores it on identity mapping', () => {
    const [suggested] = enrichAccountMappingsWithVat([
      mapping('4056', 'Inköp varor 25% EU'),
    ], [])

    const [remapped] = enrichAccountMappingsWithVat([{
      ...suggested,
      targetAccount: '4010',
      targetName: 'Inköp material',
    }], [])
    expect(remapped).toMatchObject({
      defaultVatTreatment: null,
      requiresVatTreatmentReview: false,
      vatTreatmentReviewed: true,
    })

    const [identity] = enrichAccountMappingsWithVat([{
      ...remapped,
      targetAccount: '4056',
      targetName: 'Inköp varor 25% EU',
    }], [])
    expect(identity).toMatchObject({
      defaultVatTreatment: 'reverse_charge_eu_goods',
      requiresVatTreatmentReview: true,
      vatTreatmentReviewed: false,
    })
  })

  it('preserves another row review when one mapping changes', () => {
    const initial = enrichAccountMappingsWithVat([
      mapping('3041', 'Försäljning tjänst 25% sv'),
      mapping('4056', 'Inköp varor 25% EU'),
    ], [])
    const reviewed = applyVatTreatmentReview(initial, '3041', 'exempt', 0)
    const remapped = enrichChangedAccountMappingWithVat(
      reviewed.map((item) => item.sourceAccount === '4056'
        ? { ...item, targetAccount: '4010', targetName: 'Inköp material' }
        : item),
      '4056',
      [],
    )

    expect(remapped[0]).toMatchObject({
      defaultVatTreatment: 'exempt',
      defaultVatRate: 0,
      vatTreatmentReviewed: true,
    })
  })
})

describe('applyVatTreatmentReviewAll', () => {
  it('marks every unreviewed row reviewed and keeps its suggested default', () => {
    const mappings = [
      {
        sourceAccount: '3001', sourceName: 'Försäljning', targetAccount: '3001', targetName: 'Försäljning',
        confidence: 1, matchType: 'exact', isOverride: false,
        defaultVatTreatment: 'sales_25', defaultVatRate: 25,
        vatTreatmentSuggested: true, vatTreatmentReviewed: false, requiresVatTreatmentReview: true,
      },
      {
        sourceAccount: '4010', sourceName: 'Inköp', targetAccount: '4010', targetName: 'Inköp',
        confidence: 1, matchType: 'exact', isOverride: false,
        defaultVatTreatment: null, defaultVatRate: null,
        vatTreatmentSuggested: false, vatTreatmentReviewed: false, requiresVatTreatmentReview: true,
      },
      {
        sourceAccount: '1930', sourceName: 'Bank', targetAccount: '1930', targetName: 'Bank',
        confidence: 1, matchType: 'exact', isOverride: false,
        defaultVatTreatment: null, defaultVatRate: null,
        vatTreatmentSuggested: false, vatTreatmentReviewed: true, requiresVatTreatmentReview: false,
      },
    ] as never[]

    const result = applyVatTreatmentReviewAll(mappings)

    // Both review rows confirmed in one action, defaults untouched.
    expect(result[0]).toMatchObject({ vatTreatmentReviewed: true, defaultVatTreatment: 'sales_25', defaultVatRate: 25 })
    expect(result[1]).toMatchObject({ vatTreatmentReviewed: true, defaultVatTreatment: null })
    // Already-reviewed rows pass through by reference.
    expect(result[2]).toBe(mappings[2])
    // No row is left gating the wizard's Continue button.
    expect(result.filter((m: { requiresVatTreatmentReview?: boolean; vatTreatmentReviewed?: boolean }) =>
      m.requiresVatTreatmentReview && !m.vatTreatmentReviewed
    )).toHaveLength(0)
  })
})

describe('applySourceVatCodes (#2585)', () => {
  const translate = (code: string, accountClass: number) =>
    code === 'MP1' && accountClass === 3 ? ('standard_25' as const)
    : code === 'IVEU' && accountClass >= 4 ? ('reverse_charge_eu_goods' as const)
    : null

  it('prefills a translated source code as a reviewed provider treatment', () => {
    const [sales, purchase] = applySourceVatCodes(
      [mapping('3041', 'Försäljn tjänst 25% sv'), mapping('4056', 'Inköp varor EU')],
      new Map([['3041', 'MP1'], ['4056', 'IVEU']]),
      translate,
    )
    expect(sales).toMatchObject({
      providerVatCode: 'MP1',
      vatTreatmentSource: 'provider',
      defaultVatTreatment: 'standard_25',
      defaultVatRate: 0.25,
      vatTreatmentSuggested: false,
      vatTreatmentReviewed: true,
      requiresVatTreatmentReview: false,
    })
    expect(purchase).toMatchObject({
      providerVatCode: 'IVEU',
      vatTreatmentSource: 'provider',
      defaultVatTreatment: 'reverse_charge_eu_goods',
      defaultVatRate: 0.25,
      vatTreatmentReviewed: true,
    })
  })

  it('keeps an untranslated code visible without deciding the treatment', () => {
    const [result] = applySourceVatCodes(
      [mapping('3001', 'Uttag')],
      new Map([['3001', 'UT']]),
      translate,
    )
    expect(result.providerVatCode).toBe('UT')
    expect(result.vatTreatmentSource).toBeUndefined()
    expect(result.defaultVatTreatment).toBeUndefined()
  })

  it('leaves remapped accounts, other classes and accounts without a code alone', () => {
    const remapped = { ...mapping('3041', 'Försäljning'), targetAccount: '3010', targetName: 'Försäljning' }
    const [asset, moms, noCode, moved] = applySourceVatCodes(
      [mapping('1930', 'Bank'), mapping('2611', 'Utgående moms'), mapping('3041', 'Försäljning'), remapped],
      new Map([['1930', 'MP1'], ['2611', 'U1'], ['3010', 'MP1']]),
      translate,
    )
    for (const row of [asset, moms, noCode, moved]) {
      expect(row.providerVatCode).toBeUndefined()
      expect(row.vatTreatmentSource).toBeUndefined()
      expect(row.defaultVatTreatment).toBeUndefined()
    }
  })

  it('is kept by the mapping-step enrichment instead of the label suggestion', () => {
    // The label alone would say standard_25 for this account; the source
    // system says it is momsfri, and the user's own configuration wins.
    const [prefilled] = applySourceVatCodes(
      [mapping('3041', 'Försäljning tjänster 25%')],
      new Map([['3041', 'MF']]),
      () => 'exempt',
    )
    const [enriched] = enrichAccountMappingsWithVat([prefilled], [])
    expect(enriched).toMatchObject({
      providerVatCode: 'MF',
      vatTreatmentSource: 'provider',
      defaultVatTreatment: 'exempt',
      defaultVatRate: 0,
      vatTreatmentSuggested: false,
      vatTreatmentReviewed: true,
      requiresVatTreatmentReview: false,
    })
  })

  it('yields to a treatment the company already set on the account', () => {
    const [prefilled] = applySourceVatCodes(
      [mapping('3041', 'Försäljning')],
      new Map([['3041', 'MF']]),
      () => 'exempt',
    )
    const [enriched] = enrichAccountMappingsWithVat([prefilled], [{
      account_number: '3041',
      default_vat_treatment: 'standard_25',
      default_vat_rate: 0.25,
    } as never])
    expect(enriched).toMatchObject({
      defaultVatTreatment: 'standard_25',
      defaultVatRate: 0.25,
      providerVatCode: 'MF',
      vatTreatmentReviewed: true,
    })
  })

  it('still label-suggests an account whose code could not be translated', () => {
    const [prefilled] = applySourceVatCodes(
      [mapping('4056', 'Inköp varor 25% EU')],
      new Map([['4056', 'XYZ']]),
      () => null,
    )
    const [enriched] = enrichAccountMappingsWithVat([prefilled], [])
    expect(enriched).toMatchObject({
      providerVatCode: 'XYZ',
      defaultVatTreatment: 'reverse_charge_eu_goods',
      vatTreatmentSuggested: true,
      vatTreatmentReviewed: false,
      requiresVatTreatmentReview: true,
    })
  })
})
