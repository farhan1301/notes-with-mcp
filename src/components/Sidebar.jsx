import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderPlus, Inbox, LogOut, Monitor, Moon, MoreHorizontal, NotebookText, Settings, Sun, Trash2 } from 'lucide-react';
import { flattenTree, subtreeIds } from '../lib/folders';
import { load, save } from '../lib/storage';
import { getTheme, setTheme, THEMES } from '../lib/theme';
import { useDialog } from './Dialog';

const COLLAPSED_KEY = 'notes-with-mcp:collapsed';
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon };

const Row = ({ active, icon: Icon, label, count, depth = 0, onClick, toggle, menu }) => (
  <div
    className={`group flex items-center rounded-lg pr-1 text-[15px] ${active ? 'bg-amber-100 text-stone-900 dark:bg-amber-400/20 dark:text-stone-50' : 'text-stone-700 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-neutral-800'}`}
    style={{ paddingLeft: `${0.25 + depth * 0.9}rem` }}
  >
    <span className="flex w-5 shrink-0 justify-center">{toggle}</span>
    <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
      <Icon size={17} className="shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="truncate">{label}</span>
    </button>
    {count > 0 && <span className="px-1 text-xs tabular-nums text-stone-400">{count}</span>}
    {menu}
  </div>
);

export default function Sidebar({ folders, notes, view, onSelect, onFolderAction, onSignOut }) {
  const dialog = useDialog();
  const [theme, setThemeState] = useState(getTheme);
  const [collapsed, setCollapsed] = useState(() => new Set(load(COLLAPSED_KEY, [])));
  const live = notes.filter((n) => !n.deleted_at);
  const counts = new Map();
  for (const n of live) counts.set(n.folder_id || 'inbox', (counts.get(n.folder_id || 'inbox') || 0) + 1);

  const chooseTheme = async () => {
    const choice = await dialog.choose('Appearance', Object.entries(THEMES).map(([value, label]) => ({ value, label: `${theme === value ? '✓ ' : '\u2003 '}${label}` })));
    if (!choice) return;
    setTheme(choice);
    setThemeState(choice);
  };

  const toggle = (id) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCollapsed(next);
    save(COLLAPSED_KEY, [...next]);
  };

  // Hide folders under a collapsed parent.
  const rows = [];
  const hiddenUnder = [];
  for (const row of flattenTree(folders)) {
    while (hiddenUnder.length && row.depth <= hiddenUnder[hiddenUnder.length - 1]) hiddenUnder.pop();
    if (hiddenUnder.length) continue;
    rows.push(row);
    if (collapsed.has(row.folder.id)) hiddenUnder.push(row.depth);
  }

  const folderMenu = async (folder, path) => {
    const blocked = subtreeIds(folders, folder.id);
    const choice = await dialog.choose(path, [
      { value: 'new', label: 'New folder inside' },
      { value: 'rename', label: 'Rename' },
      { value: 'move', label: 'Move to…' },
      { value: 'delete', label: 'Delete' },
    ]);
    if (choice === 'new') {
      const name = await dialog.prompt(`New folder in ${path}`, '', 'Create');
      if (name) onFolderAction('create_folder', { path: `${path}/${name.replaceAll('/', '-')}` });
    } else if (choice === 'rename') {
      const name = await dialog.prompt('Rename folder', folder.name);
      if (name && name !== folder.name) onFolderAction('rename_folder', { folder: folder.id, name: name.replaceAll('/', '-') });
    } else if (choice === 'move') {
      const target = await dialog.choose(`Move ${folder.name} to`, [
        { value: '', label: 'Top level' },
        ...flattenTree(folders).filter((r) => !blocked.has(r.folder.id)).map((r) => ({ value: r.folder.id, label: r.folder.name, depth: r.depth + 1 })),
      ]);
      if (target != null) onFolderAction('move_folder', { folder: folder.id, parent: target });
    } else if (choice === 'delete') {
      const inside = live.filter((n) => blocked.has(n.folder_id)).length;
      const ok = await dialog.confirm(
        `Delete ${path}?`,
        inside ? `Its subfolders go too, and ${inside} note${inside === 1 ? '' : 's'} move to the Trash.` : 'Its subfolders go too.',
        'Delete',
        true,
      );
      if (ok) onFolderAction('delete_folder', { folder: folder.id });
    }
  };

  const newFolder = async () => {
    const name = await dialog.prompt('New folder', '', 'Create');
    if (name) onFolderAction('create_folder', { path: name.replaceAll('/', '-') });
  };

  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight">Folders</h1>
        <button type="button" onClick={newFolder} title="New folder" className="rounded-lg p-2 text-amber-600 hover:bg-stone-200/60 dark:text-amber-400 dark:hover:bg-neutral-800">
          <FolderPlus size={20} />
        </button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        <Row icon={NotebookText} label="All notes" count={live.length} active={view.kind === 'all'} onClick={() => onSelect({ kind: 'all' })} />
        <Row icon={Inbox} label="Inbox" count={counts.get('inbox')} active={view.kind === 'inbox'} onClick={() => onSelect({ kind: 'inbox' })} />
        {rows.map(({ folder, depth, path, hasChildren }) => (
          <Row
            key={folder.id}
            icon={Folder}
            label={folder.name}
            depth={depth}
            count={counts.get(folder.id)}
            active={view.kind === 'folder' && view.folderId === folder.id}
            onClick={() => onSelect({ kind: 'folder', folderId: folder.id })}
            toggle={hasChildren && (
              <button type="button" onClick={() => toggle(folder.id)} className="text-stone-400">
                {collapsed.has(folder.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            )}
            menu={(
              <button type="button" onClick={() => folderMenu(folder, path)} title="Folder options" className="rounded p-1 text-stone-400 hover:text-stone-700 md:opacity-0 md:group-hover:opacity-100 dark:hover:text-stone-200">
                <MoreHorizontal size={17} />
              </button>
            )}
          />
        ))}
        <div className="pt-3">
          <Row icon={Trash2} label="Trash" count={notes.length - live.length} active={view.kind === 'trash'} onClick={() => onSelect({ kind: 'trash' })} />
          <Row icon={Settings} label="AI access" active={view.kind === 'settings'} onClick={() => onSelect({ kind: 'settings' })} />
          <Row icon={THEME_ICONS[theme]} label={`Appearance: ${THEMES[theme]}`} onClick={chooseTheme} />
          <Row icon={LogOut} label="Sign out" onClick={onSignOut} />
        </div>
      </div>
    </nav>
  );
}
