/**
 * Sends drafts (see drafts.js) to Supabase, one at a time.
 *
 * New notes are inserted with the id the app generated, so a note created
 * offline keeps its id. Existing notes are updated only if the server still
 * has the version the edit started from; otherwise the draft is marked as a
 * conflict and the editor asks which text to keep. Network failures leave the
 * draft in place and retry later.
 */
import { supabase, isNetworkError, NOTE_META } from './supabase';
import { allDrafts, isEmptyDraft, patchDraft, removeDraft } from './drafts';

const listeners = new Set();
let running = false;
let again = false;
let status = 'idle'; // idle | saving | offline | error

const emit = (event) => listeners.forEach((fn) => fn(event));
const setStatus = (next, message) => {
  status = next;
  emit({ type: 'status', status, message });
};

export const getStatus = () => status;
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const fetchRow = async (id) => {
  const { data, error } = await supabase.from('notes').select(`${NOTE_META}, content`).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
};

// A blank title is filled in from the first line by the database.
const sameText = (row, draft) => row.content === draft.content && (!draft.title.trim() || row.title === draft.title.trim());

/** Saves one draft; returns the saved row, or null if it hit a conflict. */
const saveOne = async (draft) => {
  if (draft.baseVersion == null) {
    const { data, error } = await supabase.from('notes')
      .insert({ id: draft.id, folder_id: draft.folder_id, title: draft.title, content: draft.content })
      .select(`${NOTE_META}, content`).single();
    if (!error) return data;
    // Already inserted (the reply to an earlier attempt was lost): update it.
    if (error.code !== '23505') throw error;
    const row = await fetchRow(draft.id);
    if (!row) throw error;
    if (sameText(row, draft)) return row;
    patchDraft(draft.id, { baseVersion: row.version });
    return saveOne({ ...draft, baseVersion: row.version });
  }

  const { data, error } = await supabase.from('notes')
    .update({ title: draft.title, content: draft.content })
    .eq('id', draft.id)
    .eq('version', draft.baseVersion)
    .select(`${NOTE_META}, content`);
  if (error) throw error;
  if (data.length === 1) return data[0];

  // Someone (an agent, another device) changed or deleted it meanwhile.
  const row = await fetchRow(draft.id);
  if (row && sameText(row, draft)) return row;
  patchDraft(draft.id, {
    conflict: row
      ? { version: row.version, title: row.title, content: row.content, editedBy: row.last_edited_by, deleted: Boolean(row.deleted_at) }
      : { deleted: true, gone: true },
  });
  emit({ type: 'conflict', id: draft.id });
  return null;
};

/** Saves every pending draft. Safe to call as often as you like. */
export const syncNow = async () => {
  if (!supabase) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const pending = Object.values(allDrafts()).filter((d) => !d.conflict && !(d.baseVersion == null && isEmptyDraft(d)));
      if (pending.length === 0) {
        setStatus('idle');
        break;
      }
      setStatus('saving');
      for (const draft of pending) {
        try {
          const row = await saveOne(draft);
          if (!row) continue;
          // Typed more while saving: keep the draft, but on the new version.
          if (allDrafts()[draft.id]?.updatedAt === draft.updatedAt) removeDraft(draft.id, draft.updatedAt);
          else patchDraft(draft.id, { baseVersion: row.version });
          emit({ type: 'saved', row });
        } catch (error) {
          if (isNetworkError(error)) {
            setStatus('offline');
            return;
          }
          setStatus('error', error.message);
          return;
        }
      }
    } while (again);
    const left = Object.values(allDrafts()).some((d) => !d.conflict && !(d.baseVersion == null && isEmptyDraft(d)));
    setStatus(left ? 'saving' : 'idle');
    if (left) setTimeout(syncNow, 0);
  } finally {
    running = false;
  }
};

/** Conflict choice: overwrite the server copy with what is on this device. */
export const keepMine = (id) => {
  const draft = allDrafts()[id];
  if (!draft?.conflict) return;
  patchDraft(id, draft.conflict.gone
    ? { conflict: null, baseVersion: null }
    : { conflict: null, baseVersion: draft.conflict.version });
  syncNow();
};

/** Conflict choice: drop this device's edits and use the server copy. */
export const discardMine = (id) => removeDraft(id);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncNow());
  setInterval(() => {
    if (status === 'offline' || status === 'error') syncNow();
  }, 15000);
}
