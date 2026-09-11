import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ENABLED_EXTENSION_IDS } from '@/lib/extensions/_generated/enabled-extensions'
import BooksJourney from '@/components/onboarding/books/BooksJourney'

export const dynamic = 'force-dynamic'

/**
 * /onboarding/books: act two of the onboarding journey (issue #2438).
 *
 * The company exists (the dashboard layout above resolved it and mounted
 * the company context); this act brings the books in, then the bank and
 * Skatteverket, inside the journey chrome. The layout renders its bare
 * shell for this path. The station and the OAuth landing parameters arrive
 * in the query string: the first-session gate rewrites /settings/banking
 * and /import onto this page with their query intact, and the Skatteverket
 * callback returns here through its return_to.
 */
export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const first = (key: string) => {
    const v = params[key]
    return Array.isArray(v) ? v[0] : v
  }

  return (
    <BooksJourney
      initialStation={first('station') ?? null}
      initialProvider={first('provider') ?? null}
      landedFromProvider={Boolean(first('migration') || first('handoff') || first('consentId'))}
      selectAccounts={first('select_accounts') ?? null}
      skvConnected={first('skv_connected') === 'true'}
      landedError={first('bank_error') ?? first('skv_error') ?? null}
      hasMigration={ENABLED_EXTENSION_IDS.has('arcim-migration')}
      hasBanking={ENABLED_EXTENSION_IDS.has('enable-banking')}
      hasSkatteverket={ENABLED_EXTENSION_IDS.has('skatteverket')}
    />
  )
}
