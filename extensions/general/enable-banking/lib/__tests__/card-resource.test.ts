import { describe, expect, it } from 'vitest'
import { isCardResource } from '../card-resource'

describe('isCardResource', () => {
  it('flags the Svea product-code shapes seen in production', () => {
    expect(isCardResource({ name: 'BOKIO_Debit_Business' })).toBe(true)
    expect(isCardResource({ product: 'SVEA_MQ_Debit_B2B' })).toBe(true)
    expect(isCardResource({ name: 'SVEA_MQ_Debit_B2B', iban: null })).toBe(true)
    expect(isCardResource({ name: 'Testbrand AB', product: 'BOKIO_Debit_Business' })).toBe(true)
  })

  it('never flags a resource that has its own IBAN', () => {
    expect(isCardResource({ name: 'BOKIO_Debit_Business', iban: 'SE1234567890' })).toBe(false)
    expect(isCardResource({ product: 'SVEA_MQ_Debit_B2B', iban: 'SE1234567890' })).toBe(false)
  })

  it('leaves genuine no-IBAN accounts alone, standalone credit cards included', () => {
    // SEB lists real credit cards without an IBAN; they carry their own feed.
    expect(isCardResource({ name: 'SEB Credit' })).toBe(false)
    expect(isCardResource({ name: 'Eurocard Gold' })).toBe(false)
    expect(isCardResource({ name: 'Testbrand AB' })).toBe(false)
    expect(isCardResource({ name: null, product: null })).toBe(false)
    expect(isCardResource({ name: 'Företagskonto' })).toBe(false)
    // A holder whose name contains the word is not a product code.
    expect(isCardResource({ name: 'Debit AB' })).toBe(false)
    expect(isCardResource({ name: 'Debitering Konsult AB' })).toBe(false)
  })
})
