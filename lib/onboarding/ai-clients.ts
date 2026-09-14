import type { SupabaseClient } from '@supabase/supabase-js'
import { OAUTH_MCP_KEY_NAME } from '@/lib/auth/api-keys'
import { claudeConnectorLink, sideDoorServerUrl, type SideDoor } from '@/lib/onboarding/checklist'

/**
 * The three AI clients the product connects to over MCP, in display order.
 * One list for the books act's last card, the Hem worklist footer and the
 * connected-state readout, so the logos, names and connector pages can
 * never disagree between surfaces.
 */
export type AiClient = 'claude' | 'chatgpt' | 'grok'

export const AI_CLIENTS: { id: AiClient; name: string; logo: string; home: string }[] = [
  { id: 'claude', name: 'Claude', logo: '/logos/claude.webp', home: 'https://claude.ai/customize/connectors' },
  { id: 'chatgpt', name: 'ChatGPT', logo: '/logos/chatgpt.webp', home: 'https://chatgpt.com/#settings/Connectors' },
  { id: 'grok', name: 'Grok', logo: '/logos/grok.webp', home: 'https://grok.com/' },
]

const AI_CLIENT_IDS = new Set<string>(AI_CLIENTS.map((c) => c.id))

/**
 * Which clients have completed the MCP OAuth sign-in, from the user's live
 * OAuth-minted keys. `client` is what the token route stored from the
 * redirect URI (migration 20260913120000); rows older than that column,
 * Cursor, localhost and registered clients carry null or another value and
 * count as none of the three. Pure so the readout can be pinned in tests.
 */
export function connectedAiClients(rows: { client: string | null }[]): AiClient[] {
  const seen = new Set<AiClient>()
  for (const r of rows) {
    if (r.client && AI_CLIENT_IDS.has(r.client)) seen.add(r.client as AiClient)
  }
  return AI_CLIENTS.map((c) => c.id).filter((id) => seen.has(id))
}

/**
 * The connection follows the person, not the company: the key's company_id
 * is whatever was active at sign-in (or null for a companyless signup), so
 * the lookup is by user. Revoked keys do not count. A failed read answers
 * an empty list rather than throwing: the readout only decorates a button.
 */
export async function loadConnectedAiClients(supabase: SupabaseClient, userId: string): Promise<AiClient[]> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('client')
    .eq('user_id', userId)
    .eq('name', OAUTH_MCP_KEY_NAME)
    .is('revoked_at', null)
  if (error || !data) return []
  return connectedAiClients(data as { client: string | null }[])
}

/**
 * A new chat in the client with the prompt already typed. Each of the three
 * web apps reads `q` from its home or /new URL; the user still presses send,
 * and the connector has to be enabled in that chat for the tools to answer.
 */
export function aiChatLink(client: AiClient, prompt: string): string {
  const q = encodeURIComponent(prompt)
  switch (client) {
    case 'claude':
      return `https://claude.ai/new?q=${q}`
    case 'chatgpt':
      return `https://chatgpt.com/?q=${q}`
    case 'grok':
      return `https://grok.com/?q=${q}`
  }
}

/**
 * What the Anslut button for a client does. Claude has an add-connector
 * deep link that prefills everything. ChatGPT and Grok have none: the
 * server address is copied and the client's connector page opened. Pure:
 * the component owns window.open and the clipboard.
 */
export function aiConnectAction(client: AiClient, input: { origin: string; appName: string }): { open: string; copy: string | null } {
  if (client === 'claude') {
    return { open: claudeConnectorLink({ origin: input.origin, appName: input.appName }), copy: null }
  }
  return {
    open: AI_CLIENTS.find((c) => c.id === client)?.home ?? '/',
    copy: sideDoorServerUrl({ origin: input.origin, door: client as SideDoor }),
  }
}
