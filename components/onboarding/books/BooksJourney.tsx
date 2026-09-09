'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'
import { useBranding } from '@/lib/branding/brand-context'
import { useFormat } from '@/lib/hooks/use-format'
import { formatCurrency } from '@/lib/utils'
import { getSettingsPanel } from '@/lib/extensions/settings-panel-registry'
import { BRANCH_PROVIDERS } from '@/lib/onboarding-journey/branch'
import type { BooksFindings } from '@/lib/onboarding/findings'
import type { InitialSetupPath } from '@/types'
import SIEImportWizard from '@/components/import/SIEImportWizard'
import JourneyOrb, { type OrbState } from '@/components/onboarding/journey/JourneyOrb'
import JourneyTrack from '@/components/onboarding/journey/JourneyTrack'
import Question from '@/components/onboarding/journey/Question'
import { InkText } from '@/components/onboarding/journey/ink'
import '@/components/onboarding/journey/journey.css'

const MigrationWorkspace = dynamic(
  () => import('@/components/extensions/general/ArcimMigrationWorkspace'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center gap-3 p-6 text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    ),
  },
)

const BankingPanel = getSettingsPanel('enable-banking')

type Step = 'source' | 'sie' | 'provider' | 'insight' | 'bank' | 'skv' | 'done'
type Station = 0 | 1 | 2 | 3
const STATION_OF: Record<Step, Station> = {
  source: 0,
  sie: 0,
  provider: 0,
  insight: 0,
  bank: 1,
  skv: 2,
  done: 3,
}
const STATION_FRACS = [0.07, 0.36, 0.64, 0.93]

interface BooksJourneyProps {
  userId: string
  initialStation: string | null
  initialProvider: string | null
  /** The provider OAuth round trip landed here (the gate rewrote /import). */
  landedFromProvider: boolean
  hasMigration: boolean
  hasBanking: boolean
  hasSkatteverket: boolean
}

interface Verdict {
  tone: 'ok' | 'warn' | 'info'
  text: string
  href?: string
}

/**
 * Act two of the onboarding journey (issue #2438): Böckerna, Banken,
 * Skatteverket, Klart on the journey rail. Every station ends on a verdict
 * line computed from the company's own data (GET /api/onboarding/findings):
 * the answer the user did not have before the station ran. Bank and
 * Skatteverket are recommended, never mandatory: skipping is a quiet link
 * that says what it costs. Leaving the act clears the first-session gate.
 */
