import React, { useRef } from 'react';
import { ChevronLeft, FileText, LayoutGrid, List, Loader2, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Search, SlidersHorizontal, SquarePen, Trash2, X } from 'lucide-react';
import { splitHighlights } from '../lib/markdown';
import { dateGroup, SORTS } from '../lib/sorting';

const formatDate = (iso) => {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now - date) / 86400000);
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};

const Snippet = ({ text }) => (
  <>
    {splitHighlights(text).map((part, i) => (part.bold
      ? <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-400/30">{part.text}</mark>
      : <span key={i}>{part.text}</span>))}
  </>
);

const iconButton = 'rounded-lg p-2 text-amber-600 hover:bg-stone-200/60 dark:text-amber-400 dark:hover:bg-neutral-800';

/** Click opens the note; right-click, or a long press on touch screens, opens the menu. */
function usePress(note, onOpen, onMenu) {
  const press = useRef(null);
  const startPress = (e) => {
    if (e.pointerType !== 'touch' || !onMenu) return;
    press.current = setTimeout(() => {
      press.current = 'opened';
      onMenu(note);
    }, 550);
  };
  const endPress = () => {
    if (press.current && press.current !== 'opened') clearTimeout(press.current);
  };
  const open = () => {
    if (press.current === 'opened') {
      press.current = null;
      return;
    }
    onOpen(note.id);
  };
  return {
    container: { onContextMenu: onMenu ? (e) => { e.preventDefault(); onMenu(note); } : undefined },
    button: { onClick: open, onPointerDown: startPress, onPointerUp: endPress, onPointerCancel: endPress, onPointerMove: endPress },
  };
}

