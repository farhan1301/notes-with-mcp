/**
 * Keeping the reader's place when the editor changes: where the cursor is on
 * screen, which rendered line was clicked, and how to scroll so a spot stays
 * where it was. Browser-only helpers (they measure the DOM).
 */
import { blockPrefixLength, lineEndOffset, lineOffset } from './format';

const MIRRORED = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'textTransform', 'wordSpacing', 'tabSize', 'textIndent',
];

/** Distance from the textarea's top edge to the line holding `pos`, in px. */
export const caretOffsetInTextarea = (el, pos) => {
  const style = getComputedStyle(el);
  const mirror = document.createElement('div');
  for (const prop of MIRRORED) mirror.style[prop] = style[prop];
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word',
  });
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
};

/** Where the cursor's line is, measured from the scroller's visible top. */
export const caretViewportY = (el, scroller, pos = el.selectionStart) =>
  el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + caretOffsetInTextarea(el, pos);

/** Scrolls so the cursor's line sits `y` px below the scroller's top. */
export const scrollCaretTo = (el, scroller, y, pos = el.selectionStart) => {
  scroller.scrollTop += caretViewportY(el, scroller, pos) - y;
};

/** Scrolls just enough to bring the cursor into view (with some margin). */
export const revealCaret = (el, scroller) => {
  const y = caretViewportY(el, scroller);
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
  const margin = lineHeight * 2;
  if (y < margin) scroller.scrollTop += y - margin;
  else if (y + lineHeight > scroller.clientHeight - margin) scroller.scrollTop += y + lineHeight - (scroller.clientHeight - margin);
};

const caretFromPoint = (x, y) => {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
};

/**
 * Source offset in the Markdown for a click on the rendered note: the clicked
 * block's line (data-line), plus line breaks before the click, plus the
 * characters before it on that line (skipping Markdown markers like ** and _).
 */
export const sourceOffsetFromClick = (event, content) => {
  const block = event.target.closest('[data-line]');
  if (!block) return content.length;
  const startLine = Number(block.dataset.line);
  const point = caretFromPoint(event.clientX, event.clientY);
  if (!point || !block.contains(point.node)) return lineEndOffset(content, startLine);

  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(point.node, point.offset);
  let breaks = 0;
  let text = '';
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeName === 'BR') {
        breaks += 1;
        text = '';
      } else if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else {
        walk(child);
      }
    }
  };
  walk(before.cloneContents());

  const line = startLine + breaks;
  const from = lineOffset(content, line);
  const source = content.slice(from, lineEndOffset(content, line));
  let i = breaks === 0 ? blockPrefixLength(source) : source.length - source.trimStart().length;
  let matched = 0;
  while (i < source.length && matched < text.length) {
    if ('*_~`'.includes(source[i]) && source[i] !== text[matched]) {
      i += 1;
      continue;
    }
    i += 1;
    matched += 1;
  }
  return from + i;
};

/** The rendered block nearest the top of the scroller, and its line and y. */
export const firstVisibleBlock = (container, scroller) => {
  const top = scroller.getBoundingClientRect().top;
  for (const el of container.querySelectorAll('[data-line]')) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > top + 4) return { line: Number(el.dataset.line), y: Math.max(0, rect.top - top) };
  }
  return null;
};

/** The rendered block for a source line (the last block starting at or before it). */
export const blockForLine = (container, line) => {
  let best = null;
  for (const el of container.querySelectorAll('[data-line]')) {
    if (Number(el.dataset.line) <= line) best = el;
    else break;
  }
  return best;
};
