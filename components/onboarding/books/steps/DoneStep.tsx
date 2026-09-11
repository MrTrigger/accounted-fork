'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useCompany } from '@/contexts/CompanyContext'
import { useBranding } from '@/lib/branding/brand-context'
import { useFormat } from '@/lib/hooks/use-format'
import { InkText } from '@/components/onboarding/journey/ink'
import { Confetti } from '../ui/Confetti'
import { AiCard } from '../ui/AiCard'
import type { BooksCtx } from '../context'

/** Klart: a few flecks let go, the card of what got connected, then the door to Hem. */
export function DoneStep({ ctx, onLeave, leaving }: { ctx: BooksCtx; onLeave: (outcome: 'done') => void; leaving: boolean }) {
  const t = useTranslations('books')
  const { company } = useCompany()
  const { appName } = useBranding()
  const { formatDateLong } = useFormat()
  const { findings, state } = ctx
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
    <div className="jny-qstep" style={{ position: 'relative' }}>
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
      <AiCard />
      <div className="jny-qactions">
        <button type="button" className="jny-btn-quiet" onClick={() => ctx.dispatch({ type: 'GO_BACK' })}>‹ {t('back')}</button>
        <button type="button" className="jny-btn" disabled={leaving} onClick={() => onLeave('done')}>
          {t('open_app', { appName })}
        </button>
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
