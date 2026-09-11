'use client'

import { useTranslations } from 'next-intl'
import { useBranding } from '@/lib/branding/brand-context'
import { claudeConnectorLink, sideDoorServerUrl, type SideDoor } from '@/lib/onboarding/checklist'

type Client = 'claude' | 'chatgpt' | 'grok'

const CLIENTS: { id: Client; name: string; logo: string; home: string }[] = [
  { id: 'claude', name: 'Claude', logo: '/logos/claude.webp', home: 'https://claude.ai/customize/connectors' },
  { id: 'chatgpt', name: 'ChatGPT', logo: '/logos/chatgpt.webp', home: 'https://chatgpt.com/#settings/Connectors' },
  { id: 'grok', name: 'Grok', logo: '/logos/grok.webp', home: 'https://grok.com/' },
]

/**
 * The last card: one header, three connectors. Claude has an add-connector
 * deep link that prefills everything. ChatGPT and Grok have none: the click
 * copies the server address and opens the client's connector page. Same
 * URLs as Settings and the Hem checklist.
 */
export function AiCard() {
  const t = useTranslations('books')
  const { appName } = useBranding()

  function connect(client: Client) {
    const origin = window.location.origin
    if (client === 'claude') {
      window.open(claudeConnectorLink({ origin, appName }), '_blank', 'noopener')
      return
    }
    const url = sideDoorServerUrl({ origin, door: client as SideDoor })
    void navigator.clipboard?.writeText(url).catch(() => {})
    window.open(CLIENTS.find((c) => c.id === client)?.home ?? '/', '_blank', 'noopener')
  }

  return (
    <div className="aicard">
      <p className="aicard-title">{t('ai_title')}</p>
      {CLIENTS.map((c) => (
        <div key={c.id} className="airow">
          <span className="pmark" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.logo} alt="" />
          </span>
          <span className="n">{c.name}</span>
          <button type="button" className="jny-btn" onClick={() => connect(c.id)}>
            {t('ai_connect')}
          </button>
        </div>
      ))}
    </div>
  )
}
