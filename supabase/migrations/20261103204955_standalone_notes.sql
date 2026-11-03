-- Notes: folders, Markdown notes, version history, search and AI agent keys.
--
-- * Only the explicitly configured Supabase Auth user can use the web app.
-- * The web app reads and writes note_folders / notes directly (RLS: owner
--   only). Everything else, and everything agents do, goes through
--   notes_api(p_token, p_action, p_args): a null token means "the signed-in
--   owner", otherwise it must be an active notes key.
-- * Every title/content change bumps notes.version. Saving with
--   `where version = <the version you loaded>` detects conflicting edits.
-- * Before a note changes, its previous text is copied to note_versions
--   (once per editing session: consecutive saves by the same editor within
--   10 minutes keep a single snapshot), so any edit can be undone.
-- * Search: Postgres full text (notes.search) plus meaning-based search over
--   note_chunks.embedding (gte-small, 384 dims), filled by the notes-embed
--   Edge Function. See supabase/schedules.sql (optional background jobs).
--
-- Safe to re-run.

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- One installation, one owner. Provisioned by an administrator, never claimed
-- by the first person to visit the app. UUID comes from Supabase Auth users.
create schema if not exists notes_private;
revoke all on schema notes_private from public, anon, authenticated;
create table if not exists notes_private.settings (
  singleton boolean primary key default true check (singleton),
  owner_user_id uuid not null references auth.users(id),
  project_url text not null check (project_url ~ '^https://[a-z0-9-]+[.]supabase[.]co$'),
  cron_secret text not null check (length(cron_secret) >= 32)
);
alter table notes_private.settings enable row level security;
revoke all on notes_private.settings from public, anon, authenticated;

