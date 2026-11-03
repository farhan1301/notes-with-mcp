import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Publishable key only: the database lets the signed-in owner in (RLS) and
// nobody else. Secret keys must never reach the browser.
export const supabase = url && key
  ? createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'notes-with-mcp-auth',
    },
  })
  : null;

/** Calls notes_api as the signed-in owner (no agent key). */
export const notesApi = async (action, args = {}) => {
  const { data, error } = await supabase.rpc('notes_api', { p_token: null, p_action: action, p_args: args });
  if (error) throw error;
  return data;
};

/** True for "the request never reached the server" errors. */
export const isNetworkError = (error) => {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  return !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(message);
};

/** Columns for lists: everything except the full text and search data. */
export const NOTE_META = 'id, folder_id, title, preview, tags, pinned, version, last_edited_by, created_at, updated_at, deleted_at';
