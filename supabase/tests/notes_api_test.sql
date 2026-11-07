-- Behaviour test for the notes migration. Run on a scratch database after
-- supabase_shim.sql and the migration (see supabase/tests/README.md).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

-- Owner session
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"Owner@example.com"}', false);
select 'owner? ' || notes_is_owner();

select 'folder: ' || (notes_api(null, 'create_folder', '{"path":"Work/Ideas"}') ->> 'path');
select 'again: ' || (notes_api(null, 'create_folder', '{"path":"work/ideas"}') ->> 'created');
select 'note: ' || (notes_api(null, 'create_note', '{"content":"# Grocery plan\nBuy milk and eggs.\n- [ ] bread","folder":"Work/Ideas","tags":["Home"," errands"]}') ->> 'title');
-- direct table write (what the web app does)
insert into notes (title, content) values ('', 'Dictated thought about switching careers into product management');
select 'inbox title: ' || title || ' by ' || last_edited_by from notes where folder_id is null;
select 'list inbox: ' || (notes_api(null, 'list_notes', '{"folder":"Inbox"}') ->> 'total');
select 'list all: ' || (notes_api(null, 'list_notes', '{}') ->> 'total');
select 'subfolders: ' || (notes_api(null, 'list_notes', '{"folder":"Work","include_subfolders":true}') ->> 'total');
select 'folders: ' || (notes_api(null, 'list_folders', '{}'))::text;
select 'search: ' || (notes_api(null, 'search_notes', '{"query":"milk"}') -> 'results' -> 0 ->> 'snippet');
select 'title search: ' || jsonb_array_length(notes_api(null, 'search_notes', '{"query":"Grocer"}') -> 'results');
select 'tags: ' || notes_api(null, 'list_tags', '{}')::text;

-- Keys
select set_config('test.key', create_note_agent_key('Claude', false) ->> 'key', false);
select set_config('test.wkey', create_note_agent_key('Writer', true) ->> 'key', false);
select set_config('test.ikey', create_note_agent_key('Inbox only', p_access => 'inbox') ->> 'key', false);
select 'access: ' || string_agg(k ->> 'label' || '=' || (k ->> 'access') || '/' || (k ->> 'can_write'), ', ' order by k ->> 'label')
from jsonb_array_elements(list_note_agent_keys()) k;
select 'keys: ' || jsonb_array_length(list_note_agent_keys());
reset role;

-- Anonymous caller (what the MCP server is): key required
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select 'anon read: ' || (notes_api(current_setting('test.key'), 'list_notes', '{}') ->> 'total');
do $$ begin
  perform notes_api(current_setting('test.key'), 'create_note', '{"title":"x"}');
  raise exception 'read-only key wrote';
exception when insufficient_privilege then raise notice 'ok: read-only key cannot write';
end $$;
do $$ begin
  perform notes_api(null, 'list_notes', '{}');
  raise exception 'anon without key read';
exception when insufficient_privilege then raise notice 'ok: no key, no access';
end $$;
do $$ begin
  perform notes_api('notes_bogus_key_000000000000', 'list_notes', '{}');
  raise exception 'bogus key read';
exception when insufficient_privilege then raise notice 'ok: bogus key rejected';
end $$;
do $$ begin
  perform count(*) from notes;
  raise exception 'anon read the table';
exception when insufficient_privilege then raise notice 'ok: anon cannot read tables';
end $$;
do $$ begin
  perform notes_pending_embeddings(5);
  raise exception 'anon called embeddings fn';
exception when insufficient_privilege then raise notice 'ok: anon cannot call embedding fns';
end $$;

-- Writer agent
select set_config('test.note', (select (notes_api(current_setting('test.wkey'), 'search_notes', '{"query":"grocery"}') -> 'results' -> 0 ->> 'id')), false);
select 'append: ' || (notes_api(current_setting('test.wkey'), 'append_to_note', jsonb_build_object('note', current_setting('test.note'), 'text', '- [ ] butter')) ->> 'version');
select 'edit: ' || (notes_api(current_setting('test.wkey'), 'edit_note', jsonb_build_object('note', 'grocery plan', 'old_text', 'milk', 'new_text', 'oat milk')) ->> 'version');
do $$ begin
  perform notes_api(current_setting('test.wkey'), 'edit_note', jsonb_build_object('note', current_setting('test.note'), 'old_text', 'zzz', 'new_text', 'y'));
  raise exception 'edit of missing text worked';