create or replace function public.notes_is_owner()
returns boolean language sql stable security definer
set search_path to ''
as $$
  select auth.uid() is not null and exists (
    select 1 from notes_private.settings s where s.owner_user_id = auth.uid()
  )
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.note_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.note_folders(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100 and position('/' in name) = 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists note_folders_name_key
  on public.note_folders (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists note_folders_parent_idx on public.note_folders (parent_id);

comment on table public.note_folders is 'Folders for notes. Nested through parent_id. Notes without a folder are in the Inbox.';

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.note_folders(id) on delete set null,
  title text not null default '',
  content text not null default '' check (length(content) <= 500000),
  preview text not null default '',
  tags text[] not null default '{}',
  pinned boolean not null default false,
  version integer not null default 1,
  last_edited_by text not null default 'you',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search tsvector,
  content_hash text,
  embedded_hash text
);

create index if not exists notes_folder_idx on public.notes (folder_id) where deleted_at is null;
create index if not exists notes_updated_idx on public.notes (updated_at desc);
create index if not exists notes_search_idx on public.notes using gin (search);
create index if not exists notes_tags_idx on public.notes using gin (tags);

comment on table public.notes is 'Markdown notes. folder_id null = Inbox. deleted_at set = in Trash.';
comment on column public.notes.content is 'The note body as Markdown (plain text is fine too).';
comment on column public.notes.version is 'Bumped on every title/content change. Save with where version = <loaded version> to detect conflicts.';
comment on column public.notes.last_edited_by is '"you" for the owner, "agent: <key label>" for an AI agent.';
comment on column public.notes.embedded_hash is 'content_hash when note_chunks were last built; differs from content_hash while embeddings are pending.';

create table if not exists public.note_versions (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.notes(id) on delete cascade,
  version integer not null,
  title text not null,
  content text not null,
  edited_by text not null,
  edited_at timestamptz not null,
  saved_at timestamptz not null default now()
);

create index if not exists note_versions_note_idx on public.note_versions (note_id, id desc);

comment on table public.note_versions is 'Earlier text of a note, saved before it was changed. Restore with notes_api(..., ''restore_version'', ...).';

create table if not exists public.note_chunks (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.notes(id) on delete cascade,
  idx integer not null,
  content text not null,
  embedding extensions.vector(384) not null
);

create index if not exists note_chunks_note_idx on public.note_chunks (note_id);
create index if not exists note_chunks_embedding_idx on public.note_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.note_agent_keys (
  id bigint generated always as identity primary key,
  label text not null,
  token_prefix text not null,
  token_hash text not null unique,
  can_write boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

comment on table public.note_agent_keys is 'AI agent keys for the notes MCP server. Only a SHA-256 hash of each key is stored.';

create table if not exists public.note_agent_actions (
  id bigint generated always as identity primary key,
  key_id bigint references public.note_agent_keys(id) on delete set null,
  key_label text not null,
  action text not null,
  note_id uuid,
  folder_id uuid,
  summary text,
  created_at timestamptz not null default now()
);

create index if not exists note_agent_actions_created_idx on public.note_agent_actions (created_at desc);

-- ── Folder helpers ───────────────────────────────────────────────────────────

/** "Work/Ideas" for a folder id; "Inbox" for null. */
create or replace function public.notes_folder_path(p_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive up as (
    select id, parent_id, name, 0 as depth from note_folders where id = p_id
    union all
    select f.id, f.parent_id, f.name, up.depth + 1
    from note_folders f join up on f.id = up.parent_id
    where up.depth < 50
  )
  select case when p_id is null then 'Inbox' else string_agg(name, '/' order by depth desc) end from up
$$;

/** The folder and all folders below it. */
create or replace function public.notes_folder_subtree(p_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive down as (
    select id, 0 as depth from note_folders where id = p_id
    union all
    select f.id, down.depth + 1 from note_folders f join down on f.parent_id = down.id
    where down.depth < 50
  )
  select coalesce(array_agg(id), '{}') from down
$$;

/** Folder id from an id or a path like "Work/Ideas" (case-insensitive). '' or 'Inbox' → null. */
create or replace function public.notes_resolve_folder(p_ref text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ref text := btrim(coalesce(p_ref, ''), ' /');
  v_part text;
  v_parent uuid := null;
  v_id uuid;
begin
  if v_ref = '' or lower(v_ref) = 'inbox' then
    return null;
  end if;
  if v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_id from note_folders where id = v_ref::uuid;
    if v_id is null then
      raise exception 'No folder with id %.', v_ref using errcode = '22023';
    end if;
    return v_id;
  end if;
  foreach v_part in array string_to_array(v_ref, '/') loop
    v_part := btrim(v_part);
    continue when v_part = '';
    select id into v_id from note_folders
    where parent_id is not distinct from v_parent and lower(name) = lower(v_part);
    if v_id is null then
      raise exception 'No folder "%". Call list_folders to see the folders, or create_folder to make it.', v_ref
        using errcode = '22023';
    end if;
    v_parent := v_id;
  end loop;
  return v_parent;
end;
$$;

/** Note id from an id or an exact title (case-insensitive, must be unique). */
create or replace function public.notes_resolve_note(p_ref text, p_include_deleted boolean default false)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ref text := btrim(coalesce(p_ref, ''));
  v_ids uuid[];
begin
  if v_ref = '' then
    raise exception 'Pass the note''s id.' using errcode = '22023';
  end if;
  if v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select array_agg(id) into v_ids from notes
    where id = v_ref::uuid and (deleted_at is null or p_include_deleted);
  else
    select array_agg(id) into v_ids from notes
    where lower(title) = lower(v_ref) and deleted_at is null;
  end if;
  if v_ids is null then
    raise exception 'No note "%". Search or list notes to find its id.', v_ref using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 1 then
    raise exception 'Several notes are titled "%" (ids: %). Pass the id instead.', v_ref, array_to_string(v_ids, ', ')
      using errcode = '22023';
  end if;
  return v_ids[1];
end;
$$;

create or replace function public.notes_note_summary(n public.notes)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'id', n.id,
    'title', n.title,
    'folder', notes_folder_path(n.folder_id),
    'folder_id', n.folder_id,
    'tags', to_jsonb(n.tags),
    'pinned', n.pinned,
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'last_edited_by', n.last_edited_by,
    'chars', length(n.content),
    'preview', n.preview
  )
$$;

/** Tag list from a JSON array (or a single string), lower-cased. */
create or replace function public.notes_tags_arg(p_value jsonb)
returns text[]
language sql
immutable
set search_path to ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then '{}'::text[]
    when jsonb_typeof(p_value) = 'array' then array(select lower(btrim(t)) from jsonb_array_elements_text(p_value) t)
    else string_to_array(lower(p_value #>> '{}'), ',')
  end
$$;

-- ── Triggers ─────────────────────────────────────────────────────────────────

create or replace function public.note_folders_before_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.name := btrim(new.name);
  if new.parent_id is null and lower(new.name) = 'inbox' then
    raise exception '"Inbox" is reserved for notes without a folder.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.parent_id is distinct from old.parent_id and new.parent_id is not null
       and new.parent_id = any(notes_folder_subtree(new.id)) then
      raise exception 'A folder cannot move into itself or one of its subfolders.' using errcode = '22023';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists note_folders_before_write on public.note_folders;
create trigger note_folders_before_write
  before insert or update on public.note_folders
  for each row execute function public.note_folders_before_write();

create or replace function public.notes_before_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor text := coalesce(nullif(current_setting('notes.actor', true), ''), 'you');
  v_first text;
  v_body text;
  v_lead text;
begin
  new.content := coalesce(new.content, '');
  new.title := btrim(coalesce(new.title, ''));
  -- No title: use the first non-blank line, like Apple Notes (cut at a word
  -- boundary, since a dictated first line can run on for a long time).
  if new.title = '' then
    select l into v_first from unnest(string_to_array(new.content, E'\n')) l where btrim(l) <> '' limit 1;
    v_first := btrim(regexp_replace(coalesce(v_first, ''), '^\s*(#+|[-*+]|\d+[.)])?\s*(\[[ xX]\]\s*)?', ''));
    new.title := case when length(v_first) <= 80 then v_first
                      else coalesce(nullif(regexp_replace(left(v_first, 80), '\s+\S*$', ''), ''), left(v_first, 80)) || '…' end;
  end if;
  new.tags := coalesce(array(
    select distinct lower(btrim(t)) from unnest(coalesce(new.tags, '{}')) t where btrim(t) <> '' order by 1
  ), '{}');

  if tg_op = 'INSERT' then
    new.version := 1;
    new.last_edited_by := v_actor;
    new.created_at := now();
    new.updated_at := now();
  else
    new.version := old.version;
    new.created_at := old.created_at;
    new.updated_at := old.updated_at;
    new.last_edited_by := old.last_edited_by;
    if (new.title, new.content) is distinct from (old.title, old.content) then
      new.version := old.version + 1;
      new.last_edited_by := v_actor;
      new.updated_at := now();
    elsif (new.folder_id, new.tags, new.pinned, new.deleted_at)
          is distinct from (old.folder_id, old.tags, old.pinned, old.deleted_at) then
      new.updated_at := now();
    end if;
  end if;

  -- List preview: the plain text after the title, without Markdown markers.
  v_body := regexp_replace(ltrim(new.content, E' \t\n'), '^#+[ \t]*', '');
  v_lead := rtrim(new.title, '…');
  if v_lead <> '' and left(v_body, length(v_lead)) = v_lead then
    v_body := substr(v_body, length(v_lead) + 1);
  end if;
  v_body := regexp_replace(v_body, '^[ \t]*(#+|>|[-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?', '', 'gn');
  v_body := regexp_replace(v_body, '\*\*|__|`', '', 'g');
  new.preview := left(btrim(regexp_replace(v_body, '\s+', ' ', 'g')), 200);
  new.search := setweight(to_tsvector('english', new.title), 'A')
             || setweight(to_tsvector('english', array_to_string(new.tags, ' ')), 'A')
             || setweight(to_tsvector('english', new.content), 'B');
  new.content_hash := md5(new.title || E'\n' || new.content);
  return new;
end;
$$;

drop trigger if exists notes_before_write on public.notes;
create trigger notes_before_write
  before insert or update on public.notes
  for each row execute function public.notes_before_write();

create or replace function public.notes_after_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.title, new.content) is distinct from (old.title, old.content)
     and (old.title <> '' or old.content <> '')
     and not (old.last_edited_by = new.last_edited_by and old.updated_at > now() - interval '10 minutes') then
    insert into note_versions (note_id, version, title, content, edited_by, edited_at)
    values (old.id, old.version, old.title, old.content, old.last_edited_by, old.updated_at);
    -- Keep the latest 100 versions per note.
    delete from note_versions
    where note_id = new.id
      and id not in (select id from note_versions where note_id = new.id order by id desc limit 100);
  end if;
  return null;
end;
$$;

drop trigger if exists notes_after_update on public.notes;
create trigger notes_after_update
  after update on public.notes
  for each row execute function public.notes_after_update();

-- ── Search ───────────────────────────────────────────────────────────────────

/**
 * Hybrid search: full-text matches and meaning matches (when p_embedding is
 * given) fused by reciprocal rank. p_has_folder limits it to p_folder and its
 * subfolders (p_folder null = Inbox).
 */
create or replace function public.notes_search_core(
  p_query text,
  p_embedding extensions.vector,
  p_folder uuid,
  p_has_folder boolean,
  p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  with q as (
    select websearch_to_tsquery('english', p_query) as tsq
  ),
  scope as (
    select n.id from notes n
    where n.deleted_at is null
      and (not p_has_folder
           or (p_folder is null and n.folder_id is null)
           or (p_folder is not null and n.folder_id = any(notes_folder_subtree(p_folder))))
  ),
  kw as (
    select n.id, row_number() over (order by ts_rank_cd(n.search, q.tsq, 32) desc, n.updated_at desc) as r
    from notes n, q
    where n.id in (select id from scope)
      and (n.search @@ q.tsq or n.title ilike '%' || p_query || '%')
    order by r
    limit 50
  ),
  chunk_hits as (
    select c.note_id, c.content, c.embedding <=> p_embedding as dist
    from note_chunks c
    where p_embedding is not null and c.note_id in (select id from scope)
    order by c.embedding <=> p_embedding
    limit 100
  ),
  sem as (
    select note_id as id,
           min(dist) as dist,
           (array_agg(content order by dist))[1] as chunk,
           row_number() over (order by min(dist)) as r
    from chunk_hits
    where dist < 0.22  -- similarity > 0.78, the cut-off Supabase suggests for gte-small
    group by note_id
  ),
  fused as (
    select coalesce(kw.id, sem.id) as id,
           coalesce(1.0 / (60 + kw.r), 0) + coalesce(1.0 / (60 + sem.r), 0) as score,
           kw.r as kr, sem.r as sr, sem.dist, sem.chunk
    from kw full join sem on kw.id = sem.id
  )
  select coalesce(jsonb_agg(x.j order by x.score desc), '[]'::jsonb)
  from (
    select f.score,
           (notes_note_summary(n) - 'preview') || jsonb_build_object(
             'match', case when f.kr is not null and f.sr is not null then 'keyword+meaning'
                           when f.kr is not null then 'keyword' else 'meaning' end,
             'similarity', case when f.dist is null then null else round((1 - f.dist)::numeric, 3) end,
             'snippet', case
               when f.kr is not null then ts_headline('english', n.content, (select tsq from q),
                 'MaxFragments=2, MinWords=8, MaxWords=30, StartSel=**, StopSel=**')
               else left(f.chunk, 300) end
           ) as j
    from fused f join notes n on n.id = f.id
    order by f.score desc
    limit p_limit
  ) x
$$;

-- ── The API (web app + agents) ───────────────────────────────────────────────

create or replace function public.notes_api(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
as $$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_write boolean := p_action not in (
    'list_folders', 'list_notes', 'get_note', 'get_recent_notes', 'search_notes',
    'list_tags', 'get_note_history', 'get_note_version'
  );
  v_key note_agent_keys;
  v_actor text;
  v_note notes;
  v_id uuid;
  v_folder uuid;
  v_parent uuid;
  v_ids uuid[];
  v_part text;
  v_text text;
  v_old text;
  v_count integer;
  v_limit integer;
  v_offset integer;
  v_sort text;
  v_tags text[];
  v_created boolean := false;
  v_summary text;
  v_result jsonb;
begin
  -- Who is calling: an agent key, or the signed-in owner.
  if p_token is not null then
    select * into v_key from note_agent_keys
    where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
    if v_key.id is null then
      raise exception 'Invalid or revoked notes key.' using errcode = '42501';
    end if;
    if v_write and not v_key.can_write then
      raise exception 'This key is read-only. Turn on "Can edit" for it in Notes → Settings → AI access.'
        using errcode = '42501';
    end if;
    update note_agent_keys set last_used_at = now() where id = v_key.id;
    v_actor := 'agent: ' || v_key.label;
  elsif notes_is_owner() then
    v_actor := 'you';
  else
    raise exception 'Sign in as the owner or pass a notes key.' using errcode = '42501';
  end if;
  perform set_config('notes.actor', v_actor, true);

  case p_action

  -- ── Reads ──
  when 'list_folders' then
    select jsonb_build_object(
      'inbox_notes', (select count(*) from notes where folder_id is null and deleted_at is null),
      'folders', coalesce(jsonb_agg(x.j order by lower(x.j ->> 'path')), '[]'::jsonb)
    ) into v_result
    from (
      select jsonb_build_object(
        'id', f.id, 'name', f.name, 'path', notes_folder_path(f.id), 'parent_id', f.parent_id,
        'notes', (select count(*) from notes n where n.folder_id = f.id and n.deleted_at is null)
      ) as j
      from note_folders f
    ) x;

  when 'list_notes', 'get_recent_notes' then
    v_limit := least(greatest(coalesce((a ->> 'limit')::int, case when p_action = 'list_notes' then 50 else 20 end), 1), 200);
    v_offset := greatest(coalesce((a ->> 'offset')::int, 0), 0);
    v_sort := coalesce(a ->> 'sort', 'updated');
    if a ? 'folder' then
      v_folder := notes_resolve_folder(a ->> 'folder');
    end if;
    select array_agg(id order by rn) into v_ids from (
      select n.id, row_number() over (
        order by
          case when p_action = 'list_notes' and v_sort <> 'created' then n.pinned end desc,
          case when v_sort = 'title' then lower(n.title) end asc,
          case when v_sort = 'created' then n.created_at end desc,
          n.updated_at desc
      ) as rn
      from notes n
      where case when coalesce((a ->> 'trash')::boolean, false) then n.deleted_at is not null else n.deleted_at is null end
        and (not (a ? 'folder')
             or (v_folder is null and n.folder_id is null)
             or (v_folder is not null and coalesce((a ->> 'include_subfolders')::boolean, false)
                 and n.folder_id = any(notes_folder_subtree(v_folder)))
             or (v_folder is not null and n.folder_id = v_folder))
        and (a ->> 'tag' is null or lower(a ->> 'tag') = any(n.tags))
        and (a ->> 'pinned' is null or n.pinned = (a ->> 'pinned')::boolean)
        and (p_action <> 'get_recent_notes'
             or n.updated_at > now() - make_interval(days => least(greatest(coalesce((a ->> 'days')::int, 7), 1), 3650)))
    ) s;
    select jsonb_build_object(
      'total', coalesce(array_length(v_ids, 1), 0),
      'notes', coalesce(jsonb_agg(notes_note_summary(n) order by array_position(v_ids, n.id)), '[]'::jsonb)
    ) into v_result
    from notes n
    where n.id = any(v_ids[v_offset + 1 : v_offset + v_limit]);

  when 'get_note' then
    v_id := notes_resolve_note(a ->> 'note', true);
    select * into v_note from notes where id = v_id;
    v_result := (notes_note_summary(v_note) - 'preview') || jsonb_build_object(
      'content', v_note.content, 'version', v_note.version, 'deleted_at', v_note.deleted_at);

  when 'search_notes' then
    v_text := btrim(coalesce(a ->> 'query', ''));
    if v_text = '' then
      raise exception 'Pass a query.' using errcode = '22023';
    end if;
    if a ? 'folder' then
      v_folder := notes_resolve_folder(a ->> 'folder');
    end if;
    v_result := jsonb_build_object(
      'semantic', a ? 'embedding',
      'results', notes_search_core(
        v_text,
        case when a ? 'embedding' then (a ->> 'embedding')::extensions.vector end,
        v_folder,
        a ? 'folder',
        least(greatest(coalesce((a ->> 'limit')::int, 10), 1), 50)
      )
    );

  when 'list_tags' then
    select coalesce(jsonb_agg(jsonb_build_object('tag', t, 'notes', c) order by c desc, t), '[]'::jsonb) into v_result
    from (
      select t, count(*) as c from notes, unnest(tags) t where deleted_at is null group by t
    ) s;

  when 'get_note_history' then
    v_id := notes_resolve_note(a ->> 'note', true);
    select * into v_note from notes where id = v_id;
    select jsonb_build_object(
      'note_id', v_id,
      'current', jsonb_build_object('version', v_note.version, 'edited_by', v_note.last_edited_by, 'edited_at', v_note.updated_at),
      'versions', coalesce(jsonb_agg(jsonb_build_object(
        'version_id', v.id, 'version', v.version, 'title', v.title, 'edited_by', v.edited_by,
        'edited_at', v.edited_at, 'chars', length(v.content),
        'preview', left(btrim(regexp_replace(v.content, '\s+', ' ', 'g')), 200)
      ) order by v.id desc), '[]'::jsonb)
    ) into v_result
    from (select * from note_versions where note_id = v_id order by id desc limit 50) v;

  when 'get_note_version' then
    select jsonb_build_object(
      'version_id', v.id, 'note_id', v.note_id, 'version', v.version, 'title', v.title,
      'content', v.content, 'edited_by', v.edited_by, 'edited_at', v.edited_at
    ) into v_result
    from note_versions v where v.id = (a ->> 'version_id')::bigint;
    if v_result is null then
      raise exception 'No version %.', a ->> 'version_id' using errcode = '22023';
    end if;

  -- ── Note writes ──
  when 'create_note' then
    if btrim(coalesce(a ->> 'title', '')) = '' and btrim(coalesce(a ->> 'content', '')) = '' then
      raise exception 'Pass a title or content.' using errcode = '22023';
    end if;
    v_folder := notes_resolve_folder(a ->> 'folder');
    insert into notes (folder_id, title, content, tags, pinned)
    values (v_folder, coalesce(a ->> 'title', ''), coalesce(a ->> 'content', ''),
            notes_tags_arg(a -> 'tags'), coalesce((a ->> 'pinned')::boolean, false))
    returning * into v_note;
    v_summary := format('Created "%s" in %s', v_note.title, notes_folder_path(v_folder));

  when 'append_to_note' then
    v_id := notes_resolve_note(a ->> 'note');
    v_text := a ->> 'text';
    if btrim(coalesce(v_text, '')) = '' then
      raise exception 'Pass the text to add.' using errcode = '22023';
    end if;
    update notes set content = case
        when coalesce(a ->> 'position', 'end') = 'start' then
          v_text || case when btrim(content) = '' then '' else E'\n\n' || ltrim(content, E'\n') end
        else
          rtrim(content, E'\n ') || case when btrim(content) = '' then '' else E'\n\n' end || v_text
      end
    where id = v_id
    returning * into v_note;
    v_summary := format('Added %s characters to "%s"', length(v_text), v_note.title);

  when 'edit_note' then
    v_id := notes_resolve_note(a ->> 'note');
    v_old := a ->> 'old_text';
    if coalesce(v_old, '') = '' then
      raise exception 'Pass old_text: the exact text to replace.' using errcode = '22023';
    end if;
    select * into v_note from notes where id = v_id for update;
    v_count := (length(v_note.content) - length(replace(v_note.content, v_old, ''))) / length(v_old);
    if v_count = 0 then
      raise exception 'old_text was not found in the note. Call get_note for the current text and copy it exactly, including line breaks.'
        using errcode = '22023';
    end if;
    if v_count > 1 and not coalesce((a ->> 'replace_all')::boolean, false) then
      raise exception 'old_text appears % times. Include more of the surrounding text so it matches once, or set replace_all.', v_count
        using errcode = '22023';
    end if;
    update notes set content = replace(content, v_old, coalesce(a ->> 'new_text', ''))
    where id = v_id
    returning * into v_note;
    v_summary := format('Edited "%s" (%s replacement%s)', v_note.title, v_count, case when v_count = 1 then '' else 's' end);

  when 'replace_note' then
    v_id := notes_resolve_note(a ->> 'note');
    if not (a ? 'content') then
      raise exception 'Pass the new content.' using errcode = '22023';
    end if;
    select * into v_note from notes where id = v_id for update;
    if a ? 'expected_version' and (a ->> 'expected_version')::int <> v_note.version then
      raise exception 'The note changed since version % (now version %). Call get_note and redo the change.',
        a ->> 'expected_version', v_note.version using errcode = '40001';
    end if;
    update notes set content = a ->> 'content', title = coalesce(a ->> 'title', title)
    where id = v_id
    returning * into v_note;
    v_summary := format('Rewrote "%s"', v_note.title);

  when 'update_note' then
    v_id := notes_resolve_note(a ->> 'note');
    select * into v_note from notes where id = v_id for update;
    v_tags := v_note.tags;
    if a ? 'tags' then v_tags := notes_tags_arg(a -> 'tags'); end if;
    if a ? 'add_tags' then v_tags := v_tags || notes_tags_arg(a -> 'add_tags'); end if;
    if a ? 'remove_tags' then
      v_tags := array(select t from unnest(v_tags) t where t <> all(notes_tags_arg(a -> 'remove_tags')));
    end if;
    update notes set
      title = coalesce(a ->> 'title', title),
      tags = v_tags,
      pinned = coalesce((a ->> 'pinned')::boolean, pinned)
    where id = v_id
    returning * into v_note;
    v_summary := format('Updated "%s"', v_note.title);

  when 'move_note' then
    v_id := notes_resolve_note(a ->> 'note');
    v_folder := notes_resolve_folder(a ->> 'folder');
    update notes set folder_id = v_folder where id = v_id returning * into v_note;
    v_summary := format('Moved "%s" to %s', v_note.title, notes_folder_path(v_folder));

  when 'delete_note' then
    v_id := notes_resolve_note(a ->> 'note');
    update notes set deleted_at = now() where id = v_id returning * into v_note;
    v_summary := format('Moved "%s" to Trash', v_note.title);

  when 'restore_note' then
    v_id := notes_resolve_note(a ->> 'note', true);
    update notes set deleted_at = null where id = v_id returning * into v_note;
    v_summary := format('Restored "%s" from Trash', v_note.title);

  when 'restore_version' then
    select note_id, title, content into v_id, v_text, v_old
    from note_versions where id = (a ->> 'version_id')::bigint;
    if v_id is null then
      raise exception 'No version %.', a ->> 'version_id' using errcode = '22023';
    end if;
    update notes set title = v_text, content = v_old, deleted_at = null
    where id = v_id
    returning * into v_note;
    v_summary := format('Restored an earlier version of "%s"', v_note.title);

  -- ── Folder writes ──
  when 'create_folder' then
    if btrim(coalesce(a ->> 'path', ''), ' /') = '' then
      raise exception 'Pass the folder path, e.g. "Work" or "Work/Ideas".' using errcode = '22023';
    end if;
    foreach v_part in array string_to_array(btrim(a ->> 'path', ' /'), '/') loop
      v_part := btrim(v_part);
      continue when v_part = '';
      v_folder := null;
      select id into v_folder from note_folders
      where parent_id is not distinct from v_parent and lower(name) = lower(v_part);
      if v_folder is null then
        insert into note_folders (parent_id, name) values (v_parent, v_part) returning id into v_folder;
        v_created := true;
      end if;
      v_parent := v_folder;
    end loop;
    v_result := jsonb_build_object('id', v_folder, 'path', notes_folder_path(v_folder), 'created', v_created);
    v_summary := format('%s folder %s', case when v_created then 'Created' else 'Found existing' end, notes_folder_path(v_folder));

  when 'rename_folder' then
    v_folder := notes_resolve_folder(a ->> 'folder');
    if v_folder is null then
      raise exception 'The Inbox cannot be renamed.' using errcode = '22023';
    end if;
    v_old := notes_folder_path(v_folder);
    update note_folders set name = a ->> 'name' where id = v_folder;
    v_result := jsonb_build_object('id', v_folder, 'path', notes_folder_path(v_folder));
    v_summary := format('Renamed folder %s to %s', v_old, notes_folder_path(v_folder));

  when 'move_folder' then
    v_folder := notes_resolve_folder(a ->> 'folder');
    if v_folder is null then
      raise exception 'The Inbox cannot be moved.' using errcode = '22023';
    end if;
    v_parent := notes_resolve_folder(a ->> 'parent');
    v_old := notes_folder_path(v_folder);
    update note_folders set parent_id = v_parent where id = v_folder;
    v_result := jsonb_build_object('id', v_folder, 'path', notes_folder_path(v_folder));
    v_summary := format('Moved folder %s to %s', v_old, notes_folder_path(v_folder));

  when 'delete_folder' then
    v_folder := notes_resolve_folder(a ->> 'folder');
    if v_folder is null then
      raise exception 'The Inbox cannot be deleted.' using errcode = '22023';
    end if;
    v_old := notes_folder_path(v_folder);
    v_ids := notes_folder_subtree(v_folder);
    update notes set deleted_at = now() where folder_id = any(v_ids) and deleted_at is null;
    get diagnostics v_count = row_count;
    delete from note_folders where id = v_folder;
    v_result := jsonb_build_object('deleted_folders', array_length(v_ids, 1), 'notes_moved_to_trash', v_count);
    v_summary := format('Deleted folder %s (%s notes moved to Trash)', v_old, v_count);

  else
    raise exception 'Unknown action: %', p_action using errcode = '22023';
  end case;

  if v_write then
    if v_result is null and v_note.id is not null then
      v_result := notes_note_summary(v_note) || jsonb_build_object('version', v_note.version);
    end if;
    if v_key.id is not null then
      insert into note_agent_actions (key_id, key_label, action, note_id, folder_id, summary)
      values (v_key.id, v_key.label, p_action, v_note.id, v_folder, left(v_summary, 300));
    end if;
  end if;
  return v_result;
end;
$$;

-- ── Agent keys (owner only) ──────────────────────────────────────────────────

create or replace function public.notes_assert_owner()
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not notes_is_owner() then
    raise exception 'Only the owner can manage notes keys.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_note_agent_key(p_label text, p_can_write boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_token text := 'notes_' || encode(gen_random_bytes(24), 'hex');
  v_row note_agent_keys;
begin
  perform notes_assert_owner();
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'Give the key a name, e.g. "Claude".' using errcode = '22023';
  end if;
  insert into note_agent_keys (label, token_prefix, token_hash, can_write)
  values (btrim(p_label), left(v_token, 12), encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_can_write, false))
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'label', v_row.label, 'key', v_token, 'can_write', v_row.can_write);
end;
$$;

create or replace function public.list_note_agent_keys()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform notes_assert_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'token_prefix', token_prefix, 'can_write', can_write,
      'created_at', created_at, 'last_used_at', last_used_at, 'revoked_at', revoked_at
    ) order by revoked_at nulls first, created_at desc)
    from note_agent_keys
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_note_agent_key_write(p_id bigint, p_can_write boolean)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
begin
  perform notes_assert_owner();
  update note_agent_keys set can_write = p_can_write where id = p_id and revoked_at is null;
end;
$$;

create or replace function public.revoke_note_agent_key(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
begin
  perform notes_assert_owner();
  update note_agent_keys set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;

-- ── Embeddings (notes-embed Edge Function, service role only) ───────────────

create or replace function public.notes_pending_embeddings(p_limit integer default 5)
returns table (id uuid, title text, content text, content_hash text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.title, n.content, n.content_hash
  from notes n
  where n.deleted_at is null and n.content_hash is distinct from n.embedded_hash
  order by n.updated_at
  limit least(greatest(p_limit, 1), 50)
$$;

/** p_chunks: [{"content": "...", "embedding": [384 numbers]}, ...] */
create or replace function public.notes_store_embeddings(p_note_id uuid, p_hash text, p_chunks jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
as $$
begin
  -- Skip if the note changed while the embeddings were being made.
  perform 1 from notes where id = p_note_id and content_hash = p_hash for update;
  if not found then
    return false;
  end if;
  delete from note_chunks where note_id = p_note_id;
  insert into note_chunks (note_id, idx, content, embedding)
  select p_note_id, (c.ord - 1)::int, c.value ->> 'content', (c.value ->> 'embedding')::extensions.vector
  from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) with ordinality as c(value, ord);
  update notes set embedded_hash = p_hash where id = p_note_id;
  return true;
end;
$$;

-- ── Access ───────────────────────────────────────────────────────────────────

alter table public.note_folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_versions enable row level security;
alter table public.note_chunks enable row level security;
alter table public.note_agent_keys enable row level security;
alter table public.note_agent_actions enable row level security;

revoke all on public.note_folders, public.notes, public.note_versions, public.note_chunks,
  public.note_agent_keys, public.note_agent_actions from anon, authenticated;
grant select, insert, update, delete on public.note_folders, public.notes to authenticated;
grant select on public.note_versions, public.note_agent_actions to authenticated;

drop policy if exists note_folders_owner on public.note_folders;
create policy note_folders_owner on public.note_folders
  for all to authenticated using ((select public.notes_is_owner())) with check ((select public.notes_is_owner()));

drop policy if exists notes_owner on public.notes;
create policy notes_owner on public.notes
  for all to authenticated using ((select public.notes_is_owner())) with check ((select public.notes_is_owner()));

drop policy if exists note_versions_owner_read on public.note_versions;
create policy note_versions_owner_read on public.note_versions
  for select to authenticated using ((select public.notes_is_owner()));

drop policy if exists note_agent_actions_owner_read on public.note_agent_actions;
create policy note_agent_actions_owner_read on public.note_agent_actions
  for select to authenticated using ((select public.notes_is_owner()));

-- Functions: helpers are internal; only the entry points are callable.
revoke all on function
  public.notes_is_owner(),
  public.notes_folder_path(uuid),
  public.notes_folder_subtree(uuid),
  public.notes_resolve_folder(text),
  public.notes_resolve_note(text, boolean),
  public.notes_note_summary(public.notes),
  public.notes_tags_arg(jsonb),
  public.note_folders_before_write(),
  public.notes_before_write(),
  public.notes_after_update(),
  public.notes_search_core(text, extensions.vector, uuid, boolean, integer),
  public.notes_api(text, text, jsonb),
  public.notes_assert_owner(),
  public.create_note_agent_key(text, boolean),
  public.list_note_agent_keys(),
  public.set_note_agent_key_write(bigint, boolean),
  public.revoke_note_agent_key(bigint),
  public.notes_pending_embeddings(integer),
  public.notes_store_embeddings(uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function public.notes_is_owner() to authenticated;
grant execute on function public.notes_api(text, text, jsonb) to anon, authenticated;
grant execute on function
  public.create_note_agent_key(text, boolean),
  public.list_note_agent_keys(),
  public.set_note_agent_key_write(bigint, boolean),
  public.revoke_note_agent_key(bigint)
to authenticated;
grant execute on function
  public.notes_pending_embeddings(integer),
  public.notes_store_embeddings(uuid, text, jsonb)
to service_role;

-- Three AI access levels for notes keys: read, inbox, edit.
--
--   read   Reads only (as before for keys without "Can edit").
--   inbox  Reads, plus create_note (Inbox only: a folder other than the
--          Inbox is refused) and append_to_note / edit_note on notes that
--          are still in the Inbox. Every other write is refused.
--   edit   Every action (as before for keys with "Can edit").
--
-- note_agent_keys.access is the source of truth. can_write is kept in sync
-- (true only for "edit") by a trigger, so it still means "full edit".
-- create_note_agent_key takes p_access (p_can_write still works), and
-- set_note_agent_key_access sets the level; set_note_agent_key_write maps
-- true/false to edit/read.
--
-- Calls without a key require the owner's authenticated session.
--
-- Safe to re-run.

alter table public.note_agent_keys add column if not exists access text;
update public.note_agent_keys set access = case when can_write then 'edit' else 'read' end where access is null;
alter table public.note_agent_keys alter column access set default 'read';
alter table public.note_agent_keys alter column access set not null;
alter table public.note_agent_keys drop constraint if exists note_agent_keys_access_check;
alter table public.note_agent_keys add constraint note_agent_keys_access_check check (access in ('read', 'inbox', 'edit'));
comment on column public.note_agent_keys.access is 'read: reads only. inbox: reads, plus add notes to the Inbox and add to or edit notes still in the Inbox. edit: everything.';
comment on column public.note_agent_keys.can_write is 'Kept in sync with access: true only for access = edit.';

create or replace function public.note_agent_keys_sync_write()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.can_write := new.access = 'edit';
  return new;
end;
$$;

drop trigger if exists note_agent_keys_sync_write on public.note_agent_keys;
create trigger note_agent_keys_sync_write
  before insert or update on public.note_agent_keys
  for each row execute function public.note_agent_keys_sync_write();

revoke all on function public.note_agent_keys_sync_write() from public, anon, authenticated;

-- ── Key management (owner only) ──

drop function if exists public.create_note_agent_key(text, boolean);
create or replace function public.create_note_agent_key(p_label text, p_can_write boolean default null, p_access text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_token text := 'notes_' || encode(gen_random_bytes(24), 'hex');
  v_access text := coalesce(p_access, case when p_can_write then 'edit' else 'read' end);
  v_row note_agent_keys;
begin
  perform notes_assert_owner();
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'Give the key a name, e.g. "Claude".' using errcode = '22023';
  end if;
  if v_access not in ('read', 'inbox', 'edit') then
    raise exception 'Access must be read, inbox or edit.' using errcode = '22023';
  end if;
  insert into note_agent_keys (label, token_prefix, token_hash, access)
  values (btrim(p_label), left(v_token, 12), encode(digest(v_token, 'sha256'), 'hex'), v_access)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'label', v_row.label, 'key', v_token, 'access', v_row.access, 'can_write', v_row.can_write);
end;
$$;

create or replace function public.list_note_agent_keys()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform notes_assert_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'token_prefix', token_prefix, 'access', access, 'can_write', can_write,
      'created_at', created_at, 'last_used_at', last_used_at, 'revoked_at', revoked_at
    ) order by revoked_at nulls first, created_at desc)
    from note_agent_keys
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_note_agent_key_access(p_id bigint, p_access text)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
begin
  perform notes_assert_owner();
  if p_access is null or p_access not in ('read', 'inbox', 'edit') then
    raise exception 'Access must be read, inbox or edit.' using errcode = '22023';
  end if;
  update note_agent_keys set access = p_access where id = p_id and revoked_at is null;
end;
$$;

create or replace function public.set_note_agent_key_write(p_id bigint, p_can_write boolean)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
begin
  perform notes_assert_owner();
  update note_agent_keys set access = case when p_can_write then 'edit' else 'read' end
  where id = p_id and revoked_at is null;
end;
$$;

revoke all on function
  public.create_note_agent_key(text, boolean, text),
  public.set_note_agent_key_access(bigint, text)
from public, anon, authenticated;
grant execute on function
  public.create_note_agent_key(text, boolean, text),
  public.set_note_agent_key_access(bigint, text)
to authenticated;

-- ── notes_api: enforce the Inbox-only level ──

create or replace function public.notes_api(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
as $$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_write boolean := p_action not in (
    'list_folders', 'list_notes', 'get_note', 'get_recent_notes', 'search_notes',
    'list_tags', 'get_note_history', 'get_note_version'
  );
  v_key note_agent_keys;
  v_actor text;
  v_note notes;
  v_id uuid;
  v_folder uuid;
  v_parent uuid;
  v_ids uuid[];
  v_part text;
  v_text text;
  v_old text;
  v_count integer;
  v_limit integer;
  v_offset integer;
  v_sort text;
  v_tags text[];
  v_created boolean := false;
  v_summary text;
  v_result jsonb;
begin
  -- Who is calling: an agent key, or the signed-in owner.
  if p_token is not null then
    select * into v_key from note_agent_keys
    where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
    if v_key.id is null then
      raise exception 'Invalid or revoked notes key.' using errcode = '42501';
    end if;
    if v_write and v_key.access = 'read' then
      raise exception 'This key is read-only. Change its access in Notes → Settings → AI access.'
        using errcode = '42501';
    end if;
    if v_write and v_key.access = 'inbox' and p_action not in ('create_note', 'append_to_note', 'edit_note') then
      raise exception 'This key can only add to the Inbox: create_note, and append_to_note or edit_note on notes still in the Inbox. % needs "Full edit" access (Notes → Settings → AI access).', p_action
        using errcode = '42501';
    end if;
    update note_agent_keys set last_used_at = now() where id = v_key.id;
    v_actor := 'agent: ' || v_key.label;
  elsif notes_is_owner() then
    v_actor := 'you';
  else
    raise exception 'Sign in as the owner or pass a notes key.' using errcode = '42501';
  end if;
  perform set_config('notes.actor', v_actor, true);

  case p_action

  -- ── Reads ──
  when 'list_folders' then
    select jsonb_build_object(
      'inbox_notes', (select count(*) from notes where folder_id is null and deleted_at is null),
      'folders', coalesce(jsonb_agg(x.j order by lower(x.j ->> 'path')), '[]'::jsonb)
    ) into v_result
    from (
      select jsonb_build_object(
        'id', f.id, 'name', f.name, 'path', notes_folder_path(f.id), 'parent_id', f.parent_id,
        'notes', (select count(*) from notes n where n.folder_id = f.id and n.deleted_at is null)
      ) as j
      from note_folders f
    ) x;

  when 'list_notes', 'get_recent_notes' then
    v_limit := least(greatest(coalesce((a ->> 'limit')::int, case when p_action = 'list_notes' then 50 else 20 end), 1), 200);
    v_offset := greatest(coalesce((a ->> 'offset')::int, 0), 0);
    v_sort := coalesce(a ->> 'sort', 'updated');
    if a ? 'folder' then
      v_folder := notes_resolve_folder(a ->> 'folder');
    end if;
    select array_agg(id order by rn) into v_ids from (
      select n.id, row_number() over (
        order by
          case when p_action = 'list_notes' and v_sort <> 'created' then n.pinned end desc,
          case when v_sort = 'title' then lower(n.title) end asc,
          case when v_sort = 'created' then n.created_at end desc,
          n.updated_at desc
      ) as rn
      from notes n
      where case when coalesce((a ->> 'trash')::boolean, false) then n.deleted_at is not null else n.deleted_at is null end
        and (not (a ? 'folder')
             or (v_folder is null and n.folder_id is null)
             or (v_folder is not null and coalesce((a ->> 'include_subfolders')::boolean, false)
                 and n.folder_id = any(notes_folder_subtree(v_folder)))
             or (v_folder is not null and n.folder_id = v_folder))
        and (a ->> 'tag' is null or lower(a ->> 'tag') = any(n.tags))
        and (a ->> 'pinned' is null or n.pinned = (a ->> 'pinned')::boolean)
        and (p_action <> 'get_recent_notes'
             or n.updated_at > now() - make_interval(days => least(greatest(coalesce((a ->> 'days')::int, 7), 1), 3650)))
    ) s;
    select jsonb_build_object(
      'total', coalesce(array_length(v_ids, 1), 0),
      'notes', coalesce(jsonb_agg(notes_note_summary(n) order by array_position(v_ids, n.id)), '[]'::jsonb)
    ) into v_result
    from notes n
    where n.id = any(v_ids[v_offset + 1 : v_offset + v_limit]);

  when 'get_note' then
    v_id := notes_resolve_note(a ->> 'note', true);
    select * into v_note from notes where id = v_id;
    v_result := (notes_note_summary(v_note) - 'preview') || jsonb_build_object(
      'content', v_note.content, 'version', v_note.version, 'deleted_at', v_note.deleted_at);

  when 'search_notes' then
    v_text := btrim(coalesce(a ->> 'query', ''));
    if v_text = '' then
      raise exception 'Pass a query.' using errcode = '22023';
    end if;
    if a ? 'folder' then
      v_folder := notes_resolve_folder(a ->> 'folder');
    end if;
    v_result := jsonb_build_object(
      'semantic', a ? 'embedding',
      'results', notes_search_core(
        v_text,
        case when a ? 'embedding' then (a ->> 'embedding')::extensions.vector end,
        v_folder,
        a ? 'folder',
        least(greatest(coalesce((a ->> 'limit')::int, 10), 1), 50)
      )
    );

  when 'list_tags' then
    select coalesce(jsonb_agg(jsonb_build_object('tag', t, 'notes', c) order by c desc, t), '[]'::jsonb) into v_result
    from (
      select t, count(*) as c from notes, unnest(tags) t where deleted_at is null group by t
    ) s;

  when 'get_note_history' then
    v_id := notes_resolve_note(a ->> 'note', true);
    select * into v_note from notes where id = v_id;
    select jsonb_build_object(
      'note_id', v_id,
      'current', jsonb_build_object('version', v_note.version, 'edited_by', v_note.last_edited_by, 'edited_at', v_note.updated_at),
      'versions', coalesce(jsonb_agg(jsonb_build_object(
        'version_id', v.id, 'version', v.version, 'title', v.title, 'edited_by', v.edited_by,
        'edited_at', v.edited_at, 'chars', length(v.content),
        'preview', left(btrim(regexp_replace(v.content, '\s+', ' ', 'g')), 200)
      ) order by v.id desc), '[]'::jsonb)
    ) into v_result
    from (select * from note_versions where note_id = v_id order by id desc limit 50) v;

  when 'get_note_version' then
    select jsonb_build_object(
      'version_id', v.id, 'note_id', v.note_id, 'version', v.version, 'title', v.title,
      'content', v.content, 'edited_by', v.edited_by, 'edited_at', v.edited_at
    ) into v_result
    from note_versions v where v.id = (a ->> 'version_id')::bigint;
    if v_result is null then
      raise exception 'No version %.', a ->> 'version_id' using errcode = '22023';
    end if;

  -- ── Note writes ──
  when 'create_note' then
    if btrim(coalesce(a ->> 'title', '')) = '' and btrim(coalesce(a ->> 'content', '')) = '' then
      raise exception 'Pass a title or content.' using errcode = '22023';
    end if;
    v_folder := notes_resolve_folder(a ->> 'folder');
    if v_key.access = 'inbox' and v_folder is not null then
      raise exception 'This key can only add notes to the Inbox. Leave out folder; the owner files Inbox notes.'
        using errcode = '42501';
    end if;
    insert into notes (folder_id, title, content, tags, pinned)
    values (v_folder, coalesce(a ->> 'title', ''), coalesce(a ->> 'content', ''),
            notes_tags_arg(a -> 'tags'), coalesce((a ->> 'pinned')::boolean, false))
    returning * into v_note;
    v_summary := format('Created "%s" in %s', v_note.title, notes_folder_path(v_folder));

  when 'append_to_note' then
    v_id := notes_resolve_note(a ->> 'note');
    if v_key.access = 'inbox' and exists (select 1 from notes where id = v_id and folder_id is not null) then
      raise exception 'This key can only change notes that are still in the Inbox, and this one has been filed in %.',
        (select notes_folder_path(folder_id) from notes where id = v_id) using errcode = '42501';
    end if;
    v_text := a ->> 'text';
    if btrim(coalesce(v_text, '')) = '' then
      raise exception 'Pass the text to add.' using errcode = '22023';
    end if;
    update notes set content = case
        when coalesce(a ->> 'position', 'end') = 'start' then
          v_text || case when btrim(content) = '' then '' else E'\n\n' || ltrim(content, E'\n') end
        else
          rtrim(content, E'\n ') || case when btrim(content) = '' then '' else E'\n\n' end || v_text
      end
    where id = v_id
    returning * into v_note;
    v_summary := format('Added %s characters to "%s"', length(v_text), v_note.title);

  when 'edit_note' then
    v_id := notes_resolve_note(a ->> 'note');
    if v_key.access = 'inbox' and exists (select 1 from notes where id = v_id and folder_id is not null) then
      raise exception 'This key can only change notes that are still in the Inbox, and this one has been filed in %.',
        (select notes_folder_path(folder_id) from notes where id = v_id) using errcode = '42501';
    end if;
    v_old := a ->> 'old_text';
    if coalesce(v_old, '') = '' then
      raise exception 'Pass old_text: the exact text to replace.' using errcode = '22023';
    end if;
    select * into v_note from notes where id = v_id for update;
    v_count := (length(v_note.content) - length(replace(v_note.content, v_old, ''))) / length(v_old);
    if v_count = 0 then
      raise exception 'old_text was not found in the note. Call get_note for the current text and copy it exactly, including line breaks.'
        using errcode = '22023';
    end if;
    if v_count > 1 and not coalesce((a ->> 'replace_all')::boolean, false) then
      raise exception 'old_text appears % times. Include more of the surrounding text so it matches once, or set replace_all.', v_count
        using errcode = '22023';
    end if;
    update notes set content = replace(content, v_old, coalesce(a ->> 'new_text', ''))
    where id = v_id
    returning * into v_note;
    v_summary := format('Edited "%s" (%s replacement%s)', v_note.title, v_count, case when v_count = 1 then '' else 's' end);

  when 'replace_note' then
    v_id := notes_resolve_note(a ->> 'note');
    if not (a ? 'content') then
      raise exception 'Pass the new content.' using errcode = '22023';
    end if;
    select * into v_note from notes where id = v_id for update;
    if a ? 'expected_version' and (a ->> 'expected_version')::int <> v_note.version then
      raise exception 'The note changed since version % (now version %). Call get_note and redo the change.',
        a ->> 'expected_version', v_note.version using errcode = '40001';
    end if;
    update notes set content = a ->> 'content', title = coalesce(a ->> 'title', title)
    where id = v_id
    returning * into v_note;
    v_summary := format('Rewrote "%s"', v_note.title);

  when 'update_note' then
    v_id := notes_resolve_note(a ->> 'note');
    select * into v_note from notes where id = v_id for update;
    v_tags := v_note.tags;
    if a ? 'tags' then v_tags := notes_tags_arg(a -> 'tags'); end if;
    if a ? 'add_tags' then v_tags := v_tags || notes_tags_arg(a -> 'add_tags'); end if;
    if a ? 'remove_tags' then
      v_tags := array(select t from unnest(v_tags) t where t <> all(notes_tags_arg(a -> 'remove_tags')));
    end if;
    update notes set
      title = coalesce(a ->> 'title', title),
      tags = v_tags,
      pinned = coalesce((a ->> 'pinned')::boolean, pinned)
    where id = v_id
    returning * into v_note;
    v_summary := format('Updated "%s"', v_note.title);

  when 'move_note' then
    v_id := notes_resolve_note(a ->> 'note');
    v_folder := notes_resolve_folder(a ->> 'folder');
    update notes set folder_id = v_folder where id = v_id returning * into v_note;
    v_summary := format('Moved "%s" to %s', v_note.title, notes_folder_path(v_folder));

  when 'delete_note' then
    v_id := notes_resolve_note(a ->> 'note');
    update notes set deleted_at = now() where id = v_id returning * into v_note;
    v_summary := format('Moved "%s" to Trash', v_note.title);

  when 'restore_note' then
    v_id := notes_resolve_note(a ->> 'note', true);
    update notes set deleted_at = null where id = v_id returning * into v_note;
    v_summary := format('Restored "%s" from Trash', v_note.title);

  when 'restore_version' then
    select note_id, title, content into v_id, v_text, v_old
    from note_versions where id = (a ->> 'version_id')::bigint;
    if v_id is null then
      raise exception 'No version %.', a ->> 'version_id' using errcode = '22023';
    end if;
    update notes set title = v_text, content = v_old, deleted_at = null
    where id = v_id
    returning * into v_note;
    v_summary := format('Restored an earlier version of "%s"', v_note.title);

  -- ── Folder writes ──
  when 'create_folder' then
    if btrim(coalesce(a ->> 'path', ''), ' /') = '' then
      raise exception 'Pass the folder path, e.g. "Work" or "Work/Ideas".' using errcode = '22023';
    end if;
    foreach v_part in array string_to_array(btrim(a ->> 'path', ' /'), '/') loop
      v_part := btrim(v_part);
      continue when v_part = '';
      v_folder := null;
      select id into v_folder from note_folders
      where parent_id is not distinct from v_parent and lower(name) = lower(v_part);
      if v_folder is null then
        insert into note_folders (parent_id, name) values (v_parent, v_part) returning id into v_folder;
        v_created := true;
      end if;
      v_parent := v_folder;
    end loop;
    v_result := jsonb_build_object('id', v_folder, 'path', notes_folder_path(v_folder), 'created', v_created);
    v_summary := format('%s folder %s', case when v_created then 'Created' else 'Found existing' end, notes_folder_path(v_folder));

  when 'rename_folder' then
    v_folder := notes_resolve_folder(a ->> 'folder');
    if v_folder is null then
      raise exception 'The Inbox cannot be renamed.' using errcode = '22023';
    end if;
    v_old := notes_folder_path(v_folder);
    update note_folders set name = a ->> 'name' where id = v_folder;
    v_result := jsonb_build_object('id', v_folder, 'path', notes_folder_path(v_folder));
    v_summary := format('Renamed folder %s to %s', v_old, notes_folder_path(v_folder));

  when 'move_folder' then
    v_folder := notes_resolve_folder(a ->> 'folder');
    if v_folder is null then
      raise exception 'The Inbox cannot be moved.' using errcode = '22023';
    end if;
    v_parent := notes_resolve_folder(a ->> 'parent');
    v_old := notes_folder_path(v_folder);
    update note_folders set parent_id = v_parent where id = v_folder;
    v_result := jsonb_build_object('id', v_folder, 'path', notes_folder_path(v_folder));
    v_summary := format('Moved folder %s to %s', v_old, notes_folder_path(v_folder));

  when 'delete_folder' then
    v_folder := notes_resolve_folder(a ->> 'folder');
    if v_folder is null then
      raise exception 'The Inbox cannot be deleted.' using errcode = '22023';
    end if;
    v_old := notes_folder_path(v_folder);
    v_ids := notes_folder_subtree(v_folder);
    update notes set deleted_at = now() where folder_id = any(v_ids) and deleted_at is null;
    get diagnostics v_count = row_count;
    delete from note_folders where id = v_folder;
    v_result := jsonb_build_object('deleted_folders', array_length(v_ids, 1), 'notes_moved_to_trash', v_count);
    v_summary := format('Deleted folder %s (%s notes moved to Trash)', v_old, v_count);

  else
    raise exception 'Unknown action: %', p_action using errcode = '22023';
  end case;

  if v_write then
    if v_result is null and v_note.id is not null then
      v_result := notes_note_summary(v_note) || jsonb_build_object('version', v_note.version);
    end if;
    if v_actor <> 'you' then
      insert into note_agent_actions (key_id, key_label, action, note_id, folder_id, summary)
      values (v_key.id, coalesce(v_key.label, 'Claude'), p_action, v_note.id, v_folder, left(v_summary, 300));
    end if;
  end if;
  return v_result;
end;
$$;

-- Images in notes.
--
-- * Storage bucket note-images (private, 10 MB per image). The web app
--   uploads to <note id>/<random>.<ext> and writes the image into the note as
--   Markdown: ![](https://<project>.supabase.co/storage/v1/object/authenticated/note-images/<path>).
--   It shows images through short-lived signed URLs.
-- * Only the owner (notes_is_owner) can read, add, change or delete them.
-- * Titles, list previews and keyword search ignore image URLs: an image
--   counts as its alt text (usually empty), so a note that starts with a
--   photo takes its title from the first line of text.
--
-- The storage part is skipped where the storage schema does not exist (the
-- plain-Postgres test database). Safe to re-run.

do $storage$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found: skipping the note-images bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('note-images', 'note-images', false, 10485760,
          array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif'])
  on conflict (id) do update set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists note_images_owner_select on storage.objects;
  create policy note_images_owner_select on storage.objects for select to authenticated
    using (bucket_id = 'note-images' and (select public.notes_is_owner()));
  drop policy if exists note_images_owner_insert on storage.objects;
  create policy note_images_owner_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'note-images' and (select public.notes_is_owner()));
  drop policy if exists note_images_owner_update on storage.objects;
  create policy note_images_owner_update on storage.objects for update to authenticated
    using (bucket_id = 'note-images' and (select public.notes_is_owner()))
    with check (bucket_id = 'note-images' and (select public.notes_is_owner()));
  drop policy if exists note_images_owner_delete on storage.objects;
  create policy note_images_owner_delete on storage.objects for delete to authenticated
    using (bucket_id = 'note-images' and (select public.notes_is_owner()));
end;
$storage$;

-- Same as in the schema migration, except that images count as their alt
-- text for the title, preview and search. Keep autoTitle (src/lib/markdown.js)
-- in step.
create or replace function public.notes_before_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor text := coalesce(nullif(current_setting('notes.actor', true), ''), 'you');
  v_first text;
  v_body text;
  v_lead text;
  v_text text; -- the content with images reduced to their alt text
begin
  new.content := coalesce(new.content, '');
  v_text := regexp_replace(new.content, '!\[([^]]*)\]\([^)]*\)', '\1', 'g');
  new.title := btrim(coalesce(new.title, ''));
  -- No title: use the first non-blank line, like Apple Notes (cut at a word
  -- boundary, since a dictated first line can run on for a long time).
  if new.title = '' then
    select l into v_first from unnest(string_to_array(v_text, E'\n')) l where btrim(l) <> '' limit 1;
    v_first := btrim(regexp_replace(coalesce(v_first, ''), '^\s*(#+|[-*+]|\d+[.)])?\s*(\[[ xX]\]\s*)?', ''));
    new.title := case when length(v_first) <= 80 then v_first
                      else coalesce(nullif(regexp_replace(left(v_first, 80), '\s+\S*$', ''), ''), left(v_first, 80)) || '…' end;
  end if;
  new.tags := coalesce(array(
    select distinct lower(btrim(t)) from unnest(coalesce(new.tags, '{}')) t where btrim(t) <> '' order by 1
  ), '{}');

  if tg_op = 'INSERT' then
    new.version := 1;
    new.last_edited_by := v_actor;
    new.created_at := now();
    new.updated_at := now();
  else
    new.version := old.version;
    new.created_at := old.created_at;
    new.updated_at := old.updated_at;
    new.last_edited_by := old.last_edited_by;
    if (new.title, new.content) is distinct from (old.title, old.content) then
      new.version := old.version + 1;
      new.last_edited_by := v_actor;
      new.updated_at := now();
    elsif (new.folder_id, new.tags, new.pinned, new.deleted_at)
          is distinct from (old.folder_id, old.tags, old.pinned, old.deleted_at) then
      new.updated_at := now();
    end if;
  end if;

  -- List preview: the plain text after the title, without Markdown markers.
  v_body := regexp_replace(ltrim(v_text, E' \t\n'), '^#+[ \t]*', '');
  v_lead := rtrim(new.title, '…');
  if v_lead <> '' and left(v_body, length(v_lead)) = v_lead then
    v_body := substr(v_body, length(v_lead) + 1);
  end if;
  v_body := regexp_replace(v_body, '^[ \t]*(#+|>|[-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?', '', 'gn');
  v_body := regexp_replace(v_body, '\*\*|__|`', '', 'g');
  new.preview := left(btrim(regexp_replace(v_body, '\s+', ' ', 'g')), 200);
  new.search := setweight(to_tsvector('english', new.title), 'A')
             || setweight(to_tsvector('english', array_to_string(new.tags, ' ')), 'A')
             || setweight(to_tsvector('english', v_text), 'B');
  new.content_hash := md5(new.title || E'\n' || new.content);
  return new;
end;
$$;


-- Image Trash, and images for AI agents.
--
-- Image Trash
-- * note_images lists every image in the note-images bucket that a note
--   uses or used. A trigger on notes keeps it up to date, whoever edits
--   (the app, an agent, a restored version).
-- * An image that no note uses any more (removed from its note) goes to the
--   Trash: trashed_at is set and it is deleted for good 30 days later
--   (delete_after). Putting it back into a note takes it out of the Trash.
-- * When a note is deleted for good (Delete forever, Empty Trash), its
--   images are due at once, unless another note still uses them.
-- * Uploads that never made it into a note (e.g. pasted, then the line
--   deleted before saving) go to the Trash after a day (notes_images_sweep).
-- * The notes-images Edge Function deletes due images from Storage
--   (POST {"action": "purge"}), called by the app after Empty Trash /
--   Delete forever and hourly by pg_cron
--   (supabase/schedules.sql).
--
-- Images for agents
-- * notes_image_links(key, note) returns, for each image in a note, a link
--   to the notes-images Edge Function that works for one hour. The caller
--   needs the same access as get_note (an agent key or the owner). The MCP server uses it to send the images
--   themselves with get_note, so agents can see them.
--
-- Safe to re-run.

-- ── Which images notes use ───────────────────────────────────────────────────

create table if not exists public.note_images (
  path text primary key,                                     -- inside the note-images bucket
  note_id uuid references public.notes(id) on delete set null, -- the note it was last in
  created_at timestamptz not null default now(),
  trashed_at timestamptz,                                    -- set: no note uses it
  delete_after timestamptz                                   -- removed from Storage after this
);
comment on table public.note_images is 'Images in the note-images bucket. trashed_at set = in the Trash, deleted from Storage after delete_after.';
create index if not exists note_images_due_idx on public.note_images (delete_after) where trashed_at is not null;

/** The images (bucket paths) a note's Markdown refers to. */
create or replace function public.notes_image_refs(p_content text)
returns table (path text)
language sql
immutable
set search_path to 'public'
as $$
  select distinct m[1]
  from regexp_matches(
    coalesce(p_content, ''),
    '/storage/v1/object/(?:authenticated|public|sign)/note-images/([^?#)\s<>"]+)',
    'g'
  ) m
$$;

create or replace function public.notes_track_images()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    -- In use: track it, and take it out of the Trash.
    insert into note_images as i (path, note_id)
    select r.path, new.id from notes_image_refs(new.content) r
    on conflict (path) do update set note_id = excluded.note_id, trashed_at = null, delete_after = null
    where i.note_id is distinct from excluded.note_id or i.trashed_at is not null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    -- No longer used by this note, nor by any other: to the Trash. A note
    -- deleted for good takes its images with it.
    update note_images i
    set trashed_at = now(),
        delete_after = case when tg_op = 'DELETE' then now() else now() + interval '30 days' end
    where i.path in (select r.path from notes_image_refs(old.content) r)
      and i.trashed_at is null
      and (tg_op = 'DELETE' or i.path not in (select r.path from notes_image_refs(new.content) r))
      and not exists (
        select 1 from notes n
        where n.id <> old.id and strpos(n.content, '/note-images/' || i.path) > 0
      );
  end if;
  return null;
end;
$$;

drop trigger if exists notes_track_images on public.notes;
create trigger notes_track_images
  after insert or update of content or delete on public.notes
  for each row execute function public.notes_track_images();

-- Images already in notes.
insert into public.note_images (path, note_id)
select distinct on (r.path) r.path, n.id
from public.notes n, public.notes_image_refs(n.content) r
order by r.path, n.deleted_at nulls first, n.updated_at desc
on conflict (path) do nothing;

/**
 * Uploads more than a day old that no note uses: to the Trash. Returns how
 * many. (Skipped where there is no Storage, e.g. the test database.)
 */
create or replace function public.notes_images_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer := 0;
begin
  if to_regclass('storage.objects') is null then
    return 0;
  end if;
  execute $q$
    insert into public.note_images (path, created_at, trashed_at, delete_after)
    select o.name, o.created_at, now(), now() + interval '30 days'
    from storage.objects o
    where o.bucket_id = 'note-images' and o.created_at < now() - interval '1 day'
    on conflict (path) do nothing
  $q$;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Images whose time in the Trash is over (for the notes-images function). */
create or replace function public.notes_images_due(p_limit integer default 100)
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $$
  select path from note_images
  where trashed_at is not null and delete_after <= now()
  order by delete_after
  limit least(greatest(coalesce(p_limit, 100), 1), 1000)
$$;

/** Forgets images the notes-images function removed from Storage. */
create or replace function public.notes_images_forget(p_paths text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  delete from note_images where path = any(p_paths) and trashed_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Short-lived image links for agents ───────────────────────────────────────

create table if not exists public.note_image_tickets (
  token_hash text primary key,
  path text not null,
  expires_at timestamptz not null
);
comment on table public.note_image_tickets is 'One-hour links to images, handed to agents by notes_image_links and served by the notes-images Edge Function.';

/**
 * The images in a note, each with a link that works for one hour:
 * {note_id, title, expires_at, images: [{alt, path, url}]}. Access is the
 * same as get_note: notes_api checks the key (or the owner's session).
 */
create or replace function public.notes_image_links(p_token text, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_note jsonb := notes_api(p_token, 'get_note', jsonb_build_object('note', p_note));
  v_images jsonb := '[]'::jsonb;
  v_token text;
  r record;
begin
  delete from note_image_tickets where expires_at < now();
  for r in
    select m[1] as alt, m[2] as url, m[3] as path
    from regexp_matches(
      v_note ->> 'content',
      '!\[([^]]*)\]\(\s*(https?://[^\s)]*/storage/v1/object/(?:authenticated|public|sign)/note-images/([^?#)\s]+)[^)\s]*)',
      'g'
    ) with ordinality as x(m, n)
    order by n
  loop
    v_token := encode(gen_random_bytes(24), 'hex');
    insert into note_image_tickets (token_hash, path, expires_at)
    values (encode(digest(v_token, 'sha256'), 'hex'), r.path, now() + interval '1 hour');
    v_images := v_images || jsonb_build_object(
      'alt', r.alt,
      'path', r.path,
      'url', (select project_url from notes_private.settings where singleton) || '/functions/v1/notes-images?t=' || v_token
    );
  end loop;
  return jsonb_build_object(
    'note_id', v_note ->> 'id',
    'title', v_note ->> 'title',
    'expires_at', now() + interval '1 hour',
    'images', v_images
  );
end;
$$;

/** The bucket path for a link from notes_image_links, while it is valid. */
create or replace function public.notes_image_ticket_path(p_token text)
returns text
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select path from note_image_tickets
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now()
$$;

-- ── Access ───────────────────────────────────────────────────────────────────

alter table public.note_images enable row level security;
alter table public.note_image_tickets enable row level security;
revoke all on public.note_images, public.note_image_tickets from anon, authenticated;
-- The owner sees the image Trash and can mark images due (Delete now / Empty Trash).
grant select, update (delete_after) on public.note_images to authenticated;

drop policy if exists note_images_owner_read on public.note_images;
create policy note_images_owner_read on public.note_images
  for select to authenticated using ((select public.notes_is_owner()));
drop policy if exists note_images_owner_update on public.note_images;
create policy note_images_owner_update on public.note_images
  for update to authenticated using ((select public.notes_is_owner())) with check ((select public.notes_is_owner()));

revoke all on function
  public.notes_image_refs(text),
  public.notes_track_images(),
  public.notes_images_sweep(),
  public.notes_images_due(integer),
  public.notes_images_forget(text[]),
  public.notes_image_links(text, text),
  public.notes_image_ticket_path(text)
from public, anon, authenticated;
grant execute on function public.notes_image_links(text, text) to anon, authenticated;
grant execute on function
  public.notes_images_sweep(),
  public.notes_images_due(integer),
  public.notes_images_forget(text[]),
  public.notes_image_ticket_path(text)
to service_role;


-- Internal functions are never executable by web roles. Service access is
-- explicit so this also works with Supabase's restricted new-project grants.
grant usage on schema public, extensions to anon, authenticated, service_role;
grant all on public.note_folders, public.notes, public.note_versions,
  public.note_chunks, public.note_agent_keys, public.note_agent_actions,
  public.note_images, public.note_image_tickets to service_role;
grant usage, select on all sequences in schema public to service_role;
notify pgrst, 'reload schema';

-- Check image write permission BEFORE downloading or uploading any bytes.
create or replace function public.notes_prepare_image_upload(p_token text, p_note text)
returns jsonb language plpgsql volatile security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_note jsonb := notes_api(p_token, 'get_note', jsonb_build_object('note', p_note));
  v_access text;
begin
  select access into v_access from note_agent_keys
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if v_access is null or v_access = 'read'
     or (v_access = 'inbox' and v_note ->> 'folder_id' is not null) then
    raise exception 'This key cannot add images to that note.' using errcode = '42501';
  end if;
  if (v_note ->> 'deleted_at') is not null then
    raise exception 'Restore the note from Trash first.' using errcode = '22023';
  end if;
  return v_note;
end;
$$;
revoke all on function public.notes_prepare_image_upload(text, text) from public, anon, authenticated;
grant execute on function public.notes_prepare_image_upload(text, text) to anon, authenticated;
