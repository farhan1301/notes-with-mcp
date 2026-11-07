-- Keep the current text in history when a note is restored to an earlier
-- version. Edits by the same editor within 10 minutes share one snapshot, so
-- restoring right after an edit used to overwrite that edit without saving it.
-- A change that puts back text already in the note's history is a restore:
-- always snapshot first.
create or replace function public.notes_after_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.title, new.content) is distinct from (old.title, old.content)
     and (old.title <> '' or old.content <> '')
     and (
       not (old.last_edited_by = new.last_edited_by and old.updated_at > now() - interval '10 minutes')
       or exists (
         select 1 from note_versions v
         where v.note_id = new.id and v.title = new.title and v.content = new.content
       )
     ) then
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

revoke execute on function public.notes_after_update() from public, anon, authenticated;
