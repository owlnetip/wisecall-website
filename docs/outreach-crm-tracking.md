# Dental outreach CRM — engagement tracking

Light/Mailchimp-style organisation for Dentally sequences (day 0 → 3 → 7 → 14).

## What you get in `/admin/outreach`

- **Stats strip**: Dentally count, have email, ready to send, first email sent, opened, awaiting reply, replied, follow-ups due
- **Smart lists**: Ready to email · Awaiting reply · Opened no reply · Never opened · Follow-up due · Replied · Missing email
- **Per prospect**: first email sent time, first opened time, open count, mark replied / interested (stops sequence)
- **Activity**: delivered / opened / clicked / bounced timestamps per email
- **Guards**: no duplicate first email; follow-ups only use Dentally templates (not Exact drafts)

## One-time setup after deploy

1. **Run migration** `0020_outreach_engagement_tracking.sql` on the portal Supabase project.
2. **Resend webhook** (required for opens):
   - URL: `https://app.wisecall.io/api/webhooks/resend`
   - Events: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`
   - Copy signing secret → env `RESEND_WEBHOOK_SECRET`
3. Optional: `OUTREACH_REPLY_TO=you@wisecall.io` so day 3/7/14 replies land in your inbox.

Until the webhook is live, sent/scheduled tracking still works; opens stay empty.

## Daily workflow (Dentally traction)

1. Smart list **Missing email** → add addresses for Dentally independents
2. **Ready to email** → send first email (schedules 3/7/14)
3. **Opened · no reply** → call or personal chase
4. When they reply → **Mark replied** (cancels remaining follow-ups)
5. Use **Send N due follow-ups** or the daily cron if anything is overdue
