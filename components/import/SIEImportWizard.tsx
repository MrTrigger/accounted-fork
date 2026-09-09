'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/components/ui/use-toast'
import { getErrorMessage } from '@/lib/errors/get-error-message'
import { cn } from '@/lib/utils'
import { fetchAccounts } from '@/lib/reference-data/fetchers'
import { invalidateReferenceData } from '@/lib/reference-data/invalidate'
import { applyMappingOverride } from '@/lib/import/account-mapper'
import type { ImportExecuteOptions } from '@/components/import/ImportReviewStep'
import type { BASAccount } from '@/types'
import type {
  ImportWizardStep,
  ParsedSIEFile,
  AccountMapping,
  ImportPreview,
  ImportResult,
  ParseIssue,
} from '@/lib/import/types'
import {
  applyVatTreatmentReview,
  applyVatTreatmentReviewAll,
  enrichChangedAccountMappingWithVat,
  enrichAccountMappingsWithVat,
} from '@/lib/import/account-vat-treatment'
import type { AccountVatTreatment } from '@/lib/vat/account-vat-treatment'
import type { TheaterModel } from '@/lib/import/theater-model'

/**
 * The SIE import wizard (upload, preview, mapping, review with the import
 * theater, result). Extracted unchanged from app/(dashboard)/import/page.tsx
 * so the onboarding books act (issue #2438) can host the same wizard inside
 * the journey chrome. Needs CompanyProvider and reference data: render it
 * under the dashboard layout only.
 */

/** Above this size the client-side theater parse is skipped (main-thread
 *  parse of very large SIE files would jank the animation it exists for). */
const THEATER_MAX_FILE_BYTES = 8 * 1024 * 1024

