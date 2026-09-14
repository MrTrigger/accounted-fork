'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Loader2, Mail, Send } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { submitFeedback } from '@/lib/support/submit-feedback'
import {
  conversationsAvailable,
  currentTicketId,
  isResolved,
  listTickets,
  loadThread,
  markThreadRead,
  pickActiveTicket,
  replyInThread,
  sortByActivity,
  totalUnread,
  type Thread,
  type TicketStatus,
  type TicketSummary,
} from '@/lib/support/conversations'
import { useCompanyOptional } from '@/contexts/CompanyContext'

interface SupportLinkProps {
  /** 'hidden' renders no trigger: the dialog is controlled by `open`. */
  variant?: 'inline' | 'muted' | 'hidden'
  subject?: string
  children?: React.ReactNode
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * loading  fetching tickets or a thread
 * thread   the conversation with support (reply box when it is the active ticket)
 * compose  no open ticket: write a new one
 * email    conversations unavailable (self-hosted, analytics off): the mail form
 * sent     the mail form delivered
 */
type View = 'loading' | 'thread' | 'compose' | 'email' | 'sent'

const POLL_MS = 20_000

/**
 * The support dialog. Since 2026-09-14 the conversation lives in PostHog
 * Support and the founders answer there, so this is a thread the user can
 * come back to, not a one-way form. The mail form remains as the fallback
 * for installs without PostHog.
 */
export function SupportLink({ variant = 'inline', subject, children, className, open: openProp, onOpenChange }: SupportLinkProps) {
  const t = useTranslations('support_link')
  const locale = useLocale()
  const { toast } = useToast()
  const companyCtx = useCompanyOptional()

  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const [view, setView] = useState<View>('loading')
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [active, setActive] = useState<TicketSummary | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [showEarlier, setShowEarlier] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [unread, setUnread] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenState(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange]
  )

  const showTicket = useCallback(async (ticketId: string, silent = false) => {
    if (!silent) setView('loading')
    const next = await loadThread(ticketId)
    if (!next) {
      setLoadFailed(true)
      setView('thread')
      return
    }
    setLoadFailed(false)
    setThread(next)
    setView('thread')
    if (next.unreadCount > 0) {
      await markThreadRead(ticketId)
      setTickets((prev) => prev.map((x) => (x.id === ticketId ? { ...x, unreadCount: 0 } : x)))
      setUnread((n) => Math.max(0, n - next.unreadCount))
    }
  }, [])

  const bootstrap = useCallback(async () => {
    setView('loading')
    setThread(null)
    setShowEarlier(false)
    if (!conversationsAvailable()) {
      setView('email')
      return
    }
    const list = sortByActivity(await listTickets())
    setTickets(list)
    setUnread(totalUnread(list))
    const next = pickActiveTicket(list, currentTicketId())
    setActive(next)
    if (!next) {
      setView('compose')
      return
    }
    await showTicket(next.id)
  }, [showTicket])

  // Unread dot on the trigger: one cheap call when the trigger mounts.
  useEffect(() => {
    if (variant === 'hidden' || !conversationsAvailable()) return
    let cancelled = false
    listTickets().then((list) => {
      if (!cancelled) setUnread(totalUnread(list))
    })
    return () => {
      cancelled = true
    }
  }, [variant])

