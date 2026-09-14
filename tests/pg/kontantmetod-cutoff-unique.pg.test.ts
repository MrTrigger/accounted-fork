import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getPool, withUserContext } from './setup'
import { insertPostedJournalEntry, seedCompany } from './fixtures'

describe('kontantmetod cut-off live marker uniqueness', () => {
  it('allows exactly one of two concurrent live markers', async () => {
    const seeded = await seedCompany()
    const description = 'Kundfordringar vid bokslut (kontantmetoden)'
    const common = {
      userId: seeded.userId,
      companyId: seeded.companyId,
      fiscalPeriodId: seeded.fiscalPeriodId,
      entryDate: '2026-12-31',
      description,
      sourceType: 'year_end',
      sourceId: seeded.fiscalPeriodId,
    }

    const results = await Promise.allSettled([
      insertPostedJournalEntry({ ...common, voucherNumber: 11 }),
      insertPostedJournalEntry({ ...common, voucherNumber: 12 }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected' })
    expect(String((rejected as PromiseRejectedResult).reason)).toMatch(
      /journal_entries_kontantmetod_cutoff_live_marker_unique/,
    )
  })

  it('preserves the corporate-tax race guard without blocking other year-end entries', async () => {
    const seeded = await seedCompany()
    const common = {
      userId: seeded.userId,
      companyId: seeded.companyId,
      fiscalPeriodId: seeded.fiscalPeriodId,
      entryDate: '2026-12-31',
      description: 'Bokslutsdisposition: Bolagsskatt 20,6 %',
      sourceType: 'year_end',
      sourceId: seeded.fiscalPeriodId,
    }

    await insertPostedJournalEntry({ ...common, voucherNumber: 21 })
    await expect(insertPostedJournalEntry({ ...common, voucherNumber: 22 })).rejects.toThrow(
      /uq_year_end_corporate_tax_per_period/,
    )
  })
})

/**
 * The marker table (20260914150109) is what the two VAT functions read instead
 * of the Swedish descriptions. These assert the contract the writer and both
 * readers depend on, plus the one-time backfill that carried every legacy
 * cut-off across.
 */
describe('kontantmetod cut-off markers', () => {
  const MIGRATION_PATH = new URL(
    '../../supabase/migrations/20260914150109_kontantmetod_cutoff_entries_marker.sql',
    import.meta.url,
  )

  /**
   * The migration's backfill statement, taken from the migration file itself.
   * Running a hand-copied version would prove nothing about the statement that
   * actually runs on production, so the file carries markers for this test.
   */
  function backfillStatement(): string {
    const sql = readFileSync(MIGRATION_PATH, 'utf8')
    const start = sql.indexOf('-- backfill:begin')
    const end = sql.indexOf('-- backfill:end')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return sql.slice(start + '-- backfill:begin'.length, end)
  }

  const LEGACY = [
    { description: 'Kundfordringar vid bokslut (kontantmetoden)', kind: 'receivable' },
    { description: 'Vändning kundfordringar bokslut (kontantmetoden)', kind: 'receivable_reversal' },
    { description: 'Leverantörsskulder vid bokslut (kontantmetoden)', kind: 'payable' },
    { description: 'Vändning leverantörsskulder bokslut (kontantmetoden)', kind: 'payable_reversal' },
  ]

  it('backfills every legacy description to its kind, and is idempotent', async () => {
    const seeded = await seedCompany()
    const entryIds: Record<string, string> = {}

    for (const [index, legacy] of LEGACY.entries()) {
      entryIds[legacy.kind] = await insertPostedJournalEntry({
        userId: seeded.userId,
        companyId: seeded.companyId,
        fiscalPeriodId: seeded.fiscalPeriodId,
        voucherNumber: 100 + index,
        entryDate: '2026-12-31',
        description: legacy.description,
        sourceType: 'year_end',
        sourceId: seeded.fiscalPeriodId,
      })
    }

    const statement = backfillStatement()
    await getPool().query(statement)
    // Re-running must add nothing: ON CONFLICT DO NOTHING is what makes the
    // migration replayable and keeps the writer safe afterwards.
    await getPool().query(statement)

    const { rows } = await getPool().query<{ kind: string; journal_entry_id: string }>(
      `SELECT kind, journal_entry_id FROM public.kontantmetod_cutoff_entries
        WHERE company_id = $1 ORDER BY kind`,
      [seeded.companyId],
    )
    expect(rows).toEqual(
      [...LEGACY]
        .sort((a, b) => a.kind.localeCompare(b.kind))
        .map((legacy) => ({ kind: legacy.kind, journal_entry_id: entryIds[legacy.kind] })),
    )
  })

  it('marks a reversed legacy cut-off too, the way the VAT functions already treated it', async () => {
    // Both functions scope to status IN ('posted','reversed') and dropped both
    // on description, so the backfill must take both or a filed figure moves.
    const seeded = await seedCompany()
    const entryId = await insertPostedJournalEntry({
      userId: seeded.userId,
      companyId: seeded.companyId,
      fiscalPeriodId: seeded.fiscalPeriodId,
      voucherNumber: 130,
      entryDate: '2026-12-31',
      description: 'Vändning kundfordringar bokslut (kontantmetoden)',
      sourceType: 'year_end',
      sourceId: seeded.fiscalPeriodId,
    })
    await getPool().query(
      `UPDATE public.journal_entries SET status = 'reversed' WHERE id = $1`,
      [entryId],
    )

    await getPool().query(backfillStatement())

    const { rows } = await getPool().query<{ kind: string }>(
      `SELECT kind FROM public.kontantmetod_cutoff_entries WHERE journal_entry_id = $1`,
      [entryId],
    )
    expect(rows).toEqual([{ kind: 'receivable_reversal' }])
  })

  it('refuses a marker on a verifikat that is not a year-end posting for that period', async () => {
    // Without this a member could mark an ordinary sale and take it out of
    // their own momsdeklaration.
    const seeded = await seedCompany()
    const ordinaryId = await insertPostedJournalEntry({
      userId: seeded.userId,
      companyId: seeded.companyId,
      fiscalPeriodId: seeded.fiscalPeriodId,
      voucherNumber: 140,
      description: 'Vanlig försäljning',
      sourceType: 'invoice_created',
    })

    await expect(
      getPool().query(
        `INSERT INTO public.kontantmetod_cutoff_entries
           (company_id, fiscal_period_id, kind, journal_entry_id)
         VALUES ($1, $2, 'receivable_reversal', $3)`,
        [seeded.companyId, seeded.fiscalPeriodId, ordinaryId],
      ),
    ).rejects.toThrow(/must reference a year_end journal entry/)
  })

  it('is append-only: no UPDATE or DELETE for any API role, and anon sees nothing', async () => {
    const { rows } = await getPool().query<Record<string, boolean>>(
      `SELECT
         has_table_privilege('authenticated', 'public.kontantmetod_cutoff_entries', 'SELECT') AS auth_select,
         has_table_privilege('authenticated', 'public.kontantmetod_cutoff_entries', 'INSERT') AS auth_insert,
         has_table_privilege('authenticated', 'public.kontantmetod_cutoff_entries', 'UPDATE') AS auth_update,
         has_table_privilege('authenticated', 'public.kontantmetod_cutoff_entries', 'DELETE') AS auth_delete,
         has_table_privilege('service_role', 'public.kontantmetod_cutoff_entries', 'INSERT') AS service_insert,
         has_table_privilege('service_role', 'public.kontantmetod_cutoff_entries', 'DELETE') AS service_delete,
         has_table_privilege('anon', 'public.kontantmetod_cutoff_entries', 'SELECT') AS anon_select`,
    )
    expect(rows[0]).toEqual({
      auth_select: true,
      auth_insert: true,
      auth_update: false,
      auth_delete: false,
      service_insert: true,
      service_delete: false,
      anon_select: false,
    })
  })

  it('shows a member only its own company markers', async () => {
    const mine = await seedCompany()
    const theirs = await seedCompany()

    for (const seeded of [mine, theirs]) {
      const entryId = await insertPostedJournalEntry({
        userId: seeded.userId,
        companyId: seeded.companyId,
        fiscalPeriodId: seeded.fiscalPeriodId,
        voucherNumber: 150,
        entryDate: '2026-12-31',
        description: 'Kundfordringar vid bokslut (kontantmetoden)',
        sourceType: 'year_end',
        sourceId: seeded.fiscalPeriodId,
      })
      await getPool().query(
        `INSERT INTO public.kontantmetod_cutoff_entries
           (company_id, fiscal_period_id, kind, journal_entry_id)
         VALUES ($1, $2, 'receivable', $3)`,
        [seeded.companyId, seeded.fiscalPeriodId, entryId],
      )
    }

    const visible = await withUserContext(mine.userId, async (client) => {
      const res = await client.query<{ company_id: string }>(
        `SELECT company_id FROM public.kontantmetod_cutoff_entries`,
      )
      return res.rows.map((row) => row.company_id)
    })
    expect(visible).toEqual([mine.companyId])
  })
})
