'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useTranslations } from 'next-intl'
import { getErrorMessage } from '@/lib/errors/get-error-message'
import { invalidateReferenceData } from '@/lib/reference-data/invalidate'
import { useCompanySettings } from '@/components/settings/useSettings'
import { BRANCH_PROVIDERS } from '@/lib/onboarding-journey/branch'
import { defaultOpeningBalanceSeries } from '@/lib/import/opening-balance-defaults'
import type { AccountMapping, ImportPreview, SIEAccount, SIEHeader } from '@/lib/import/types'
import { InkText } from '@/components/onboarding/journey/ink'
import type { TheaterApi } from '../engines/theater-engine'
import { Theater, type TheaterLine, type TheaterModelInput } from '../ui/Theater'
import { Facts, Wait } from '../ui/Verdicts'
import { InsightPanel } from '../ui/InsightPanel'
import { Pill, Pills } from '../ui/Pills'
import { OptRow, OptRows, Sentence, Switch } from '../ui/Sentence'
import {
  openProviderWindow, pointWindow, providerAccept, providerConnect, providerMigrate, providerSubmitToken, useProviderMessage,
} from '../lib/provider'
import type { BooksCtx } from '../context'

const THEATER_MAX_FILE_BYTES = 8 * 1024 * 1024

interface ParsedFile {
  header: SIEHeader
  stats: { totalAccounts: number; totalVouchers: number; fiscalYearStart: string | null; fiscalYearEnd: string | null }
  accounts: SIEAccount[]
  mappings: AccountMapping[]
  preview: ImportPreview
}

interface FileEntry {
  file: File
  status: 'parsing' | 'ready' | 'dup' | 'error'
  parsed?: ParsedFile
  error?: string
  dupImportId?: string
}

type Phase = 'drop' | 'importing' | 'imported'
type Reg = null | 'pick' | 'card' | 'connecting' | 'token' | 'running' | 'done' | 'skipped'

function yearsOf(files: FileEntry[]): string[] {
  const set = new Set<string>()
  for (const f of files) for (const y of f.parsed?.header.fiscalYears ?? []) set.add(y.start)
  return Array.from(set)
}

/**
 * Ladda upp SIE-filen: drop one or more SIE 4 files, the facts ink in, one
 * sentence says what will be read with Ändra behind it, then the theater
 * runs while the server writes, oldest year first. Unmapped accounts are
 * created from the file, no mapping page, no VAT review gate: momskoder
 * for revenue accounts are set on the genomlysning instead. Then the
 * registers: kunder, leverantörer and fakturor from the old system.
 */
