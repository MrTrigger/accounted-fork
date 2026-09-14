import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { submitFeedback } from '@/lib/support/submit-feedback'

// posthog-js is browser-only: stub it so both the ticket call and the
// analytics breadcrumb can be asserted without initialising the real SDK.
const captureMock = vi.fn()
const sendMessageMock = vi.fn()
const isAvailableMock = vi.fn(() => true)
vi.mock('posthog-js', () => ({
  default: {
    capture: (...a: unknown[]) => captureMock(...a),
    conversations: {
      isAvailable: () => isAvailableMock(),
      sendMessage: (...a: unknown[]) => sendMessageMock(...a),
    },
  },
}))

describe('submitFeedback', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    captureMock.mockClear()
    sendMessageMock.mockReset()
    sendMessageMock.mockResolvedValue({ ticket_id: 't1' })
    isAvailableMock.mockReturnValue(true)
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'false')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'phc_test')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function stubFetchOk() {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchSpy)
    return fetchSpy
  }

  it('delivers as a PostHog ticket and sends no email when that works', async () => {
    const fetchSpy = stubFetchOk()

    const result = await submitFeedback({ subject: 'Hjälpsida', message: 'Hjälp tack' })

    expect(result).toEqual({ ok: true, channels: ['ticket'] })
    expect(sendMessageMock).toHaveBeenCalledWith('[Hjälpsida]\n\nHjälp tack')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to email when conversations are unavailable', async () => {
    isAvailableMock.mockReturnValue(false)
    const fetchSpy = stubFetchOk()

    const result = await submitFeedback({ subject: 'Hjälpsida', message: 'Hjälp tack' })

    expect(result).toEqual({ ok: true, channels: ['email'] })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/support/contact',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ subject: 'Hjälpsida', message: 'Hjälp tack' }) })
    )
  })

  it('falls back to email when the ticket call fails', async () => {
    sendMessageMock.mockRejectedValue(new Error('posthog down'))
    stubFetchOk()

    const result = await submitFeedback({ message: 'msg' })

    expect(result).toEqual({ ok: true, channels: ['email'] })
  })

  it('reports failure only when both channels failed', async () => {
    sendMessageMock.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Mailtjänsten är inte konfigurerad' }) }))

    const result = await submitFeedback({ message: 'msg' })

    expect(result.ok).toBe(false)
    expect(result.channels).toEqual([])
    expect(result.error).toBe('Mailtjänsten är inte konfigurerad')
  })

  it('reports failure when fetch itself throws after a failed ticket', async () => {
    sendMessageMock.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))

    const result = await submitFeedback({ message: 'msg' })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Network down')
  })

  it('records a PostHog breadcrumb WITHOUT the message body', async () => {
    stubFetchOk()

    await submitFeedback({ subject: 'Hjälpsida', message: 'känslig text om mitt bolag' })

    expect(captureMock).toHaveBeenCalledWith('support_feedback_submitted', {
      subject: 'Hjälpsida',
      delivered: true,
      email: 'skipped',
      ticket: 'ok',
      lost: false,
    })
    // Free text is user content: it must never ride along as an event property.
    expect(JSON.stringify(captureMock.mock.calls)).not.toContain('känslig text')
  })

  it('marks the breadcrumb lost when neither channel delivered', async () => {
    sendMessageMock.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))

    await submitFeedback({ message: 'msg' })

    expect(captureMock).toHaveBeenCalledWith(
      'support_feedback_submitted',
      expect.objectContaining({ delivered: false, email: 'failed', lost: true })
    )
  })

  it('uses email and skips the breadcrumb when analytics is off (self-hosted)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true')
    stubFetchOk()

    const result = await submitFeedback({ message: 'msg' })

    expect(result).toEqual({ ok: true, channels: ['email'] })
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(captureMock).not.toHaveBeenCalled()
  })

  it('does not let a throwing analytics SDK break delivery', async () => {
    captureMock.mockImplementationOnce(() => {
      throw new Error('posthog boom')
    })
    stubFetchOk()

    const result = await submitFeedback({ message: 'msg' })

    expect(result.ok).toBe(true)
  })

  it('does not wait forever on a hung ticket call', async () => {
    vi.useFakeTimers()
    sendMessageMock.mockReturnValue(new Promise(() => {}))
    stubFetchOk()

    const pending = submitFeedback({ message: 'msg' })
    await vi.advanceTimersByTimeAsync(4100)
    const result = await pending
    vi.useRealTimers()

    expect(result).toEqual({ ok: true, channels: ['email'] })
    expect(captureMock).toHaveBeenCalledWith('support_feedback_submitted', expect.objectContaining({ ticket: 'timeout', email: 'ok' }))
  })
})
