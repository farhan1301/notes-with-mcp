-- Fixture for a disposable database only; never use this UUID on a live project.
insert into notes_private.settings (owner_user_id, project_url, cron_secret)
values ('11111111-1111-1111-1111-111111111111', 'https://x.supabase.co', repeat('a', 64));
