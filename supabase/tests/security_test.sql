\set ON_ERROR_STOP 1
-- Every public table must have RLS, including when default grants are broad.
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception 'public table without RLS';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and p.proname not in ('notes_api', 'notes_image_links', 'notes_prepare_image_upload')
  ) then raise exception 'internal definer function exposed to anon'; end if;
end $$;
set role anon;
do $$ begin
  perform 1 from notes_private.settings;
  raise exception 'anonymous caller read installation settings';
exception when insufficient_privilege then null;
end $$;
reset role;
set role authenticated;
-- An outsider using the owner's email still fails: ownership is by UUID.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"owner@example.com"}', false);
do $$ begin
  if notes_is_owner() then raise exception 'email impersonation granted access'; end if;
  begin
    insert into notes(content) values ('unauthorized');
    raise exception 'outsider wrote a note';
  exception when insufficient_privilege then null; end;
  begin
    perform create_note_agent_key('outsider');
    raise exception 'outsider made agent key';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id, name) values ('note-images', 'outsider.png');
    raise exception 'outsider uploaded image';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
do $$ begin
  if not notes_is_owner() then raise exception 'owner denied'; end if;
end $$;
insert into storage.objects(bucket_id, name) values ('note-images', 'owner.png');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', false);
do $$ begin
  if exists (select 1 from storage.objects) then raise exception 'outsider read owner images'; end if;
end $$;
reset role;
-- Until an administrator configures the owner, nobody may claim the workspace.
begin;
delete from notes_private.settings;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
do $$ begin
  if notes_is_owner() then raise exception 'unconfigured workspace was claimed'; end if;
end $$;
rollback;
