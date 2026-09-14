import { describe, expect, it } from 'vitest'
import { AI_TASK_ORDER, pickFirstAiTask } from '../ai-task'
import { WORKLIST_CATEGORIES, type WorklistCategory } from '../types'

function counts(overrides: Partial<Record<WorklistCategory, number>> = {}): Record<WorklistCategory, number> {
  const base = Object.fromEntries(WORKLIST_CATEGORIES.map((c) => [c, 0])) as Record<WorklistCategory, number>
  return { ...base, ...overrides }
}

describe('pickFirstAiTask', () => {
  it('returns null when nothing is pending', () => {
    expect(pickFirstAiTask(counts(), { hasAi: true })).toBeNull()
  })

  it('takes the first rendered row: bank rows before anything in Granska or Bevaka', () => {
    const c = counts({ overdue_invoice: 3, verifikat_missing_document: 2, book_transaction: 7 })
    expect(pickFirstAiTask(c, { hasAi: true })).toEqual({ category: 'book_transaction', count: 7 })
  })

  it('skips rows no agent can clear: staged operations and the two Betala rows', () => {
    const c = counts({ pending_operations: 4, expense_payout: 2, skattekonto_payment_due: 1, overdue_invoice: 1 })
    expect(pickFirstAiTask(c, { hasAi: true })).toEqual({ category: 'overdue_invoice', count: 1 })
  })

  it('hides the Dokumentinkorg row for non-payers, like the section does', () => {
    const c = counts({ inbox_document: 5, verifikat_missing_document: 1 })
    expect(pickFirstAiTask(c, { hasAi: false })).toEqual({ category: 'verifikat_missing_document', count: 1 })
    expect(pickFirstAiTask(c, { hasAi: true })).toEqual({ category: 'inbox_document', count: 5 })
  })

  it('every task category is a real worklist category', () => {
    for (const cat of AI_TASK_ORDER) expect(WORKLIST_CATEGORIES).toContain(cat)
  })
})
