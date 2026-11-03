import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHighlights, toggleTaskLine } from './markdown.js';
import { flattenTree, folderPath, subtreeIds } from './folders.js';

test('toggleTaskLine ticks and unticks only task lines', () => {
  const md = '# List\n- [ ] milk\n  * [x] eggs\n1. [ ] bread\nplain [ ] text';
  assert.equal(toggleTaskLine(md, 2), md.replace('- [ ] milk', '- [x] milk'));
  assert.equal(toggleTaskLine(md, 3), md.replace('* [x] eggs', '* [ ] eggs'));
  assert.equal(toggleTaskLine(md, 4), md.replace('1. [ ] bread', '1. [x] bread'));
  assert.equal(toggleTaskLine(md, 5), md);
  assert.equal(toggleTaskLine(md, 99), md);
});

test('splitHighlights marks **bold** parts', () => {
  assert.deepEqual(splitHighlights('buy **milk** now'), [
    { text: 'buy ', bold: false }, { text: 'milk', bold: true }, { text: ' now', bold: false },
  ]);
});

test('folder tree helpers', () => {
  const folders = [
    { id: 'b', parent_id: null, name: 'work' },
    { id: 'a', parent_id: null, name: 'Home' },
    { id: 'c', parent_id: 'b', name: 'Ideas' },
  ];
  assert.deepEqual(flattenTree(folders).map((r) => r.path), ['Home', 'work', 'work/Ideas']);
  assert.equal(folderPath(folders, 'c'), 'work/Ideas');
  assert.equal(folderPath(folders, null), 'Inbox');
  assert.deepEqual([...subtreeIds(folders, 'b')].sort(), ['b', 'c']);
});

test('autoTitle matches the database rule', async () => {
  const { autoTitle } = await import('./markdown.js');
  assert.equal(autoTitle('\n## Groceries\n- milk'), 'Groceries');
  assert.equal(autoTitle('- [ ] call mom'), 'call mom');
  assert.equal(autoTitle('   '), '');
  assert.equal(
    autoTitle('so I was thinking about switching careers into product management because I enjoy talking to customers'),
    'so I was thinking about switching careers into product management because I…',
  );
});

test('images: path, Markdown, titles and insertion', async () => {
  const { autoTitle, imageMarkdown, imagePath, insertBlock, withoutImages } = await import('./markdown.js');
  const md = imageMarkdown('https://abc.supabase.co/', 'note 1/x.jpg');
  assert.equal(md, '![](https://abc.supabase.co/storage/v1/object/authenticated/note-images/note%201/x.jpg)');
  assert.equal(imagePath(md.slice(4, -1)), 'note 1/x.jpg');
  assert.equal(imagePath('https://abc.supabase.co/storage/v1/object/sign/note-images/a/b.png?token=t'), 'a/b.png');
  assert.equal(imagePath('https://example.com/cat.png'), null);
  assert.equal(imageMarkdown('https://h', 'a.png', 'my [cat]'), '![my  cat](https://h/storage/v1/object/authenticated/note-images/a.png)');

  assert.equal(withoutImages('see ![a cat](https://x/y.png) here'), 'see a cat here');
  assert.equal(autoTitle(`${md}\n\nTrip to Banff`), 'Trip to Banff');

  // At the end of a line: the image gets its own paragraph, cursor after it.
  const change = insertBlock('hello', 5, 5, '![](u)');
  assert.deepEqual(change, { from: 5, to: 5, insert: '\n\n![](u)\n\n', start: 15, end: 15 });
  // In an empty note: no blank lines before it.
  assert.equal(insertBlock('', 0, 0, '![](u)').insert, '![](u)\n\n');
  // Between paragraphs: reuses the blank lines already there.
  const text = 'one\n\ntwo';
  const mid = insertBlock(text, 5, 5, '![](u)');
  const result = text.slice(0, mid.from) + mid.insert + text.slice(mid.to);
  assert.equal(result, 'one\n\n![](u)\n\ntwo');
  assert.equal(result.slice(mid.start), 'two');
});
