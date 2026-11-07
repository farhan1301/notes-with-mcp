/**
 * An in-memory stand-in for the Supabase client, used when VITE_DEMO=true.
 *
 * It implements exactly the calls the app makes (see the list below), with
 * the same { data, error } results, and copies the database's behaviour that
 * the UI relies on: column defaults, derived titles and previews, version
 * numbers and history, the duplicate-id error that sync.js recovers from,
 * folder rules, and the image Trash. Everything lives in this module and is
 * gone on reload.
 *
 * Calls covered:
 * - from('notes'): select (with eq / not is null / order / limit / single /
 *   maybeSingle), insert().select().single(), update().eq()[.eq()].select()
 *   [.single()], delete().eq(), delete().not('deleted_at', 'is', null)
 * - from('note_folders').select(); from('note_versions').select().eq().order().limit()
 * - from('note_agent_actions').select().order().limit()
 * - from('note_images'): select().not().order(), update().not()[.in()]
 * - rpc: notes_is_owner, notes_api (create_note, append_to_note,
 *   restore_version, search_notes, create_folder, rename_folder, move_folder,
 *   delete_folder), list_note_agent_keys, create_note_agent_key,
 *   set_note_agent_key_access, revoke_note_agent_key
 * - functions.invoke: notes-search, notes-images (purge)
 * - storage.from('note-images'): upload (refused), createSignedUrl
 * - auth: getSession, onAuthStateChange, signOut, signInWithPassword,
 *   signInWithOAuth
 *
 * If you add a query, table, RPC or notes_api action to the app, add it here
 * and give it sample rows in seed.js; unknown calls fail loudly.
 */
import { autoTitle, imagePath, withoutImages } from '../lib/markdown';
import { DEMO_UNAVAILABLE } from './mode';
import { memoryStorage } from './memoryStorage';
import { seed } from './seed';
import wireframeUrl from './images/wireframe.svg?url';
import coastUrl from './images/coast.svg?url';

const IMAGE_FILES = { 'wireframe.svg': wireframeUrl, 'coast.svg': coastUrl, 'coast-old.svg': coastUrl };

const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  user_metadata: { full_name: 'Demo user' },
  app_metadata: { provider: 'email' },
};
const SESSION = { access_token: 'demo', token_type: 'bearer', expires_in: 3600, refresh_token: 'demo', user: USER };

const copy = (value) => (value === undefined ? value : structuredClone(value));
const now = () => new Date().toISOString();
const fail = (message, code = '', details = '') => ({ message, code, details, hint: '' });
const unavailable = () => fail(DEMO_UNAVAILABLE, 'demo');

/** Thrown inside notes_api / table writes; turned into { error }. */
class DbError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// ── State ────────────────────────────────────────────────────────────────────

let db;
let nextVersionId;
let nextKeyId;

const NOTE_COLUMNS = ['id', 'folder_id', 'title', 'content', 'preview', 'tags', 'pinned', 'version', 'last_edited_by', 'created_at', 'updated_at', 'deleted_at'];

const reset = () => {
  const data = seed();
  db = {
    note_folders: data.folders,
    notes: data.notes.map((n) => {
      const row = { ...n };
      derive(row);
      return row;
    }),
    note_versions: data.versions.map((v, i) => ({ id: i + 1, saved_at: v.edited_at, ...v })),
    note_agent_keys: data.keys,
    note_agent_actions: data.actions,
    note_images: data.images,
  };
  nextVersionId = db.note_versions.length + 1;
  nextKeyId = Math.max(0, ...db.note_agent_keys.map((k) => k.id)) + 1;
};

// ── What the database triggers do (notes_before_write, notes_after_update) ──

