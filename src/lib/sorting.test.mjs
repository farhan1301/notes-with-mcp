import test from 'node:test';
import assert from 'node:assert/strict';
import { dateGroup, sortNotes } from './sorting.js';

const notes = [
  { id: 'a', title: 'banana', pinned: false, updated_at: '2026-10-20T10:00:00Z', created_at: '2026-01-01T00:00:00Z' },
  { id: 'b', title: 'Apple', pinned: false, updated_at: '2026-10-25T10:00:00Z', created_at: '2026-05-01T00:00:00Z' },
  { id: 'c', title: 'cherry', pinned: true, updated_at: '2026-01-01T10:00:00Z', created_at: '2025-01-01T00:00:00Z' },
  { id: 'd', title: 'Note 10', pinned: false, updated_at: '2026-10-01T10:00:00Z', created_at: '2026-10-24T00:00:00Z' },
  { id: 'e', title: 'Note 9', pinned: false, updated_at: '2026-10-02T10:00:00Z', created_at: '2026-10-23T00:00:00Z' },
];
const ids = (list) => list.map((n) => n.id).join('');

test('sortNotes keeps pinned first and sorts by the chosen field', () => {
  assert.equal(ids(sortNotes(notes, 'updated')), 'cbaed');
  assert.equal(ids(sortNotes(notes, 'created')), 'cdeba');
  assert.equal(ids(sortNotes(notes, 'title')), 'cbaed');
});

test('dateGroup buckets like Apple Notes', () => {
  const now = new Date(2026, 9, 26, 15, 0); // 26 Oct 2026, local time
  const at = (y, m, d, h = 9) => new Date(y, m, d, h).toISOString();
  assert.equal(dateGroup(at(2026, 9, 26, 1), now), 'Today');
  assert.equal(dateGroup(at(2026, 9, 25, 23), now), 'Yesterday');
  assert.equal(dateGroup(at(2026, 9, 21), now), 'Previous 7 Days');
  assert.equal(dateGroup(at(2026, 9, 1), now), 'Previous 30 Days');
  assert.equal(dateGroup(at(2026, 2, 3), now), new Date(2026, 2, 3).toLocaleDateString([], { month: 'long' }));
  assert.equal(dateGroup(at(2024, 6, 1), now), '2024');
});
