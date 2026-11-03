import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase, notesApi } from '../lib/supabase';
import Markdown from './Markdown';
import { useDialog } from './Dialog';

/** Earlier versions of a note (saved before each editing session), with restore. */
export default function HistoryDialog({ noteId, onClose, onRestored }) {
  const dialog = useDialog();
  const [versions, setVersions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('note_versions')
      .select('id, version, title, content, edited_by, edited_at')
      .eq('note_id', noteId)
      .order('id', { ascending: false })
      .limit(50)
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message);
        else {
          setVersions(data);
          setSelected(data[0] || null);
        }
      });
  }, [noteId]);

  const restore = async () => {
    if (!(await dialog.confirm('Restore this version?', 'The current text is kept in the history.', 'Restore'))) return;
    try {
      await notesApi('restore_version', { version_id: selected.id });
      const { data } = await supabase.from('notes').select('*').eq('id', noteId).single();
      onRestored(data);
      onClose();
    } catch (restoreError) {
      setError(restoreError.message);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-0 sm:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-white sm:h-[80vh] sm:rounded-2xl dark:bg-neutral-900">
        <header className="flex items-center border-b border-stone-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-neutral-800">
          <h2 className="flex-1 text-lg font-semibold">Version history</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-stone-100 dark:hover:bg-neutral-800"><X size={20} /></button>
        </header>
        {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
        {versions && versions.length === 0 && (
          <p className="p-8 text-center text-stone-500">No earlier versions yet. One is saved each time you or an agent start changing the note.</p>
        )}
        {versions && versions.length > 0 && (
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <ul className="max-h-48 shrink-0 overflow-y-auto border-b border-stone-200 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r dark:border-neutral-800">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(v)}
                    className={`block w-full px-4 py-2 text-left text-sm ${selected?.id === v.id ? 'bg-amber-100 dark:bg-amber-400/20' : 'hover:bg-stone-100 dark:hover:bg-neutral-800'}`}
                  >
                    <div className="font-medium">{new Date(v.edited_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
                    <div className="text-xs text-stone-500">by {v.edited_by}</div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto p-5">
                {selected && (
                  <>
                    <h1 className="mb-3 text-2xl font-bold">{selected.title || 'Untitled'}</h1>
                    <Markdown content={selected.content} />
                  </>
                )}
              </div>
              <div className="border-t border-stone-200 p-3 text-right dark:border-neutral-800">
                <button type="button" onClick={restore} className="rounded-lg bg-stone-900 px-4 py-2 font-medium text-white dark:bg-stone-100 dark:text-stone-900">
                  Restore this version
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
