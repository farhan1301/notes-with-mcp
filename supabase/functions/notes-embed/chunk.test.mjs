// node --experimental-strip-types --test supabase/functions/notes-embed/chunk.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkNote } from './chunk.ts';

test('short note: one chunk with the title', () => {
  assert.deepEqual(chunkNote('Groceries', 'milk\n\neggs'), ['Groceries\n\nmilk\n\neggs']);
});

test('empty note: title only, or nothing', () => {
  assert.deepEqual(chunkNote('Just a title', ''), ['Just a title']);
  assert.deepEqual(chunkNote('', '  '), []);
});

test('content starting with the title is not prefixed twice', () => {
  assert.deepEqual(chunkNote('Plan', 'Plan for today'), ['Plan for today']);
});

test('long notes split under the limit, keeping every word', () => {
  const sentence = 'I keep thinking about moving into product management. ';
  const paragraph = sentence.repeat(30); // ~1,700 chars, one paragraph
  const runOn = 'word '.repeat(600); // 3,000 chars with no punctuation
  const chunks = chunkNote('Career', `${paragraph}\n\n${runOn}`);
  assert.ok(chunks.length >= 4);
  for (const c of chunks) assert.ok(c.length <= 1000 + 'Career\n\n'.length, `chunk of ${c.length}`);
  const words = (s) => s.replace(/^Career\n\n/, '').split(/\s+/).filter(Boolean).length;
  assert.equal(chunks.reduce((n, c) => n + words(c), 0), 30 * 8 + 600);
});

test('images count as their alt text', () => {
  assert.deepEqual(chunkNote('Trip', '![](https://x/a.jpg)\n\n![the lake](https://x/b.jpg) was cold'), ['Trip\n\nthe lake was cold']);
});