export default function BooksJourney({
  userId,
  initialStation,
  initialProvider,
  landedFromProvider,
  hasMigration,
  hasBanking,
  hasSkatteverket,
}: BooksJourneyProps) {
  const t = useTranslations('books')
  const router = useRouter()
  const { company } = useCompany()
  const { appName } = useBranding()
  const { formatDateLong } = useFormat()

  const [step, setStep] = useState<Step>(() => {
    if (initialStation === 'bank') return 'bank'
    if (initialStation === 'skv') return 'skv'
    if (initialStation === 'books' && (landedFromProvider || initialProvider)) return 'provider'
    return 'source'
  })
  const [provider, setProvider] = useState<string | null>(initialProvider)
  const [sourcePath, setSourcePath] = useState<InitialSetupPath | null>(
    landedFromProvider || initialProvider ? 'migration' : null,
  )
  const [imported, setImported] = useState(false)
  const [findings, setFindings] = useState<BooksFindings | null>(null)
  const [loadingFindings, setLoadingFindings] = useState(false)
  const [skvSaldo, setSkvSaldo] = useState<number | null>(null)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [bankSkipped, setBankSkipped] = useState(false)
  const [skvSkipped, setSkvSkipped] = useState(false)

  const station = STATION_OF[step]

  /* ── findings: fetched whenever a station needs its verdict ─────── */
  const loadFindings = useCallback(async () => {
    setLoadingFindings(true)
    try {
      const res = await fetch('/api/onboarding/findings')
      if (res.ok) {
        const json = (await res.json()) as { data: BooksFindings }
        setFindings(json.data)
      }
    } catch {
      // The verdict line simply stays empty; the station still works.
    } finally {
      setLoadingFindings(false)
    }
  }, [])

  useEffect(() => {
    if (step === 'insight' || step === 'bank' || step === 'skv' || step === 'done') void loadFindings()
  }, [step, loadFindings])

  // The bank connection lands back here through a redirect: keep asking
  // until the connection row exists so the verdict appears without a reload.
  useEffect(() => {
    if (step !== 'bank' || findings?.bank.connected) return
    const id = window.setInterval(() => void loadFindings(), 4000)
    return () => window.clearInterval(id)
  }, [step, findings?.bank.connected, loadFindings])

  useEffect(() => {
    if (step !== 'skv' || !findings?.skv.connected || skvSaldo !== null) return
    fetch('/api/extensions/ext/skatteverket/skattekonto/saldo')
      .then(async (res) => {
        if (!res.ok) return
        const json = (await res.json()) as { data: { saldoSkatteverket: number } | null }
        if (json.data) setSkvSaldo(json.data.saldoSkatteverket)
      })
      .catch(() => {})
  }, [step, findings?.skv.connected, skvSaldo])

  /* ── leaving the act ────────────────────────────────────────────── */
  const leave = useCallback(
    async (outcome: 'done' | 'skipped') => {
      if (leaving) return
      setLeaving(true)
      try {
        await fetch('/api/onboarding/books/exit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sourcePath ? { outcome, path: sourcePath } : { outcome }),
        })
      } catch {
        // The cookie expires on its own; the dashboard opens either way.
      }
      router.push('/')
      router.refresh()
    },
    [leaving, router, sourcePath],
  )

  /* ── derived ────────────────────────────────────────────────────── */
  const orbState: OrbState =
    step === 'done' ? 'check' : step === 'sie' || step === 'provider' ? 'working' : 'listening'

  const stations = useMemo(() => {
    const books = findings && findings.books.entries > 0
      ? t('answer_entries', { count: findings.books.entries })
      : sourcePath === 'fresh'
        ? t('answer_fresh')
        : null
    const bank = findings?.bank.connected
      ? findings.bank.bankName ?? t('answer_connected')
      : bankSkipped
        ? t('answer_skipped')
        : null
    const skv = findings?.skv.connected ? t('answer_connected') : skvSkipped ? t('answer_skipped') : null
    return [
      { label: t('station_books'), answer: station > 0 ? books : null },
      { label: t('station_bank'), answer: station > 1 ? bank : null },
      { label: t('station_skv'), answer: station > 2 ? skv : null },
      { label: t('station_done') },
    ]
  }, [findings, sourcePath, bankSkipped, skvSkipped, station, t])

  const insightVerdicts = useMemo<Verdict[]>(() => {
    if (!findings) return []
    const b = findings.books
    const out: Verdict[] = []
    out.push({
      tone: b.entries > 0 ? 'ok' : 'warn',
      text: t('v_entries', { count: b.entries, years: b.periods.length }),
    })
    const broken = b.periods.filter((p) => p.continuityVerified === false)
    if (broken.length > 0) {
      out.push({ tone: 'warn', text: t('v_continuity_broken', { name: broken[0].name }), href: '/bookkeeping' })
    } else if (b.periods.some((p) => p.continuityVerified === true)) {
      out.push({ tone: 'ok', text: t('v_continuity_ok') })
    }
    if (b.revenue !== null && b.result !== null && b.periodName) {
      out.push({
        tone: 'ok',
        text: t('v_result', {
          period: b.periodName,
          revenue: formatCurrency(b.revenue),
          result: formatCurrency(b.result),
        }),
      })
    }
    if (b.overdueInvoices > 0) {
      out.push({ tone: 'warn', text: t('v_overdue', { count: b.overdueInvoices }), href: '/invoices?status=overdue' })
    }
    if (b.vatBalance !== null && Math.abs(b.vatBalance) >= 1) {
      out.push({
        tone: 'info',
        text: b.vatBalance > 0
          ? t('v_vat_owed', { amount: formatCurrency(b.vatBalance) })
          : t('v_vat_receivable', { amount: formatCurrency(-b.vatBalance) }),
        href: '/reports/vat',
      })
    }
    if (b.uncategorizedTransactions > 0) {
      out.push({
        tone: 'warn',
        text: t('v_uncategorized', { count: b.uncategorizedTransactions }),
        href: '/transactions',
      })
    }
    return out
  }, [findings, t])

  const bankVerdicts = useMemo<Verdict[]>(() => {
    if (!findings?.bank.connected) return []
    const k = findings.bank
    const out: Verdict[] = [
      { tone: 'ok', text: t('v_bank_connected', { bank: k.bankName ?? t('answer_connected'), count: k.transactions }) },
    ]
    if (k.sweep) {
      out.push({ tone: 'ok', text: t('v_bank_matched', { count: k.sweep.auto_linked }) })
      if (k.sweep.unmatched + k.sweep.suggested > 0) {
        out.push({
          tone: 'warn',
          text: t('v_bank_review', { count: k.sweep.unmatched + k.sweep.suggested }),
          href: '/transactions',
        })
      }
    }
    return out
  }, [findings, t])

  const skvVerdicts = useMemo<Verdict[]>(() => {
    if (!findings?.skv.connected) return []
    const s = findings.skv
    const out: Verdict[] = [{ tone: 'ok', text: t('v_skv_connected') }]
    if (skvSaldo !== null) {
      if (s.ledger1630 === null) {
        out.push({ tone: 'info', text: t('v_skv_saldo', { amount: formatCurrency(skvSaldo) }) })
      } else if (Math.abs(skvSaldo - s.ledger1630) < 1) {
        out.push({ tone: 'ok', text: t('v_skv_reconciled', { amount: formatCurrency(skvSaldo) }) })
      } else {
        out.push({
          tone: 'warn',
          text: t('v_skv_diff', {
            skv: formatCurrency(skvSaldo),
            ledger: formatCurrency(s.ledger1630),
          }),
          href: '/skattekonto',
        })
      }
    }
    for (const d of s.nextDeadlines.slice(0, 2)) {
      out.push({ tone: 'info', text: t('v_deadline', { type: t(`deadline_${d.type}`), date: formatDateLong(d.dueDate) }) })
    }
    return out
  }, [findings, skvSaldo, t, formatDateLong])

  /* ── steps ──────────────────────────────────────────────────────── */
  function renderStep() {
    switch (step) {
      case 'source':
        return (
          <Question title={t('source_title')} sub={t('source_sub')}>
            <div className="jny-srcgrid">
              {hasMigration
                ? BRANCH_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="jny-srcpick"
                      onClick={() => {
                        setProvider(p.id)
                        setSourcePath('migration')
                        setStep('provider')
                      }}
                    >
                      <span className="jny-srcmark">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.logo} alt="" />
                      </span>
                      {p.name}
                    </button>
                  ))
                : null}
              <button
                type="button"
                className={`jny-srcpick is-text${hasMigration ? '' : ' is-span'}`}
                onClick={() => {
                  setSourcePath('migration')
                  setStep('sie')
                }}
              >
                {t('source_sie')}
              </button>
              <button
                type="button"
                className="jny-srcpick is-text is-span"
                onClick={() => {
                  setSourcePath('fresh')
                  setStep(hasBanking ? 'bank' : hasSkatteverket ? 'skv' : 'done')
                }}
              >
                {t('source_fresh')}
              </button>
            </div>
            <div className="jny-qactions" style={{ flexDirection: 'column', gap: 10 }}>
              {confirmSkip ? (
                <>
                  <p className="jny-attn" style={{ margin: 0 }}>{t('skip_all_cost', { appName })}</p>
                  <button type="button" className="jny-btn-quiet" disabled={leaving} onClick={() => void leave('skipped')}>
                    {t('skip_all_confirm')}
                  </button>
                </>
              ) : (
                <button type="button" className="jny-btn-quiet" onClick={() => setConfirmSkip(true)}>
                  {t('skip_all')}
                </button>
              )}
            </div>
          </Question>
        )

      case 'sie':
        return (
          <div className="bks-host">
            <div className="jny-qstep" style={{ textAlign: 'center' }}>
              <h1 className="jny-qtitle">
                <InkText text={t('sie_title')} />
              </h1>
              <p className="jny-qsub">{t('sie_sub')}</p>
            </div>
            <SIEImportWizard onImported={() => setImported(true)} />
            <div className="jny-qactions">
              {imported ? (
                <button type="button" className="jny-btn" onClick={() => setStep('insight')}>
                  {t('to_insight')}
                </button>
              ) : (
                <button type="button" className="jny-btn-quiet" onClick={() => setStep('source')}>
                  &lsaquo; {t('back')}
                </button>
              )}
            </div>
          </div>
        )

      case 'provider':
        return (
          <div className="bks-host">
            <div className="jny-qstep" style={{ textAlign: 'center' }}>
              <h1 className="jny-qtitle">
                <InkText text={t('provider_title')} />
              </h1>
              <p className="jny-qsub">{t('provider_sub')}</p>
            </div>
            {hasMigration ? <MigrationWorkspace userId={userId} initialProvider={provider ?? undefined} /> : null}
            <div className="jny-qactions">
              <button type="button" className="jny-btn-quiet" onClick={() => setStep('source')}>
                &lsaquo; {t('back')}
              </button>
              <button type="button" className="jny-btn" onClick={() => setStep('insight')}>
                {t('provider_done')}
              </button>
            </div>
          </div>
        )

      case 'insight':
        return (
          <Question
            title={
              findings && findings.books.entries > 0
                ? t('insight_title', { count: findings.books.entries, years: findings.books.periods.length })
                : t('insight_title_empty')
            }
            sub={t('insight_sub')}
          >
            <VerdictList verdicts={insightVerdicts} loading={loadingFindings && !findings} />
            <div className="jny-qactions">
              <button
                type="button"
                className="jny-btn"
                onClick={() => setStep(hasBanking ? 'bank' : hasSkatteverket ? 'skv' : 'done')}
              >
                {hasBanking ? t('to_bank') : hasSkatteverket ? t('to_skv') : t('to_done')}
              </button>
            </div>
          </Question>
        )

      case 'bank': {
        const connected = Boolean(findings?.bank.connected)
        return (
          <div className="bks-host">
            <div className="jny-qstep" style={{ textAlign: 'center' }}>
              <h1 className="jny-qtitle">
                <InkText text={connected ? t('bank_title_done') : t('bank_title')} />
              </h1>
              {!connected ? <p className="jny-qsub">{t('bank_sub')}</p> : null}
            </div>
            {connected ? (
              <VerdictList verdicts={bankVerdicts} loading={false} />
            ) : hasBanking && BankingPanel ? (
              <BankingPanel />
            ) : (
              <p className="jny-qsub" style={{ textAlign: 'center' }}>{t('bank_unavailable')}</p>
            )}
            <div className="jny-qactions">
              {connected ? (
                <button type="button" className="jny-btn" onClick={() => setStep(hasSkatteverket ? 'skv' : 'done')}>
                  {hasSkatteverket ? t('to_skv') : t('to_done')}
                </button>
              ) : (
                <button
                  type="button"
                  className="jny-btn-quiet"
                  onClick={() => {
                    setBankSkipped(true)
                    setStep(hasSkatteverket ? 'skv' : 'done')
                  }}
                >
                  {t('bank_skip')}
                </button>
              )}
            </div>
          </div>
        )
      }

      case 'skv': {
        const connected = Boolean(findings?.skv.connected)
        const returnTo = encodeURIComponent('/onboarding/books?station=skv')
        return (
          <Question
            title={connected ? t('skv_title_done') : t('skv_title')}
            sub={connected ? undefined : t('skv_sub')}
          >
            {connected ? (
              <VerdictList verdicts={skvVerdicts} loading={loadingFindings && !findings} />
            ) : hasSkatteverket ? (
              <a className="jny-bankid" href={`/api/extensions/ext/skatteverket/authorize?return_to=${returnTo}`}>
                <span className="jny-bankid-mark">BankID</span>
                {t('skv_connect')}
              </a>
            ) : (
              <p className="jny-qsub">{t('skv_unavailable')}</p>
            )}
            <div className="jny-qactions">
              {connected ? (
                <button type="button" className="jny-btn" onClick={() => setStep('done')}>
                  {t('to_done')}
                </button>
              ) : (
                <button
                  type="button"
                  className="jny-btn-quiet"
                  onClick={() => {
                    setSkvSkipped(true)
                    setStep('done')
                  }}
                >
                  {t('skv_skip')}
                </button>
              )}
            </div>
          </Question>
        )
      }

      case 'done': {
        const b = findings?.books
        const rows: [string, string][] = [
          [
            t('card_books'),
            b && b.entries > 0
              ? t('card_books_value', { count: b.entries, years: b.periods.length })
              : sourcePath === 'fresh'
                ? t('answer_fresh')
                : t('card_books_none'),
          ],
          [
            t('card_bank'),
            findings?.bank.connected ? (findings.bank.bankName ?? t('answer_connected')) : t('card_not_connected'),
          ],
          [t('card_skv'), findings?.skv.connected ? t('answer_connected') : t('card_not_connected')],
        ]
        const next = findings?.skv.nextDeadlines[0]
        if (next) rows.push([t('card_next'), `${t(`deadline_${next.type}`)} ${formatDateLong(next.dueDate)}`])
        return (
          <div className="jny-qstep">
            <h1 className="jny-qtitle">
              <InkText text={t('done_title', { name: company?.name?.split(' ')[0] ?? '' })} />
            </h1>
            <div className="jny-card">
              <div className="jny-card-eyebrow">{t('card_eyebrow')}</div>
              <div className="jny-card-name">{company?.name}</div>
              <dl>
                {rows.map(([k, v], i) => (
                  <CardRow key={k} label={k} value={v} delay={250 + i * 140} />
                ))}
              </dl>
            </div>
            <div className="jny-qactions">
              <button type="button" className="jny-btn" disabled={leaving} onClick={() => void leave('done')}>
                {t('open_app', { appName })}
              </button>
            </div>
          </div>
        )
      }
    }
  }

  return (
    <div className="bks" style={{ ['--jny-dawn' as string]: String(station / 3) }}>
      <div className="jny-dawn" aria-hidden="true" />
      <div className="bks-center">
        <JourneyTrack
          stations={stations}
          active={station}
          orbLabel={t(`orb_${orbState}`)}
        >
          <JourneyOrb state={orbState} targetX={STATION_FRACS[station]} />
        </JourneyTrack>
        <div className="bks-qarea">{renderStep()}</div>
      </div>
    </div>
  )
}

function VerdictList({ verdicts, loading }: { verdicts: Verdict[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="bks-verdicts" role="status">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return (
    <ul className="bks-verdicts">
      {verdicts.map((v, i) => (
        <VerdictLine key={v.text} verdict={v} delay={200 + i * 260} />
      ))}
    </ul>
  )
}

function VerdictLine({ verdict, delay }: { verdict: Verdict; delay: number }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setOn(true), delay)
    return () => window.clearTimeout(id)
  }, [delay])
  const body = verdict.href ? (
    <a href={verdict.href} className="bks-vlink">{verdict.text}</a>
  ) : (
    <span>{verdict.text}</span>
  )
  return (
    <li className={`bks-v is-${verdict.tone}${on ? ' is-on' : ''}`}>
      <span className="bks-vmark" aria-hidden="true">
        {verdict.tone === 'ok' ? (
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="bks-vdot" />
        )}
      </span>
      {body}
    </li>
  )
}

function CardRow({ label, value, delay }: { label: string; value: string; delay: number }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setOn(true), delay)
    return () => window.clearTimeout(id)
  }, [delay])
  return (
    <div className={`jny-card-row${on ? ' is-on' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
