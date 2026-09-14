import { describe, expect, it } from 'vitest'
import { pickAiPrompts } from '../ai-prompts'
import type { BooksFindings } from '@/lib/onboarding/findings'

function findings(over: { books?: Partial<BooksFindings['books']>; bank?: Partial<BooksFindings['bank']>; skv?: Partial<BooksFindings['skv']> } = {}): BooksFindings {
  return {
    books: {
      entries: 120,
      periods: [{ name: '2025', start: '2025-01-01', end: '2025-12-31', isClosed: false, continuityVerified: null }],
      revenue: 480000,
      result: 52000,
      periodName: '2025',
      overdueInvoices: 0,
      vatBalance: null,
      uncategorizedTransactions: 0,
      lastEntryDate: '2025-12-31',
      missingUnderlag: 0,
      ...over.books,
    },
    bank: { connected: false, bankName: null, transactions: 0, sweep: null, ...over.bank },
    skv: { connected: false, ledger1630: null, nextDeadlines: [], ...over.skv },
    ai: { connected: [] },
  }
}

describe('pickAiPrompts', () => {
  it('returns nothing without findings', () => {
    expect(pickAiPrompts(null)).toEqual([])
  })

  it('offers first steps to a company with nothing in it', () => {
    const out = pickAiPrompts(findings({ books: { entries: 0, revenue: null, periodName: null } }))
    expect(out.map((p) => p.key)).toEqual(['fresh_invoice', 'fresh_receipt'])
  })

  it('ranks waiting bank rows first and caps at three', () => {
    const out = pickAiPrompts(
      findings({
        books: { uncategorizedTransactions: 4, missingUnderlag: 7, overdueInvoices: 2 },
        bank: { connected: true, bankName: 'Testbank', transactions: 30, sweep: { auto_linked: 20, suggested: 3, unmatched: 7 } },
        skv: { connected: true, nextDeadlines: [{ type: 'moms_quarterly', dueDate: '2026-11-12' }] },
      }),
    )
    expect(out).toEqual([
      { key: 'review', params: { count: 10 } },
      { key: 'underlag', params: { count: 7 } },
      { key: 'overdue', params: { count: 2 } },
    ])
  })

  it('falls through to the VAT return, cash, the tax account and the period summary', () => {
    const base = { skv: { connected: true, nextDeadlines: [{ type: 'arbetsgivardeklaration', dueDate: '2026-10-12' }, { type: 'moms_monthly', dueDate: '2026-10-26' }] } }
    expect(pickAiPrompts(findings(base))).toEqual([
      { key: 'vat', params: { date: '2026-10-26' } },
      { key: 'skattekonto', params: {} },
      { key: 'result', params: { period: '2025' } },
    ])
    expect(pickAiPrompts(findings({ ...base, bank: { connected: true, bankName: 'Testbank', transactions: 12, sweep: null } })).map((p) => p.key)).toEqual(['vat', 'cash', 'skattekonto'])
  })

  it('never returns an empty list for a company with books', () => {
    const out = pickAiPrompts(findings({ books: { revenue: null, periodName: null } }))
    expect(out).toEqual([{ key: 'fresh_invoice', params: {} }])
  })
})
