import { describe, expect, it } from 'vitest'

import { FORTNOX_VAT_CODE_TREATMENTS, fortnoxVatCodeToTreatment } from '../vat-codes'
import {
  ACCOUNT_VAT_TREATMENTS,
  resolveVatTreatmentRuta,
} from '@/lib/vat/account-vat-treatment'

/**
 * Fortnox names each momskod after the momsdeklaration ruta it feeds. The
 * table is therefore checked ruta by ruta: a Fortnox code on an account of
 * the class Fortnox uses it on must land that account on the same ruta
 * Fortnox would.
 */
describe('fortnoxVatCodeToTreatment', () => {
  it.each([
    // code, account class, Fortnox ruta, expected treatment
    ['MP1', 3, 'ruta05', 'standard_25'],
    ['MP2', 3, 'ruta05', 'reduced_12'],
    ['MP3', 3, 'ruta05', 'reduced_6'],
    ['BVMB', 3, 'ruta07', 'vmb'],
    ['HFS', 3, 'ruta08', 'rental_voluntary'],
    ['VTEU', 3, 'ruta35', 'reverse_charge_eu_goods'],
    ['E', 3, 'ruta36', 'export_goods'],
    ['FTEU', 3, 'ruta39', 'reverse_charge_eu_services'],
    ['ÖTEU', 3, 'ruta40', 'export_services'],
    ['OTTU', 3, 'ruta41', 'reverse_charge_domestic'],
    ['MF', 3, 'ruta42', 'exempt'],
    ['IVEU', 4, 'ruta20', 'reverse_charge_eu_goods'],
    ['ITEU', 4, 'ruta21', 'reverse_charge_eu_services'],
    ['ITGLOB', 4, 'ruta22', 'reverse_charge_non_eu_services'],
    ['IV', 4, 'ruta23', 'reverse_charge_domestic'],
    ['IT', 6, 'ruta24', 'reverse_charge_domestic'],
  ] as const)('%s on a class %i account lands on %s', (code, accountClass, ruta, treatment) => {
    expect(fortnoxVatCodeToTreatment(code, accountClass)).toBe(treatment)
    expect(resolveVatTreatmentRuta(treatment, accountClass)?.box).toBe(ruta)
  })

  it('IT on a class 4 account that is not a known service account lands on ruta 23, like any other class 4 domestic reverse charge', () => {
    // Fortnox puts IT (24) on tjänsteinköp; Accounted's ruta 23/24 split is
    // by account class and the 4425-4427 exception, and the translation
    // does not override that rule. Pinned so a future change is deliberate.
    expect(fortnoxVatCodeToTreatment('IT', 4)).toBe('reverse_charge_domestic')
    expect(resolveVatTreatmentRuta('reverse_charge_domestic', 4, '4010')?.box).toBe('ruta23')
    expect(resolveVatTreatmentRuta('reverse_charge_domestic', 4, '4425')?.box).toBe('ruta24')
  })

  it('normalises case and whitespace', () => {
    expect(fortnoxVatCodeToTreatment(' mp1 ', 3)).toBe('standard_25')
    expect(fortnoxVatCodeToTreatment('öteu', 3)).toBe('export_services')
  })

  it('answers null for blank, unknown and moms-account codes', () => {
    expect(fortnoxVatCodeToTreatment(undefined, 3)).toBeNull()
    expect(fortnoxVatCodeToTreatment(null, 3)).toBeNull()
    expect(fortnoxVatCodeToTreatment('', 3)).toBeNull()
    expect(fortnoxVatCodeToTreatment('MPX', 3)).toBeNull()
    // Codes Fortnox puts on 26xx moms accounts: no treatment on any class.
    for (const code of ['U1', 'U2', 'U3', 'I', 'UOS1', 'UEU1', 'UTFU1', 'UI25', 'R1', 'R2']) {
      expect(fortnoxVatCodeToTreatment(code, 3)).toBeNull()
      expect(fortnoxVatCodeToTreatment(code, 4)).toBeNull()
    }
    // Rutor Accounted has no treatment for yet.
    for (const code of ['UT', '3VEU', '3FEU', 'BI']) {
      expect(fortnoxVatCodeToTreatment(code, 3)).toBeNull()
      expect(fortnoxVatCodeToTreatment(code, 4)).toBeNull()
    }
  })

  it('refuses a treatment the account class cannot carry', () => {
    // A revenue-only code on a purchase account, and vice versa, must not
    // inherit a ruta the account can never reach.
    expect(fortnoxVatCodeToTreatment('MP1', 4)).toBeNull()
    expect(fortnoxVatCodeToTreatment('MF', 5)).toBeNull()
    expect(fortnoxVatCodeToTreatment('HFS', 6)).toBeNull()
    expect(fortnoxVatCodeToTreatment('ITGLOB', 3)).toBeNull()
    // Class 2 and 7 accounts never carry a treatment at all.
    expect(fortnoxVatCodeToTreatment('MP1', 2)).toBeNull()
    expect(fortnoxVatCodeToTreatment('IVEU', 7)).toBeNull()
  })

  it('only ever names a treatment Accounted knows', () => {
    for (const treatment of Object.values(FORTNOX_VAT_CODE_TREATMENTS)) {
      expect(ACCOUNT_VAT_TREATMENTS).toContain(treatment)
    }
  })
})
