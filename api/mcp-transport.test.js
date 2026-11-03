// Exercise the actual HTTP transport with the official MCP client SDK.
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const handler = require('./mcp');
const nativeFetch = global.fetch;
let revoked = false;
global.fetch = async (url, options) => {
  if (String(url).startsWith('https://test.supabase.co/')) {
    const input = JSON.parse(options.body);
    if (revoked || input.p_token !== 'notes_test') return new Response(JSON.stringify({ code: '42501', message: 'denied' }), { status: 403 });
    if (input.p_action === 'list_tags') return Response.json([]);
    if (input.p_action === 'list_notes') return Response.json({ notes: [{ id: 'n1', title: 'Sample' }], total: 1 });
    return Response.json({ id: 'n1', title: 'Sample', content: 'A test note', version: 1 });
  }
  return nativeFetch(url, options);
};

function server() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    req.query = Object.fromEntries(url.searchParams);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    req.body = Buffer.concat(chunks).toString();
    res.status = (s) => { res.statusCode = s; return res; };
    res.json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
    await handler(req, res);
  });
}
test('official client can initialize, discover and call tools; revoked keys fail', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const http = server();
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${http.address().port}/api/mcp`);
  const client = new Client({ name: 'notes-release-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer notes_test' } } }));
    const list = await client.listTools();
    assert.equal(list.tools.length, 23);
    const note = await client.callTool({ name: 'get_note', arguments: { note: 'Sample' } });
    assert.equal(JSON.parse(note.content[0].text).content, 'A test note');
    revoked = true;
    await assert.rejects(client.listTools());
  } finally { revoked = false; await client.close(); await new Promise((resolve) => http.close(resolve)); }
});

test('HTTP rejects missing keys, invalid origins and malformed JSON; notifications get 202', async () => {
  const http = server();
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${http.address().port}/api/mcp`;
  try {
    const req = (body, headers = {}) => nativeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    assert.equal((await req('{}')).status, 401);
    assert.equal((await req('{}', { Origin: 'https://attacker.example', Authorization: 'Bearer notes_test' })).status, 403);
    assert.equal((await req('{', { Authorization: 'Bearer notes_test' })).status, 400);
    assert.equal((await req('[]', { Authorization: 'Bearer notes_test' })).status, 400);
    assert.equal((await req('{"jsonrpc":"2.0","method":"notifications/initialized"}', { Authorization: 'Bearer notes_test' })).status, 202);
    assert.equal((await nativeFetch(url)).status, 405);
  } finally { await new Promise((resolve) => http.close(resolve)); }
});
