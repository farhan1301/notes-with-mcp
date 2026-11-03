import React, { useCallback, useEffect, useState } from 'react';
import { ImageOff, Loader2, MoreHorizontal } from 'lucide-react';
import { notesApi, isNetworkError } from '../lib/supabase';
import { deleteTrashedImages, listTrashedImages, signedImageUrl, trashedImageMarkdown } from '../lib/images';
import { useDialog } from './Dialog';

const DAY = 24 * 60 * 60 * 1000;

function Thumb({ image, noteTitle, onMenu }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.resolve(signedImageUrl(image.path)).then((u) => active && setUrl(u)).catch(() => active && setFailed(true));
    return () => { active = false; };
  }, [image.path]);
  const days = Math.max(0, Math.ceil((new Date(image.delete_after) - Date.now()) / DAY));
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg bg-stone-200/70 dark:bg-neutral-800">
      {failed ? (
        <div className="flex h-full items-center justify-center text-stone-400"><ImageOff size={18} /></div>
      ) : url ? (
        <a href={url} target="_blank" rel="noreferrer" title={noteTitle ? `From "${noteTitle}"` : 'Open full size'}>
          <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        </a>
      ) : (
        <div className="flex h-full items-center justify-center text-stone-400"><Loader2 size={16} className="animate-spin" /></div>
      )}
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/55 px-1.5 text-[11px] text-white">
        {days === 0 ? 'today' : `${days}d`}
      </span>
      <button
        type="button"
        onClick={() => onMenu(image)}
        title="Put back or delete"
        className="absolute right-1 top-1 rounded-md bg-black/55 p-1 text-white hover:bg-black/75"
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

/**
 * The bottom of the Trash: images removed from notes (kept 30 days, can be
 * put back) and the Empty Trash button, which deletes the notes in the Trash
 * and every image in it for good.
 */
export default function TrashFooter({ notes, trashedNotes, onEmptyNotes, onChanged }) {
  const dialog = useDialog();
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listTrashedImages().then(setImages).catch(() => {}), []);
  useEffect(() => { load(); }, [load, trashedNotes]);

  const titleOf = (id) => notes.find((n) => n.id === id)?.title;
  const fail = (title, error) => dialog.confirm(title, isNetworkError(error) ? 'You are offline. Try again when you are connected.' : error.message);

  const onMenu = async (image) => {
    const note = notes.find((n) => n.id === image.note_id && !n.deleted_at);
    const choice = await dialog.choose('Image', [
      { value: 'restore', label: note ? `Put back in "${note.title || 'Untitled'}"` : 'Put back (as a new note in the Inbox)' },
      { value: 'delete', label: 'Delete now' },
    ]);
    if (!choice) return;
    setBusy(true);
    try {
      if (choice === 'restore') {
        const markdown = trashedImageMarkdown(image.path);
        if (note) await notesApi('append_to_note', { note: note.id, text: markdown });
        else await notesApi('create_note', { content: markdown });
        onChanged();
      } else {
        await deleteTrashedImages([image.path]);
      }
    } catch (error) {
      await fail(choice === 'restore' ? 'Could not put the image back' : 'Could not delete the image', error);
    } finally {
      setBusy(false);
      load();
    }
  };

  const emptyTrash = async () => {
    const parts = [
      trashedNotes && `${trashedNotes} note${trashedNotes === 1 ? '' : 's'}`,
      images.length && `${images.length} image${images.length === 1 ? '' : 's'}`,
    ].filter(Boolean);
    if (!(await dialog.confirm(`Delete ${parts.join(' and ')} forever?`, 'Notes lose their history, and their images are deleted too.', 'Delete', true))) return;
    setBusy(true);
    try {
      if (trashedNotes) await onEmptyNotes();
      await deleteTrashedImages(); // every image in the Trash, including those of the notes just deleted
    } catch (error) {
      await fail('Could not empty the Trash', error);
    } finally {
      setBusy(false);
      load();
      onChanged();
    }
  };

  if (!trashedNotes && !images.length) return null;
  return (
    <div className="px-1">
      {images.length > 0 && (
        <>
          <h3 className="px-2 pb-1 pt-5 text-[13px] font-semibold text-stone-500 dark:text-stone-400">Images</h3>
          <p className="px-2 pb-2 text-xs text-stone-400">Removed from notes. Each is deleted after 30 days.</p>
          <div className="grid grid-cols-3 gap-1.5 px-1">
            {images.map((image) => <Thumb key={image.path} image={image} noteTitle={titleOf(image.note_id)} onMenu={onMenu} />)}
          </div>
        </>
      )}
      <div className="px-3 pt-4 text-center">
        <p className="mb-2 text-xs text-stone-400">Agents can restore notes from the Trash until you empty it.</p>
        <button type="button" disabled={busy} onClick={emptyTrash} className="inline-flex items-center gap-1.5 text-sm text-red-600 disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />} Empty Trash
        </button>
      </div>
    </div>
  );
}
