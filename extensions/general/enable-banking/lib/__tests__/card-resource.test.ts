import { describe, expect, it } from 'vitest'
import { isCardResource } from '../card-resource'

describe('isCardResource', () => {
  it('flags a CARD-typed resource without an IBAN', () => {
    expect(isCardResource({ cash_account_type: 'CARD', name: 'Testbrand AB' })).toBe(true)
    expect(isCardResource({ cash_account_type: 'card', product: 'Företagskort' })).toBe(true)
  })

  it('flags the Svea product-code shapes seen in production, typed or not', () => {
    expect(isCardResource({ name: 'BOKIO_Debit_Business' })).toBe(true)
    expect(isCardResource({ product: 'SVEA_MQ_Debit_B2B', cash_account_type: 'CACC' })).toBe(true)
    expect(isCardResource({ name: 'SVEA_MQ_Debit_B2B', iban: null })).toBe(true)
  })

  it('never flags a resource that has its own IBAN', () => {
    expect(isCardResource({ cash_account_type: 'CARD', iban: 'SE1234567890' })).toBe(false)
    expect(isCardResource({ name: 'BOKIO_Debit_Business', iban: 'SE1234567890' })).toBe(false)
  })

  it('leaves ordinary no-IBAN accounts alone', () => {
    expect(isCardResource({ name: 'Testbrand AB' })).toBe(false)
    expect(isCardResource({ name: null, product: null })).toBe(false)
    expect(isCardResource({ cash_account_type: 'CACC', name: 'Företagskonto' })).toBe(false)
    // A holder whose name contains the word is not a product code.
    expect(isCardResource({ name: 'Debit AB' })).toBe(false)
    expect(isCardResource({ name: 'Debitering Konsult AB' })).toBe(false)
  })
})
