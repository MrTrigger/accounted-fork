import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { SIEJobMappingsSchema } from '@/lib/api/schemas'
import { BAS_REFERENCE } from '@/lib/bookkeeping/bas-data'
import { parseSIEFile } from '../sie-parser'
import { suggestMappings } from '../account-mapper'
import { jobInput } from '../sie-job-preparation'
import type { SIEJob } from '../sie-job-contract'
import { resolveSIEFiscalYear, submitSIEJob, validateSIEJobInput } from '../sie-jobs'
import type { AccountMapping } from '../types'

const options = {filename:'ledger.si',createFiscalPeriod:false,importOpeningBalances:false,importTransactions:true}
const mappings:AccountMapping[] = ['1930','3001'].map(number => ({sourceAccount:number,targetAccount:number,
  sourceName:'Account',targetName:'Account',confidence:1,matchType:'exact',isOverride:false}))
const content = '#FLAGGA 0\n#SIETYP 4\n#VER "" "" 20260201 "Unnumbered"\n{\n#TRANS 1930 {} 100\n#TRANS 3001 {} -100\n}'

describe('SIE durable input boundaries', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('normalizes repeated identical source definitions before metadata upserts', () => {
    const parsed = parseSIEFile('#KONTO 1930 "Bank"\n#KONTO 1930 "Bank"\n#KONTO 3001 "Sales"\n' + content)
    const suggested = suggestMappings(parsed.accounts, BAS_REFERENCE)
    expect(suggested.map(mapping => mapping.sourceAccount)).toEqual(['1930', '1930', '3001'])
    expect(SIEJobMappingsSchema.parse(suggested).map(mapping => mapping.sourceAccount)).toEqual(['1930', '3001'])
  })

  it('preserves accepted mapping checkpoint positions when resuming older duplicate input', () => {
    const unique = Array.from({ length: 101 }, (_, index) => ({ ...mappings[0], sourceAccount: String(1000 + index) }))
    const acceptedMappings = [...unique.slice(0, 60), unique[0], ...unique.slice(60)]
    const fileHash = 'a'.repeat(64)
    const job = { file_hash: fileHash, manifest: { input: {
      version: 1, sourceHash: fileHash, mappings: acceptedMappings, options,
    } } } as unknown as SIEJob
    const resumed = jobInput(job)
    expect(resumed.mappings.map(mapping => mapping.sourceAccount)).toEqual(acceptedMappings.map(mapping => mapping.sourceAccount))
    expect(resumed.mappings.slice(100).map(mapping => mapping.sourceAccount)).toEqual(['1099', '1100'])
  })

  it.each([
    { targetAccount: '1940' },
    { sourceName: 'Conflicting name' },
    { defaultVatTreatment: 'standard_25' as const, vatTreatmentReviewed: true },
  ])('refuses conflicting source mappings before storage or database access: %j', async changes => {
    vi.stubEnv('SIE_IMPORT_JOBS', 'true')
    const database = { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } }
    await expect(submitSIEJob(database as unknown as SupabaseClient, 'company-1', 'user-1', content,
      [...mappings, { ...mappings[0], ...changes }], options)).rejects.toThrow('kontomappning')
    expect(database.from).not.toHaveBeenCalled()
    expect(database.rpc).not.toHaveBeenCalled()
    expect(database.storage.from).not.toHaveBeenCalled()
  })

  it.each([
    '#VER A invalid 20260201 "Damaged voucher"\n{\n#TRANS 1930 {} 10\n#TRANS 3001 {} -10\n}',
    '#TRANS 1930 {} 10',
  ])('refuses a partially parsed file before storage or database access: %s', async malformed => {
    vi.stubEnv('SIE_IMPORT_JOBS', 'true')
    const partial = '#RAR 0 20260101 20261231\n' + content + '\n' + malformed
    const parsed = parseSIEFile(partial)
    expect(parsed.vouchers).toHaveLength(1)
    expect(parsed.issues.some(issue => issue.severity === 'error')).toBe(true)
    const database = { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } }
    await expect(submitSIEJob(database as unknown as SupabaseClient, 'company-1', 'user-1', partial,
      mappings, options)).rejects.toThrow('tolkningsfel')
    expect(database.from).not.toHaveBeenCalled()
    expect(database.rpc).not.toHaveBeenCalled()
    expect(database.storage.from).not.toHaveBeenCalled()
  })

  it('preserves omitted voucher identity and resolves the sole containing fiscal period', async () => {
    const parsed = parseSIEFile(content)
    expect(parsed.vouchers).toHaveLength(1)
    expect(parsed.vouchers[0].numberOmitted).toBe(true)
    const {supabase,enqueueMany} = createQueuedMockSupabase()
    enqueueMany([{data:[{period_start:'2026-01-01',period_end:'2026-12-31'}]}])
    await resolveSIEFiscalYear(supabase as unknown as SupabaseClient, 'company-1', parsed)
    expect(parsed.stats.fiscalYearStart).toBe('2026-01-01')
    expect(()=>validateSIEJobInput(content,parsed,mappings,options)).not.toThrow()
  })
  it.each([{periods:[]},{periods:[{period_start:'2026-01-01',period_end:'2026-12-31'},{period_start:'2025-07-01',period_end:'2026-06-30'}]}])(
    'refuses missing or ambiguous containing periods', async ({periods}) => {
      const {supabase,enqueueMany} = createQueuedMockSupabase()
      enqueueMany([{data:periods}])
      await expect(resolveSIEFiscalYear(supabase as unknown as SupabaseClient,'company-1',parseSIEFile(content))).rejects.toThrow('saknar #RAR')
    })
  it('names an oversized voucher before any ledger write', () => {
    const withYear = '#RAR 0 20260101 20261231\n'+content
    const parsed = parseSIEFile(withYear)
    parsed.vouchers[0].lines = Array.from({length:2001},()=>parsed.vouchers[0].lines[0])
    expect(()=>validateSIEJobInput(withYear,parsed,mappings,options)).toThrow('2 000 rader')
  })
})
