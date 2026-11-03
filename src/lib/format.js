/**
 * Formatting for the Markdown editor, so headings, lists and checklists work
 * like Apple Notes' Aa menu without knowing Markdown.
 *
 * Every function takes the textarea state { text, start, end } (selection
 * offsets) and returns a change { from, to, insert, start, end }: replace
 * text[from, to) with `insert`, then select [start, end). Applying a change
 * as one edit keeps the browser's undo working. null means "nothing to do".
 */

// Block prefix of a line: indent, then a heading, quote, or list marker
// (with an optional checkbox).
const PREFIX = /^(\s*)(#{1,6}\s+|>\s?|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;

export const BLOCKS = {
  title: { label: 'Title', prefix: () => '# ' },
  heading: { label: 'Heading', prefix: () => '## ' },
  subheading: { label: 'Subheading', prefix: () => '### ' },
  body: { label: 'Body', prefix: () => '' },
  bullet: { label: 'Bulleted list', prefix: () => '- ' },
  number: { label: 'Numbered list', prefix: (i) => `${i + 1}. ` },
  check: { label: 'Checklist', prefix: () => '- [ ] ' },
  quote: { label: 'Quote', prefix: () => '> ' },
};

/** Which block style a line has. */
export const blockOf = (line) => {
  const marker = (PREFIX.exec(line)[2] || '').trim();
  if (marker.startsWith('###')) return 'subheading';
  if (marker.startsWith('##')) return 'heading';
  if (marker.startsWith('#')) return 'title';
  if (marker.startsWith('>')) return 'quote';
  if (/\[[ xX]\]$/.test(marker)) return 'check';
  if (/^\d/.test(marker)) return 'number';
  if (marker) return 'bullet';
  return 'body';
};

/** Start and end offsets of the lines the selection touches. */
const lineRange = (text, start, end) => {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  // A selection ending right after a newline does not include the next line.
  const stop = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const next = text.indexOf('\n', stop);
  return { from, to: next === -1 ? text.length : next };
};

/** The block style of the line the cursor is on. */
export const currentBlock = ({ text, start }) => {
  const { from, to } = lineRange(text, start, start);
  return blockOf(text.slice(from, to));
};

/**
 * Sets the selected lines to a block style. Choosing the style they all
 * already have turns it off (back to body text), like Apple Notes.
 */
export const setBlock = ({ text, start, end }, kind) => {
  const { from, to } = lineRange(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const content = lines.filter((l) => l.trim());
  const toggleOff = kind !== 'body' && content.length > 0 && content.every((l) => blockOf(l) === kind);
  const target = toggleOff ? 'body' : kind;
  let n = 0;
  const out = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const [whole, indent] = PREFIX.exec(line);
    const body = line.slice(whole.length);
    // Headings and quotes are not indented; list items keep their indent.
    const keepIndent = ['bullet', 'number', 'check'].includes(target) ? indent : '';
    return keepIndent + BLOCKS[target].prefix(n++) + body;
  });
  const insert = out.join('\n');
  if (start !== end) return { from, to, insert, start: from, end: from + insert.length };
  // Keep the cursor on the same character of the line's text.
  const oldPrefix = PREFIX.exec(lines[0])[0].length;
  const newPrefix = out[0].length - (lines[0].length - oldPrefix);
  const cursor = from + newPrefix + Math.max(0, start - from - oldPrefix);
  return { from, to, insert, start: cursor, end: cursor };
};

const INLINE = { bold: '**', italic: '_', strike: '~~' };

/** Wraps the selection in bold / italic / strikethrough, or unwraps it. */
export const toggleInline = ({ text, start, end }, kind) => {
  const mark = INLINE[kind];
  const m = mark.length;
  // Already wrapped just outside the selection: unwrap.
  if (text.slice(start - m, start) === mark && text.slice(end, end + m) === mark) {
    return { from: start - m, to: end + m, insert: text.slice(start, end), start: start - m, end: end - m };
  }
  // The selection itself includes the markers: unwrap.
  const selected = text.slice(start, end);
  if (selected.length >= 2 * m && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(m, -m);
    return { from: start, to: end, insert: inner, start, end: start + inner.length };
  }
  if (start === end) {
    return { from: start, to: end, insert: mark + mark, start: start + m, end: start + m };
  }
  return { from: start, to: end, insert: mark + selected + mark, start: start + m, end: end + m };
};

/**
 * Enter inside a list: continue it (next number, new unchecked box). Enter on
 * an empty list item ends the list. Returns null outside lists.
 */
export const continueList = ({ text, start, end }) => {
  if (start !== end) return null;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const line = text.slice(lineStart, start);
  const match = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/.exec(line);
  if (!match) {
    const quote = /^>\s?/.exec(line);
    if (!quote) return null;
    if (!line.slice(quote[0].length).trim()) return { from: lineStart, to: start, insert: '', start: lineStart, end: lineStart };
    const insert = '\n> ';
    return { from: start, to: end, insert, start: start + insert.length, end: start + insert.length };
  }
  const [prefix, indent, bullet, num, delim, box] = match;
  if (!line.slice(prefix.length).trim()) {
    // Empty item: end the list (outdent first if indented). Leave a blank
    // line after the list, or Markdown would join the next text to it.
    const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    const afterList = lineStart > 0 && blockOf(text.slice(prevStart, lineStart - 1)) !== 'body';
    const replacement = indent.length >= 2 ? `${indent.slice(2)}${prefix.slice(indent.length)}` : afterList ? '\n' : '';
    return { from: lineStart, to: start, insert: replacement, start: lineStart + replacement.length, end: lineStart + replacement.length };
  }
  const marker = bullet || `${Number(num) + 1}${delim}`;
  const insert = `\n${indent}${marker} ${box ? '[ ] ' : ''}`;
  return { from: start, to: end, insert, start: start + insert.length, end: start + insert.length };
};

/** Tab / Shift-Tab on list lines: indent or outdent by two spaces. */
export const indentLines = ({ text, start, end }, outdent = false) => {
  const { from, to } = lineRange(text, start, end);
  const lines = text.slice(from, to).split('\n');
  if (!lines.some((l) => blockOf(l) !== 'body' && !/^#/.test(l.trim()))) return null;
  const out = lines.map((l) => (outdent ? l.replace(/^ {1,2}/, '') : `  ${l}`));
  const insert = out.join('\n');
  const shift = out[0].length - lines[0].length;
  return {
    from, to, insert,
    start: Math.max(from, start + shift),
    end: start === end ? Math.max(from, start + shift) : from + insert.length,
  };
};

/** Character offset where a 1-based line starts. */
export const lineOffset = (text, line) => {
  let offset = 0;
  for (let i = 1; i < line; i += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
};

/** Offset of the end of a 1-based line (where a click on that block puts the cursor). */
export const lineEndOffset = (text, line) => {
  const startAt = lineOffset(text, line);
  const next = text.indexOf('\n', startAt);
  return next === -1 ? text.length : next;
};

/** Length of a line's block marker (heading #, list marker, checkbox, quote). */
export const blockPrefixLength = (line) => PREFIX.exec(line)[0].length;