exception when invalid_parameter_value then raise notice 'ok: %', sqlerrm;
end $$;
do $$ begin
  perform notes_api(current_setting('test.wkey'), 'replace_note', jsonb_build_object('note', current_setting('test.note'), 'content', 'x', 'expected_version', 1));
  raise exception 'stale replace worked';
exception when serialization_failure then raise notice 'ok: %', sqlerrm;
end $$;
select 'update: ' || (notes_api(current_setting('test.wkey'), 'update_note', jsonb_build_object('note', current_setting('test.note'), 'add_tags', '["Shopping"]'::jsonb, 'remove_tags', '["errands"]'::jsonb, 'pinned', true)) ->> 'tags');
select 'move: ' || (notes_api(current_setting('test.wkey'), 'move_note', jsonb_build_object('note', current_setting('test.note'), 'folder', 'Work')) ->> 'folder');
select 'get: ' || (notes_api(current_setting('test.wkey'), 'get_note', jsonb_build_object('note', current_setting('test.note'))) ->> 'content');
select 'edited by: ' || (notes_api(current_setting('test.wkey'), 'get_note', jsonb_build_object('note', current_setting('test.note'))) ->> 'last_edited_by');
select 'history: ' || jsonb_array_length(notes_api(current_setting('test.wkey'), 'get_note_history', jsonb_build_object('note', current_setting('test.note'))) -> 'versions');
select set_config('test.ver', (notes_api(current_setting('test.wkey'), 'get_note_history', jsonb_build_object('note', current_setting('test.note'))) -> 'versions' -> 0 ->> 'version_id'), false);
select set_config('test.pre', (notes_api(current_setting('test.wkey'), 'get_note', jsonb_build_object('note', current_setting('test.note'))) ->> 'content'), false);
select 'restore version: ' || (notes_api(current_setting('test.wkey'), 'restore_version', jsonb_build_object('version_id', current_setting('test.ver'))) ->> 'version');
select 'restored text: ' || (notes_api(current_setting('test.wkey'), 'get_note', jsonb_build_object('note', current_setting('test.note'))) ->> 'content');
-- The same key edited moments ago; restoring must still keep that text in history.
do $$ begin
  if not exists (
    select 1 from jsonb_array_elements(notes_api(current_setting('test.wkey'), 'get_note_history', jsonb_build_object('note', current_setting('test.note'))) -> 'versions') v
    where notes_api(current_setting('test.wkey'), 'get_note_version', jsonb_build_object('version_id', v ->> 'version_id')) ->> 'content' = current_setting('test.pre')
  ) then
    raise exception 'restore discarded the current text';
  end if;
  raise notice 'ok: restore kept the current text in history';
end $$;
select 'rename: ' || (notes_api(current_setting('test.wkey'), 'rename_folder', '{"folder":"Work/Ideas","name":"Brainstorm"}') ->> 'path');
select 'move folder: ' || (notes_api(current_setting('test.wkey'), 'move_folder', '{"folder":"Work/Brainstorm","parent":""}') ->> 'path');
do $$ begin
  perform notes_api(current_setting('test.wkey'), 'create_folder', '{"path":"Work/Deep"}');
  perform notes_api(current_setting('test.wkey'), 'move_folder', '{"folder":"Work","parent":"Work/Deep"}');
  raise exception 'cycle allowed';
exception when invalid_parameter_value then raise notice 'ok: %', sqlerrm;
end $$;
select 'delete folder: ' || notes_api(current_setting('test.wkey'), 'delete_folder', '{"folder":"Work"}')::text;
select 'trash: ' || (notes_api(current_setting('test.wkey'), 'list_notes', '{"trash":true}') ->> 'total');
select 'restore: ' || (notes_api(current_setting('test.wkey'), 'restore_note', jsonb_build_object('note', current_setting('test.note'))) ->> 'folder');
select 'recent: ' || (notes_api(current_setting('test.wkey'), 'get_recent_notes', '{"days":1}') ->> 'total');
reset role;

-- Agent log and embeddings (service role)
select 'agent actions: ' || count(*) from note_agent_actions;
set role service_role;
select 'pending: ' || count(*) from notes_pending_embeddings(10);
select 'store: ' || notes_store_embeddings(
  (select id from notes where title = 'Grocery plan'),
  (select content_hash from notes where title = 'Grocery plan'),
  jsonb_build_array(jsonb_build_object('content', 'chunk', 'embedding', (select jsonb_agg(0.05) from generate_series(1, 384)))));
