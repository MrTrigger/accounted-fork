'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { useBranding } from '@/lib/branding/brand-context'
import { useFormat } from '@/lib/hooks/use-format'
import { AI_CLIENTS, aiConnectAction, type AiClient } from '@/lib/onboarding/ai-clients'
import { pickAiPrompts, type AiPromptKey } from '@/lib/onboarding-books/ai-prompts'
import type { BooksFindings } from '@/lib/onboarding/findings'

/**
 * The last card: one header, up to three prompts built from this company's
 * own findings (the work the connected client can do right now; a click
 * copies one), then the three connectors. Claude has an add-connector deep
 * link that prefills everything. ChatGPT and Grok have none: the click
 * copies the server address and opens the client's connector page. Same
 * URLs as Settings and the Hem checklist. A client that has completed the
 * OAuth sign-in (findings.ai.connected, polled by the Done step) shows a
 * green Ansluten mark instead of its button.
 */
export function AiCard({ findings }: { findings: BooksFindings | null }) {
  const t = useTranslations('books')
  const { appName } = useBranding()
  const { locale, formatDateLong } = useFormat()
  const prompts = useMemo(() => pickAiPrompts(findings), [findings])
  const [copied, setCopied] = useState<AiPromptKey | null>(null)
  const copiedTimer = useRef<number | null>(null)
  useEffect(() => () => { if (copiedTimer.current) window.clearTimeout(copiedTimer.current) }, [])

  function promptText(key: AiPromptKey, params: Record<string, string | number>): string {
    const values = { ...params }
    if (typeof values.date === 'string') values.date = formatDateLong(values.date)
    return t(`prompt_${key}`, values)
  }

  function copyPrompt(key: AiPromptKey, text: string) {
    void navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(key)
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(null), 1800)
  }

  function connect(client: AiClient) {
    const action = aiConnectAction(client, { origin: window.location.origin, appName })
    if (action.copy) void navigator.clipboard?.writeText(action.copy).catch(() => {})
    window.open(action.open, '_blank', 'noopener')
  }
  const connected = findings?.ai.connected ?? []

  // Swedish quotes close on both sides; English opens and closes.
  const [qOpen, qClose] = locale === 'en' ? ['“', '”'] : ['”', '”']
  const SLOTS = ['is-top', 'is-left', 'is-right']

  return (
    <div className="aiwrap">
      <p className="aihead">{t('ai_head')}</p>
      {/* The card speaks: one bubble above it, one out of each side, each a prompt in quotes. */}
      <div className="aistage">
        {prompts.map((p, i) => {
          const text = promptText(p.key, p.params)
          return (
            <span key={p.key} className={`aislot ${SLOTS[i] ?? 'is-top'}`}>
              <button
                type="button"
                className={`aiprompt${copied === p.key ? ' is-copied' : ''}`}
                style={{ animationDelay: `${1500 + i * 380}ms` }}
                onClick={() => copyPrompt(p.key, text)}
              >
                {qOpen}{text}{qClose}
                {copied === p.key ? <small>{t('ai_copied')}</small> : null}
              </button>
            </span>
          )
        })}
        <div className="aicard">
      <p className="aicard-title">{t('ai_title')}</p>
      {AI_CLIENTS.map((c) => (
        <div key={c.id} className="airow">
          <span className="pmark" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.logo} alt="" />
          </span>
          <span className="n">{c.name}</span>
          {connected.includes(c.id) ? (
            <span className="aidone" role="status">
              <Check size={13} aria-hidden="true" />
              {t('ai_connected')}
            </span>
          ) : (
            <button type="button" className="jny-btn" onClick={() => connect(c.id)}>
              {t('ai_connect')}
            </button>
          )}
        </div>
      ))}
        </div>
      </div>
    </div>
  )
}
