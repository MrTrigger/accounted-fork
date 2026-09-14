import { describe, expect, it } from 'vitest'
import { resolveBooksResume } from '../resume'

describe('resolveBooksResume', () => {
  it('follows a running or paused import job', () => {
    for (const state of ['queued', 'preparing', 'running', 'reconciling', 'paused', 'finalizing']) {
      expect(resolveBooksResume({ id: 'job-1', job_state: state, job_kind: 'import' }, 0)).toEqual({ kind: 'active', importId: 'job-1' })
    }
  })

  it('opens on the books when the latest job is over and entries exist', () => {
    expect(resolveBooksResume({ id: 'job-1', job_state: 'completed', job_kind: 'import' }, 2786)).toEqual({ kind: 'books' })
    expect(resolveBooksResume({ id: 'job-1', job_state: 'failed', job_kind: 'import' }, 1)).toEqual({ kind: 'books' })
    expect(resolveBooksResume(null, 12)).toEqual({ kind: 'books' })
  })

  it('asks where the books were for a fresh company', () => {
    expect(resolveBooksResume(null, 0)).toEqual({ kind: 'none' })
    expect(resolveBooksResume({ id: 'job-1', job_state: 'failed', job_kind: 'import' }, 0)).toEqual({ kind: 'none' })
  })

  it('a duplicate-repair job is not an import to follow', () => {
    expect(resolveBooksResume({ id: 'job-2', job_state: 'running', job_kind: 'duplicate_repair' }, 5)).toEqual({ kind: 'books' })
  })
})