select 'pending after: ' || count(*) from notes_pending_embeddings(10);
reset role;

-- Semantic search through the API with an embedding passed as JSON
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"owner@example.com"}', false);
select 'semantic: ' || (notes_api(null, 'search_notes', jsonb_build_object('query', 'shopping list', 'embedding', (select jsonb_agg(0.05) from generate_series(1, 384)))) -> 'results' -> 0 ->> 'match');

-- A viewer (not the owner) gets nothing
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"viewer@example.com"}', false);
select 'viewer rows: ' || count(*) from notes;
do $$ begin
  perform notes_api(null, 'list_notes', '{}');
  raise exception 'viewer used the api';
exception when insufficient_privilege then raise notice 'ok: viewer blocked';
end $$;
reset role;

-- Inbox-only key: add to the Inbox, change only notes still in the Inbox
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select set_config('test.inote', notes_api(current_setting('test.ikey'), 'create_note', '{"title":"Inbox idea","content":"first"}') ->> 'id', false);
select 'inbox create: ' || coalesce(notes_api(current_setting('test.ikey'), 'get_note', jsonb_build_object('note', current_setting('test.inote'))) ->> 'folder', 'Inbox');
select 'inbox append: ' || (notes_api(current_setting('test.ikey'), 'append_to_note', jsonb_build_object('note', current_setting('test.inote'), 'text', 'second')) ->> 'version');
select 'inbox edit: ' || (notes_api(current_setting('test.ikey'), 'edit_note', jsonb_build_object('note', current_setting('test.inote'), 'old_text', 'first', 'new_text', 'one')) ->> 'version');
do $$ begin
  perform notes_api(current_setting('test.ikey'), 'create_note', '{"title":"x","folder":"Brainstorm"}');
  raise exception 'inbox key created in a folder';
exception when insufficient_privilege then raise notice 'ok: %', sqlerrm;
end $$;
select 'inbox create "Inbox": ' || coalesce(notes_api(current_setting('test.ikey'), 'create_note', '{"title":"y","folder":"Inbox"}') ->> 'folder', 'Inbox');
do $$
declare v_action text;
begin
  foreach v_action in array array['replace_note', 'update_note', 'move_note', 'delete_note', 'restore_note', 'create_folder'] loop
    begin
      perform notes_api(current_setting('test.ikey'), v_action, jsonb_build_object('note', current_setting('test.inote'), 'content', 'x', 'folder', 'Brainstorm', 'path', 'Z'));
      raise exception 'inbox key ran %', v_action;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'ok: inbox key refused other writes';
end $$;
select 'filed: ' || (notes_api(current_setting('test.wkey'), 'move_note', jsonb_build_object('note', current_setting('test.inote'), 'folder', 'Brainstorm')) ->> 'folder');
do $$ begin
  perform notes_api(current_setting('test.ikey'), 'append_to_note', jsonb_build_object('note', current_setting('test.inote'), 'text', 'more'));
  raise exception 'inbox key changed a filed note';
exception when insufficient_privilege then raise notice 'ok: %', sqlerrm;
end $$;
do $$ begin
  perform notes_api(current_setting('test.ikey'), 'edit_note', jsonb_build_object('note', current_setting('test.inote'), 'old_text', 'one', 'new_text', 'two'));
  raise exception 'inbox key edited a filed note';
exception when insufficient_privilege then raise notice 'ok: inbox key cannot edit a filed note';
end $$;
reset role;

-- Administrative SQL sessions must also identify the configured owner.
reset role;
select set_config('request.jwt.claims', '', false);
do $$ begin
  perform notes_api(null, 'list_notes', '{}');
  raise exception 'unauthenticated SQL session bypassed owner checks';
exception when insufficient_privilege then raise notice 'ok: SQL session still needs owner identity or agent key';
end $$;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);

-- Images: a note that starts with a photo takes its title from the text; the
-- image URL is not in the preview or the search index.
with created as (select notes_api(null, 'create_note',
  '{"content":"![](https://x.supabase.co/storage/v1/object/authenticated/note-images/n/a.jpg)\n\nTrip to Banff\nLake Louise ![lake](https://x/l.jpg) was cold"}') as r)
