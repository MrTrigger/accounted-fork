import type { WorklistCategory, WorklistCounts } from './types'

/**
 * The first thing on Att göra that a connected AI client can do over MCP.
 *
 * Hem's worklist footer offers one button: "Fixa första punkten med Claude"
 * (or ChatGPT, Grok). "First" is the first row the section renders, in its
 * band order (Bokför, Betala, Granska, Bevaka), skipping rows no agent can
 * clear: staged operations wait for a human approval, and the two Betala
 * rows are bank transfers a person makes. Each returned category keys a
 * prompt in messages (dashboard.ai_task_<category>) that names the count
 * and the MCP tools behind it. Pure: the footer only renders the copy.
 */
export type AiTaskCategory = Extract<
  WorklistCategory,
  | 'book_transaction'
  | 'book_skattekonto'
  | 'inbox_document'
  | 'supplier_invoice_approval'
  | 'verifikat_missing_document'
  | 'overdue_invoice'
  | 'deadline_action'
  | 'reconciliation_due'
>

export interface AiTask {
  category: AiTaskCategory
  count: number
}

/** Render order of the Att göra rows an agent can act on. */
export const AI_TASK_ORDER: readonly AiTaskCategory[] = [
  'book_transaction',
  'book_skattekonto',
  'inbox_document',
  'supplier_invoice_approval',
  'verifikat_missing_document',
  'overdue_invoice',
  'deadline_action',
  'reconciliation_due',
]

export function pickFirstAiTask(
  counts: WorklistCounts['counts'],
  opts: { hasAi: boolean },
): AiTask | null {
  for (const category of AI_TASK_ORDER) {
    // The Dokumentinkorg row is hidden for non-payers (paid AI surface), so
    // it is not "on the list" for them either.
    if (category === 'inbox_document' && !opts.hasAi) continue
    const count = counts[category] ?? 0
    if (count > 0) return { category, count }
  }
  return null
}
