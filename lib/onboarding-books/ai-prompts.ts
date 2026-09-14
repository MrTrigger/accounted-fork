import type { BooksFindings } from '@/lib/onboarding/findings'

/**
 * The bubbles out of the AI card at the end of the books act: three things
 * the connected client can do for this company right now, each one a full
 * instruction the user pastes as-is and each backed by MCP tools that exist
 * (list_uncategorized_transactions + suggest_categories + bulk_book,
 * list_verifikat_without_documents + link_document, list_invoices overdue,
 * get_vat_report + vat_declaration_validate, list_cash_accounts +
 * list_supplier_invoices, book_skattekonto_rows, get_income_statement,
 * create_customer + create_invoice + send_invoice). Ranked by how much of
 * the user's own work they clear: bank rows waiting for kontering first,
 * then verifikat without underlag, overdue customer invoices, the next VAT
 * return, cash against the bills due, the tax account, and last period's
 * result. A company with nothing in it yet gets its first two moves
 * instead. Pure: the card only renders the copy.
 */

export type AiPromptKey =
  | 'review'
  | 'underlag'
  | 'overdue'
  | 'vat'
  | 'cash'
  | 'skattekonto'
  | 'result'
  | 'fresh_invoice'
  | 'fresh_receipt'

export interface AiPrompt {
  key: AiPromptKey
  params: Record<string, string | number>
}

export function pickAiPrompts(f: BooksFindings | null, max = 3): AiPrompt[] {
  if (!f) return []
  if (f.books.entries === 0 && !f.bank.connected) {
    const fresh: AiPrompt[] = [
      { key: 'fresh_invoice', params: {} },
      { key: 'fresh_receipt', params: {} },
    ]
    return fresh.slice(0, max)
  }
  const out: AiPrompt[] = []
  const sweepReview = f.bank.sweep ? f.bank.sweep.unmatched + f.bank.sweep.suggested : 0
  const review = Math.max(sweepReview, f.books.uncategorizedTransactions)
  if (review > 0) out.push({ key: 'review', params: { count: review } })
  if (f.books.missingUnderlag > 0) out.push({ key: 'underlag', params: { count: f.books.missingUnderlag } })
  if (f.books.overdueInvoices > 0) out.push({ key: 'overdue', params: { count: f.books.overdueInvoices } })
  const vat = f.skv.nextDeadlines.find((d) => d.type.startsWith('moms'))
  if (vat) out.push({ key: 'vat', params: { date: vat.dueDate } })
  if (f.bank.connected) out.push({ key: 'cash', params: {} })
  if (f.skv.connected) out.push({ key: 'skattekonto', params: {} })
  if (f.books.revenue !== null && f.books.periodName) out.push({ key: 'result', params: { period: f.books.periodName } })
  if (out.length === 0) out.push({ key: 'fresh_invoice', params: {} })
  return out.slice(0, max)
}
