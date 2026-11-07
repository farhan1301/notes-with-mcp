import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CaseSensitive, Check, ChevronLeft, CloudOff, Eye, ImagePlus, ListTodo, Loader2, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen, Pencil, Pin, RotateCcw, Trash2,
} from 'lucide-react';
import { supabase, isNetworkError, NOTE_META } from '../lib/supabase';
import { getDraft, putDraft, removeDraft } from '../lib/drafts';
import { getStatus, discardMine, keepMine, subscribe, syncNow } from '../lib/sync';
import { flattenTree } from '../lib/folders';
import { autoTitle, insertBlock, toggleTaskLine } from '../lib/markdown';
import { isImageFile, purgeImages, uploadImage } from '../lib/images';
import { continueList, currentBlock, indentLines, lineOffset, setBlock, toggleInline } from '../lib/format';
import { blockForLine, caretViewportY, firstVisibleBlock, revealCaret, scrollCaretTo, sourceOffsetFromClick } from '../lib/caret';
import { load, save } from '../lib/storage';
import Markdown from './Markdown';
import HistoryDialog from './HistoryDialog';
import FormatMenu from './FormatMenu';
import { useDialog } from './Dialog';

const CACHE_KEY = 'notes-with-mcp:content';

/** Recently opened notes, so they can be read without a connection. */
const cacheNote = (row) => {
  const cache = load(CACHE_KEY, {});
  cache[row.id] = { ...row, cachedAt: Date.now() };
  const ids = Object.keys(cache).sort((a, b) => cache[b].cachedAt - cache[a].cachedAt);
  for (const id of ids.slice(100)) delete cache[id];
  save(CACHE_KEY, cache);
};

const SaveState = ({ status, dirty, conflict }) => {
  const [Icon, label, tone, spin] = conflict ? [AlertTriangle, 'Not saved', 'text-amber-600']
    : status === 'offline' ? [CloudOff, 'Offline, kept on this device', 'text-amber-600']
      : status === 'error' ? [AlertTriangle, 'Not saved, retrying', 'text-red-600']
        : dirty || status === 'saving' ? [Loader2, 'Saving', '', true]
          : [Check, 'Saved', ''];
  return (
    <span title={label} className={`flex items-center gap-1 ${tone}`}>
      <Icon size={14} className={spin ? 'animate-spin' : ''} /> <span className="hidden sm:inline">{label}</span>
    </span>
  );
};

