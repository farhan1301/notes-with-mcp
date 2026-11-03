/** Folder helpers over the flat list loaded from note_folders. */
export const folderPath = (folders, id) => {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts = [];
  let current = byId.get(id);
  for (let depth = 0; current && depth < 50; depth += 1) {
    parts.unshift(current.name);
    current = byId.get(current.parent_id);
  }
  return id ? parts.join('/') : 'Inbox';
};

/** Depth-first list of { folder, depth, path }, siblings sorted by name. */
export const flattenTree = (folders) => {
  const children = new Map();
  for (const f of folders) {
    const key = f.parent_id || 'root';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(f);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const out = [];
  const walk = (key, depth, prefix) => {
    for (const folder of children.get(key) || []) {
      const path = prefix ? `${prefix}/${folder.name}` : folder.name;
      out.push({ folder, depth, path, hasChildren: children.has(folder.id) });
      walk(folder.id, depth + 1, path);
    }
  };
  walk('root', 0, '');
  return out;
};

/** The folder and every folder below it. */
export const subtreeIds = (folders, id) => {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
};
