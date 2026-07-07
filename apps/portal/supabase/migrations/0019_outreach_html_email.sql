-- Visual (HTML) outreach emails.
--
-- Templates and sent-email rows gain an optional body_html. When present it's
-- the rich version authored in the visual editor and is what gets sent (as an
-- HTML email with an auto-generated plain-text fallback). When absent, the
-- existing plain-text body_template / body keeps working unchanged, so all
-- current templates and scheduled follow-ups are unaffected.

alter table wisecall_outreach_email_templates
  add column if not exists body_html text;

alter table wisecall_outreach_emails
  add column if not exists body_html text;

-- Public bucket for images dropped into emails. Public read so the <img>
-- URLs resolve in the recipient's inbox; uploads go through a service-role
-- server action (admin-gated), so no client write policy is needed.
insert into storage.buckets (id, name, public)
values ('outreach-assets', 'outreach-assets', true)
on conflict (id) do nothing;

-- Explicit public read policy (belt-and-braces alongside the bucket's public
-- flag) so the images are always fetchable by email clients.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'outreach_assets_public_read'
  ) then
    create policy "outreach_assets_public_read"
      on storage.objects for select
      using (bucket_id = 'outreach-assets');
  end if;
end $$;