/** Title from the first line when blank, tags tidied, list preview. */
function derive(row) {
  row.content = row.content ?? '';
  row.title = (row.title ?? '').trim() || autoTitle(row.content);
  row.tags = [...new Set((row.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
  const text = withoutImages(row.content);
  let body = text.replace(/^[ \t\n]+/, '').replace(/^#+[ \t]*/, '');
  const lead = row.title.replace(/…+$/, '');
  if (lead && body.startsWith(lead)) body = body.slice(lead.length);
  body = body.replace(/^[ \t]*(#+|>|[-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/gm, '').replace(/\*\*|__|`/g, '');
  row.preview = body.replace(/\s+/g, ' ').trim().slice(0, 200);
}

const insertNote = (values) => {
  const id = values.id ?? crypto.randomUUID();
  if (db.notes.some((n) => n.id === id)) {
    throw new DbError('duplicate key value violates unique constraint "notes_pkey"', '23505');
  }
  checkNote(values);
  const stamp = now();
  const row = {
    id,
    folder_id: values.folder_id ?? null,
    title: values.title ?? '',
    content: values.content ?? '',
    tags: values.tags ?? [],
    pinned: values.pinned ?? false,
    version: 1,
    last_edited_by: 'you',
    created_at: stamp,
    updated_at: stamp,
    deleted_at: values.deleted_at ?? null,
  };
  derive(row);
  db.notes.unshift(row);
  trackImages();
  return row;
};

const checkNote = (row) => {
  if (row.folder_id != null && !db.note_folders.some((f) => f.id === row.folder_id)) {
    throw new DbError('insert or update on table "notes" violates foreign key constraint "notes_folder_id_fkey"', '23503');
  }
  if ((row.content ?? '').length > 500000) {
    throw new DbError('new row for relation "notes" violates check constraint "notes_content_check"', '23514');
  }
};

const updateNote = (old, patch) => {
  const row = { ...old, ...patch };
  checkNote(row);
  derive(row);
  row.id = old.id;
  row.created_at = old.created_at;
  row.version = old.version;
  row.updated_at = old.updated_at;
  row.last_edited_by = old.last_edited_by;
  const textChanged = row.title !== old.title || row.content !== old.content;
  if (textChanged) {
    row.version = old.version + 1;
    row.last_edited_by = 'you';
    row.updated_at = now();
    snapshot(old, row);
  } else if (row.folder_id !== old.folder_id || row.pinned !== old.pinned || row.deleted_at !== old.deleted_at
    || row.tags.join() !== old.tags.join()) {
    row.updated_at = now();
  }
  Object.assign(old, row);
  trackImages();
  return old;
};

/** Keeps the text before an editing session (or before a restore) in history. */
const snapshot = (old, next) => {
  if (!old.title && !old.content) return;
  const sameSession = old.last_edited_by === next.last_edited_by && Date.parse(old.updated_at) > Date.now() - 10 * 60 * 1000;
  const isRestore = db.note_versions.some((v) => v.note_id === old.id && v.title === next.title && v.content === next.content);
  if (sameSession && !isRestore) return;
  db.note_versions.push({
    id: nextVersionId++, note_id: old.id, version: old.version, title: old.title, content: old.content,
    edited_by: old.last_edited_by, edited_at: old.updated_at, saved_at: now(),
  });
  const mine = db.note_versions.filter((v) => v.note_id === old.id);
  if (mine.length > 100) {
    const drop = new Set(mine.slice(0, mine.length - 100).map((v) => v.id));
    db.note_versions = db.note_versions.filter((v) => !drop.has(v.id));
  }
};

const deleteNotes = (rows) => {
  const gone = new Set(rows.map((n) => n.id));
  db.notes = db.notes.filter((n) => !gone.has(n.id));
  db.note_versions = db.note_versions.filter((v) => !gone.has(v.note_id));
  // Images only these notes used are due at once.
  const used = usedImagePaths();
  for (const img of db.note_images) {
    if (gone.has(img.note_id) && !used.has(img.path)) {
      img.trashed_at ??= now();
      img.delete_after = now();
    }
  }
};

// ── Image Trash (notes_track_images) ─────────────────────────────────────────

const imageRefs = (content) => [...(content || '').matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => imagePath(m[1])).filter(Boolean);
const usedImagePaths = () => new Set(db.notes.flatMap((n) => imageRefs(n.content)));

const trackImages = () => {
  const used = usedImagePaths();
  for (const n of db.notes) {
    for (const path of imageRefs(n.content)) {
      if (!db.note_images.some((img) => img.path === path)) db.note_images.push({ path, note_id: n.id, trashed_at: null, delete_after: null });
    }
  }
  for (const img of db.note_images) {
    if (used.has(img.path)) {
      img.trashed_at = null;
      img.delete_after = null;
    } else if (!img.trashed_at) {
      img.trashed_at = now();
      img.delete_after = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }
  }
};

// ── Folders ──────────────────────────────────────────────────────────────────

const folderById = (id) => db.note_folders.find((f) => f.id === id);
const folderPath = (id) => {
  if (!id) return 'Inbox';
  const parts = [];
  for (let f = folderById(id); f; f = folderById(f.parent_id)) parts.unshift(f.name);
  return parts.join('/');
};
const subtree = (id) => {
  const ids = [id];
  for (let i = 0; i < ids.length; i += 1) ids.push(...db.note_folders.filter((f) => f.parent_id === ids[i]).map((f) => f.id));
  return ids;
};
const resolveFolder = (ref) => {
  const value = (ref ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!value || value.toLowerCase() === 'inbox') return null;
  if (folderById(value)) return value;
  const found = db.note_folders.find((f) => folderPath(f.id).toLowerCase() === value.toLowerCase());
  if (!found) throw new DbError(`No folder "${value}".`, '22023');
  return found.id;
};
const checkFolderName = (name, parentId, selfId) => {
  const clean = (name ?? '').trim();
  if (clean.length < 1 || clean.length > 100 || clean.includes('/')) {
    throw new DbError('new row for relation "note_folders" violates check constraint "note_folders_name_check"', '23514');
  }
  if (!parentId && clean.toLowerCase() === 'inbox') throw new DbError('"Inbox" is reserved for notes without a folder.', '22023');
  if (db.note_folders.some((f) => f.id !== selfId && (f.parent_id ?? null) === (parentId ?? null) && f.name.toLowerCase() === clean.toLowerCase())) {
    throw new DbError('duplicate key value violates unique constraint "note_folders_name_key"', '23505');
  }
  return clean;
};

// ── notes_api (the owner's actions the app uses) ─────────────────────────────

const resolveNote = (ref, includeDeleted = false) => {
  const n = db.notes.find((x) => x.id === ref && (includeDeleted || !x.deleted_at));
  if (!n) throw new DbError(`No note "${ref}".`, '22023');
  return n;
};

const summary = (n) => ({
  id: n.id, title: n.title, folder: folderPath(n.folder_id), folder_id: n.folder_id, tags: n.tags, pinned: n.pinned,
  created_at: n.created_at, updated_at: n.updated_at, last_edited_by: n.last_edited_by, chars: n.content.length, preview: n.preview,
});

/** Keyword search like notes_search_core without embeddings: every word must match. */
const search = (query, limit = 20) => {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return [];
  const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return db.notes
    .filter((n) => !n.deleted_at)
    .map((n) => {
      const text = withoutImages(n.content);
      const haystack = `${n.title} ${n.tags.join(' ')} ${text}`.toLowerCase();
      if (!words.every((w) => haystack.includes(w))) return null;
      const score = words.reduce((s, w) => s + haystack.split(w).length - 1 + (n.title.toLowerCase().includes(w) ? 3 : 0), 0);
      const flat = text.replace(/\s+/g, ' ');
      const at = Math.max(0, flat.toLowerCase().indexOf(words[0]));
      const start = Math.max(0, flat.lastIndexOf(' ', Math.max(0, at - 60)));
      let snippet = flat.slice(start, start + 180).trim();
      for (const w of words) snippet = snippet.replace(new RegExp(`(${escape(w)}[\\p{L}\\p{N}]*)`, 'giu'), '**$1**');
      const { preview, ...rest } = summary(n);
      return { score, result: { ...rest, match: 'keyword', similarity: null, snippet } };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.result.updated_at.localeCompare(a.result.updated_at))
    .slice(0, limit)
    .map((x) => x.result);
};

const notesApi = (action, a = {}) => {
  switch (action) {
    case 'search_notes': {
      const query = (a.query ?? '').trim();
      if (!query) throw new DbError('Pass a query.', '22023');
      return { semantic: false, results: search(query, a.limit ?? 20) };
    }
    case 'create_note': {
      if (!(a.title ?? '').trim() && !(a.content ?? '').trim()) throw new DbError('Pass a title or content.', '22023');
      const n = insertNote({ folder_id: resolveFolder(a.folder), title: a.title ?? '', content: a.content ?? '', tags: a.tags ?? [], pinned: a.pinned ?? false });
      return { ...summary(n), version: n.version };
    }
    case 'append_to_note': {
      const n = resolveNote(a.note);
      const text = a.text ?? '';
      if (!text.trim()) throw new DbError('Pass the text to add.', '22023');
      const content = a.position === 'start'
        ? text + (n.content.trim() ? `\n\n${n.content.replace(/^\n+/, '')}` : '')
        : n.content.replace(/[\n ]+$/, '') + (n.content.trim() ? '\n\n' : '') + text;
      updateNote(n, { content });
      return { ...summary(n), version: n.version };
    }
    case 'restore_version': {
      const v = db.note_versions.find((x) => x.id === Number(a.version_id));
      if (!v) throw new DbError(`No version ${a.version_id}.`, '22023');
      const n = resolveNote(v.note_id, true);
      updateNote(n, { title: v.title, content: v.content, deleted_at: null });
      return { ...summary(n), version: n.version };
    }
    case 'create_folder': {
      const parts = (a.path ?? '').split('/').map((p) => p.trim()).filter(Boolean);
      if (!parts.length) throw new DbError('Pass the folder path, e.g. "Work" or "Work/Ideas".', '22023');
      let parent = null;
      let created = false;
      for (const part of parts) {
        let f = db.note_folders.find((x) => (x.parent_id ?? null) === parent && x.name.toLowerCase() === part.toLowerCase());
        if (!f) {
          const stamp = now();
          f = { id: crypto.randomUUID(), parent_id: parent, name: checkFolderName(part, parent), created_at: stamp, updated_at: stamp };
          db.note_folders.push(f);
          created = true;
        }
        parent = f.id;
      }
      return { id: parent, path: folderPath(parent), created };
    }
    case 'rename_folder': {
      const id = resolveFolder(a.folder);
      if (!id) throw new DbError('The Inbox cannot be renamed.', '22023');
      const f = folderById(id);
      f.name = checkFolderName(a.name, f.parent_id, id);
      f.updated_at = now();
      return { id, path: folderPath(id) };
    }
    case 'move_folder': {
      const id = resolveFolder(a.folder);
      if (!id) throw new DbError('The Inbox cannot be moved.', '22023');
      const parent = resolveFolder(a.parent);
      if (parent && subtree(id).includes(parent)) throw new DbError('A folder cannot move into itself or one of its subfolders.', '22023');
      const f = folderById(id);
      checkFolderName(f.name, parent, id);
      f.parent_id = parent;
      f.updated_at = now();
      return { id, path: folderPath(id) };
    }
    case 'delete_folder': {
      const id = resolveFolder(a.folder);
      if (!id) throw new DbError('The Inbox cannot be deleted.', '22023');
      const ids = subtree(id);
      let count = 0;
      for (const n of db.notes) {
        if (ids.includes(n.folder_id) && !n.deleted_at) {
          updateNote(n, { deleted_at: now() });
          count += 1;
        }
      }
      // on delete cascade for subfolders; notes' folder_id is set null
      db.note_folders = db.note_folders.filter((f) => !ids.includes(f.id));
      for (const n of db.notes) if (ids.includes(n.folder_id)) n.folder_id = null;
      return { deleted_folders: ids.length, notes_moved_to_trash: count };
    }
    default:
      throw new DbError(DEMO_UNAVAILABLE, 'demo');
  }
};

const RPC = {
  notes_is_owner: () => true,
  notes_api: ({ p_action, p_args }) => notesApi(p_action, p_args ?? {}),
  list_note_agent_keys: () => [...db.note_agent_keys]
    .sort((a, b) => (a.revoked_at ? 1 : 0) - (b.revoked_at ? 1 : 0) || b.created_at.localeCompare(a.created_at))
    .map((k) => ({ ...k, can_write: k.access === 'edit' })),
  create_note_agent_key: () => { throw new DbError(DEMO_UNAVAILABLE, 'demo'); },
  set_note_agent_key_access: ({ p_id, p_access }) => {
    if (!['read', 'inbox', 'edit'].includes(p_access)) throw new DbError('Access must be read, inbox or edit.', '22023');
    const k = db.note_agent_keys.find((x) => x.id === p_id && !x.revoked_at);
    if (k) k.access = p_access;
    return null;
  },
  revoke_note_agent_key: ({ p_id }) => {
    const k = db.note_agent_keys.find((x) => x.id === p_id && !x.revoked_at);
    if (k) k.revoked_at = now();
    return null;
  },
};

// ── Query builder (the subset of PostgREST the app uses) ─────────────────────

const project = (row, columns) => {
  if (!columns || columns.trim() === '*') {
    return Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')));
  }
  return Object.fromEntries(columns.split(',').map((c) => c.trim()).filter(Boolean).map((c) => [c, row[c] ?? null]));
};

class Query {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.filters = [];
    this.columns = null;
    this.returning = false; // writes return rows only with .select()
    this.orders = [];
    this.max = null;
    this.mode = 'many';
  }

  /** A read, or (after insert/update) "return the written rows". */
  select(columns = '*') {
    this.columns = columns;
    this.returning = true;
    return this;
  }

  insert(values) { this.op = 'insert'; this.values = values; return this; }

  update(patch) { this.op = 'update'; this.patch = patch; return this; }

  delete() { this.op = 'delete'; return this; }

  eq(column, value) { this.filters.push((r) => r[column] === value); return this; }

  in(column, values) { this.filters.push((r) => values.includes(r[column])); return this; }

  not(column, operator, value) {
    if (operator !== 'is' || value !== null) throw new Error(`demo client: .not(${column}, ${operator}, ${value}) is not implemented`);
    this.filters.push((r) => r[column] != null);
    return this;
  }

  order(column, { ascending = true } = {}) { this.orders.push({ column, ascending }); return this; }

  limit(n) { this.max = n; return this; }

  single() { this.mode = 'single'; return this; }

  maybeSingle() { this.mode = 'maybe'; return this; }

  then(resolve, reject) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }

  rows() {
    const rows = db[this.table];
    if (!rows) throw new Error(`demo client: table ${this.table} is not implemented`);
    return rows.filter((r) => this.filters.every((f) => f(r)));
  }

  run() {
    let rows;
    try {
      rows = this.execute();
    } catch (e) {
      if (e instanceof DbError) return { data: null, error: fail(e.message, e.code) };
      throw e;
    }
    if (!this.returning) return { data: null, error: null };
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[column];
        const y = b[column];
        if (x === y) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (this.max != null) rows = rows.slice(0, this.max);
    const data = rows.map((r) => copy(project(r, this.columns)));
    if (this.mode === 'many') return { data, error: null };
    if (data.length === 1) return { data: data[0], error: null };
    if (this.mode === 'maybe' && data.length === 0) return { data: null, error: null };
    return { data: null, error: fail('JSON object requested, multiple (or no) rows returned', 'PGRST116', `The result contains ${data.length} rows`) };
  }

  execute() {
    if (this.op === 'select') {
      this.returning = true;
      return this.rows();
    }
    if (this.op === 'insert') {
      if (this.table !== 'notes') throw new DbError(DEMO_UNAVAILABLE, 'demo');
      const list = Array.isArray(this.values) ? this.values : [this.values];
      return list.map((v) => insertNote(v));
    }
    if (this.op === 'update') {
      const matched = this.rows();
      if (this.table === 'notes') return matched.map((r) => updateNote(r, this.patch));
      if (this.table === 'note_images') {
        for (const r of matched) Object.assign(r, { delete_after: this.patch.delete_after ?? r.delete_after });
        return matched;
      }
      throw new DbError(DEMO_UNAVAILABLE, 'demo');
    }
    if (this.op === 'delete') {
      if (this.table !== 'notes') throw new DbError(DEMO_UNAVAILABLE, 'demo');
      const matched = this.rows();
      deleteNotes(matched);
      return matched;
    }
    throw new Error(`demo client: ${this.op} is not implemented`);
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

const listeners = new Set();
const emit = (event, session) => listeners.forEach((fn) => setTimeout(() => fn(event, session), 0));

const auth = {
  getSession: async () => ({ data: { session: copy(SESSION) }, error: null }),
  onAuthStateChange: (fn) => {
    listeners.add(fn);
    return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
  },
  /** Starts the demo over: fresh sample data, and signed straight back in. */
  signOut: async () => {
    reset();
    memoryStorage.clear();
    emit('SIGNED_OUT', null);
    setTimeout(() => emit('SIGNED_IN', copy(SESSION)), 50);
    return { error: null };
  },
  signInWithPassword: async () => ({ data: { session: copy(SESSION), user: copy(USER) }, error: null }),
  signInWithOAuth: async () => ({ data: null, error: unavailable() }),
};

// ── Edge Functions and Storage ───────────────────────────────────────────────

const functions = {
  invoke: async (name, { body } = {}) => {
    await null;
    if (name === 'notes-search') {
      try {
        return { data: { semantic: false, results: search((body?.query ?? '').trim(), body?.limit ?? 20) }, error: null };
      } catch (e) {
        return { data: null, error: fail(e.message) };
      }
    }
    if (name === 'notes-images' && body?.action === 'purge') {
      const due = db.note_images.filter((img) => img.delete_after && Date.parse(img.delete_after) <= Date.now());
      db.note_images = db.note_images.filter((img) => !due.includes(img));
      return { data: { deleted: due.length }, error: null };
    }
    return { data: null, error: unavailable() };
  },
};

const storage = {
  from: () => ({
    upload: async () => ({ data: null, error: unavailable() }),
    createSignedUrl: async (path) => {
      const url = IMAGE_FILES[path.split('/').pop()];
      return url ? { data: { signedUrl: url }, error: null } : { data: null, error: fail('Object not found', '404') };
    },
  }),
};

// ── The client ───────────────────────────────────────────────────────────────

export const createDemoClient = () => {
  reset();
  return {
    from: (table) => new Query(table),
    rpc: async (name, args = {}) => {
      await null;
      const fn = RPC[name];
      if (!fn) return { data: null, error: unavailable() };
      try {
        return { data: copy(fn(args)), error: null };
      } catch (e) {
        if (e instanceof DbError) return { data: null, error: fail(e.message, e.code) };
        throw e;
      }
    },
    functions,
    storage,
    auth,
  };
};
