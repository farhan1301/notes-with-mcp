import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NotebookPen, SquarePen, X } from 'lucide-react';
import { supabase, notesApi, isNetworkError, NOTE_META } from '../lib/supabase';
import { allDrafts, isEmptyDraft, removeDraft } from '../lib/drafts';
import { subscribe, syncNow } from '../lib/sync';
import { flattenTree, folderPath } from '../lib/folders';
import { DEFAULT_SORT, SORTS, sortNotes } from '../lib/sorting';
import { load, save } from '../lib/storage';
import { useDialog } from './Dialog';
import Sidebar from './Sidebar';
import NoteList from './NoteList';
import Editor from './Editor';
import Settings from './Settings';
import TrashFooter from './TrashFooter';

const LIST_KEY = 'notes-with-mcp:list';
const VIEW_KEY = 'notes-with-mcp:view';
const SORT_KEY = 'notes-with-mcp:sort';
const LAYOUT_KEY = 'notes-with-mcp:layout';
const DISPLAY_KEY = 'notes-with-mcp:display';
const DEFAULT_DISPLAY = { layout: 'list', previews: true }; // layout: list | grid
const DEFAULT_LAYOUT = { sidebar: 240, list: 320, sidebarHidden: false, listHidden: false };
const LIMITS = { sidebar: [180, 420], list: [240, 560] };

/** Drag handle on a column's right edge (desktop). Double-click resets the width. */
function ResizeHandle({ width, onResize, onReset }) {
  const start = (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev) => onResize(width + ev.clientX - x0);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize, double-click to reset"
      onPointerDown={start}
      onDoubleClick={onReset}
      className="absolute -right-1 top-0 z-10 hidden h-full w-2 cursor-col-resize hover:bg-amber-400/40 active:bg-amber-400/60 md:block"
    />
  );
}

/** Unsaved notes that only exist as drafts on this device. */
const draftOnlyNotes = (known) => Object.values(allDrafts())
  .filter((d) => d.baseVersion == null && !isEmptyDraft(d) && !known.has(d.id))
  .map((d) => ({
    id: d.id,
    folder_id: d.folder_id,
    title: d.title.trim() || d.content.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 80),
    preview: d.content.replace(/\s+/g, ' ').slice(0, 200),
    tags: [],
    pinned: false,
    updated_at: new Date(d.updatedAt).toISOString(),
    deleted_at: null,
    last_edited_by: 'you',
  }));

