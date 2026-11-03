const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

/** Ticks or unticks the "- [ ]" checkbox on a 1-based line of Markdown. */
export const toggleTaskLine = (content, line) => {
  const lines = content.split('\n');
  const index = line - 1;
  if (index < 0 || index >= lines.length || !TASK.test(lines[index])) return content;
  lines[index] = lines[index].replace(TASK, (_, prefix, mark) => `${prefix}[${mark === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
};

/** "Grocery **milk** list" → [{text, bold}] for search snippets. */
export const splitHighlights = (snippet = '') =>
  snippet.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) =>
    part.startsWith('**') && part.endsWith('**') ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false });

/** Images ("![alt](url)") reduced to their alt text, as titles, previews and search see them. */
export const withoutImages = (text = '') => text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

/** Storage bucket for images added to notes (private: owner only). */
export const IMAGE_BUCKET = 'note-images';

/**
 * The path inside the note-images bucket for an image URL written into a note,
 * or null for any other image. Works whatever the Supabase host is.
 */
export const imagePath = (src = '') => {
  const match = /\/storage\/v1\/object\/(?:authenticated|public|sign)\/note-images\/([^?#]+)/.exec(src);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/** The Markdown for an uploaded image: its own paragraph, alt text without brackets. */
export const imageMarkdown = (supabaseUrl, path, alt = '') =>
  `![${alt.replace(/[[\]\n]/g, ' ').trim()}](${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/authenticated/${IMAGE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')})`;

/**
 * Where to insert a block (an image) at the cursor: on its own line, with a
 * blank line around it so it renders as its own paragraph.
 */
export const insertBlock = (text, start, end, block) => {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const insert = `${lead}${block}${trail}`;
  // The cursor goes to the start of the paragraph after the image.
  const caret = start + lead.length + block.length + 2;
  return { from: start, to: end, insert, start: caret, end: caret };
};

/**
 * The title the database gives a note without one: its first non-blank line,
 * without heading/list/checkbox markers, cut at a word boundary after 80
 * characters. Must match notes_before_write in the schema migration.
 */
export const autoTitle = (content = '') => {
  const first = withoutImages(content).split('\n').find((l) => l.trim()) || '';
  const text = first.replace(/^\s*(#+|[-*+]|\d+[.)])?\s*(\[[ xX]\]\s*)?/, '').trim();
  if (text.length <= 80) return text;
  return `${text.slice(0, 80).replace(/\s+\S*$/, '') || text.slice(0, 80)}…`;
};
