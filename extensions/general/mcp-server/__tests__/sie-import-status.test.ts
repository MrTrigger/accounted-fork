import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueuedMockSupabase } from '@/tests/helpers'
import { tools } from '../server'

const statusTool = tools.find(tool => tool.name === 'gnubok_sie_import_status')!
const undoTool = tools.find(tool => tool.name === 'gnubok_undo_sie_import')!
const db = createQueuedMockSupabase()
const call = () => statusTool.execute({ import_id: 'import-1' }, 'company-1', 'user-1', db.supabase as never)

describe('MCP SIE legacy recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); db.reset() })

  it('preserves durable progress', async () => {
    db.enqueue({ data: { id: 'import-1', job_state: 'completed', chunks_done: 4, chunks_total: 4,
      transactions_count: 81, error_message: null, job_result: { completed: true } } })
    expect(await call()).toEqual({ import_id: 'import-1', kind: 'durable', state: 'completed', chunks_done: 4,
      chunks_total: 4, vouchers_written: 81, error_message: null, result: { completed: true } })
  })

  it.each(['failed', 'pending', 'completed', 'undone', 'timed_out'])('reports legacy %s as review-required, with no invented progress', async status => {
    const row = { id: 'import-1', status, job_state: null, fiscal_period_id: 'period-1' }
    db.enqueueMany([{ data: row }, { data: row },
      { data: { id: 'period-1', period_start: '2026-01-01', period_end: '2026-12-31', is_closed: true, locked_at: null, import_hold: null } },
      { data: { bookkeeping_locked_through: '2026-06-30' } }, { count: 6850 }, { count: 6849 }, { count: 6848 },
    ])
    expect(await call()).toMatchObject({ import_id: 'import-1', kind: 'legacy', state: 'review_required',
      chunks_done: null, chunks_total: null, vouchers_written: null, result: null,
      recovery: { legacy_status: status, entry_ownership: 'unverified', mutation_available: false,
        fiscal_period: { fiscal_period_id: 'period-1', is_closed: true },
        period_entries: { all: 6850, posted: 6849, importOrOpening: 6848 },
        company_lock: { known: true, through: '2026-06-30' }, assessment_api_url: '/api/import/sie/import-1/recovery' },
    })
    expect(db.calls.some(call => ['insert', 'update', 'delete', 'upsert'].includes(call.method))).toBe(false)
    expect(db.supabase.rpc).not.toHaveBeenCalled()
  })

  it('does not leak an import outside the active company', async () => {
    db.enqueueMany([{ data: null }, { data: null }])
    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(db.findCalls('sie_imports', 'eq').filter(args => args[0] === 'company_id')).toEqual([
      ['company_id', 'company-1'], ['company_id', 'company-1'],
    ])
  })

  it('preserves database errors', async () => {
    const error = { code: '57014', message: 'statement timeout' }
    db.enqueue({ error })
    await expect(call()).rejects.toThrow('statement timeout')
  })

  it.each(['failed', 'completed'])('does not stage undo for legacy %s', async status => {
    db.enqueue({ data: { id: 'import-1', status, job_state: null } })
    await expect(undoTool.execute({ import_id: 'import-1' }, 'company-1', 'user-1', db.supabase as never))
      .rejects.toMatchObject({ code: 'SIE_IMPORT_LEGACY_REVIEW_REQUIRED' })
    expect(db.findCalls('pending_operations', 'insert')).toHaveLength(0)
    expect(db.supabase.rpc).not.toHaveBeenCalled()
  })
})
