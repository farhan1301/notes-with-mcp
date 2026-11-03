import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration } from './setup.mjs';
const owner = '11111111-1111-1111-1111-111111111111';
test('setup uses one generated secret consistently in SQL and Edge Function env', () => {
  const c = configuration('https://example.supabase.co', owner);
  const secret = c.env.trim().split('=')[1];
  assert.match(secret, /^[a-f0-9]{64}$/);
  assert.ok(c.sql.includes(secret));
  assert.ok(c.sql.includes(owner));
});
test('setup rejects SQL injection, non-Supabase URLs and invalid owner IDs', () => {
  for (const url of ['https://localhost', 'http://x.supabase.co', "https://x.supabase.co';drop table notes;--", 'https://x.supabase.co/']) {
    assert.throws(() => configuration(url, owner));
  }
  assert.throws(() => configuration('https://x.supabase.co', "';--"));
});
