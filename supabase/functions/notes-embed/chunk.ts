/**
 * Splits a note into pieces small enough for gte-small (512 tokens, about
 * 2,000 characters). Paragraphs stay together up to MAX_CHARS; longer ones
 * are cut at sentence ends. Every chunk starts with the title so it keeps
 * its context.
 */
const MAX_CHARS = 1000;

const splitLong = (text: string): string[] => {
  if (text.length <= MAX_CHARS) return [text];
  const pieces: string[] = [];
  let current = '';
  for (const sentence of text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text]) {
    if (current && current.length + sentence.length > MAX_CHARS) {
      pieces.push(current.trim());
      current = '';
    }
    // A single "sentence" longer than the limit: hard cut.
    for (let i = 0; i < sentence.length; i += MAX_CHARS) {
      const part = sentence.slice(i, i + MAX_CHARS);
      if (current.length + part.length > MAX_CHARS) {
        pieces.push(current.trim());
        current = '';
      }
      current += part;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
};

export const chunkNote = (title: string, content: string): string[] => {
  const heading = title.trim();
  // Images count as their alt text: their URLs carry no meaning.
  const text = content.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).flatMap(splitLong);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > MAX_CHARS) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  if (chunks.length === 0) return heading ? [heading] : [];
  return heading ? chunks.map((c) => (c.startsWith(heading) ? c : `${heading}\n\n${c}`)) : chunks;
};