export function SieStep({ ctx }: { ctx: BooksCtx }) {
  const t = useTranslations('books')
  const { state, dispatch, flags, loadFindings } = ctx
  const { settings } = useCompanySettings()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [over, setOver] = useState(false)
  const [optsOpen, setOptsOpen] = useState(false)
  const [ibOn, setIbOn] = useState<boolean | null>(null)
  const [namesOn, setNamesOn] = useState(true)
  const [phase, setPhase] = useState<Phase>('drop')
  const [model, setModel] = useState<TheaterModelInput | null>(null)
  const [shown, setShown] = useState(0)
  const [tick, setTick] = useState(0)
  const [written, setWritten] = useState(0)
  const [fileIdx, setFileIdx] = useState(0)
  const [created, setCreated] = useState(0)
  const [importError, setImportError] = useState<string | null>(null)
  const [reg, setReg] = useState<Reg>(null)
  const [regProvider, setRegProvider] = useState<string | null>(state.provider)
  const [regShown, setRegShown] = useState(0)
  const [regTick, setRegTick] = useState(0)
  const [regCounts, setRegCounts] = useState<{ customers: number; suppliers: number; invoices: number; linked: number } | null>(null)
  const [regError, setRegError] = useState<string | null>(null)
  const [consentId, setConsentId] = useState<string | null>(null)
  const [tokenA, setTokenA] = useState('')
  const [tokenB, setTokenB] = useState('')
  const apiRef = useRef<TheaterApi | null>(null)
  const timers = useRef<number[]>([])
  const at = useCallback((ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }, [])
  useEffect(() => {
    const list = timers.current
    return () => list.forEach((id) => window.clearTimeout(id))
  }, [])

  const provName = useMemo(() => BRANCH_PROVIDERS.find((p) => p.id === (regProvider ?? state.provider))?.name ?? null, [regProvider, state.provider])
  const sieFirst = !!state.provider

  /* ── parse ───────────────────────────────────────────────────────── */
  const parseOne = useCallback(async (file: File, index: number) => {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/import/sie/parse', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        const code = data?.error?.code as string | undefined
        const message = getErrorMessage(data)
        const importId = data?.error?.details?.importId as string | undefined
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: code === 'SIE_DUPLICATE_FILE' || code === 'SIE_DUPLICATE_PERIOD' ? 'dup' : 'error', error: message, dupImportId: importId } : f)))
        return
      }
      const parsed: ParsedFile = { header: data.parsed.header, stats: data.parsed.stats, accounts: data.parsed.accounts, mappings: data.mappings, preview: data.preview }
      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'ready', parsed } : f)))
    } catch {
      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'error', error: t('sie_network') } : f)))
    }
  }, [t])

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => /\.(se|sie)$/i.test(f.name) || f.size > 0)
    if (incoming.length === 0) return
    setFiles((prev) => {
      const start = prev.length
      const next = [...prev, ...incoming.map((file) => ({ file, status: 'parsing' as const }))]
      incoming.forEach((file, i) => void parseOne(file, start + i))
      return next
    })
  }

  async function replaceDup(index: number) {
    const f = files[index]
    if (!f.dupImportId) return
    setFiles((prev) => prev.map((x, i) => (i === index ? { ...x, status: 'parsing', error: undefined } : x)))
    try {
      const res = await fetch(`/api/import/sie/${f.dupImportId}/replace`, { method: 'POST' })
      if (!res.ok) throw new Error(getErrorMessage(await res.json().catch(() => ({}))))
      await parseOne(f.file, index)
    } catch (err) {
      setFiles((prev) => prev.map((x, i) => (i === index ? { ...x, status: 'error', error: err instanceof Error ? err.message : t('sie_network') } : x)))
    }
  }

  const ready = useMemo(() => files.filter((f) => f.status === 'ready' && f.parsed), [files])
  const ordered = useMemo(() => [...ready].sort((a, b) => (a.parsed!.stats.fiscalYearStart ?? '').localeCompare(b.parsed!.stats.fiscalYearStart ?? '')), [ready])
  const parsing = files.some((f) => f.status === 'parsing')
  const company = ready[0]?.parsed?.header.companyName ?? null
  const nYears = yearsOf(ready).length || ready.length
  const totalVouchers = ready.reduce((s, f) => s + (f.parsed?.stats.totalVouchers ?? 0), 0)
  const totalAccounts = ready.reduce((s, f) => s + (f.parsed?.stats.totalAccounts ?? 0), 0)
  const unmapped = useMemo(() => {
    const seen = new Set<string>()
    const out: SIEAccount[] = []
    for (const f of ready) for (const m of f.parsed!.mappings) {
      if (!m.targetAccount && !seen.has(m.sourceAccount)) {
        seen.add(m.sourceAccount)
        const acc = f.parsed!.accounts.find((a) => a.number === m.sourceAccount)
        out.push({ number: m.sourceAccount, name: acc?.name ?? m.sourceName })
      }
    }
    return out
  }, [ready])
  const hasIb = ready.some((f) => (f.parsed?.preview.openingBalanceTotal ?? 0) > 0)
  const ib = ibOn ?? hasIb
  const ibAmount = ready.reduce((s, f) => s + (f.parsed?.preview.openingBalanceTotal ?? 0), 0)

  const facts = useMemo(() => {
    if (ready.length === 0) return []
    const list: { text: string; warn?: boolean }[] = []
    if (company) list.push({ text: company })
    list.push({ text: t('fact_years', { count: nYears }) })
    list.push({ text: t('fact_vouchers', { count: totalVouchers }) })
    list.push(unmapped.length === 0 ? { text: t('fact_accounts_known', { count: totalAccounts }) } : { text: t('fact_accounts_new', { count: totalAccounts, created: unmapped.length }) })
    return list
  }, [ready.length, company, nYears, totalVouchers, totalAccounts, unmapped.length, t])

  /* ── import ──────────────────────────────────────────────────────── */
  const lines: TheaterLine[] = [
    { title: t('th_read', { company: company ?? '' }), sub: t('fact_years', { count: nYears }), tone: 'ok' },
    { title: t('th_map'), sub: unmapped.length ? t('th_map_sub_new', { count: totalAccounts, created: created || unmapped.length }) : t('th_map_sub_known', { count: totalAccounts }) },
    { title: t('th_write'), sub: ordered.length > 1 ? t('th_write_sub_files', { i: Math.min(fileIdx + 1, ordered.length), n: ordered.length, tick: tick.toLocaleString('sv-SE'), total: totalVouchers.toLocaleString('sv-SE') }) : t('th_write_sub', { tick: tick.toLocaleString('sv-SE'), total: totalVouchers.toLocaleString('sv-SE') }) },
    { title: t('th_parties'), sub: model ? t('th_parties_sub', { count: model.counterparties.length }) : '' },
    { title: t('th_balance'), sub: importError ?? t('th_balance_sub'), tone: importError ? 'err' : 'ok' },
  ]

  async function buildModel(file: File) {
    if (file.size > THEATER_MAX_FILE_BYTES) return null
    try {
      const [{ parseSIEFile, detectEncoding, decodeBuffer }, { buildTheaterModel }] = await Promise.all([
        import('@/lib/import/sie-parser'),
        import('@/lib/import/theater-model'),
      ])
      const buffer = await file.arrayBuffer()
      const parsed = parseSIEFile(decodeBuffer(buffer, detectEncoding(buffer)))
      const m = buildTheaterModel(parsed)
      return {
        company: m.companyName || company || '',
        accounts: m.accounts.map((a) => ({ number: a.number, name: a.name, weight: a.weight })),
        counterparties: m.counterparties.map((c) => ({ name: c.name, account: c.account, weight: c.weight })),
      } satisfies TheaterModelInput
    } catch {
      return null
    }
  }

  async function runImport() {
    if (ordered.length === 0 || parsing) return
    setPhase('importing')
    setImportError(null)
    setOptsOpen(false)
    dispatch({ type: 'SET_WORKING', working: true })
    const m = (await buildModel(ordered[0].file)) ?? { company: company ?? '', accounts: [], counterparties: [] }
    setModel(m)
    at(300, () => setShown(1))
    at(1400, () => { setShown(2); apiRef.current?.spawnAccounts() })
    const voucherSeries = settings?.default_voucher_series || 'A'
    try {
      // Unmapped accounts get created from the file; the mapping then points them at themselves.
      if (unmapped.length > 0) {
        const res = await fetch('/api/import/sie/create-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accounts: unmapped }),
        })
        if (!res.ok) throw new Error(getErrorMessage(await res.json().catch(() => ({}))))
        setCreated(unmapped.length)
        void invalidateReferenceData('ref:accounts')
      }
      await new Promise((r) => at(2400, () => r(null)))
      setShown(3)
      apiRef.current?.feedVouchers(Math.min(24000, Math.max(2600, totalVouchers * 4)), totalVouchers)
      let writtenSoFar = 0
      const importedAccounts: string[] = []
      for (let i = 0; i < ordered.length; i++) {
        setFileIdx(i)
        const f = ordered[i]
        const p = f.parsed!
        const mappings = p.mappings.map((mp) => (mp.targetAccount ? mp : { ...mp, targetAccount: mp.sourceAccount, targetName: mp.sourceName, matchType: 'exact' as const, confidence: 1, isOverride: true }))
        const fd = new FormData()
        fd.append('file', f.file)
        fd.append('mappings', JSON.stringify(mappings))
        fd.append('options', JSON.stringify({
          createFiscalPeriod: true,
          importOpeningBalances: ib,
          importTransactions: true,
          updateAccountNames: namesOn,
          voucherSeries,
          openingBalanceSeries: defaultOpeningBalanceSeries([...(p.preview.voucherSeriesInFile ?? []), voucherSeries]),
          markImportedNoDocRequired: true,
        }))
        const res = await fetch('/api/import/sie/execute', { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({}))
        const result = (res.ok ? data.result : data?.error?.details?.result) as { success?: boolean; journalEntriesCreated?: number; errors?: string[] } | undefined
        if (!res.ok && !result) throw new Error(getErrorMessage(data))
        if (!result?.success) throw new Error(result?.errors?.length ? result.errors.join(' ') : getErrorMessage(data))
        writtenSoFar += result.journalEntriesCreated ?? 0
        setWritten(writtenSoFar)
        for (const a of p.accounts) importedAccounts.push(a.number)
        void invalidateReferenceData(['ref:accounts', 'ref:fiscal-periods'])
      }
      apiRef.current?.pulse()
      setTick(totalVouchers)
      setShown(4)
      apiRef.current?.spawnCounterparties()
      await new Promise((r) => at(1300, () => r(null)))
      setShown(5)
      dispatch({ type: 'IMPORTED', accounts: importedAccounts })
      void loadFindings()
      await new Promise((r) => at(900, () => r(null)))
      setPhase('imported')
      dispatch({ type: 'SET_WORKING', working: false })
      setReg(sieFirst ? 'card' : 'pick')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('sie_failed'))
      setShown(5)
      setPhase('imported')
      dispatch({ type: 'SET_WORKING', working: false })
    }
  }

  /* ── registers: kunder, leverantörer, fakturor from the old system ── */
  const regLines: TheaterLine[] = [
    { title: t('reg_login', { provider: provName ?? t('reg_source') }), sub: t('reg_connected'), tone: 'ok' },
    { title: t('reg_customers'), sub: regCounts ? t('reg_count', { count: regCounts.customers }) : '' },
    { title: t('reg_suppliers'), sub: regCounts ? t('reg_count', { count: regCounts.suppliers }) : '' },
    { title: t('reg_invoices'), sub: regCounts ? t('reg_invoices_sub', { tick: regTick, total: regCounts.invoices }) : '' },
    { title: t('reg_link'), sub: regError ?? (regCounts ? t('reg_link_sub', { count: regCounts.linked }) : ''), tone: regError ? 'err' : 'ok' },
  ]

  const runRegisters = useCallback(async (cId: string) => {
    setReg('running')
    setRegError(null)
    setRegShown(1)
    dispatch({ type: 'SET_WORKING', working: true })
    try {
      const results = await providerMigrate(cId, { importCustomers: true, importSuppliers: true, importSalesInvoices: true, importSupplierInvoices: true, importAssets: false }, (_step, progress) => {
        setRegShown(progress < 20 ? 2 : progress < 40 ? 3 : progress < 90 ? 4 : 5)
      })
      const counts = {
        customers: results.customers?.imported ?? 0,
        suppliers: results.suppliers?.imported ?? 0,
        invoices: (results.salesInvoices?.imported ?? 0) + (results.supplierInvoices?.imported ?? 0),
        linked: (results.salesInvoices?.imported ?? 0) + (results.supplierInvoices?.imported ?? 0),
      }
      setRegCounts(counts)
      setRegShown(4)
      await new Promise<void>((resolve) => {
        const api = apiRef.current
        if (!api || counts.invoices === 0) { setRegTick(counts.invoices); resolve(); return }
        api.registerStage({
          source: provName ?? t('reg_source'),
          ms: Math.min(6000, Math.max(2200, counts.invoices * 25)),
          invoices: [['1510', results.salesInvoices?.imported ?? 0], ['2440', results.supplierInvoices?.imported ?? 0]],
          onProgress: (r) => { setRegTick(r.matched + r.review); if (r.done) resolve() },
        })
        at(8000, () => resolve())
      })
      setRegShown(5)
      if (results.stepErrors?.length) setRegError(results.stepErrors.map((e) => e.message).join(' '))
      await providerAccept(cId)
      setReg('done')
      void loadFindings()
    } catch (err) {
      setRegError(err instanceof Error ? err.message : t('reg_failed'))
      setRegShown(5)
      setReg('done')
    } finally {
      dispatch({ type: 'SET_WORKING', working: false })
    }
  }, [at, dispatch, loadFindings, provName, t])

  useProviderMessage(
    (cId) => { setConsentId(cId); void runRegisters(cId) },
    (reason) => { setRegError(reason); setReg(sieFirst ? 'card' : 'pick') },
  )

  async function connectRegisters(providerId: string) {
    setRegProvider(providerId)
    setRegError(null)
    setReg('connecting')
    const popup = openProviderWindow()
    try {
      const r = await providerConnect(providerId)
      setConsentId(r.consentId)
      if (r.alreadyConnected) { popup?.close(); void runRegisters(r.consentId); return }
      if (r.authType === 'oauth' && r.authUrl) { pointWindow(popup, r.authUrl); return }
      popup?.close()
      setReg('token')
    } catch (err) {
      popup?.close()
      setRegError(err instanceof Error ? err.message : t('reg_failed'))
      setReg(sieFirst ? 'card' : 'pick')
    }
  }

  async function submitToken() {
    if (!consentId || !regProvider) return
    setReg('connecting')
    try {
      await providerSubmitToken(consentId, regProvider, tokenA, tokenB)
      void runRegisters(consentId)
    } catch (err) {
      setRegError(err instanceof Error ? err.message : t('reg_failed'))
      setReg('token')
    }
  }

  /* ── render ──────────────────────────────────────────────────────── */
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  const showDrop = phase === 'drop'
  const regBusy = reg === 'running'
  const canContinue = phase === 'imported' && !importError && (reg === 'done' || reg === 'skipped')

  return (
    <div className="bks-host">
      <div className="jny-qstep" style={{ textAlign: 'center' }}>
        <h1 className="jny-qtitle"><InkText text={t('sie_title')} /></h1>
        <p className="jny-qsub">{sieFirst ? t('sie_sub_first', { provider: provName ?? '' }) : t('sie_sub')}</p>
      </div>

      {showDrop ? (
        <>
          <input ref={inputRef} type="file" accept=".se,.sie" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
          {files.length === 0 ? (
            <button
              type="button"
              className={`drop1${over ? ' is-over' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <p className="big">{t('sie_drop_title')}</p>
              <p className="s">{t('sie_drop_sub')}</p>
            </button>
          ) : (
            <div className="drop1 is-file" onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
              {files.map((f, i) => (
                <p key={`${f.file.name}-${i}`} className="file">
                  {f.file.name}
                  {f.status === 'parsing' ? <span className="bks-f" style={{ marginLeft: 8, color: 'hsl(var(--muted-foreground))' }}>{t('sie_reading')}</span> : null}
                  {f.status === 'dup' ? (
                    <span className="bks-f is-warn" style={{ marginLeft: 8 }}>
                      {f.error}{' '}
                      {f.dupImportId ? <button type="button" className="imp-change" onClick={() => void replaceDup(i)}>{t('sie_replace')}</button> : null}
                    </span>
                  ) : null}
                  {f.status === 'error' ? <span className="bks-f is-warn" style={{ marginLeft: 8 }}>{f.error}</span> : null}
                </p>
              ))}
              {facts.length ? <Facts facts={facts} /> : null}
            </div>
          )}
          {ready.length > 0 ? (
            <>
              <Sentence open={optsOpen} onToggle={() => setOptsOpen((v) => !v)} changeLabel={t('change')} closeLabel={t('close')}>
                {t.rich('sie_sentence', { years: nYears, count: totalVouchers.toLocaleString('sv-SE'), ib: ib ? 'yes' : 'no', b: (c) => <b>{c}</b> })}
              </Sentence>
              {optsOpen ? (
                <OptRows>
                  <OptRow
                    name={t('opt_ib')}
                    desc={hasIb ? t('opt_ib_desc', { amount: ibAmount.toLocaleString('sv-SE') }) : t('opt_ib_none')}
                    off={!ib}
                    locked={!hasIb}
                    control={<Switch on={ib} onToggle={() => setIbOn(!ib)} label={t('opt_ib')} locked={!hasIb} />}
                  />
                  <OptRow
                    name={t('opt_names')}
                    desc={t('opt_names_desc')}
                    off={!namesOn}
                    control={<Switch on={namesOn} onToggle={() => setNamesOn((v) => !v)} label={t('opt_names')} />}
                  />
                </OptRows>
              ) : null}
            </>
          ) : null}
          <div className="jny-qactions">
            {files.length > 0 ? (
              <button type="button" className="jny-btn-quiet" onClick={() => { setFiles([]); setOptsOpen(false) }}>{t('sie_other_file')}</button>
            ) : (
              <button type="button" className="jny-btn-quiet" onClick={() => dispatch({ type: 'BACK_TO_SOURCE' })}>‹ {t('back')}</button>
            )}
            {files.length > 0 ? (
              <button type="button" className="jny-btn-quiet" onClick={() => inputRef.current?.click()}>{t('sie_add_file')}</button>
            ) : null}
            {ready.length > 0 && !parsing ? (
              <button type="button" className="jny-btn" onClick={() => void runImport()}>{t('sie_import', { count: nYears })}</button>
            ) : null}
          </div>
        </>
      ) : null}

      {phase !== 'drop' ? (
        <Theater
          model={model}
          lines={regBusy || reg === 'done' ? regLines : lines}
          shown={regBusy || reg === 'done' ? regShown : shown}
          settled={phase === 'imported' && !regBusy}
          hold={phase === 'importing' ? t('sie_hold_open') : null}
          onApi={(api) => { apiRef.current = api }}
          onCount={(n) => setTick(Math.min(n, totalVouchers || n))}
          groupLabels={{ tillgangar: t('grp_assets'), skulder: t('grp_liabilities'), intakter: t('grp_revenue'), kostnader: t('grp_costs') }}
          reviewLabel={t('grp_review')}
        />
      ) : null}
      {phase === 'imported' && !importError && reg === 'card' ? (
        <div className="reg" style={{ marginTop: 18 }}>
          <button type="button" className="drop1" onClick={() => state.provider && void connectRegisters(state.provider)}>
            <p className="big">{t('reg_card_title', { provider: provName ?? '' })}</p>
            <p className="s">{t('reg_card_sub')}</p>
          </button>
          {regError ? <p className="bks-err">{regError}</p> : null}
          <div className="jny-qactions"><button type="button" className="jny-btn-quiet" onClick={() => setReg('skipped')}>{t('reg_skip')}</button></div>
        </div>
      ) : null}
      {phase === 'imported' && !importError && reg === 'pick' ? (
        <div className="reg" style={{ marginTop: 18 }}>
          <p className="imp-line" style={{ marginTop: 0 }}>{t.rich('reg_pick', { b: (c) => <b>{c}</b> })}</p>
          <Pills className="mt-3.5">
            {BRANCH_PROVIDERS.map((p, i) => (
              <Pill key={p.id} index={i} logo={p.logo} onClick={() => void connectRegisters(p.id)}>{p.name}</Pill>
            ))}
          </Pills>
          {regError ? <p className="bks-err">{regError}</p> : null}
          <div className="jny-qactions"><button type="button" className="jny-btn-quiet" onClick={() => setReg('skipped')}>{t('reg_skip')}</button></div>
        </div>
      ) : null}
      {reg === 'connecting' ? <Wait text={t('reg_connecting', { provider: provName ?? '' })} height={96} /> : null}
      {reg === 'token' ? (
        <div className="tokfields">
          <input type="text" value={tokenB} onChange={(e) => setTokenB(e.target.value)} placeholder={t('tok_company', { provider: provName ?? '' })} />
          <input type="password" value={tokenA} onChange={(e) => setTokenA(e.target.value)} placeholder={t('tok_token', { provider: provName ?? '' })} autoComplete="off" />
          {regError ? <p className="bks-err">{regError}</p> : null}
          <div className="jny-qactions" style={{ marginTop: 12 }}>
            <button type="button" className="jny-btn-quiet" onClick={() => setReg(sieFirst ? 'card' : 'pick')}>‹ {t('back')}</button>
            <button type="button" className="jny-btn" disabled={!tokenA} onClick={() => void submitToken()}>{t('tok_connect')}</button>
          </div>
        </div>
      ) : null}

      {canContinue ? (
        <div style={{ marginTop: 22 }}>
          <InsightPanel ctx={ctx} base={300} />
        </div>
      ) : null}

      {phase === 'imported' ? (
        <div className="jny-qactions">
          {canContinue ? (
            <button type="button" className="jny-btn" onClick={() => dispatch({ type: 'AFTER_BOOKS', flags })}>
              {flags.hasBanking ? t('to_bank') : flags.hasSkatteverket ? t('to_skv') : t('to_done')}
            </button>
          ) : null}
          {importError ? (
            <>
              <button type="button" className="jny-btn-quiet" onClick={() => { setPhase('drop'); setFiles([]); setModel(null); setShown(0); setTick(0); setImportError(null) }}>{t('sie_other_file')}</button>
              {written > 0 ? (
                <button type="button" className="jny-btn" onClick={() => { dispatch({ type: 'IMPORTED' }); dispatch({ type: 'TO_INSIGHT' }) }}>{t('to_insight')}</button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
