import {
  isVatTreatmentAllowedForAccountClass,
  type AccountVatTreatment,
} from '@/lib/vat/account-vat-treatment'

/**
 * Fortnox per-account momskod (Account.VATCode on /accounts) to Accounted's
 * account VAT treatment.
 *
 * Fortnox names its codes after the momsdeklaration ruta they feed (the UI
 * shows them as "MP1 (05)", "I (48)"), so the translation is ruta to ruta:
 * a code is listed here only when Accounted has a treatment that lands the
 * same account on the same ruta. The keys below are the codes Fortnox ships
 * by default; a company can rename or add codes, and anything not listed
 * translates to null, which leaves the mapping step on today's label-based
 * suggestion for that account.
 *
 * Deliberately absent, with the ruta they feed:
 * - U1-U3 (10-12), I (48), UOS/UEU/UTFU (30-32), UI25/12/6 (60-62), R1/R2
 *   (49): moms accounts (class 2), which carry no treatment in Accounted.
 * - UT (06, uttag), 3VEU/3FEU (37-38, trepartshandel), BI (50, import
 *   beskattningsunderlag): no matching treatment exists yet.
 *
 * Same treatment on both sides of the ledger: VTEU (35) and IVEU (20) both
 * become reverse_charge_eu_goods, FTEU (39) and ITEU (21) both
 * reverse_charge_eu_services, OTTU (41) and IV/IT (23-24) both
 * reverse_charge_domestic. The account class decides the ruta, the same way
 * resolveVatTreatmentRuta does for every other source of the treatment.
 */
export const FORTNOX_VAT_CODE_TREATMENTS: Readonly<Record<string, AccountVatTreatment>> = {
  // Ruta 05-08: momspliktig försäljning
  MP1: 'standard_25',
  MP2: 'reduced_12',
  MP3: 'reduced_6',
  BVMB: 'vmb',
  HFS: 'rental_voluntary',
  // Ruta 20-24: inköp med omvänd betalningsskyldighet
  IVEU: 'reverse_charge_eu_goods',
  ITEU: 'reverse_charge_eu_services',
  ITGLOB: 'reverse_charge_non_eu_services',
  IV: 'reverse_charge_domestic',
  IT: 'reverse_charge_domestic',
  // Ruta 35-42: försäljning undantagen från moms
  VTEU: 'reverse_charge_eu_goods',
  E: 'export_goods',
  FTEU: 'reverse_charge_eu_services',
  'ÖTEU': 'export_services',
  OTTU: 'reverse_charge_domestic',
  MF: 'exempt',
}

/**
 * Translate one Fortnox VATCode for an account of the given class. Null when
 * the code is unknown, blank, or names a treatment the class cannot carry
 * (MP1 on a purchase account, IVEU on a revenue account): the account then
 * falls back to the label suggestion instead of inheriting a ruta it cannot
 * reach.
 */
export function fortnoxVatCodeToTreatment(
  code: string | null | undefined,
  accountClass: number,
): AccountVatTreatment | null {
  if (!code) return null
  const treatment = FORTNOX_VAT_CODE_TREATMENTS[code.trim().toUpperCase()]
  if (!treatment) return null
  return isVatTreatmentAllowedForAccountClass(treatment, accountClass) ? treatment : null
}