function ImportStepLoading() {
  return (
    <div className="flex min-h-48 items-center justify-center" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}

const SIEUploadStep = dynamic(() => import('@/components/import/SIEUploadStep'), { loading: ImportStepLoading })
const SIEPreviewStep = dynamic(() => import('@/components/import/SIEPreviewStep'), { loading: ImportStepLoading })
const AccountMappingStep = dynamic(() => import('@/components/import/AccountMappingStep'), { loading: ImportStepLoading })
const ImportReviewStep = dynamic(() => import('@/components/import/ImportReviewStep'), { loading: ImportStepLoading })
const ImportResultStep = dynamic(() => import('@/components/import/ImportResultStep'), { loading: ImportStepLoading })

const SIE_STEP_LABELS: Record<ImportWizardStep, string> = {
  upload: 'Ladda upp',
  preview: 'Förhandsgranskning',
  mapping: 'Kontomappning',
  review: 'Bekräfta',
  result: 'Resultat',
}

export default function SIEImportWizard({
  onOpenManualOpeningBalances,
  onImported,
}: {
  /** Switch to the manual "Ingående balanser" wizard (SIE preview, issue #2082). */
  onOpenManualOpeningBalances?: () => void
  /** The server confirmed a successful import (books act, issue #2438). */
  onImported?: () => void
}) {
  const { toast } = useToast()

  const [step, setStep] = useState<ImportWizardStep>('upload')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorType, setErrorType] = useState<'duplicate' | 'duplicate_period' | 'validation' | 'parse' | 'network' | undefined>()
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [validationWarnings, setValidationWarnings] = useState<string[]>([])
  const [duplicateImportId, setDuplicateImportId] = useState<string | null>(null)
  const [isReplacing, setIsReplacing] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [, setParsed] = useState<ParsedSIEFile | null>(null)
  const [mappings, setMappings] = useState<AccountMapping[]>([])
  const [basAccounts, setBasAccounts] = useState<BASAccount[]>([])
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [issues, setIssues] = useState<ParseIssue[]>([])
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [theaterModel, setTheaterModel] = useState<TheaterModel | null>(null)
  const [, setSieAccounts] = useState<{ number: string; name: string }[]>([])
  const [isCreatingAccounts, setIsCreatingAccounts] = useState(false)

  // Skip the mapping step when all accounts are already mapped
  const hasUnmapped = mappings.some((m) => !m.targetAccount)
  const needsVatReview = mappings.some((m) =>
    m.requiresVatTreatmentReview && !m.vatTreatmentReviewed
  )
  const showMappingStep = hasUnmapped || needsVatReview
  const sieSteps: ImportWizardStep[] = showMappingStep
    ? ['upload', 'preview', 'mapping', 'review', 'result']
    : ['upload', 'preview', 'review', 'result']

  const currentStepIndex = sieSteps.indexOf(step)
  const progress = ((currentStepIndex + 1) / sieSteps.length) * 100

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    setError(null)
    setErrorType(undefined)
    setValidationErrors([])
    setValidationWarnings([])
    setIsLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)

      const res = await fetch('/api/import/sie/parse', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        const code = data?.error?.code as string | undefined
        const message = getErrorMessage(data)
        const details = (data?.error?.details ?? {}) as {
          importId?: string
          errors?: string[]
          warnings?: string[]
        }
        if (code === 'SIE_DUPLICATE_FILE' || code === 'SIE_DUPLICATE_PERIOD') {
          const isPeriod = code === 'SIE_DUPLICATE_PERIOD'
          setErrorType(isPeriod ? 'duplicate_period' : 'duplicate')
          setError(message)
          if (details.importId) {
            setDuplicateImportId(details.importId)
          }
          toast({
            title: isPeriod ? 'Överlappande räkenskapsår' : 'Filen har redan importerats',
            description: message,
            variant: 'destructive',
          })
        } else if (code === 'SIE_PARSE_VALIDATION_FAILED') {
          setErrorType('validation')
          setError(message)
          setValidationErrors(details.errors || [])
          setValidationWarnings(details.warnings || [])
          toast({
            title: 'Valideringsfel i SIE-filen',
            description: `${(details.errors || []).length} fel hittades som måste åtgärdas.`,
            variant: 'destructive',
          })
        } else {
          setErrorType('parse')
          setError(message)
          toast({ title: 'Kunde inte läsa filen', description: message, variant: 'destructive' })
        }
        return
      }

      setParsed({
        header: data.parsed.header,
        accounts: data.parsed.accounts,
        openingBalances: [],
        closingBalances: [],
        resultBalances: [],
        vouchers: [],
        dimensions: [],
        dimensionValues: [],
        issues: data.parsed.issues,
        stats: data.parsed.stats,
      })
      setPreview(data.preview)
      setIssues(data.parsed.issues)
      setSieAccounts(data.parsed.accounts)

      const accounts = await fetchAccounts(false).catch(() => {
        throw new Error('Kunde inte hämta kontoplanen för momsgranskning.')
      })
      setBasAccounts(accounts)
      setMappings(enrichAccountMappingsWithVat(data.mappings, accounts))

      setStep('preview')

      toast({
        title: 'Fil analyserad',
        description: `${data.parsed.stats.totalAccounts} konton och ${data.parsed.stats.totalVouchers} verifikationer hittades`,
      })
    } catch (err) {
      const isNetworkError = err instanceof TypeError && (err.message === 'Failed to fetch' || err.message.includes('NetworkError'))
      const message = isNetworkError
        ? 'Kunde inte nå servern. Kontrollera din internetanslutning och försök igen.'
        : getErrorMessage(err)
      setErrorType(isNetworkError ? 'network' : 'parse')
      setError(message)
      toast({ title: isNetworkError ? 'Anslutningsfel' : 'Ett fel uppstod', description: message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  const handleUndo = useCallback(async (importId: string) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/import/sie/${importId}/undo`, { method: 'DELETE' })
      const data = await res.json()

      if (!res.ok) {
        toast({ title: 'Kunde inte ångra import', description: getErrorMessage(data), variant: 'destructive' })
        return
      }

      toast({
        title: 'Import ångrad',
        description: `${data.deletedEntries} verifikation${data.deletedEntries === 1 ? '' : 'er'} raderades.`,
      })

      // Reset wizard to upload step so the user can re-import a corrected file
      setStep('upload')
      setFile(null)
      setParsed(null)
      setMappings([])
      setPreview(null)
      setIssues([])
      setImportResult(null)
      setError(null)
      setErrorType(undefined)
      setValidationErrors([])
      setValidationWarnings([])
      setDuplicateImportId(null)
      setSieAccounts([])
    } catch {
      toast({ title: 'Anslutningsfel', description: 'Kunde inte nå servern.', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  const handleReplace = useCallback(async (importId: string) => {
    if (!file) return

    setIsReplacing(true)
    try {
      const res = await fetch(`/api/import/sie/${importId}/replace`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast({ title: 'Kunde inte ersätta import', description: getErrorMessage(data), variant: 'destructive' })
        return
      }

      toast({
        title: 'Import ersatt',
        description: `${data.deletedEntries} verifikation${data.deletedEntries === 1 ? '' : 'er'} raderades. Importerar ny fil...`,
      })

      // Clear error state and re-trigger the file upload
      setError(null)
      setErrorType(undefined)
      setDuplicateImportId(null)

      // Small delay so the user sees the success toast before re-upload starts
      await new Promise(resolve => setTimeout(resolve, 500))
      handleFileSelect(file)
    } catch {
      toast({ title: 'Anslutningsfel', description: 'Kunde inte nå servern.', variant: 'destructive' })
    } finally {
      setIsReplacing(false)
    }
  }, [file, handleFileSelect, toast])

  const handleMappingChange = useCallback((sourceAccount: string, targetAccount: string, targetName: string) => {
    setMappings((prev) => enrichChangedAccountMappingWithVat(
      applyMappingOverride(prev, sourceAccount, targetAccount, targetName),
      sourceAccount,
      basAccounts,
    ))

    setPreview((prev) => {
      if (!prev) return prev
      const updatedMappings = enrichChangedAccountMappingWithVat(
        applyMappingOverride(mappings, sourceAccount, targetAccount, targetName),
        sourceAccount,
        basAccounts,
      )
      const mapped = updatedMappings.filter((m) => m.targetAccount).length
      const unmapped = updatedMappings.length - mapped
      const lowConfidence = updatedMappings.filter((m) => m.targetAccount && m.confidence < 0.7).length

      return {
        ...prev,
        mappingStatus: {
          ...prev.mappingStatus,
          mapped,
          unmapped,
          lowConfidence,
        },
      }
    })
  }, [basAccounts, mappings])

  const handleVatTreatmentChange = useCallback((
    sourceAccount: string,
    treatment: AccountVatTreatment | null,
    rate: number | null,
  ) => {
    setMappings((prev) => applyVatTreatmentReview(prev, sourceAccount, treatment, rate))
  }, [])

  const handleConfirmAllVatTreatments = useCallback(() => {
    setMappings((prev) => applyVatTreatmentReviewAll(prev))
  }, [])

  const confirmVatReview = useCallback(() => {
    if (mappings.some((mapping) =>
      mapping.requiresVatTreatmentReview && !mapping.vatTreatmentReviewed
    )) {
      setError('Granska momshanteringen för alla markerade konton innan du fortsätter.')
      return
    }
    setStep('review')
    setError(null)
    setValidationErrors([])
    setValidationWarnings([])
  }, [mappings])

  const missingAccounts = mappings
    .filter((m) => !m.targetAccount)
    .map((m) => ({ number: m.sourceAccount, name: m.sourceName }))

  const handleCreateAccounts = useCallback(async () => {
    if (missingAccounts.length === 0) return

    setIsCreatingAccounts(true)

    try {
      const res = await fetch('/api/import/sie/create-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: missingAccounts }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast({ title: 'Kunde inte skapa konton', description: getErrorMessage(data), variant: 'destructive' })
        return
      }

      toast({ title: 'Konton skapade', description: `${data.created} nya konton har lagts till i din kontoplan` })

      const createdSet = new Set(missingAccounts.map(a => a.number))
      // New accounts exist now: refresh every cached chart (pickers app-wide)
      // and re-read the full chart for the VAT review below.
      await invalidateReferenceData('ref:accounts')
      const accounts = await fetchAccounts(false).catch(() => {
        throw new Error('Kunde inte hämta kontoplanen för momsgranskning.')
      })
      setBasAccounts(accounts)
      setMappings(prev => {
        let updated = prev.map(m =>
          !m.targetAccount && createdSet.has(m.sourceAccount)
            ? { ...m, targetAccount: m.sourceAccount, targetName: m.sourceName, confidence: 1.0 }
            : m
        )
        for (const sourceAccount of createdSet) {
          updated = enrichChangedAccountMappingWithVat(updated, sourceAccount, accounts)
        }
        return updated
      })
      setPreview(prev => {
        if (!prev) return prev
        const newMapped = prev.mappingStatus.mapped + createdSet.size
        return {
          ...prev,
          mappingStatus: {
            ...prev.mappingStatus,
            mapped: newMapped,
            unmapped: Math.max(0, prev.mappingStatus.unmapped - createdSet.size),
          },
          // The accounts just created now exist in the chart and are mapped
          // to themselves: they move from "Ej mappade" to "Finns redan". They
          // were never in "Läggs till" (planChartChanges counts mapped targets
          // only), so that count and its sample stay as they are.
          chart: prev.chart
            ? { ...prev.chart, existing: prev.chart.existing + createdSet.size }
            : prev.chart,
        }
      })
    } catch (err) {
      toast({ title: 'Kunde inte skapa konton', description: err instanceof Error ? getErrorMessage(err) : 'Försök igen.', variant: 'destructive' })
    } finally {
      setIsCreatingAccounts(false)
    }
  }, [missingAccounts, toast])

  const handleExecuteImport = useCallback(async (options: ImportExecuteOptions) => {
    if (!file) { setError('No file selected'); return }

    setIsLoading(true)
    setError(null)

    // Import theater: parse the file client-side (the parser is browser-clean)
    // so the graph can build itself while the server writes. Best-effort with
    // a size cap: any failure just leaves the plain spinner takeover.
    if (file.size <= THEATER_MAX_FILE_BYTES) {
      void (async () => {
        try {
          const [{ parseSIEFile, detectEncoding, decodeBuffer }, { buildTheaterModel }] =
            await Promise.all([import('@/lib/import/sie-parser'), import('@/lib/import/theater-model')])
          const buffer = await file.arrayBuffer()
          const parsed = parseSIEFile(decodeBuffer(buffer, detectEncoding(buffer)))
          setTheaterModel(buildTheaterModel(parsed))
        } catch {
          // Theater is a nicety; the import itself is unaffected.
        }
      })()
    }

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mappings', JSON.stringify(mappings))
      formData.append('options', JSON.stringify(options))

      const res = await fetch('/api/import/sie/execute', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        const code = data?.error?.code as string | undefined
        const message = getErrorMessage(data)
        const failedResult = data?.error?.details?.result as typeof data.result | undefined

        if (code === 'SIE_DUPLICATE_FILE' || code === 'SIE_DUPLICATE_PERIOD') {
          setError(message)
          toast({ title: 'Filen har redan importerats', description: message, variant: 'destructive' })
          return
        }
        if (failedResult) {
          setImportResult(failedResult)
        } else {
          setError(message)
          toast({ title: 'Import misslyckades', description: message, variant: 'destructive' })
          return
        }
      } else {
        setImportResult(data.result)
        onImported?.()
      }

      setStep('result')
      // An import creates periods and accounts: refresh the session caches so
      // every picker in the app sees them without a reload.
      void invalidateReferenceData(['ref:accounts', 'ref:fiscal-periods'])

      if (data.result?.success) {
        const created = data.result.journalEntriesCreated
        const skipped = data.result.details?.skippedVouchers?.total || 0
        toast({
          title: 'Import genomförd',
          description: `${created} verifikationer skapades${skipped > 0 ? ` (${skipped} hoppades över)` : ''}`,
        })
      } else if (data.result && !data.result.success) {
        toast({
          title: 'Import slutförd med problem',
          description: `${data.result.errors?.length || 0} fel uppstod under importen. Se resultatet för detaljer.`,
          variant: 'destructive',
        })
      }
    } catch (err) {
      const isNetworkError = err instanceof TypeError && (err.message === 'Failed to fetch' || err.message.includes('NetworkError'))
      const msg = isNetworkError
        ? 'Tappade anslutningen till servern under importen. Kontrollera din internetanslutning och se om importen genomfördes under Bokföring.'
        : getErrorMessage(err)
      setError(msg)
      toast({ title: 'Import avbröts', description: msg, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [file, mappings, toast])

  const goToStep = (targetStep: ImportWizardStep) => { setStep(targetStep); setError(null); setValidationErrors([]); setValidationWarnings([]) }
  const goBack = () => { const i = sieSteps.indexOf(step); if (i > 0) setStep(sieSteps[i - 1]) }

  const handleNewImport = () => {
    setStep('upload'); setFile(null); setParsed(null); setMappings([])
    setPreview(null); setIssues([]); setImportResult(null); setError(null); setErrorType(undefined)
    setValidationErrors([]); setValidationWarnings([]); setDuplicateImportId(null)
    setSieAccounts([]); setIsCreatingAccounts(false); setTheaterModel(null)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="sm:hidden text-primary font-medium">
                Steg {currentStepIndex + 1}/{sieSteps.length}: {SIE_STEP_LABELS[step]}
              </span>
              {sieSteps.map((s, i) => (
                <span key={s} className={cn(
                  'hidden sm:inline',
                  i <= currentStepIndex ? 'text-primary font-medium' : 'text-muted-foreground'
                )}>
                  {SIE_STEP_LABELS[s]}
                </span>
              ))}
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {step === 'upload' && <SIEUploadStep onFileSelect={handleFileSelect} isLoading={isLoading} error={error} errorType={errorType} validationErrors={validationErrors} validationWarnings={validationWarnings} duplicateImportId={duplicateImportId} onReplace={handleReplace} isReplacing={isReplacing} />}
      {step === 'preview' && preview && (
        <SIEPreviewStep preview={preview} issues={issues} missingAccounts={missingAccounts}
          onCreateAccounts={handleCreateAccounts} isCreatingAccounts={isCreatingAccounts}
          onContinue={() => goToStep(showMappingStep ? 'mapping' : 'review')} onBack={goBack}
          onOpenManualOpeningBalances={onOpenManualOpeningBalances} />
      )}
      {step === 'mapping' && (
        <AccountMappingStep mappings={mappings} basAccounts={basAccounts}
          onMappingChange={handleMappingChange} onVatTreatmentChange={handleVatTreatmentChange}
          onConfirmAllVatTreatments={handleConfirmAllVatTreatments}
          onContinue={confirmVatReview} onBack={goBack} />
      )}
      {step === 'review' && preview && (
        <ImportReviewStep preview={preview} mappings={mappings}
          onExecute={handleExecuteImport} onBack={goBack} isLoading={isLoading}
          theaterModel={theaterModel} />
      )}
      {step === 'result' && importResult && (
        <ImportResultStep result={importResult} onNewImport={handleNewImport} onUndo={handleUndo}
          preview={preview} theaterModel={theaterModel}
          unresolvedVatAccountCount={mappings.filter((mapping) =>
            mapping.sourceAccount === mapping.targetAccount &&
            ['3', '4'].includes(mapping.sourceAccount.charAt(0)) &&
            !mapping.defaultVatTreatment
          ).length} />
      )}
    </div>
  )
}
