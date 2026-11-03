/** Note list sorting and Apple Notes-style date groups. */
export const SORTS = {
  updated: { label: 'Date Edited', field: 'updated_at' },
  created: { label: 'Date Created', field: 'created_at' },
  title: { label: 'Title', field: 'title' },
};

export const DEFAULT_SORT = { by: 'updated', group: true };

/** Pinned first, then by the chosen field (newest first, or A–Z for titles). */
export const sortNotes = (notes, by = 'updated') => {
  const field = SORTS[by]?.field || 'updated_at';
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (by === 'title') {
      return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true })
        || (b.updated_at || '').localeCompare(a.updated_at || '');
    }
    return (b[field] || b.updated_at || '').localeCompare(a[field] || a.updated_at || '');
  });
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "March", "2025". */
export const dateGroup = (iso, now = new Date()) => {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 Days';
  if (days < 30) return 'Previous 30 Days';
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'long' });
  return String(date.getFullYear());
};