  // Deferred a tick so the effect itself sets no state (react-hooks rule);
  // bootstrap does its work after awaits anyway.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => void bootstrap(), 0)
    return () => clearTimeout(id)
  }, [open, bootstrap])

  // Keep the open thread fresh while the dialog is up, so a reply that lands
  // during the conversation shows without a reload.
  const viewingId = thread?.ticketId ?? null
  useEffect(() => {
    if (!open || view !== 'thread' || !viewingId) return
    const id = setInterval(() => void showTicket(viewingId, true), POLL_MS)
    return () => clearInterval(id)
  }, [open, view, viewingId, showTicket])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread])

  if (companyCtx?.isSandbox) return null

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setDraft('')
      setView('loading')
    }
  }

  async function handleCompose(e: React.FormEvent) {
    e.preventDefault()
    const message = draft.trim()
    if (message.length < 5) return
    setSending(true)
    const result = await submitFeedback({ subject, message })
    setSending(false)
    if (!result.ok) {
      toast({ title: t('send_failed_title'), description: result.error || t('send_failed_fallback'), variant: 'destructive' })
      return
    }
    setDraft('')
    if (result.channels.includes('ticket')) {
      await bootstrap()
      return
    }
    setView('sent')
    setTimeout(() => handleOpenChange(false), 2000)
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault()
    const message = draft.trim()
    if (!message || !viewingId) return
    setSending(true)
    const res = await replyInThread(message)
    setSending(false)
    if (!res) {
      toast({ title: t('send_failed_title'), description: t('reply_failed'), variant: 'destructive' })
      return
    }
    setDraft('')
    if (res.ticketId !== viewingId) await bootstrap()
    else await showTicket(viewingId, true)
  }

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  const statusLabel = (s: TicketStatus) => t(`status_${s}`)

  const canReply = Boolean(thread && active && thread.ticketId === active.id && !isResolved(thread.status))
  const earlier = tickets.filter((x) => x.id !== viewingId)

  const triggerLabel = (
    <>
      {children ?? t('default_label')}
      {unread > 0 && (
        <span
          aria-label={t('unread_aria', { count: unread })}
          className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
        />
      )}
    </>
  )

  const trigger =
    variant === 'hidden' ? null : variant === 'muted' ? (
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer',
          className
        )}
      >
        <Mail className="h-3 w-3" />
        {triggerLabel}
      </button>
    ) : (
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 text-primary hover:text-primary/80 underline-offset-4 hover:underline transition-colors text-sm cursor-pointer',
          className
        )}
      >
        {triggerLabel}
      </button>
    )

  const composer = (onSubmit: (e: React.FormEvent) => void, placeholder: string, label: string, minLength: number) => (
    <form onSubmit={onSubmit} className="mt-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className="min-h-[96px] resize-none"
        maxLength={5000}
        disabled={sending}
        autoFocus
      />
      <DialogFooter className="mt-3">
        <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={sending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={sending || draft.trim().length < minLength}>
          {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {sending ? t('sending') : label}
        </Button>
      </DialogFooter>
    </form>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dialog_title')}</DialogTitle>
          <DialogDescription>{view === 'thread' ? t('thread_description') : t('dialog_description')}</DialogDescription>
        </DialogHeader>

        {view === 'loading' && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {view === 'sent' && (
          <div className="flex flex-col items-center py-6 gap-3">
            <div className="p-3 rounded-full bg-success/10">
              <Send className="h-6 w-6 text-success" />
            </div>
            <p className="text-sm font-medium">{t('thanks')}</p>
          </div>
        )}

        {(view === 'compose' || view === 'email') && composer(handleCompose, t('placeholder'), t('send'), 5)}

        {view === 'thread' && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[11px] text-muted-foreground">
                {thread ? statusLabel(thread.status) : ''}
              </span>
              {earlier.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowEarlier((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showEarlier ? t('hide_earlier') : t('earlier_tickets', { count: earlier.length })}
                </button>
              )}
            </div>

            {showEarlier && (
              <ul className="mt-2 flex flex-col gap-1">
                {earlier.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => void showTicket(x.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-secondary/35 transition-colors"
                    >
                      <span className="truncate text-foreground">{x.lastMessage || t('no_messages')}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{statusLabel(x.status)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {loadFailed ? (
              <p className="mt-4 text-sm text-muted-foreground">{t('load_failed')}</p>
            ) : (
              <div ref={listRef} className="mt-3 flex max-h-[45vh] flex-col gap-3 overflow-y-auto pr-1">
                {thread?.messages.map((m) => (
                  <div key={m.id} className={cn('flex flex-col gap-1', m.from === 'me' ? 'items-end' : 'items-start')}>
                    <span className="text-[11px] text-muted-foreground">
                      {m.from === 'me' ? t('you') : (m.authorName ?? t('support_name'))}
                    </span>
                    <div
                      className={cn(
                        'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm',
                        m.from === 'me' ? 'bg-secondary' : 'border border-border'
                      )}
                    >
                      {m.text}
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{fmt(m.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}

            {canReply ? (
              composer(handleReply, t('reply_placeholder'), t('reply'), 1)
            ) : (
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{t('resolved_hint')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft('')
                    setView('compose')
                  }}
                >
                  {t('new_ticket')}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
