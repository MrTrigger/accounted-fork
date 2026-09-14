'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useCapability, useCompany } from '@/contexts/CompanyContext'
import { useBranding } from '@/lib/branding/brand-context'
import { CAPABILITY } from '@/lib/entitlements/keys'
import { useFetch } from '@/lib/hooks/use-fetch'
import { useFormat } from '@/lib/hooks/use-format'
import type { AiClient } from '@/lib/onboarding/ai-clients'
import { pickFirstAiTask } from '@/lib/worklist/ai-task'
import type { WorklistCounts } from '@/lib/worklist/types'
import { AttGoraAiCta } from '@/components/dashboard/AttGoraAiCta'
import { Button } from '@/components/ui/button'
import { InkText } from '@/components/onboarding/journey/ink'
import { Confetti } from '../ui/Confetti'
import { AiCard } from '../ui/AiCard'
import type { BooksCtx } from '../context'

/** How often the Done step asks whether an AI client has signed in, while it is showing. */
export const AI_POLL_MS = 4000

/** Klart: a few flecks let go, the card of what got connected, then the door to Hem. */
export function DoneStep({ ctx, onLeave, leaving }: { ctx: BooksCtx; onLeave: (outcome: 'done') => void; leaving: boolean }) {
  const t = useTranslations('books')
  const { company } = useCompany()
  const { appName } = useBranding()
  const { formatDateLong } = useFormat()
  const { findings, state, loadFindings } = ctx
  const hasAi = useCapability(CAPABILITY.ai)
  const [preferredClient, setPreferredClient] = useState<AiClient>()
  const { data: worklist, loading, error, refetch } = useFetch<{ data: WorklistCounts }, WorklistCounts>(
    '/api/worklist/counts',
    { select: (body) => body.data },
  )
  const connected = findings?.ai.connected ?? []
  const connectionKey = connected.join(',')
  const task = worklist && !error ? pickFirstAiTask(worklist.counts, { hasAi }) : null
  const hasHandoff = connected.length > 0 && task !== null

  // Refresh the same queue Hem uses when OAuth finishes or the user returns
  // from their agent. Do not keep offering work they have already completed.
  useEffect(() => {
    if (connectionKey) refetch()
  }, [connectionKey, refetch])
  useEffect(() => {
    window.addEventListener('focus', refetch)
    return () => window.removeEventListener('focus', refetch)
  }, [refetch])

  // The OAuth sign-in happens in another tab. Poll the findings while this
  // step is on screen so the client's row turns green the moment the token
  // route has minted its key; stop once all three are connected.
  const allConnected = (findings?.ai.connected.length ?? 0) >= 3
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void loadFindings()
    }
    window.addEventListener('focus', refresh)
    const id = allConnected ? null : window.setInterval(refresh, AI_POLL_MS)
    return () => {
      window.removeEventListener('focus', refresh)
      if (id !== null) window.clearInterval(id)
    }
  }, [allConnected, loadFindings])
  const b = findings?.books
  const rows: [string, string][] = [
    [
      t('card_books'),
      b && b.entries > 0
        ? t('card_books_value', { count: b.entries, years: b.periods.length })
        : state.path === 'fresh'
          ? t('answer_fresh')
          : t('card_books_none'),
    ],
    [t('card_bank'), findings?.bank.connected ? (findings.bank.bankName ?? t('answer_connected')) : t('card_not_connected')],
    [t('card_skv'), findings?.skv.connected ? t('answer_connected') : t('card_not_connected')],
  ]
  const next = findings?.skv.nextDeadlines[0]
  if (next) rows.push([t('card_next'), `${t(`deadline_${next.type}`)} ${formatDateLong(next.dueDate)}`])

  return (
    <div className="jny-qstep bks-done" style={{ position: 'relative' }}>
      <Confetti />
      <h1 className="jny-qtitle">
        <InkText text={t('done_title', { name: company?.name?.split(' ')[0] ?? '' })} />
      </h1>
      <p className="done-sub">{t('done_sub')}</p>
      <div className="jny-card">
        <div className="jny-card-eyebrow">{t('card_eyebrow')}</div>
        <div className="jny-card-name">{company?.name}</div>
        <dl>
          {rows.map(([k, v], i) => (
            <CardRow key={k} label={k} value={v} delay={250 + i * 140} />
          ))}
        </dl>
      </div>
      <AiCard findings={findings} onConnect={setPreferredClient} showPrompts={!hasHandoff} />
      {connected.length > 0 && (
        <div aria-live="polite" aria-busy={loading}>
          {error ? (
            <div className="aihandoff">
              <p className="aihandoff-note">{t('ai_handoff_failed')}</p>
              <Button type="button" variant="ghost" size="sm" onClick={refetch} disabled={loading}>
                {t('ai_handoff_retry')}
              </Button>
            </div>
          ) : loading && !worklist ? (
            <p className="aihandoff aihandoff-note" role="status">{t('ai_handoff_loading')}</p>
          ) : task ? (
            <AttGoraAiCta
              clients={connected}
              task={task}
              onboarding
              preferredClient={preferredClient}
              onOpen={() => onLeave('done')}
              disabled={leaving}
            />
          ) : (
            <p className="aihandoff aihandoff-note">{t('ai_handoff_empty')}</p>
          )}
        </div>
      )}
      <div className="jny-qactions">
        <Button type="button" variant={hasHandoff ? 'ghost' : 'default'} disabled={leaving} onClick={() => onLeave('done')}>
          {t('open_app', { appName })}
        </Button>
      </div>
    </div>
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
