import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const run = promisify(execFile);

test('export preserves metadata and downloads images into portable Markdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notes-export-test-'));
  const id = '11111111-1111-1111-1111-111111111111';
  const base = 'https://test.supabase.co';
  const note = { id, title: 'Test', content: `A picture ![chart](${base}/storage/v1/object/authenticated/note-images/${id}/chart.png)`, tags: ['test'], folder: 'Work' };
  const hook = `globalThis.fetch = async (url, init) => {
    if (String(url).includes('/functions/v1/notes-images')) return new Response(new Uint8Array([1,2,3]));
    const input = JSON.parse(init.body);
    if (String(url).endsWith('notes_image_links')) return Response.json({ images: [{ path: '${id}/chart.png', url: '${base}/functions/v1/notes-images?t=test' }] });
    if (input.p_action === 'list_folders') return Response.json({ folders: [{ path: 'Work' }] });
    if (input.p_action === 'list_notes') return Response.json({ notes: input.p_args.trash ? [] : [{ id: '${id}' }], total: input.p_args.trash ? 0 : 1 });
    return Response.json(${JSON.stringify(note)});
  };`;
  const hookFile = join(dir, 'mock.mjs');
  await writeFile(hookFile, hook);
  try {
    const target = join(dir, 'export');
    await run(process.execPath, ['--import', hookFile, 'scripts/export.mjs', target], {
      env: { ...process.env, VITE_SUPABASE_URL: base, VITE_SUPABASE_PUBLISHABLE_KEY: 'public', NOTES_AGENT_KEY: 'notes_test' },
    });
    assert.deepEqual(JSON.parse(await readFile(join(target, 'notes.json'), 'utf8')), [note]);
    assert.match(await readFile(join(target, 'notes', `${id}.md`), 'utf8'), new RegExp(`\\.\\./images/${id}-0.png`));
    assert.deepEqual([...await readFile(join(target, 'images', `${id}-0.png`))], [1, 2, 3]);
    assert.deepEqual(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).missing_images, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
