-- Public photos for the website chat launcher. The widget loads them by URL.
-- Uploads go through a service-role server action (the signed-in owner), so
-- there is no client write policy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-avatars',
  'chat-avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public read so the chat image loads on a customer's website. Writes stay on
-- the service role, which bypasses this policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'chat_avatars_public_read'
  ) then
    create policy "chat_avatars_public_read"
      on storage.objects for select
      using (bucket_id = 'chat-avatars');
  end if;
end $$;
