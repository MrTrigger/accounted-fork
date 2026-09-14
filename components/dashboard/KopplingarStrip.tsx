'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ChevronRight, Landmark } from 'lucide-react'
import { ENABLED_EXTENSION_IDS } from '@/lib/extensions/_generated/enabled-extensions'
import { useCapability, useCompanyOptional } from '@/contexts/CompanyContext'
import { CAPABILITY } from '@/lib/entitlements/keys'

/**
 * Kopplingar: the bank and Skatteverket connections a company has not made,
 * one quiet row each under Att göra. The books act offers both and neither
 * is mandatory, so whoever declined still sees, every visit, that the
 * transactions and the skattekonto can arrive by themselves. Rows drop out
 * as connections are made; the strip renders nothing once both are in.
 * Replaces the old dismissible Skatteverket promo sentence: same offer, now
 * next to the bank one instead of alone at the bottom.
 */
export function KopplingarStrip({
  hasBank,
  hasSkatteverket,
}: {
  hasBank: boolean
  hasSkatteverket: boolean
}) {
  const t = useTranslations('dashboard')
  const hasBankingExtension = ENABLED_EXTENSION_IDS.has('enable-banking')
  const skvExtension = ENABLED_EXTENSION_IDS.has('skatteverket')
  const skvCapability = useCapability(CAPABILITY.skatteverket)
  const isSandbox = useCompanyOptional()?.isSandbox ?? false

  const showBank = !hasBank
  // Sandbox companies cannot reach Skatteverket (the sandbox blocks it), and
  // the row is pointless without the extension or the plan capability.
  const showSkv = !hasSkatteverket && skvExtension && skvCapability && !isSandbox
  if (!showBank && !showSkv) return null

  return (
    <section aria-label={t('kopplingar_title')} className="mt-2">
      <p className="px-1 pt-5 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
        {t('kopplingar_title')}
      </p>
      {showBank && (
        <Link
          href={hasBankingExtension ? '/import?mode=psd2' : '/import?mode=bank'}
          className="group flex w-full items-start gap-3 border-b border-border px-1 py-3.5 transition-colors duration-150 hover:bg-secondary/30"
        >
          <span className="mt-px w-[18px] shrink-0 text-muted-foreground" aria-hidden>
            <Landmark className="h-[15px] w-[15px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px]">{t('kopplingar_bank')}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{t('kopplingar_bank_detail')}</p>
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-2 pt-px text-xs text-muted-foreground">
            {t('kopplingar_connect')}
            <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </span>
        </Link>
      )}
      {showSkv && (
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- /api route, not a Next page; the authorize endpoint 302s to Skatteverket, which the client router cannot follow
        <a
          href="/api/extensions/ext/skatteverket/authorize?return_to=/"
          className="group flex w-full items-start gap-3 border-b border-border px-1 py-3.5 transition-colors duration-150 hover:bg-secondary/30"
        >
          <span className="mt-px w-[18px] shrink-0" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/skatteverket_color.svg" alt="" className="h-[15px] w-[15px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px]">{t('kopplingar_skv')}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{t('kopplingar_skv_detail')}</p>
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-2 pt-px text-xs text-muted-foreground">
            {t('kopplingar_connect')}
            <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </span>
        </a>
      )}
    </section>
  )
}
