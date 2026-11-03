-- Optional. Run only after configuration and Edge Function deployment.
-- This file is deliberately outside migrations: schema installation never
-- schedules network calls. No project address or credential is hard-coded.
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$ begin
  if not exists (select 1 from notes_private.settings) then
    raise exception 'Configure your installation first (INSTALL.md step 3).';
  end if;
end $$;
select cron.unschedule(jobname) from cron.job
where jobname in ('notes-embed', 'notes-images-purge', 'notes-images-sweep');

select cron.schedule('notes-embed', '* * * * *', $job$
  select net.http_post(
    url := s.project_url || '/functions/v1/notes-embed',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notes-cron-secret', s.cron_secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  ) from notes_private.settings s
  where exists (select 1 from public.notes where deleted_at is null and content_hash is distinct from embedded_hash)
$job$);
select cron.schedule('notes-images-purge', '17 * * * *', $job$
  select net.http_post(
    url := s.project_url || '/functions/v1/notes-images',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notes-cron-secret', s.cron_secret),
    body := '{"action":"purge"}'::jsonb, timeout_milliseconds := 60000
  ) from notes_private.settings s
  where exists (select 1 from public.note_images where trashed_at is not null and delete_after <= now())
$job$);
select cron.schedule('notes-images-sweep', '43 3 * * *', $job$ select public.notes_images_sweep() $job$);
