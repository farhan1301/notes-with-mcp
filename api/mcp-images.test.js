// get_note sends a note's images along (as MCP image content) so agents can
// see them; get_note_images pages through the rest. Supabase is mocked.
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'pk';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./mcp');

const IMG = 'https://x.supabase.co/storage/v1/object/authenticated/note-images/n/';
const png = Buffer.from('fake-png');
const calls = [];

global.fetch = async (url, init = {}) => {
  calls.push(String(url));
  const reply = (body, type = 'application/json') => new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), { headers: { 'content-type': type } });
  if (url.endsWith('/rpc/notes_api')) {
    const { p_action: action } = JSON.parse(init.body);
    if (action === 'list_tags') return reply([]);
    assert.equal(action, 'get_note');
    return reply({ id: 'n1', title: 'Trip', content: `Lake ![lake](${IMG}a.png) and ![](${IMG}b.heic)`, version: 1 });
  }
  if (url.endsWith('/rpc/notes_image_links')) {
    assert.deepEqual(JSON.parse(init.body), { p_token: 'notes_k', p_note: 'n1' });
    return reply({ note_id: 'n1', images: [
      { alt: 'lake', path: 'n/a.png', url: 'https://x.supabase.co/functions/v1/notes-images?t=aaa' },
      { alt: '', path: 'n/b.heic', url: 'https://x.supabase.co/functions/v1/notes-images?t=bbb' },
    ] });
  }
  if (url.endsWith('/functions/v1/notes-images')) {
    assert.equal(init.headers['x-notes-key'], 'notes_k');
    const body = JSON.parse(init.body);
    assert.deepEqual(body, { action: 'upload', note: 'Trip', image_url: 'https://example.com/a.png', alt: 'map', after_text: 'Lake' });
    return reply({ note: { id: 'n1', version: 2 }, image: { path: 'n1/x.png', markdown: '![map](…)' } });
  }
  if (url.endsWith('t=aaa')) return reply(png, 'image/png');
  if (url.endsWith('t=bbb')) return reply(Buffer.from('heic'), 'image/heic');
  throw new Error(`unexpected fetch ${url}`);
};

const call = async (name, args) => {
  let status;
  let body;
  const res = {
    setHeader() {},
    status(s) { status = s; return this; },
    json(b) { body = b; return this; },
    end() { return this; },
  };
  await handler({ method: 'POST', headers: { authorization: 'Bearer notes_k' }, query: {}, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } }, res);
  assert.equal(status, 200);
  return body.result;
};

test('get_note includes the note\'s images', async () => {
  const result = await call('get_note', { note: 'Trip' });
  assert.equal(result.isError, undefined);
  const [note, label, image, unsupported] = result.content;
  assert.equal(JSON.parse(note.text).id, 'n1');
  assert.equal(label.text, 'Image 1 of 2 ("lake")');
  assert.deepEqual(image, { type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
  assert.match(unsupported.text, /Image 2 of 2: image\/heic format/);
});

test('get_note_images starts at offset', async () => {
  const result = await call('get_note_images', { note: 'n1', offset: 1 });
  assert.equal(result.content.length, 1);
  assert.match(result.content[0].text, /^Image 2 of 2/);
});

test('add_image uploads through the notes-images function with the agent key', async () => {
  const result = await call('add_image', { note: 'Trip', image_url: 'https://example.com/a.png', alt: 'map', after_text: 'Lake', ignored: 1 });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).image.path, 'n1/x.png');
});

test('add_image needs an image', async () => {
  const result = await call('add_image', { note: 'Trip' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /image_url or image_base64/);
});
