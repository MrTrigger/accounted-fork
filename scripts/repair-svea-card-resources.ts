#!/usr/bin/env npx tsx
/**
 * Issue #2564: Svea Bank lists a card view of each payment account as a second
 * PSD2 resource (no IBAN, product code BOKIO_Debit_Business or
 * SVEA_MQ_Debit_B2B). Its transactions are the payment account's own card
 * purchases mirrored with the sign flipped and no text, so every enabled card
 * view has been feeding positive "Okänd transaktion" duplicates into the
 * company's feed on every sync.
 *
 * The callback now stores such resources disabled and flagged
 * (StoredAccount.card_resource, lib/card-resource.ts). This script brings the
 * connections that predate the fix in line:
 *
 *   1. accounts_data: the card view gets enabled=false, card_resource=true
 *   2. cash_accounts: the mirrored row (if any) gets enabled=false
 *   3. transactions: the card view's UNBOOKED, unlinked rows are deleted
 *
 * Booked or linked rows are never touched: they are listed for a human
 * decision (a booked mirror row is a duplicate posting and needs storno,
 * BFL 5 kap 5 §). "Booked" is the full is_transaction_booked predicate
 * (lib/transactions/is-booked.ts): journal_entry_id, a transaction_voucher_links
 * row (bulk-book samlingsverifikat), or an invoice_payments /
 * supplier_invoice_payments row (batch allocation), all three of which can
 * anchor a row to a posted verifikat while journal_entry_id stays NULL.
 * Document, receipt and invoice links are kept as well. The anchors are
 * re-read right before each delete so a row booked between the dry run and
 * the write is skipped, not deleted.
 *
 * Dry run by default, for every company or one:
 *
 *   npx tsx scripts/repair-svea-card-resources.ts --env .env.prod.local
 *   npx tsx scripts/repair-svea-card-resources.ts --env .env.prod.local --company <uuid>
 *
 * A write needs a typed confirmation that repeats the row count of the fresh
 * dry run it just printed:
 *
 *   npx tsx scripts/repair-svea-card-resources.ts --env .env.prod.local --execute
 *
 * Flags:
 *   --env <file>      env file to load (default .env.local; the banner prints
 *                     the URL so the target is never a guess)
 *   --company <uuid>  restrict to one company
 *   --bank <name>     bank_connections.bank_name to scan (default "Svea Bank")
 *   --execute         write; without it nothing is changed
 *   --verbose         print every row in the dry run
 *
 * Rollback: re-enable the account in the picker; the deleted rows come back
 * from the bank on the next sync (the external_ids are deterministic).
 */

import { config } from 'dotenv'
import { createInterface } from 'node:readline/promises'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isCardResource } from '@/extensions/general/enable-banking/lib/card-resource'
import type { StoredAccount } from '@/extensions/general/enable-banking/types'
import { isTransactionBooked } from '@/lib/transactions/is-booked'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const ENV_FILE = arg('env') ?? '.env.local'
config({ path: ENV_FILE })