function HoverActions({ note, onPin, onTrash, className = '' }) {
  if (!onPin && !onTrash) return null;
  return (
    <div className={`absolute hidden gap-0.5 group-hover:flex ${className}`}>
      {onPin && (
        <button type="button" onClick={() => onPin(note)} title={note.pinned ? 'Unpin' : 'Pin'} className="rounded-md bg-white/80 p-1.5 text-stone-500 hover:text-amber-600 dark:bg-neutral-900/80">
          {note.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      )}
      {onTrash && (
        <button type="button" onClick={() => onTrash(note)} title="Move to Trash" className="rounded-md bg-white/80 p-1.5 text-stone-500 hover:text-red-600 dark:bg-neutral-900/80">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

function NoteRow({ note, active, showFolder, folderPathOf, dateField, onOpen, snippet, previews = true, unsaved, onMenu, onPin, onTrash }) {
  const press = usePress(note, onOpen, onMenu);
  return (
    <div
      className={`group relative rounded-xl ${active ? 'bg-amber-100 dark:bg-amber-400/20' : 'hover:bg-stone-200/50 dark:hover:bg-neutral-800/70'}`}
      {...press.container}
    >
      <button
        type="button"
        {...press.button}
        className="block w-full select-none px-3 py-2.5 text-left [-webkit-touch-callout:none]"
      >
        <div className="flex items-center gap-1.5 pr-14">
          {note.pinned && <Pin size={13} className="shrink-0 fill-amber-500 text-amber-500" />}
          <span className="truncate font-semibold">{note.title || 'New note'}</span>
          {unsaved && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Not saved yet" />}
        </div>
        <div className="mt-0.5 flex gap-2 text-sm text-stone-500 dark:text-stone-400">
          <span className="shrink-0">{formatDate(note[dateField] || note.updated_at)}</span>
          {snippet ? <span className="line-clamp-2"><Snippet text={snippet} /></span>
            : previews && <span className="line-clamp-2">{note.preview || 'No additional text'}</span>}
        </div>
        {(showFolder || note.last_edited_by?.startsWith('agent')) && (
          <div className="mt-1 flex gap-2 text-xs text-stone-400">
            {showFolder && <span className="truncate">{folderPathOf(note.folder_id)}</span>}
            {note.last_edited_by?.startsWith('agent') && <span className="shrink-0">edited by {note.last_edited_by.slice(7)}</span>}
          </div>
        )}
      </button>
      <HoverActions note={note} onPin={onPin} onTrash={onTrash} className="right-1.5 top-1.5" />
    </div>
  );
}

/** Gallery view: a card per note, like Apple Notes' gallery. */
function NoteCard({ note, active, showFolder, folderPathOf, dateField, onOpen, snippet, previews = true, unsaved, onMenu, onPin, onTrash }) {
  const press = usePress(note, onOpen, onMenu);
  const body = snippet ? <Snippet text={snippet} /> : note.preview;
  return (
    <div className="group relative min-w-0" {...press.container}>
      <button type="button" {...press.button} className="block w-full select-none text-left [-webkit-touch-callout:none]">
        <div
          className={`relative flex aspect-square overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-neutral-900 ${active ? 'border-amber-500 ring-2 ring-amber-500/40' : 'border-stone-200 group-hover:border-stone-300 dark:border-neutral-800 dark:group-hover:border-neutral-700'}`}
        >
          {previews && body ? (
            <p className="line-clamp-[8] break-words p-2.5 text-[11px] leading-snug text-stone-600 dark:text-stone-300">
              <span className="mb-1 block font-semibold text-stone-900 dark:text-stone-100">{note.title || 'New note'}</span>
              {body}
            </p>
          ) : (
            <div className="m-auto flex flex-col items-center gap-2 text-amber-500/80 dark:text-amber-400/70">
              <FileText size={40} strokeWidth={1.25} />
            </div>
          )}
          {note.pinned && (
            <span className="absolute bottom-1.5 left-1.5 rounded-full bg-amber-500 p-1 text-white shadow" title="Pinned">
              <Pin size={11} className="fill-white" />
            </span>
          )}
          {unsaved && <span className="absolute bottom-2 right-2 h-2 w-2 rounded-full bg-amber-500" title="Not saved yet" />}
        </div>
        <div className="mt-1.5 px-0.5 text-center">
          <div className="truncate text-sm font-semibold">{note.title || 'New note'}</div>
          <div className="truncate text-xs text-stone-500 dark:text-stone-400">{formatDate(note[dateField] || note.updated_at)}</div>
          {showFolder && <div className="truncate text-xs text-stone-400">{folderPathOf(note.folder_id)}</div>}
        </div>
      </button>
      <HoverActions note={note} onPin={onPin} onTrash={onTrash} className="right-1.5 top-1.5" />
    </div>
  );
}

const Notes = ({ grid, children }) => (
  <div className={grid ? 'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-3 gap-y-4 px-2 pt-1' : ''}>{children}</div>
);

const SectionHeader = ({ children }) => (
  <h3 className="px-3 pb-1 pt-4 text-[13px] font-semibold text-stone-500 first:pt-1 dark:text-stone-400">{children}</h3>
);

/** Pinned first, then date groups (Today, Yesterday, …) unless sorting by title. */
const sections = (notes, sort) => {
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);
  const out = [];
  if (pinned.length) out.push({ label: 'Pinned', notes: pinned });
  if (sort.group && sort.by !== 'title') {
    const field = SORTS[sort.by].field;
    for (const n of rest) {
      const label = dateGroup(n[field] || n.updated_at);
      if (out.length && out[out.length - 1].label === label && out[out.length - 1].dated) out[out.length - 1].notes.push(n);
      else out.push({ label, notes: [n], dated: true });
    }
  } else if (rest.length) {
    out.push({ label: pinned.length ? 'Notes' : null, notes: rest });
  }
  return out;
};

export default function NoteList({
  title, notes, selectedId, showFolder, folderPathOf, onOpen, onNew, onBack, canCreate,
  query, onQuery, results, searching, searchNote, unsavedIds, footer,
  sort, display, onViewMenu, onToggleLayout, sidebarHidden, onToggleSidebar, onMenu, onPin, onTrash,
}) {
  const searchMode = query.trim().length > 0;
  const grid = display.layout === 'grid';
  const Item = grid ? NoteCard : NoteRow;
  const dateField = SORTS[sort.by]?.field || 'updated_at';
  return (
    <section className="flex h-full flex-col">
      <header className="px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mb-3 flex items-center gap-1">
          <button type="button" onClick={onBack} className="-ml-2 flex items-center text-amber-600 md:hidden dark:text-amber-400">
            <ChevronLeft size={24} /> <span className="text-[15px]">Folders</span>
          </button>
          <button type="button" onClick={onToggleSidebar} title={sidebarHidden ? 'Show folders' : 'Hide folders'} className={`${iconButton} -ml-2 hidden md:block`}>
            {sidebarHidden ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </button>
          <div className="flex-1" />
          <button type="button" onClick={onToggleLayout} title={grid ? 'View as list' : 'View as gallery'} className={iconButton}>
            {grid ? <List size={19} /> : <LayoutGrid size={19} />}
          </button>
          <button type="button" onClick={onViewMenu} title={`View options (sorted by ${SORTS[sort.by].label})`} className={iconButton}>
            <SlidersHorizontal size={19} />
          </button>
          {canCreate && (
            <button type="button" onClick={onNew} title="New note" className={iconButton}>
              <SquarePen size={20} />
            </button>
          )}
        </div>
        <h2 className="mb-3 truncate text-2xl font-bold tracking-tight">{title}</h2>
        <label className="flex items-center gap-2 rounded-xl bg-stone-200/60 px-3 py-2 dark:bg-neutral-800">
          <Search size={17} className="shrink-0 text-stone-400" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search all notes"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-stone-400"
            type="search"
            enterKeyHint="search"
          />
          {searching && <Loader2 size={16} className="animate-spin text-stone-400" />}
          {searchMode && !searching && (
            <button type="button" onClick={() => onQuery('')} className="text-stone-400"><X size={16} /></button>
          )}
        </label>
      </header>
      <div className="flex-1 overflow-y-auto px-2 pb-24 md:pb-6">
        {searchMode ? (
          <>
            {searchNote && <p className="px-3 py-1 text-xs text-stone-400">{searchNote}</p>}
            <Notes grid={grid}>
              {results.map((r) => (
                <Item key={r.id} note={r} snippet={r.snippet} active={r.id === selectedId} showFolder folderPathOf={() => r.folder} dateField="updated_at" onOpen={onOpen} />
              ))}
            </Notes>
            {!searching && results.length === 0 && <p className="px-3 py-8 text-center text-stone-400">No matches</p>}
          </>
        ) : (
          <>
            {sections(notes, sort).map((section, i) => (
              <div key={`${section.label}-${i}`}>
                {section.label && <SectionHeader>{section.label}</SectionHeader>}
                <Notes grid={grid}>
                  {section.notes.map((n) => (
                    <Item
                      key={n.id}
                      note={n}
                      active={n.id === selectedId}
                      showFolder={showFolder}
                      folderPathOf={folderPathOf}
                      dateField={dateField}
                      onOpen={onOpen}
                      previews={display.previews}
                      unsaved={unsavedIds.has(n.id)}
                      onMenu={onMenu}
                      onPin={onPin}
                      onTrash={onTrash}
                    />
                  ))}
                </Notes>
              </div>
            ))}
            {notes.length === 0 && <p className="px-3 py-8 text-center text-stone-400">No notes</p>}
          </>
        )}
        {footer}
      </div>
    </section>
  );
}