export default function NotesApp() {
  const dialog = useDialog();
  const cached = load(LIST_KEY, { folders: [], notes: [] });
  const [folders, setFolders] = useState(cached.folders);
  const [notes, setNotes] = useState(cached.notes);
  const [view, setView] = useState(() => load(VIEW_KEY, { kind: 'all' }));
  const [selected, setSelected] = useState(null); // { id, newFolderId }
  const [pane, setPane] = useState('list'); // phone layout: nav | list | note
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const [draftTick, setDraftTick] = useState(0);
  const [sort, setSort] = useState(() => ({ ...DEFAULT_SORT, ...load(SORT_KEY, {}) }));
  const [layout, setLayout] = useState(() => ({ ...DEFAULT_LAYOUT, ...load(LAYOUT_KEY, {}) }));
  const [display, setDisplay] = useState(() => ({ ...DEFAULT_DISPLAY, ...load(DISPLAY_KEY, {}) }));
  const [toast, setToast] = useState(null); // { message, undo? }
  const latestQuery = useRef('');
  const toastTimer = useRef(null);

  const updateLayout = useCallback((patch) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      save(LAYOUT_KEY, next);
      return next;
    });
  }, []);
  const resize = (column) => (width) => {
    const [min, max] = LIMITS[column];
    updateLayout({ [column]: Math.round(Math.min(max, Math.max(min, width))) });
  };

  const showToast = useCallback((message, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const refresh = useCallback(async () => {
    const [folderRes, noteRes] = await Promise.all([
      supabase.from('note_folders').select('id, parent_id, name'),
      supabase.from('notes').select(NOTE_META).order('updated_at', { ascending: false }),
    ]);
    const error = folderRes.error || noteRes.error;
    if (error) {
      if (!isNetworkError(error)) console.error(error);
      return;
    }
    setFolders(folderRes.data);
    setNotes(noteRes.data);
    save(LIST_KEY, { folders: folderRes.data, notes: noteRes.data });
  }, []);

  // Load, then refresh whenever the app comes back to the foreground (agents
  // may have changed things) and every minute while it is open.
  useEffect(() => {
    refresh();
    syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        syncNow();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = setInterval(onVisible, 60000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(timer);
    };
  }, [refresh]);

  const upsertMeta = useCallback((row) => {
    const { content, ...meta } = row;
    setNotes((prev) => {
      const next = prev.some((n) => n.id === meta.id) ? prev.map((n) => (n.id === meta.id ? { ...n, ...meta } : n)) : [meta, ...prev];
      save(LIST_KEY, { folders: load(LIST_KEY, { folders: [] }).folders, notes: next });
      return next;
    });
  }, []);

  useEffect(() => subscribe((event) => {
    if (event.type === 'saved') upsertMeta(event.row);
    setDraftTick((t) => t + 1);
  }), [upsertMeta]);

  // Re-render the list as drafts change (unsaved dots, offline-created notes).
  useEffect(() => {
    const timer = setInterval(() => setDraftTick((t) => t + 1), 2000);
    return () => clearInterval(timer);
  }, []);

  const changeView = (next) => {
    setView(next);
    save(VIEW_KEY, next);
    setQuery('');
    setPane('list');
  };

  const folderPathOf = useCallback((id) => folderPath(folders, id), [folders]);

  const drafts = useMemo(() => allDrafts(), [draftTick, notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const unsavedIds = useMemo(() => new Set(Object.values(drafts).filter((d) => !isEmptyDraft(d)).map((d) => d.id)), [drafts]);

  const visible = useMemo(() => {
    const known = new Set(notes.map((n) => n.id));
    const all = [...notes, ...draftOnlyNotes(known)];
    let list;
    if (view.kind === 'trash') list = all.filter((n) => n.deleted_at);
    else {
      const live = all.filter((n) => !n.deleted_at);
      if (view.kind === 'inbox') list = live.filter((n) => !n.folder_id);
      else if (view.kind === 'folder') list = live.filter((n) => n.folder_id === view.folderId);
      else list = live;
    }
    return sortNotes(list, sort.by);
  }, [notes, view, drafts, sort.by]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search: keywords + meaning through the notes-search Edge Function,
  // falling back to keyword search in the database.
  useEffect(() => {
    const q = query.trim();
    latestQuery.current = q;
    if (!q) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      let found = [];
      let note = '';
      const { data, error } = await supabase.functions.invoke('notes-search', { body: { query: q, limit: 30 } });
      if (!error && data?.results) found = data.results;
      else {
        try {
          found = (await notesApi('search_notes', { query: q, limit: 30 })).results;
          note = 'Showing keyword matches only.';
        } catch (fallbackError) {
          note = isNetworkError(fallbackError) ? 'Search needs a connection.' : fallbackError.message;
        }
      }
      if (latestQuery.current !== q) return;
      setResults(found);
      setSearchNote(note);
      setSearching(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const openNote = (id) => {
    setSelected({ id });
    setPane('note');
  };

  const newNote = () => {
    const id = crypto.randomUUID();
    setSelected({ id, isNew: true, newFolderId: view.kind === 'folder' ? view.folderId : null });
    setQuery('');
    setPane('note');
  };

  /** Pin, trash or restore from the list (needs a connection). */
  const patchNote = useCallback(async (id, patch) => {
    const { data, error } = await supabase.from('notes').update(patch).eq('id', id).select(NOTE_META).single();
    if (error) {
      await dialog.confirm('Could not update the note', isNetworkError(error) ? 'You are offline. Try again when you are connected.' : error.message);
      return null;
    }
    upsertMeta(data);
    return data;
  }, [dialog, upsertMeta]);

  const restoreNote = useCallback(async (id) => {
    if (await patchNote(id, { deleted_at: null })) showToast('Note restored');
  }, [patchNote, showToast]);

  const onRemoved = useCallback((id, forever) => {
    const existed = notes.some((n) => n.id === id);
    setNotes((prev) => (forever
      ? prev.filter((n) => n.id !== id)
      : prev.map((n) => (n.id === id ? { ...n, deleted_at: new Date().toISOString() } : n))));
    setSelected(null);
    setPane('list');
    setDraftTick((t) => t + 1);
    if (forever) showToast('Deleted forever');
    else if (existed) showToast('Moved to Trash', () => restoreNote(id));
  }, [notes, restoreNote, showToast]);

  const isSaved = (note) => notes.some((n) => n.id === note.id);

  const togglePin = async (note) => {
    if (!isSaved(note)) return;
    await patchNote(note.id, { pinned: !note.pinned });
  };

  const trashNote = async (note) => {
    if (!isSaved(note)) {
      removeDraft(note.id);
      if (selected?.id === note.id) setSelected(null);
      setDraftTick((t) => t + 1);
      return;
    }
    await syncNow();
    if (await patchNote(note.id, { deleted_at: new Date().toISOString() })) {
      if (selected?.id === note.id) {
        setSelected(null);
        setPane('list');
      }
      showToast('Moved to Trash', () => restoreNote(note.id));
    }
  };

  const deleteForever = async (note) => {
    if (!(await dialog.confirm('Delete forever?', 'This note and its history are removed for good.', 'Delete', true))) return;
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) {
      await dialog.confirm('Could not delete', error.message);
      return;
    }
    onRemoved(note.id, true);
  };

  /** Right-click (or long-press on a phone) on a note in the list. */
  const noteMenu = async (note) => {
    if (note.deleted_at) {
      const choice = await dialog.choose(note.title || 'Note', [
        { value: 'restore', label: 'Restore' },
        { value: 'forever', label: 'Delete forever' },
      ]);
      if (choice === 'restore') restoreNote(note.id);
      if (choice === 'forever') deleteForever(note);
      return;
    }
    if (!isSaved(note)) {
      if (await dialog.choose(note.title || 'Note', [{ value: 'discard', label: 'Discard unsaved note' }])) trashNote(note);
      return;
    }
    const choice = await dialog.choose(note.title || 'Note', [
      { value: 'pin', label: note.pinned ? 'Unpin' : 'Pin to top' },
      { value: 'move', label: 'Move to…' },
      { value: 'trash', label: 'Move to Trash' },
    ]);
    if (choice === 'pin') togglePin(note);
    if (choice === 'trash') trashNote(note);
    if (choice === 'move') {
      const target = await dialog.choose('Move to', [
        { value: '', label: 'Inbox' },
        ...flattenTree(folders).map((r) => ({ value: r.folder.id, label: r.folder.name, depth: r.depth + 1 })),
      ]);
      if (target != null) patchNote(note.id, { folder_id: target || null });
    }
  };

  const updateDisplay = (patch) => {
    const next = { ...display, ...patch };
    setDisplay(next);
    save(DISPLAY_KEY, next);
  };

  const viewMenu = async () => {
    const mark = (on) => (on ? '✓ ' : '\u2003 ');
    const choice = await dialog.choose('View options', [
      { value: 'list', label: `${mark(display.layout === 'list')}View as list` },
      { value: 'grid', label: `${mark(display.layout === 'grid')}View as gallery` },
      { value: 'previews', label: `${mark(display.previews)}Show note previews` },
      ...Object.entries(SORTS).map(([by, { label }]) => ({ value: by, label: `${mark(sort.by === by)}Sort by ${label.toLowerCase()}` })),
      { value: 'group', label: `${mark(sort.group)}Group by date` },
    ]);
    if (!choice) return;
    if (choice === 'list' || choice === 'grid') return updateDisplay({ layout: choice });
    if (choice === 'previews') return updateDisplay({ previews: !display.previews });
    const next = choice === 'group' ? { ...sort, group: !sort.group } : { ...sort, by: choice };
    setSort(next);
    save(SORT_KEY, next);
  };

  const onFolderAction = async (action, args) => {
    try {
      const result = await notesApi(action, args);
      await refresh();
      if (action === 'create_folder' && result?.id) changeView({ kind: 'folder', folderId: result.id });
      if (action === 'delete_folder' && view.kind === 'folder') changeView({ kind: 'all' });
    } catch (error) {
      await dialog.confirm('Could not change the folder', isNetworkError(error) ? 'You are offline.' : error.message);
    }
  };

  /** Deletes the notes in the Trash for good (TrashFooter asks first and deletes the images). */
  const deleteTrashedNotes = async () => {
    const { error } = await supabase.from('notes').delete().not('deleted_at', 'is', null);
    setSelected(null);
    if (error) throw error;
  };

  const signOut = async () => {
    if (Object.keys(allDrafts()).length
      && !(await dialog.confirm('Sign out?', 'Some changes are not saved yet. They stay on this device and are saved when you sign back in.', 'Sign out'))) return;
    await supabase.auth.signOut();
  };

  const title = view.kind === 'all' ? 'All notes'
    : view.kind === 'inbox' ? 'Inbox'
      : view.kind === 'trash' ? 'Trash'
        : folders.find((f) => f.id === view.folderId)?.name || 'Folder';

  const selectedMeta = selected ? notes.find((n) => n.id === selected.id) || null : null;
  const column = 'border-stone-200/80 dark:border-neutral-800';
  // Gallery on a wide screen: the grid fills the window, and an open note takes its place.
  const gallery = display.layout === 'grid';
  const listClass = gallery
    ? `${selected ? 'md:hidden' : 'md:flex md:flex-1'} md:min-w-0`
    : `${layout.listHidden ? 'md:hidden' : 'md:flex'} md:w-[var(--w)] md:shrink-0`;
  const closeNote = () => {
    if (gallery) setSelected(null);
    setPane('list');
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-stone-50 text-stone-900 dark:bg-neutral-950 dark:text-stone-100">
      <aside
        style={{ '--w': `${layout.sidebar}px` }}
        className={`${pane === 'nav' ? 'flex' : 'hidden'} ${layout.sidebarHidden || (!gallery && layout.listHidden) ? 'md:hidden' : 'md:flex'} relative w-full shrink-0 flex-col border-r bg-stone-100/70 md:w-[var(--w)] dark:bg-neutral-900/60 ${column}`}
      >
        <Sidebar folders={folders} notes={notes} view={view} onSelect={changeView} onFolderAction={onFolderAction} onSignOut={signOut} />
        <ResizeHandle width={layout.sidebar} onResize={resize('sidebar')} onReset={() => updateLayout({ sidebar: DEFAULT_LAYOUT.sidebar })} />
      </aside>

      {view.kind === 'settings' ? (
        <main className={`${pane === 'nav' ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
          <Settings onBack={() => setPane('nav')} />
        </main>
      ) : (
        <>
          <div
            style={{ '--w': `${layout.list}px` }}
            className={`${pane === 'list' ? 'flex' : 'hidden'} ${listClass} relative w-full flex-col border-r ${column}`}
          >
            <NoteList
              title={title}
              notes={visible}
              selectedId={selected?.id}
              showFolder={view.kind === 'all' || view.kind === 'trash'}
              folderPathOf={folderPathOf}
              onOpen={openNote}
              onNew={newNote}
              onBack={() => setPane('nav')}
              canCreate={view.kind !== 'trash'}
              query={query}
              onQuery={setQuery}
              results={results}
              searching={searching}
              searchNote={searchNote}
              unsavedIds={unsavedIds}
              sort={sort}
              display={display}
              onViewMenu={viewMenu}
              onToggleLayout={() => updateDisplay({ layout: gallery ? 'list' : 'grid' })}
              sidebarHidden={layout.sidebarHidden}
              onToggleSidebar={() => updateLayout({ sidebarHidden: !layout.sidebarHidden })}
              onMenu={noteMenu}
              onPin={view.kind === 'trash' ? null : togglePin}
              onTrash={view.kind === 'trash' ? null : trashNote}
              footer={view.kind === 'trash' && !query && (
                <TrashFooter notes={notes} trashedNotes={visible.length} onEmptyNotes={deleteTrashedNotes} onChanged={refresh} />
              )}
            />
            {view.kind !== 'trash' && (
              <button
                type="button"
                onClick={newNote}
                aria-label="New note"
                className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-white shadow-lg md:hidden"
              >
                <SquarePen size={24} />
              </button>
            )}
            {!gallery && <ResizeHandle width={layout.list} onResize={resize('list')} onReset={() => updateLayout({ list: DEFAULT_LAYOUT.list })} />}
          </div>

          <main className={`${pane === 'note' ? 'flex' : 'hidden'} ${gallery && !selected ? 'md:hidden' : 'md:flex'} min-w-0 flex-1 flex-col`}>
            {selected ? (
              <Editor
                key={selected.id}
                noteId={selected.id}
                meta={selectedMeta}
                created={Boolean(selected.isNew)}
                newFolderId={selected.newFolderId ?? null}
                folders={folders}
                folderPathOf={folderPathOf}
                onBack={closeNote}
                gallery={gallery}
                onChanged={upsertMeta}
                onRemoved={onRemoved}
                listHidden={layout.listHidden}
                onToggleList={() => updateLayout({ listHidden: !layout.listHidden })}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-stone-400">
                <NotebookPen size={40} strokeWidth={1.5} />
                <p>Select a note or start a new one</p>
              </div>
            )}
          </main>
        </>
      )}

      {toast && (
        <div role="status" className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-stone-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-stone-100 dark:text-stone-900">
          <span>{toast.message}</span>
          {toast.undo && (
            <button type="button" onClick={() => { toast.undo(); setToast(null); }} className="font-semibold text-amber-400 dark:text-amber-600">Undo</button>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="opacity-60"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
