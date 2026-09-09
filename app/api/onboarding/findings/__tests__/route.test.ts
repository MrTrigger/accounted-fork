import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { createMockRequest, createQueuedMockSupabase, parseJsonResponse } from '@/tests/helpers'

const { supabase, reset } = createQueuedMockSupabase()
const requireAuthMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}))
vi.mock('@/lib/company/context', () => ({
  getActiveCompanyId: vi.fn().mockResolvedValue('company-1'),
}))
vi.mock('@/lib/onboarding/findings', () => ({
  loadBooksFindings: (...args: unknown[]) => loadMock(...args),
}))

const CTX = { params: Promise.resolve({}) }
import { GET } from '../route'

describe('GET /api/onboarding/findings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
    requireAuthMock.mockResolvedValue({ user: { id: 'user-1' }, supabase, error: null })
  })

  it('returns 401 when the user is not authenticated', async () => {
    requireAuthMock.mockResolvedValue({
      user: null,
      supabase,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    const response = await GET(createMockRequest('/api/onboarding/findings'), CTX)
    expect(response.status).toBe(401)
  })

  it('returns the findings for the active company', async () => {
    const findings = { books: { entries: 12 }, bank: { connected: false }, skv: { connected: false } }
    loadMock.mockResolvedValue(findings)
    const { status, body } = await parseJsonResponse<{ data: typeof findings }>(
      await GET(createMockRequest('/api/onboarding/findings'), CTX),
    )
    expect(status).toBe(200)
    expect(body.data).toEqual(findings)
    expect(loadMock).toHaveBeenCalledWith(supabase, 'company-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })

  it('answers 500 with a reason when the ledger read fails', async () => {
    loadMock.mockRejectedValue(new Error('boom'))
    const response = await GET(createMockRequest('/api/onboarding/findings'), CTX)
    expect(response.status).toBe(500)
  })
})
