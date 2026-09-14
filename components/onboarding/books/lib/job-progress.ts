import type { SIEJob } from '@/lib/import/sie-job-contract'

/** What the theatre's "Verifikaten skrivs" line says while a job runs. */
export type JobPhase = 'preparing' | 'writing' | 'checking'

/**
 * Read an import job's progress for the theatre: how many of its vouchers
 * the worker has written (chunks done over chunks total, scaled to the
 * file's voucher count) and which phase word fits. Pure so both steps
 * (Fortnox and SIE file) read the job the same way.
 */
export function jobProgress(job: Pick<SIEJob, 'job_state' | 'chunks_total' | 'chunks_done' | 'transactions_count'>): {
  written: number
  phase: JobPhase
} {
  const total = Math.max(0, job.transactions_count ?? 0)
  const written = job.chunks_total > 0
    ? Math.min(total, Math.round((total * job.chunks_done) / job.chunks_total))
    : 0
  const phase: JobPhase =
    job.job_state === 'reconciling' || job.job_state === 'finalizing'
      ? 'checking'
      : job.job_state === 'running'
        ? 'writing'
        : 'preparing'
  return { written, phase }
}