const COMPANY_ID = arg('company') ?? null
const BANK_NAME = arg('bank') ?? 'Svea Bank'
const EXECUTE = flag('execute')
const VERBOSE = flag('verbose')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  console.error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${ENV_FILE}`)
  process.exit(1)
}
if (COMPANY_ID && !UUID_RE.test(COMPANY_ID)) {
  console.error('--company must be a uuid')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface ConnectionRow {
  id: string
  company_id: string
  status: string
  accounts_data: StoredAccount[] | null
}

interface FeedRow {
  id: string
  date: string
  amount: number | string
  description: string | null
  journal_entry_id: string | null
  document_id: string | null
  receipt_id: string | null
  invoice_id: string | null
  supplier_invoice_id: string | null
}

interface CardView {
  connectionId: string
  connectionStatus: string
  companyId: string
  uid: string
  name: string
  enabled: boolean
  alreadyFlagged: boolean
  scope: string
  deletable: FeedRow[]
  kept: FeedRow[]
  keepReasons: Map<string, string>
}

interface Anchors {
  payments: Array<{ transaction_id: string | null }>
  voucherLinks: Array<{ transaction_id: string }>
}

/**
 * The two anchors is_transaction_booked() consults besides journal_entry_id,
 * for a set of transaction ids. Read in chunks: PostgREST caps `in` lists.
 */
async function fetchAnchors(ids: string[]): Promise<Anchors> {
  const payments: Anchors['payments'] = []
  const voucherLinks: Anchors['voucherLinks'] = []
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const [inv, sup, links] = await Promise.all([
      supabase.from('invoice_payments').select('transaction_id').in('transaction_id', chunk),
      supabase.from('supplier_invoice_payments').select('transaction_id').in('transaction_id', chunk),
      supabase.from('transaction_voucher_links').select('transaction_id').in('transaction_id', chunk),
    ])
    for (const r of [inv, sup, links]) {
      if (r.error) throw new Error(`anchor lookup failed: ${r.error.message}`)
    }
    payments.push(...((inv.data ?? []) as Anchors['payments']))
    payments.push(...((sup.data ?? []) as Anchors['payments']))
    voucherLinks.push(...((links.data ?? []) as Anchors['voucherLinks']))
  }
  return { payments, voucherLinks }
}

function keepReason(row: FeedRow, anchors: Anchors): string | null {
  if (row.journal_entry_id) return 'booked'
  if (anchors.voucherLinks.some((l) => l.transaction_id === row.id)) return 'booked (voucher link)'
  if (anchors.payments.some((p) => p.transaction_id === row.id)) return 'booked (payment)'
  if (row.document_id) return 'document'
  if (row.receipt_id) return 'receipt'
  if (row.invoice_id) return 'invoice'
  if (row.supplier_invoice_id) return 'supplier_invoice'
  return null
}

async function fetchConnections(): Promise<ConnectionRow[]> {
  let q = supabase
    .from('bank_connections')
    .select('id, company_id, status, accounts_data')
    .eq('bank_name', BANK_NAME)
    .not('accounts_data', 'is', null)
    .order('created_at', { ascending: true })
  if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
  const { data, error } = await q
  if (error) throw new Error(`bank_connections lookup failed: ${error.message}`)
  return (data ?? []) as ConnectionRow[]
}

/** PostgREST caps a page at 1000 rows: read every page. */
async function fetchFeedRows(companyId: string, connectionId: string, scope: string): Promise<FeedRow[]> {
  const PAGE = 1000
  const rows: FeedRow[] = []
  for (let page = 0; ; page++) {
    const from = page * PAGE
    const { data, error } = await supabase
      .from('transactions')
      .select('id, date, amount, description, journal_entry_id, document_id, receipt_id, invoice_id, supplier_invoice_id')
      .eq('company_id', companyId)
      .eq('bank_connection_id', connectionId)
      .like('external_id', `eb_${scope}_%`)
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`transactions lookup failed: ${error.message}`)
    const chunk = (data ?? []) as FeedRow[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}

async function collect(): Promise<CardView[]> {
  const views: CardView[] = []
  for (const conn of await fetchConnections()) {
    for (const account of conn.accounts_data ?? []) {
      const cardResource = isCardResource({
        product: account.product,
        name: account.name,
        iban: account.iban,
      })
      if (!cardResource) continue
      // Same derivation as lib/sync.ts: the pinned scope, else the uid (a
      // card view never carries an IBAN).
      const scope = account.dedup_scope || account.uid
      const rows = await fetchFeedRows(conn.company_id, conn.id, scope)
      const anchors = await fetchAnchors(rows.map((r) => r.id))
      const deletable: FeedRow[] = []
      const kept: FeedRow[] = []
      const keepReasons = new Map<string, string>()
      for (const row of rows) {
        const reason = keepReason(row, anchors)
        if (reason) {
          kept.push(row)
          keepReasons.set(row.id, reason)
        } else {
          deletable.push(row)
        }
      }
      views.push({
        connectionId: conn.id,
        connectionStatus: conn.status,
        companyId: conn.company_id,
        uid: account.uid,
        name: account.name ?? account.product ?? '(unnamed)',
        enabled: account.enabled !== false,
        alreadyFlagged: account.card_resource === true && account.enabled === false,
        scope,
        deletable,
        kept,
        keepReasons,
      })
    }
  }
  return views
}

async function companyNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name')
      .in('id', unique.slice(i, i + 100))
    if (error) throw new Error(`companies lookup failed: ${error.message}`)
    for (const c of (data ?? []) as Array<{ id: string; name: string | null }>) {
      names.set(c.id, c.name ?? '')
    }
  }
  return names
}

function fmtRow(r: FeedRow): string {
  return `${r.id}  ${r.date}  ${String(r.amount).padStart(10)}  ${r.description ?? ''}`
}

async function confirm(expectedCount: number): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(
      `\nType "REPAIR ${expectedCount}" to disable the card views and delete these ${expectedCount} rows: `,
    )
    if (answer.trim() !== `REPAIR ${expectedCount}`) {
      console.log('Aborted, nothing written.')
      process.exit(2)
    }
  } finally {
    rl.close()
  }
}

async function disableCardView(view: CardView): Promise<void> {
  // Read-modify-write on the current accounts_data: a sync running in
  // between only stamps balances, and the flags set here are idempotent.
  const { data, error } = await supabase
    .from('bank_connections')
    .select('accounts_data')
    .eq('id', view.connectionId)
    .single()
  if (error || !data) throw new Error(`bank_connections read failed for ${view.connectionId}: ${error?.message}`)
  const accounts = ((data.accounts_data ?? []) as StoredAccount[]).map((a) =>
    a.uid === view.uid ? { ...a, enabled: false, card_resource: true } : a,
  )
  const { error: writeError } = await supabase
    .from('bank_connections')
    .update({ accounts_data: accounts })
    .eq('id', view.connectionId)
  if (writeError) throw new Error(`bank_connections write failed for ${view.connectionId}: ${writeError.message}`)

  const { error: cashError } = await supabase
    .from('cash_accounts')
    .update({ enabled: false })
    .eq('company_id', view.companyId)
    .eq('bank_connection_id', view.connectionId)
    .eq('external_uid', view.uid)
  if (cashError) throw new Error(`cash_accounts write failed for ${view.connectionId}: ${cashError.message}`)
}

async function deleteRows(view: CardView): Promise<number> {
  let deleted = 0
  const ids = view.deletable.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 200) {
    const candidates = ids.slice(i, i + 200)
    // Re-read the anchors right before the write: a row bulk-booked or
    // allocated between the dry run and now must be skipped, and the DELETE
    // below can only express the journal_entry_id half of the predicate.
    const anchors = await fetchAnchors(candidates)
    const chunk = candidates.filter((id) =>
      !isTransactionBooked({ id, journal_entry_id: null }, anchors.payments, anchors.voucherLinks),
    )
    if (chunk.length < candidates.length) {
      console.log(`  ${view.companyId}  ${candidates.length - chunk.length} rows booked since the dry run: skipped`)
    }
    if (chunk.length === 0) continue
    const { data, error } = await supabase
      .from('transactions')
      .delete()
      .eq('company_id', view.companyId)
      .eq('bank_connection_id', view.connectionId)
      .is('journal_entry_id', null)
      .in('id', chunk)
      .select('id')
    if (error) throw new Error(`transactions delete failed for ${view.connectionId}: ${error.message}`)
    deleted += (data ?? []).length
  }
  return deleted
}

async function main() {
  console.log('---------------------------------------------------------')
  console.log(`Card view repair for ${BANK_NAME} (issue #2564)`)
  console.log('---------------------------------------------------------')
  console.log('Env file    :', ENV_FILE)
  console.log('Supabase URL:', supabaseUrl)
  console.log('Company     :', COMPANY_ID ?? '(all)')
  console.log('Mode        :', EXECUTE ? 'EXECUTE (writes)' : 'DRY RUN (no writes)')
  console.log('---------------------------------------------------------')

  const views = await collect()
  const names = await companyNames(views.map((v) => v.companyId))
  const pending = views.filter((v) => !v.alreadyFlagged || v.deletable.length > 0)
  const totalDeletable = pending.reduce((n, v) => n + v.deletable.length, 0)
  const totalKept = views.reduce((n, v) => n + v.kept.length, 0)

  console.log(`\n${views.length} card views on ${new Set(views.map((v) => v.connectionId)).size} connections`)
  for (const v of views) {
    console.log(
      `  ${v.companyId}  ${v.connectionStatus.padEnd(17)} ${v.enabled ? 'ENABLED ' : 'disabled'}  ` +
        `${String(v.deletable.length).padStart(4)} to delete  ${String(v.kept.length).padStart(3)} kept  ` +
        `${v.name}  ${names.get(v.companyId) ?? ''}`,
    )
    if (VERBOSE) for (const r of v.deletable) console.log(`      del  ${fmtRow(r)}`)
    for (const r of v.kept) console.log(`      KEEP ${v.keepReasons.get(r.id)}  ${fmtRow(r)}`)
  }
  console.log(`\n${totalDeletable} rows to delete, ${totalKept} rows kept for a human decision.`)

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to write.')
    return
  }
  if (pending.length === 0) {
    console.log('\nNothing to repair.')
    return
  }

  await confirm(totalDeletable)

  let deleted = 0
  for (const v of pending) {
    await disableCardView(v)
    deleted += await deleteRows(v)
    console.log(`  ${v.companyId}  ${v.uid}  disabled, ${v.deletable.length} rows deleted`)
  }
  console.log(`\nDone: ${pending.length} card views disabled, ${deleted} rows deleted.`)
  if (deleted !== totalDeletable) {
    console.log(`Note: ${totalDeletable - deleted} rows were not deleted (booked or gone between dry run and write).`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
