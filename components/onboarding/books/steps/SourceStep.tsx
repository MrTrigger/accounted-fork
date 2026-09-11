'use client'

import { useTranslations } from 'next-intl'
import { BRANCH_PROVIDERS } from '@/lib/onboarding-journey/branch'
import Question from '@/components/onboarding/journey/Question'
import { Pill } from '../ui/Pills'
import type { BooksCtx } from '../context'

/**
 * Var fanns bokföringen innan? One column of equal rows: the providers with
 * their logo, the SIE file as the last row of the same list, a new business
 * as one quiet row below it. Visma and Bokio go SIE first (their API does
 * not hand out the ledger); the rest log in. No skip: the books come in, or
 * the business is new.
 */
export function SourceStep({ ctx }: { ctx: BooksCtx }) {
  const t = useTranslations('books')
  const { dispatch, flags, findings } = ctx
  const providers = flags.hasMigration ? BRANCH_PROVIDERS : []

  return (
    <Question title={t('source_title')} sub={t('source_sub')}>
      <div className="srclist">
        {providers.map((p, i) => (
          <Pill key={p.id} index={i} logo={p.logo} onClick={() => dispatch({ type: 'PICK_PROVIDER', provider: p.id })}>
            {p.name}
          </Pill>
        ))}
        <Pill index={providers.length} text onClick={() => dispatch({ type: 'PICK_SIE' })}>
          {t('source_sie')}
        </Pill>
        <hr className="srclist-sep" />
        <Pill index={providers.length + 1} text onClick={() => dispatch({ type: 'PICK_FRESH', flags })}>
          {t('source_fresh')}
        </Pill>
      </div>
      <div className="jny-qactions" style={{ flexDirection: 'column', gap: 10 }}>
        {findings && findings.books.entries > 0 ? (
          // A reload after an import: the books are already here, the
          // shortest path is the verdict, not another upload.
          <button
            type="button"
            className="jny-btn"
            onClick={() => {
              dispatch({ type: 'IMPORTED' })
              dispatch({ type: 'TO_INSIGHT' })
            }}
          >
            {t('source_existing', { count: findings.books.entries })} {t('to_insight')}
          </button>
        ) : null}
      </div>
    </Question>
  )
}
