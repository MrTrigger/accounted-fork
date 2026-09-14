/**
 * Where the books act should open when the page loads (a reload, a return
 * from another tab): the act's position lives in browser memory, the
 * import's state lives in the database. This reads the latter.
 */

export type LatestImportJob = {
  id: string
  job_state: string | null
  job_kind: string | null
}

/** Job states in which the worker still owns the import (or waits for a resume). */
const ACTIVE_STATES = new Set(['queued', 'preparing', 'running', 'reconciling', 'paused', 'finalizing'])

export type BooksResume =
  | { kind: 'active'; importId: string }
  | { kind: 'books' }
  | { kind: 'none' }

/**
 * - active: the latest import job is still running or paused: the act opens
 *   on the theatre following it.
 * - books: nothing runs but posted entries exist: the act opens on the
 *   genomlysning, not on the provider list.
 * - none: a fresh company: the act asks where the books were.
 * Only 'import' jobs count; a duplicate-repair job is not an import.
 */
export function resolveBooksResume(latest: LatestImportJob | null, postedEntries: number): BooksResume {
  if (latest && (latest.job_kind ?? 'import') === 'import' && latest.job_state && ACTIVE_STATES.has(latest.job_state)) {
    return { kind: 'active', importId: latest.id }
  }
  if (postedEntries > 0) return { kind: 'books' }
  return { kind: 'none' }
}
