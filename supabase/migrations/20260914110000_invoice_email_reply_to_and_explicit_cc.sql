-- Invoice email: a configurable Reply-To address, and no implicit copy recipient.
--
-- Reply-To: every invoice email ends with "Svara direkt på detta mejl", but the
-- message only carried a reply address when the company email was set. Replies
-- to any other company went to the platform noreply sender. The new column is
-- the explicit reply address; the app falls back to the company email and then
-- to the sending user's address.
--
-- CC: NULL in invoice_email_cc_addresses meant "copy the company email, or the
-- sending user's login email". The login-email leg never showed in settings,
-- so the sender saw a fixed CC they could not find. Companies that were
-- receiving the company-email copy keep it as an explicit configured list;
-- from here on NULL and '{}' both mean no fixed copies. Re-running is a no-op.

ALTER TABLE public.company_settings
  ADD COLUMN invoice_email_reply_to text,
  ADD CONSTRAINT company_settings_invoice_email_reply_to_format
    CHECK (
      invoice_email_reply_to IS NULL
      OR (
        length(invoice_email_reply_to) <= 254
        AND invoice_email_reply_to ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    );

COMMENT ON COLUMN public.company_settings.invoice_email_reply_to IS
  'Reply-To for invoice, reminder and payment-confirmation emails. NULL falls back to the company email, then to the sending user.';

BEGIN;

SET LOCAL gnubok.actor_type = 'system';
SET LOCAL gnubok.actor_label = 'migration 20260914110000 invoice_email_reply_to_and_explicit_cc';

UPDATE public.company_settings
SET invoice_email_cc_addresses = ARRAY[btrim(email)]
WHERE invoice_email_cc_addresses IS NULL
  AND email IS NOT NULL
  AND btrim(email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

COMMIT;

COMMENT ON COLUMN public.company_settings.invoice_email_cc_addresses IS
  'Fixed CC recipients for invoice emails. NULL and an empty array both mean no fixed copies (the company-email fallback ended 2026-09-14).';

NOTIFY pgrst, 'reload schema';