export default function Editor({
  noteId, meta, created, newFolderId, folders, folderPathOf, onBack, gallery, onChanged, onRemoved, listHidden, onToggleList,
}) {
  const dialog = useDialog();
  const [note, setNote] = useState(null); // server copy (with content)
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mode, setMode] = useState('preview');
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState(getStatus());
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [activeBlock, setActiveBlock] = useState('body');
  const [uploading, setUploading] = useState(0); // images being uploaded
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const latest = useRef({ title: '', content: '' }); // for code that runs after an upload
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const textRef = useRef(null);
  const titleRef = useRef(null);
  const scrollerRef = useRef(null);
  const previewRef = useRef(null);
  const pendingCaret = useRef(null); // { offset | 'title', y? }: cursor to place after switching to edit
  const pendingPreview = useRef(null); // { line, y }: spot to keep after switching to preview
  const timer = useRef(null);
  // New means started here and not saved yet: via "New note", or an unsaved
  // draft from earlier. Any other note missing from the local list (e.g. one an
  // agent just created) is loaded from the server instead.
  const [startedNew] = useState(() => created || getDraft(noteId)?.baseVersion === null);
  const isNew = startedNew && !meta;
  const inTrash = Boolean((meta ?? note)?.deleted_at);

  const applyDraftOr = useCallback((row) => {
    const draft = getDraft(noteId);
    // A title the database derived from the first line stays automatic: the
    // field is left empty (showing it as the placeholder) so it keeps following
    // the first line.
    const serverTitle = row && row.title !== autoTitle(row.content) ? row.title : '';
    setTitle(draft ? draft.title : serverTitle);
    setContent(draft ? draft.content : row?.content ?? '');
    setConflict(draft?.conflict || null);
    setDirty(Boolean(draft && !draft.conflict));
  }, [noteId]);

  const fetchNote = useCallback(async () => {
    const { data, error } = await supabase.from('notes').select(`${NOTE_META}, content`).eq('id', noteId).maybeSingle();
    if (error) throw error;
    if (data) cacheNote(data);
    return data;
  }, [noteId]);

  // Load the note (or start a new one).
  useEffect(() => {
    let active = true;
    setLoadError('');
    setNote(null);
    setHistoryOpen(false);
    if (isNew) {
      applyDraftOr(null);
      setMode('edit');
      return undefined;
    }
    const cached = load(CACHE_KEY, {})[noteId];
    if (cached) {
      setNote(cached);
      applyDraftOr(cached);
    }
    fetchNote()
      .then((row) => {
        if (!active) return;
        if (!row) {
          setLoadError('This note no longer exists.');
          return;
        }
        setNote(row);
        applyDraftOr(row);
        if (!meta) onChanged(row); // add it to the list
        if (!cached) setMode(row.content.trim() ? 'preview' : 'edit');
      })
      .catch((error) => {
        if (active && !cached) setLoadError(isNetworkError(error) ? 'You are offline and this note is not on this device yet.' : error.message);
      });
    if (cached) setMode(cached.content.trim() ? 'preview' : 'edit');
    return () => { active = false; };
  }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // An agent (or another device) changed the note: reload unless we have unsaved edits.
  useEffect(() => {
    if (!note || !meta || meta.version === note.version || getDraft(noteId)) return;
    fetchNote().then((row) => {
      if (row && !getDraft(noteId)) {
        setNote(row);
        applyDraftOr(row);
      }
    }).catch(() => {});
  }, [meta?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => subscribe((event) => {
    if (event.type === 'status') setStatus(event.status);
    if (event.type === 'saved' && event.row.id === noteId) {
      const { content: savedContent, ...row } = event.row;
      setNote((prev) => ({ ...prev, ...event.row }));
      cacheNote(event.row);
      setDirty(Boolean(getDraft(noteId)));
      onChanged(row);
    }
    if (event.type === 'conflict' && event.id === noteId) {
      setConflict(getDraft(noteId)?.conflict || null);
      setDirty(false);
    }
  }), [noteId, onChanged]);

  // Save right away when leaving the note.
  useEffect(() => () => {
    clearTimeout(timer.current);
    const draft = getDraft(noteId);
    if (draft && draft.baseVersion == null && !draft.title.trim() && !draft.content.trim()) removeDraft(noteId);
    else syncNow();
  }, [noteId]);

  // Grow the textarea with its content. Resetting the height for a moment
  // shrinks the page, which would scroll it to the top: restore the scroll.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const scroller = scrollerRef.current;
    const top = scroller?.scrollTop;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top;
  }, [content, mode]);

  // After switching modes, keep the reader's place: in edit mode the cursor
  // goes where they clicked, at the same height on screen; in preview the
  // block they were editing stays where the cursor was.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (mode === 'edit' && pendingCaret.current) {
      const { offset, y } = pendingCaret.current;
      pendingCaret.current = null;
      if (offset === 'title') {
        titleRef.current?.focus();
        return;
      }
      const el = textRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(offset, offset);
      if (scroller && y != null) scrollCaretTo(el, scroller, y);
      else if (scroller) revealCaret(el, scroller);
    }
    if (mode === 'preview' && pendingPreview.current && scroller && previewRef.current) {
      const { line, y } = pendingPreview.current;
      pendingPreview.current = null;
      const block = blockForLine(previewRef.current, line);
      if (block) scroller.scrollTop += block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - y;
    }
  }, [mode]);

  latest.current = { title, content };

  const edit = (nextTitle, nextContent) => {
    latest.current = { title: nextTitle, content: nextContent };
    setTitle(nextTitle);
    setContent(nextContent);
    setDirty(true);
    putDraft({ id: noteId, folder_id: isNew ? newFolderId : note?.folder_id, title: nextTitle, content: nextContent, baseVersion: note ? note.version : null });
    clearTimeout(timer.current);
    timer.current = setTimeout(syncNow, 700);
  };

  /**
   * Switches to editing with the cursor at `offset` (or 'title'), shown `y` px
   * below the top of the visible area. Without a position, the cursor goes to
   * the first line on screen, so the view does not move.
   */
  const startEditing = (offset, y) => {
    if (inTrash) return;
    if (offset == null && scrollerRef.current && previewRef.current) {
      const visible = firstVisibleBlock(previewRef.current, scrollerRef.current);
      if (visible) {
        pendingCaret.current = { offset: lineOffset(content, visible.line), y: visible.y };
        setMode('edit');
        return;
      }
    }
    pendingCaret.current = { offset: offset ?? content.length, y };
    setMode('edit');
  };

  /** Back to the rendered note, keeping the cursor's line where it is on screen. */
  const stopEditing = () => {
    const el = textRef.current;
    const scroller = scrollerRef.current;
    if (el && scroller && document.activeElement === el) {
      pendingPreview.current = {
        line: el.value.slice(0, el.selectionStart).split('\n').length,
        y: caretViewportY(el, scroller),
      };
    }
    setMode('preview');
  };

  // Click in the rendered note: edit, with the cursor where the click was and
  // that spot kept at the same height. Links, checkboxes and selecting text
  // keep working as usual.
  const onPreviewClick = (e) => {
    if (inTrash || e.target.closest('a, input, button, [data-image]') || window.getSelection()?.toString()) return;
    if (e.target.closest('[data-title]')) {
      startEditing('title');
      return;
    }
    const y = scrollerRef.current ? e.clientY - scrollerRef.current.getBoundingClientRect().top : undefined;
    startEditing(e.target.closest('[data-line]') ? sourceOffsetFromClick(e, content) : content.length, y);
  };

  /**
   * Applies a formatting change as one native edit, so Cmd/Ctrl+Z undoes it.
   * Falls back to setting the text directly where execCommand is missing.
   */
  const applyChange = (change) => {
    const el = textRef.current;
    if (!change || !el) return;
    const expected = el.value.slice(0, change.from) + change.insert + el.value.slice(change.to);
    el.focus({ preventScroll: true });
    el.setSelectionRange(change.from, change.to);
    const ok = change.insert
      ? document.execCommand('insertText', false, change.insert)
      : change.from === change.to || document.execCommand('delete');
    // Place the cursor now: a key typed right after must land after it.
    el.setSelectionRange(change.start, change.end);
    if (scrollerRef.current) revealCaret(el, scrollerRef.current);
    setActiveBlock(currentBlock({ text: expected, start: change.start }));
    if (!ok || el.value !== expected) {
      // No native edit: set the text through React, then restore the cursor
      // once it has re-rendered (unless something was typed meanwhile).
      edit(title, expected);
      requestAnimationFrame(() => {
        if (el.value === expected) el.setSelectionRange(change.start, change.end);
      });
    }
  };

  /**
   * Uploads images and puts them in the note: at the cursor while editing,
   * otherwise at the end. Each image is its own paragraph.
   */
  const addImages = async (files) => {
    const images = [...files].filter(isImageFile);
    if (!images.length || inTrash) return;
    if (!navigator.onLine) {
      await dialog.confirm('You are offline', 'Images can be added once you are connected again.');
      return;
    }
    const forNote = noteId;
    setUploading((n) => n + images.length);
    const failures = [];
    for (const file of images) {
      try {
        const markdown = await uploadImage(file, forNote);
        if (forNote !== noteIdRef.current) continue; // the user moved to another note
        // Use this render's functions: the note may have been saved (new version) meanwhile.
        const { applyChange: apply, edit: write } = actions.current;
        const el = textRef.current;
        if (el) {
          apply(insertBlock(el.value, el.selectionStart, el.selectionEnd, markdown));
        } else {
          const { title: t, content: c } = latest.current;
          write(t, c.trim() ? `${c.replace(/\s+$/, '')}\n\n${markdown}\n` : `${markdown}\n`);
        }
      } catch (error) {
        failures.push(`${file.name || 'Image'}: ${isNetworkError(error) ? 'no connection' : error.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (failures.length) await dialog.confirm('Could not add the image', failures.join('\n'));
  };

  const actions = useRef(null);
  actions.current = { applyChange, edit };

  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter(isImageFile);
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  };

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const onDragOver = (e) => {
    if (inTrash || !hasFiles(e)) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDrop = (e) => {
    setDragging(false);
    if (inTrash || !hasFiles(e)) return;
    e.preventDefault();
    // Dropped on the text: put the image where it was dropped.
    const el = textRef.current;
    if (el && e.target === el && document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos?.offsetNode === el) el.setSelectionRange(pos.offset, pos.offset);
    }
    addImages(e.dataTransfer.files);
  };

  const selection = () => {
    const el = textRef.current;
    return { text: el.value, start: el.selectionStart, end: el.selectionEnd };
  };

  const formatBlock = (kind) => {
    if (mode !== 'edit') {
      startEditing();
      return;
    }
    applyChange(setBlock(selection(), kind));
  };

  const formatInline = (kind) => {
    if (mode !== 'edit') return;
    applyChange(toggleInline(selection(), kind));
  };

  const toggleFormatMenu = () => {
    if (mode !== 'edit') startEditing();
    else if (textRef.current) setActiveBlock(currentBlock(selection()));
    setFormatOpen((open) => !open);
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    let change = null;
    if (e.key === 'Enter' && !e.shiftKey && !mod) change = continueList(selection());
    else if (e.key === 'Tab') change = indentLines(selection(), e.shiftKey);
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') change = toggleInline(selection(), 'bold');
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') change = toggleInline(selection(), 'italic');
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'x') change = toggleInline(selection(), 'strike');
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') change = setBlock(selection(), 'check');
    if (!change) return;
    e.preventDefault();
    applyChange(change);
  };

  const resolve = async (choice) => {
    if (choice === 'mine') {
      keepMine(noteId);
      setConflict(null);
      setDirty(true);
    } else {
      discardMine(noteId);
      setConflict(null);
      setDirty(false);
      try {
        const row = await fetchNote();
        if (row) {
          setNote(row);
          applyDraftOr(row);
        }
      } catch { /* keep what is shown */ }
    }
  };

  /** Direct field updates (pin, folder, tags, trash): need a connection. */
  const update = async (patch) => {
    const { data, error } = await supabase.from('notes').update(patch).eq('id', noteId).select(NOTE_META).single();
    if (error) {
      await dialog.confirm('Could not update the note', isNetworkError(error) ? 'You are offline. Try again when you are connected.' : error.message);
      return null;
    }
    setNote((prev) => ({ ...prev, ...data }));
    onChanged(data);
    return data;
  };

  const savedFirst = async () => {
    if (!isNew) return true;
    await syncNow();
    if (getDraft(noteId)) {
      await dialog.confirm('Save the note first', 'Type something and wait until it says Saved.');
      return false;
    }
    return true;
  };

  const shownTitle = title.trim() || autoTitle(content);

  const download = () => {
    const body = content.trimStart().startsWith('#') || !title.trim() ? content : `# ${title}\n\n${content}`;
    const blob = new Blob([body], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${(shownTitle || 'note').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const menu = async () => {
    const choice = await dialog.choose(shownTitle || 'Note', [
      { value: 'move', label: `Move to… (now: ${folderPathOf(note?.folder_id ?? newFolderId ?? null)})` },
      { value: 'tags', label: `Tags${note?.tags?.length ? `: ${note.tags.join(', ')}` : ''}` },
      { value: 'history', label: 'Version history' },
      { value: 'copy', label: 'Copy as Markdown' },
      { value: 'download', label: 'Download .md' },
      { value: 'delete', label: 'Move to Trash' },
    ]);
    if (choice === 'move') {
      if (!(await savedFirst())) return;
      const target = await dialog.choose('Move to', [
        { value: '', label: 'Inbox' },
        ...flattenTree(folders).map((r) => ({ value: r.folder.id, label: r.folder.name, depth: r.depth + 1 })),
      ]);
      if (target != null) update({ folder_id: target || null });
    } else if (choice === 'tags') {
      if (!(await savedFirst())) return;
      const value = await dialog.prompt('Tags (comma separated)', (note?.tags || []).join(', '));
      if (value != null) update({ tags: value.split(',').map((t) => t.trim()).filter(Boolean) });
    } else if (choice === 'history') {
      if (await savedFirst()) setHistoryOpen(true);
    } else if (choice === 'copy') {
      navigator.clipboard?.writeText(content);
    } else if (choice === 'download') {
      download();
    } else if (choice === 'delete') {
      moveToTrash();
    }
  };

  const moveToTrash = async () => {
    if (isNew) {
      removeDraft(noteId);
      onRemoved(noteId);
      return;
    }
    await syncNow();
    if (await update({ deleted_at: new Date().toISOString() })) onRemoved(noteId);
  };

  const restore = async () => {
    if (await update({ deleted_at: null })) onBack();
  };

  const deleteForever = async () => {
    if (!(await dialog.confirm('Delete forever?', 'This note, its history and its images are removed for good.', 'Delete', true))) return;
    const { error } = await supabase.from('notes').delete().eq('id', noteId);
    if (error) {
      await dialog.confirm('Could not delete', error.message);
      return;
    }
    purgeImages(); // its images go too
    onRemoved(noteId, true);
  };

  const onRestored = (row) => {
    removeDraft(noteId);
    setNote(row);
    applyDraftOr(row);
    onChanged(row);
  };

  const toolbarButton = 'rounded-lg p-2 text-amber-600 hover:bg-stone-200/60 disabled:opacity-40 dark:text-amber-400 dark:hover:bg-neutral-800';

  return (
    <article
      className="relative flex h-full flex-col"
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-amber-500 bg-amber-50/80 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          <span className="flex items-center gap-2 font-medium"><ImagePlus size={20} /> Drop to add the image</span>
        </div>
      )}
      <header className="flex items-center gap-1 border-b border-stone-200/70 px-2 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-neutral-800">
        <button type="button" onClick={onBack} className={`flex items-center text-amber-600 dark:text-amber-400 ${gallery ? '' : 'md:hidden'}`}>
          <ChevronLeft size={24} /> <span className="text-[15px]">{gallery ? 'Gallery' : 'Notes'}</span>
        </button>
        {!gallery && (
          <button type="button" onClick={onToggleList} title={listHidden ? 'Show folders and notes' : 'Hide folders and notes'} className={`${toolbarButton} hidden md:block`}>
            {listHidden ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </button>
        )}
        <div className="ml-1 hidden min-w-0 truncate text-xs text-stone-400 lg:block">{folderPathOf(note?.folder_id ?? newFolderId ?? null)}</div>
        <div className="flex-1" />
        {!inTrash && (
          <>
            <div className="mr-1 text-xs text-stone-400"><SaveState status={status} dirty={dirty} conflict={Boolean(conflict)} /></div>
            <div className="relative">
              <button type="button" data-format-toggle className={`${toolbarButton} ${formatOpen ? 'bg-stone-200/70 dark:bg-neutral-800' : ''}`} title="Text style (headings, lists)" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={toggleFormatMenu}>
                <CaseSensitive size={21} />
              </button>
              {formatOpen && mode === 'edit' && (
                <FormatMenu
                  active={activeBlock}
                  onBlock={(kind) => { formatBlock(kind); setFormatOpen(false); }}
                  onInline={formatInline}
                  onClose={() => setFormatOpen(false)}
                />
              )}
            </div>
            <button type="button" className={toolbarButton} title="Checklist (⌘⇧L)" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => (mode === 'edit' ? formatBlock('check') : startEditing())}>
              <ListTodo size={19} />
            </button>
            <button type="button" className={toolbarButton} title="Add image (or paste / drop one)" disabled={uploading > 0} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}>
              {uploading > 0 ? <Loader2 size={19} className="animate-spin" /> : <ImagePlus size={19} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addImages(e.target.files);
                e.target.value = '';
              }}
            />
            <button type="button" className={toolbarButton} title={note?.pinned ? 'Unpin' : 'Pin'} disabled={isNew} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => update({ pinned: !note?.pinned })}>
              <Pin size={19} className={note?.pinned ? 'fill-current' : ''} />
            </button>
            <button type="button" className={toolbarButton} title="Move to Trash" onClick={moveToTrash}>
              <Trash2 size={19} />
            </button>
            <button type="button" className={toolbarButton} title={mode === 'edit' ? 'Done' : 'Edit'} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => (mode === 'edit' ? stopEditing() : startEditing())}>
              {mode === 'edit' ? <Eye size={19} /> : <Pencil size={19} />}
            </button>
            <button type="button" className={toolbarButton} title="More" onClick={menu}>
              <MoreHorizontal size={19} />
            </button>
          </>
        )}
        {inTrash && (
          <>
            <button type="button" onClick={restore} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-amber-600 hover:bg-stone-200/60 dark:text-amber-400 dark:hover:bg-neutral-800">
              <RotateCcw size={16} /> Restore
            </button>
            <button type="button" onClick={deleteForever} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950">
              <Trash2 size={16} /> Delete forever
            </button>
          </>
        )}
      </header>

      {conflict && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <p className="mb-2">
            {conflict.deleted
              ? 'This note was deleted elsewhere while you were editing.'
              : `This note was changed${conflict.editedBy && conflict.editedBy !== 'you' ? ` by ${conflict.editedBy.replace(/^agent: /, '')}` : ' elsewhere'} while you were editing.`}
            {' '}Your text is kept on this device.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => resolve('mine')} className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white dark:bg-stone-100 dark:text-stone-900">Keep mine</button>
            {!conflict.gone && (
              <button type="button" onClick={() => resolve('theirs')} className="rounded-lg px-3 py-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/40">Use the other version</button>
            )}
          </div>
          <p className="mt-2 text-xs text-stone-500">Either way, the version you don't keep stays in the note's history.</p>
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 pb-[max(6rem,env(safe-area-inset-bottom))] pt-5">
          {loadError && <p className="py-10 text-center text-stone-500">{loadError}</p>}
          {!loadError && (isNew || note) && (
            <>
              {note && <p className="mb-2 text-center text-xs text-stone-400">
                {new Date(note.updated_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                {note.last_edited_by !== 'you' && ` · edited by ${note.last_edited_by.replace(/^agent: /, '')}`}
              </p>}
              {mode === 'edit' && !inTrash ? (
                <>
                  <input
                    ref={titleRef}
                    value={title}
                    onChange={(e) => edit(e.target.value, content)}
                    placeholder={autoTitle(content) || 'Title'}
                    className="mb-3 w-full bg-transparent text-2xl font-bold outline-none placeholder:text-stone-300 dark:placeholder:text-neutral-600"
                  />
                  <textarea
                    ref={textRef}
                    value={content}
                    onChange={(e) => edit(title, e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    onSelect={(e) => formatOpen && setActiveBlock(currentBlock({ text: e.target.value, start: e.target.selectionStart }))}
                    autoFocus={isNew || !content}
                    placeholder="Start writing, or paste from Wispr Flow. Use Aa for headings and lists."
                    className="min-h-[60vh] w-full resize-none bg-transparent font-[inherit] text-[17px] leading-relaxed outline-none placeholder:text-stone-300 dark:placeholder:text-neutral-600"
                  />
                </>
              ) : (
                <div ref={previewRef} onClick={onPreviewClick} className={`min-h-[60vh] ${inTrash ? '' : 'cursor-text'}`}>
                  {/* An automatic title is the note's first line, which is already shown. */}
                  {(title.trim() || !content.trim()) && <h1 data-title className="mb-3 text-2xl font-bold">{shownTitle || 'Untitled'}</h1>}
                  {content.trim()
                    ? <Markdown content={content} onToggleTask={inTrash ? null : (line) => edit(title, toggleTaskLine(content, line))} />
                    : <p className="text-stone-400">Empty note. Click to write.</p>}
                </div>
              )}
              {note?.tags?.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-1.5">
                  {note.tags.map((t) => <span key={t} className="rounded-full bg-stone-200/70 px-2.5 py-0.5 text-xs text-stone-600 dark:bg-neutral-800 dark:text-stone-300">#{t}</span>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {historyOpen && <HistoryDialog noteId={noteId} onClose={() => setHistoryOpen(false)} onRestored={onRestored} />}
    </article>
  );
}