select 'image title: ' || (r ->> 'title') || ' / preview: ' || (r ->> 'preview') from created;
select 'image urls in the search index (expect 0): ' || count(*) from notes where search::text like '%note-images%';

-- Image Trash: images removed from every note go to the Trash for 30 days;
-- a note deleted for good takes its images at once.
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
select set_config('test.img', 'https://x.supabase.co/storage/v1/object/authenticated/note-images/', false);
select set_config('test.ia', notes_api(null, 'create_note', jsonb_build_object('content',
  'Trip ![one](' || current_setting('test.img') || 'n/p1.jpg) and ![](' || current_setting('test.img') || 'n/p2.jpg)')) ->> 'id', false);
select 'tracked: ' || count(*) || ', in trash: ' || count(trashed_at) from note_images where path in ('n/p1.jpg', 'n/p2.jpg');
select notes_api(null, 'edit_note', jsonb_build_object('note', current_setting('test.ia'), 'old_text', ' and ![](' || current_setting('test.img') || 'n/p2.jpg)', 'new_text', '')) is not null as removed_p2;
select 'p2 trashed for 30 days: ' || (trashed_at is not null and delete_after between now() + interval '29 days' and now() + interval '31 days')
from note_images where path = 'n/p2.jpg';
select notes_api(null, 'append_to_note', jsonb_build_object('note', current_setting('test.ia'), 'text', '![](' || current_setting('test.img') || 'n/p2.jpg)')) is not null as put_back;
select 'p2 back: ' || (trashed_at is null) from note_images where path = 'n/p2.jpg';
-- An image used by two notes stays while either has it.
select set_config('test.ib', notes_api(null, 'create_note', jsonb_build_object('content', 'Copy ![](' || current_setting('test.img') || 'n/p1.jpg)')) ->> 'id', false);
select notes_api(null, 'edit_note', jsonb_build_object('note', current_setting('test.ia'), 'old_text', '![one](' || current_setting('test.img') || 'n/p1.jpg)', 'new_text', '')) is not null as removed_p1_from_a;
select 'p1 kept (still in B): ' || (trashed_at is null) from note_images where path = 'n/p1.jpg';
-- B deleted for good: p1 is due now.
delete from notes where id = current_setting('test.ib')::uuid;
select 'p1 due now: ' || (trashed_at is not null and delete_after <= now()) from note_images where path = 'n/p1.jpg';
select 'due: ' || string_agg(p, ',') from notes_images_due(10) p;
select 'forgotten: ' || notes_images_forget(array['n/p1.jpg', 'n/p2.jpg']) || ' (p2 is in use, kept)';

-- Image links for agents: one-hour links to the notes-images function.
select set_config('test.links', notes_image_links(null, current_setting('test.ia'))::text, false);
select 'link: ' || regexp_replace(current_setting('test.links')::jsonb #>> '{images,0,url}', 't=[0-9a-f]+$', 't=…');
select 'link opens: ' || notes_image_ticket_path(split_part(current_setting('test.links')::jsonb #>> '{images,0,url}', 't=', 2));
select 'bad link: ' || coalesce(notes_image_ticket_path('nope'), 'null');
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ begin
  perform notes_image_links(null, current_setting('test.ia'));
  raise exception 'anon got image links';
exception when insufficient_privilege then raise notice 'ok: anon needs a key for image links';
end $$;
do $$ begin
  perform 1 from note_images;
  raise exception 'anon read note_images';
exception when insufficient_privilege then raise notice 'ok: anon cannot read note_images';
end $$;
do $$ begin
  perform notes_image_ticket_path('x');
  raise exception 'anon redeemed a link';
exception when insufficient_privilege then raise notice 'ok: only the Edge Function opens links';
end $$;
select 'read-only key gets links: ' || jsonb_array_length(notes_image_links(current_setting('test.key'), current_setting('test.ia')) -> 'images');
reset role;

-- Revocation applies immediately even to a key used previously.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
select revoke_note_agent_key((select (k ->> 'id')::bigint from jsonb_array_elements(list_note_agent_keys()) k where k ->> 'label' = 'Writer'));
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
do $$ begin
  perform notes_api(current_setting('test.wkey'), 'list_notes', '{}');
  raise exception 'revoked key still works';
exception when insufficient_privilege then raise notice 'ok: revoked key blocked';
end $$;
reset role;
