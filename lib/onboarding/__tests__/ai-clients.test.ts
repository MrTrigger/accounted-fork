import { describe, expect, it } from 'vitest'
import { aiChatLink, aiConnectAction, connectedAiClients } from '../ai-clients'

describe('connectedAiClients', () => {
  it('reads the three clients off live OAuth keys, in display order, once each', () => {
    expect(
      connectedAiClients([{ client: 'grok' }, { client: 'claude' }, { client: 'claude' }]),
    ).toEqual(['claude', 'grok'])
  })

  it('ignores keys minted before the column, by Cursor, localhost or registered clients', () => {
    expect(
      connectedAiClients([{ client: null }, { client: 'cursor' }, { client: 'local' }, { client: 'cursor_deeplink' }]),
    ).toEqual([])
  })
})

describe('aiChatLink', () => {
  it('opens a new chat with the prompt in the query, URL-encoded', () => {
    const prompt = 'Bokför 3 rader & moms'
    expect(aiChatLink('claude', prompt)).toBe(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`)
    expect(aiChatLink('chatgpt', prompt)).toBe(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`)
    expect(aiChatLink('grok', prompt)).toBe(`https://grok.com/?q=${encodeURIComponent(prompt)}`)
  })
})

describe('aiConnectAction', () => {
  const input = { origin: 'https://app.testbrand.example', appName: 'Testbrand' }

  it('Claude gets the prefilled add-connector deep link and nothing to copy', () => {
    const a = aiConnectAction('claude', input)
    expect(a.open).toContain('https://claude.ai/customize/connectors?modal=add-custom-connector')
    expect(a.open).toContain(encodeURIComponent('https://app.testbrand.example/api/extensions/ext/mcp-server/mcp'))
    expect(a.copy).toBeNull()
  })

  it('ChatGPT and Grok copy the server URL and open their connector page', () => {
    const chatgpt = aiConnectAction('chatgpt', input)
    expect(chatgpt.open).toBe('https://chatgpt.com/#settings/Connectors')
    expect(chatgpt.copy).toContain('/api/extensions/ext/mcp-server/mcp?tool_namespace=accounted&client=chatgpt')
    const grok = aiConnectAction('grok', input)
    expect(grok.open).toBe('https://grok.com/')
    expect(grok.copy).toContain('client=grok&auth=required')
  })
})
