const assert = {
  equal(a: unknown, b: unknown) { if (a !== b) throw new Error(`Expected ${a} = ${b}`); },
  deepEqual(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Values differ'); },
  async rejects(promise: Promise<unknown>, match: RegExp) {
    try { await promise; } catch (err) { if (match.test(String(err))) return; throw err; }
    throw new Error('Expected request to be rejected');
  },
};
import { downloadImage } from './download.ts';

Deno.test('URL downloads reject unapproved hosts and insecure URLs before a request', async () => {
  for (const url of ['http://images.example/a', 'https://internal.example/a', 'https://images.example:444/a', 'https://user:pass@images.example/a']) {
    await assert.rejects(downloadImage(url, ['images.example'], 8), /HTTPS host/);
  }
});
Deno.test('redirects cannot leave the explicit host allowlist', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 302, headers: { location: 'https://internal.example/a' } }); };
  try {
    await assert.rejects(downloadImage('https://images.example/a', ['images.example'], 8), /HTTPS host/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
Deno.test('image downloads are bounded even without Content-Length', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array(9));
  try {
    await assert.rejects(downloadImage('https://images.example/a', ['images.example'], 8), /larger/);
  } finally { globalThis.fetch = original; }
});
Deno.test('allowed image bytes are preserved', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
  try {
    assert.deepEqual(await downloadImage('https://images.example/a', ['images.example'], 8), new Uint8Array([1, 2, 3]));
  } finally { globalThis.fetch = original; }
});
