'use client'

import { useState, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { AiConnectorDialog } from '@/components/onboarding/AiConnectorDialog'
import { useBranding } from '@/lib/branding/brand-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCompany } from '@/contexts/CompanyContext'
import { AI_CLIENTS, aiChatLink, aiConnectAction, pickConnectedAiClient, type AiClient } from '@/lib/onboarding/ai-clients'
import type { AiTask } from '@/lib/worklist/ai-task'

const TASK_LABELS = {
  book_transaction: 'row_book_transactions',
  book_skattekonto: 'row_book_skattekonto',
  inbox_document: 'row_inbox_documents',
  supplier_invoice_approval: 'row_supplier_approval',
  verifikat_missing_document: 'row_missing_underlag',
  overdue_invoice: 'row_overdue_invoices',
  deadline_action: 'row_deadlines',
  reconciliation_due: 'row_reconciliation_due',
} as const satisfies Record<AiTask['category'], string>

/**
 * The footer under Att göra: hand the first row to a connected AI client.
 *
 * Sits directly under the list, left-aligned, as one button (founder
 * direction 2026-09-14: one "Koppla agent", not three alternatives).
 *
 * Not connected: "Koppla agent" carries the three client logos and opens a
 * menu to pick Claude, ChatGPT or Grok; picking one runs that client's
 * connect action (deep link, or copy the server URL and open its connector
 * page), the same as the end of the books act.
 *
 * Connected: review the task locally, then copy it and open an empty chat.
 * Company data never enters an external URL. With several clients connected
 * the button leads with the first and a menu picks another.
 */
export function AttGoraAiCta({
  clients,
  task,
  onboarding = false,
  preferredClient,
  onOpen,
  disabled = false,
}: {
  clients: AiClient[]
  task: AiTask | null
  onboarding?: boolean
  preferredClient?: AiClient
  onOpen?: () => void
  disabled?: boolean
}) {
  const t = useTranslations('dashboard')
  const books = useTranslations('books')
  const { appName } = useBranding()
  const { company } = useCompany()
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const [handoffClient, setHandoffClient] = useState<AiClient | null>(null)

  const [connectAction, setConnectAction] = useState<ReturnType<typeof aiConnectAction> | null>(null)

  const connected = AI_CLIENTS.filter((c) => clients.includes(c.id))
  // The OAuth connection follows the user and may have been made for another
  // company. Both entry points explicitly identify the company being handed off.
  const prompt = task && company
    ? `${t('ai_task_company', { name: company.name, id: company.id })}\n\n${t(`ai_task_${task.category}`, { count: task.count })}`
    : null

  function connect(client: AiClient) {
    const action = aiConnectAction(client, { origin: window.location.origin, appName })
    if (action.copy) setConnectAction(action)
    else window.open(action.open, '_blank', 'noopener')
  }

  async function copyPrompt() {
    if (!prompt || disabled) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyFailed(false)
      setCopiedPrompt(prompt)
    } catch {
      setCopiedPrompt(null)
      setCopyFailed(true)
    }
  }

  function reviewTask(client: AiClient) {
    if (disabled) return
    setCopiedPrompt(null)
    setCopyFailed(false)
    setHandoffClient(client)
  }

  function openTask(event: MouseEvent<HTMLAnchorElement>) {
    if (disabled) {
      event.preventDefault()
      return
    }
    onOpen?.()
    setHandoffClient(null)
  }

  if (!task) return null
  if (connected.length === 0) {
    if (onboarding) return null
    return (
      <div className="mt-5 px-1">
        <AiConnectorDialog action={connectAction} onClose={() => setConnectAction(null)} />
        <p className="mb-2.5 text-[12.5px] leading-5 text-muted-foreground">{t('ai_connect_lead')}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <span className="mr-2 flex items-center -space-x-1" aria-hidden>
                {AI_CLIENTS.map((c) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={c.id} src={c.logo} alt="" className="h-4 w-4 rounded-full bg-background ring-1 ring-background" />
                ))}
              </span>
              {t('ai_connect_agent')}
              <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-60" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {AI_CLIENTS.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => connect(c.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.logo} alt="" className="mr-2 h-4 w-4" />
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  if (!task || !prompt) return null

  const primaryId = pickConnectedAiClient(clients, preferredClient)
  const primary = connected.find((client) => client.id === primaryId)!
  const others = connected.filter((client) => client.id !== primaryId)
  const selected = connected.find((client) => client.id === handoffClient)
  const actionLabel = (client: string) => onboarding
    ? books('ai_handoff_with', { client })
    : t('ai_fix_first_with', { client })

  return (
    <div className={onboarding ? 'aihandoff' : 'mt-5 px-1'}>
      <p className={onboarding ? 'aihandoff-lead' : 'mb-2.5 text-[12.5px] leading-5 text-muted-foreground'}>
        {onboarding ? books('ai_handoff_lead') : t('ai_fix_first_lead')}
      </p>
      {onboarding && <p className="aihandoff-task">{t(TASK_LABELS[task.category])} <span className="tabular-nums">· {task.count}</span></p>}
      <div className={`flex flex-wrap items-center gap-2${onboarding ? ' justify-center' : ''}`}>
        <Button type="button" size="sm" onClick={() => reviewTask(primary.id)} disabled={disabled}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={primary.logo} alt="" className="mr-1.5 h-3.5 w-3.5" />
            {actionLabel(primary.name)}
            <ExternalLink className="ml-1.5 h-3 w-3 opacity-70" aria-hidden />
        </Button>
        {others.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={t('ai_fix_first_other')}>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {others.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => reviewTask(c.id)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.logo} alt="" className="mr-2 h-4 w-4" />
                    {actionLabel(c.name)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {onboarding && <p className="aihandoff-note">{books('ai_handoff_note', { client: primary.name })}</p>}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setHandoffClient(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ai_review_title', { client: selected?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('ai_review_description', { client: selected?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <Textarea readOnly rows={7} value={prompt} aria-label={t('ai_review_prompt')} onFocus={(event) => event.currentTarget.select()} />
          {copyFailed && <p className="text-sm text-destructive" role="alert">{t('ai_copy_failed')}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void copyPrompt()} disabled={disabled} aria-live="polite">
              <Copy className="mr-2 h-4 w-4" aria-hidden />
              {copiedPrompt === prompt ? t('ai_prompt_copied') : t('ai_copy_prompt')}
            </Button>
            {selected && <Button asChild>
              <a href={aiChatLink(selected.id)} target="_blank" rel="noopener noreferrer" onClick={openTask} aria-disabled={disabled} tabIndex={disabled ? -1 : undefined}>
                {t('ai_open_client', { client: selected.name })}
                <ExternalLink className="ml-2 h-4 w-4" aria-hidden />
              </a>
            </Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
