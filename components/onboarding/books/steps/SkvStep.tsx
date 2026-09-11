'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useBranding } from '@/lib/branding/brand-context'
import { useFormat } from '@/lib/hooks/use-format'
import { formatCurrency } from '@/lib/utils'
import { InkText } from '@/components/onboarding/journey/ink'
import { SkvHandshake } from '../ui/SkvHandshake'
import { VerdictList, type Verdict } from '../ui/Verdicts'
import type { BooksCtx } from '../context'

const RETURN_TO = '/onboarding/books?station=skv'
const AUTHORIZE_URL = `/api/extensions/ext/skatteverket/authorize?return_to=${encodeURIComponent(RETURN_TO)}`

/**
 * Anslut Skatteverket? The BankID button folds and leaves; the consent
 * runs in a new tab (the callback posts back and closes itself) while the
 * thread carries a light; on the message the rings meet, one ring closes
 * on the pair, the title inks and the verdicts follow. A blocked tab falls
 * back to the full-page flow: the return mounts straight into the back
 * phase from ?skv_connected=true.
 */
export function SkvStep({ ctx }: { ctx: BooksCtx }) {
  const t = useTranslations('books')
  const { appName } = useBranding()
  const { formatDateLong } = useFormat()
  const { state, dispatch, flags, findings, loadingFindings, loadFindings, landedError } = ctx
  const phase = state.skvPhase
  const [saldo, setSaldo] = useState<number | null>(null)
  const [attn, setAttn] = useState<string | null>(landedError)
  const timers = useRef<number[]>([])
  const tabRef = useRef<Window | null>(null)
  const watchRef = useRef<number | null>(null)
  const phaseRef = useRef(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  const stopWatch = useCallback(() => {
    if (watchRef.current) window.clearInterval(watchRef.current)
    watchRef.current = null
    tabRef.current = null
  }, [])

  useEffect(() => {
    const list = timers.current
    return () => {
      list.forEach((id) => window.clearTimeout(id))
      stopWatch()
    }
  }, [stopWatch])

  const arrive = useCallback(() => {
    stopWatch()
    dispatch({ type: 'SKV_PHASE', phase: 'back' })
    void loadFindings()
    fetch('/api/extensions/ext/skatteverket/skattekonto/saldo')
      .then(async (res) => {
        if (!res.ok) return
        const json = (await res.json()) as { data: { saldoSkatteverket: number } | null }
        if (json.data) setSaldo(json.data.saldoSkatteverket)
      })
      .catch(() => {})
    at(1500, () => dispatch({ type: 'SKV_PHASE', phase: 'done' }))
  }, [at, dispatch, loadFindings, stopWatch])

  // Mounted in the back phase: the full-page round trip brought us here.
  const mountedBack = useRef(phase === 'back')
  useEffect(() => {
    if (!mountedBack.current) return
    mountedBack.current = false
    const url = new URL(window.location.href)
    if (url.searchParams.has('skv_connected') || url.searchParams.has('skv_error')) {
      url.searchParams.delete('skv_connected')
      url.searchParams.delete('skv_error')
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''))
    }
    arrive()
  }, [arrive])

  // Already connected before this step opened (a reload): show the answer.
  useEffect(() => {
    if (phase === 'open' && findings?.skv.connected) {
      dispatch({ type: 'SKV_PHASE', phase: 'done' })
      fetch('/api/extensions/ext/skatteverket/skattekonto/saldo')
        .then(async (res) => {
          if (!res.ok) return
          const json = (await res.json()) as { data: { saldoSkatteverket: number } | null }
          if (json.data) setSaldo(json.data.saldoSkatteverket)
        })
        .catch(() => {})
    }
  }, [phase, findings?.skv.connected, dispatch])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const type = (event.data as { type?: string } | null)?.type
      if (type === 'skatteverket-oauth-success') {
        if (phaseRef.current === 'leaving' || phaseRef.current === 'away') arrive()
      } else if (type === 'skatteverket-oauth-error') {
        stopWatch()
        setAttn(t('skv_failed'))
        dispatch({ type: 'SKV_PHASE', phase: 'open' })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [arrive, dispatch, stopWatch, t])

  function connect() {
    setAttn(null)
    // The tab must open inside the click, or the browser blocks it.
    const tab = window.open(AUTHORIZE_URL, '_blank')
    if (!tab) {
      // The authorize route is an API redirect, not a page: a hard navigation is the only way in.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = AUTHORIZE_URL
      return
    }
    tabRef.current = tab
    dispatch({ type: 'SKV_PHASE', phase: 'leaving' })
    at(900, () => {
      if (phaseRef.current === 'leaving') dispatch({ type: 'SKV_PHASE', phase: 'away' })
    })
    // Abandoned: the tab closed without a message.
    watchRef.current = window.setInterval(() => {
      if (tabRef.current && tabRef.current.closed) {
        stopWatch()
        at(600, () => {
          if (phaseRef.current === 'away' || phaseRef.current === 'leaving') {
            setAttn(t('skv_abandoned'))
            dispatch({ type: 'SKV_PHASE', phase: 'open' })
          }
        })
      }
    }, 1000)
  }

  const verdicts = useMemo<Verdict[]>(() => {
    if (!findings?.skv.connected) return []
    const s = findings.skv
    const out: Verdict[] = [{ tone: 'ok', text: t('v_skv_connected') }]
    if (saldo !== null) {
      if (s.ledger1630 === null) out.push({ tone: 'info', text: t('v_skv_saldo', { amount: formatCurrency(saldo) }) })
      else if (Math.abs(saldo - s.ledger1630) < 1) out.push({ tone: 'ok', text: t('v_skv_reconciled', { amount: formatCurrency(saldo) }) })
      else out.push({ tone: 'warn', text: t('v_skv_diff', { skv: formatCurrency(saldo), ledger: formatCurrency(s.ledger1630) }), href: '/skattekonto' })
    }
    for (const d of s.nextDeadlines.slice(0, 2)) {
      out.push({ tone: 'info', text: t('v_deadline', { type: t(`deadline_${d.type}`), date: formatDateLong(d.dueDate) }) })
    }
    return out
  }, [findings, saldo, t, formatDateLong])

  const open = phase === 'open' || phase === 'leaving'
  const bodyCls = phase === 'leaving' ? ' is-away' : ''

  return (
    <div className="jny-qstep">
      <h1 className="jny-qtitle">
        <InkText text={phase === 'done' ? t('skv_title_done') : t('skv_title')} />
      </h1>
      {open ? (
        <div className={`skv-body${bodyCls}`}>
          <p className="jny-qsub">{t('skv_sub')}</p>
          {attn ? <p className="jny-attn">{attn}</p> : null}
          {flags.hasSkatteverket ? (
            <button type="button" className={`jny-bankid${phase === 'leaving' ? ' is-fold' : ''}`} onClick={connect}>
              <span className="pmark" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logos/skatteverket.svg" alt="" />
              </span>
              <span className="jny-bankid-txt">{t('skv_connect')}</span>
            </button>
          ) : (
            <p className="jny-qsub">{t('skv_unavailable')}</p>
          )}
        </div>
      ) : null}
      {phase === 'away' || phase === 'back' || phase === 'done' ? (
        <SkvHandshake phase={phase} holdText={t('skv_hold')} leftLabel={appName} rightLabel={t('station_skv')} />
      ) : null}
      {phase === 'done' ? <VerdictList verdicts={verdicts} loading={loadingFindings && !findings} base={400} narrow /> : null}
      <div className="jny-qactions">
        {phase === 'done' ? (
          <button type="button" className="jny-btn" onClick={() => dispatch({ type: 'TO_DONE' })}>
            {t('to_done')}
          </button>
        ) : open ? (
          <>
            <button type="button" className={`jny-btn-quiet${bodyCls}`} onClick={() => dispatch({ type: 'GO_BACK' })}>‹ {t('back')}</button>
            <button type="button" className={`jny-btn-quiet${bodyCls}`} onClick={() => dispatch({ type: 'SKV_SKIP' })}>
              {t('skv_skip')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
