/**
 * Sample data for demo mode. Everything here is made up: no real people,
 * places or personal details. Dates are relative to `now`, so the list's
 * "Today" / "Previous 7 days" groups always look lived-in.
 *
 * If the app starts reading a new table or column, add it here and to
 * src/demo/client.js.
 */
import { DEMO_PROJECT_URL } from './mode';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const image = (noteId, file, alt = '') =>
  `![${alt}](${DEMO_PROJECT_URL}/storage/v1/object/authenticated/note-images/${noteId}/${file})`;

export const seed = (now = Date.now()) => {
  const at = (ago) => new Date(now - ago).toISOString();
  const id = () => crypto.randomUUID();

  const folders = {};
  const folderRows = [];
  const folder = (key, name, parentKey = null) => {
    folders[key] = id();
    folderRows.push({ id: folders[key], parent_id: parentKey ? folders[parentKey] : null, name, created_at: at(90 * DAY), updated_at: at(90 * DAY) });
  };
  folder('work', 'Work');
  folder('lighthouse', 'Lighthouse app', 'work');
  folder('personal', 'Personal');
  folder('recipes', 'Recipes');
  folder('travel', 'Travel');
  folder('reading', 'Reading');

  const ids = {
    launch: id(), review: id(), decisions: id(), oneOnOne: id(), walk: id(), research: id(), weekly: id(),
    gifts: id(), pasta: id(), sourdough: id(), coast: id(), book: id(), articles: id(), oldList: id(), abstract: id(),
  };

  const note = (key, f, ago, content, extra = {}) => ({
    id: ids[key],
    folder_id: f ? folders[f] : null,
    title: '',
    content,
    tags: [],
    pinned: false,
    version: 1,
    last_edited_by: 'you',
    created_at: at(ago + (extra.age ?? 3 * DAY)),
    updated_at: at(ago),
    deleted_at: null,
    ...extra,
  });

  const notes = [
    note('weekly', 'personal', 25 * MINUTE, `# This week

- [x] Renew library card
- [x] Book the bike service
- [ ] Call the plumber about the kitchen tap
- [ ] Pick up photo prints
- [ ] Plan Saturday picnic

**Focus:** finish the Lighthouse launch checklist before Thursday.`, { pinned: true, tags: ['planning'], version: 9, age: 6 * DAY }),

    note('launch', 'lighthouse', 2 * HOUR, `# Lighthouse — launch plan

Target: **public beta in two weeks**. Owner: me. Status: on track.

## Checklist

- [x] Freeze the onboarding copy
- [x] Offline mode tested on three phones
- [ ] Write the release notes
- [ ] Record the 60-second walkthrough
- [ ] Send the beta invite email

## Risks

| Risk | Likelihood | Plan |
| --- | --- | --- |
| Sync conflicts on slow networks | Medium | Show a clear "keep mine / use theirs" choice |
| Sign-up spike on day one | Low | Waitlist with batches of 200 |
| Unclear empty states | Medium | Review in Thursday's design session |

> Agent note: added the risk table from the design review notes.`, { pinned: true, tags: ['launch', 'lighthouse'], version: 7, last_edited_by: 'agent: Claude Code', age: 12 * DAY }),

    note('walk', null, 5 * HOUR, `Ideas from today's walk

what if the weekly review was a single screen with three questions what went well what got stuck what's next and the app just saves it as a note every Sunday evening
also try the dark green for the icon`, { version: 2, age: 5 * HOUR }),

    note('research', null, 26 * HOUR, `# Research: quiet dishwashers

Summary of the comparison I asked for. Prices are rough ranges.

| Model type | Noise | Price range | Notes |
| --- | --- | --- | --- |
| Compact countertop | 49–52 dB | $$ | No plumbing, small loads |
| Standard 24" built-in | 42–46 dB | $$$ | Third rack on most |
| Drawer style | 44–48 dB | $$$$ | Two independent drawers |

**Recommendation:** a standard built-in under 45 dB. Check the depth against the 23.5" cabinet opening.`, { tags: ['home'], last_edited_by: 'agent: ChatGPT', age: 0 }),

    note('review', 'lighthouse', 2 * DAY, `# Design review — Thursday

Whiteboard from the session:

${image(ids.review, 'wireframe.svg', 'Whiteboard sketch of the Today screen')}

- The Today screen feels busy; drop the second chart.
- Swipe-to-save tested well. Keep it.
- Need an empty state and an offline banner.
- Next review: after the beta build is out.`, { tags: ['lighthouse', 'design'], version: 3, age: 2 * HOUR }),

    note('decisions', 'work', 1 * DAY + 3 * HOUR, `# Decisions log

- **Sync:** last-write-wins is out; we show conflicts to the user.
- **Pricing page:** wait until after the beta.
- **Analytics:** count screens, never note contents.
- **Beta size:** 1,000 invites in five batches. _(added by Codex from the planning thread)_`, { tags: ['decisions'], version: 5, last_edited_by: 'agent: Codex', age: 30 * DAY }),

    note('oneOnOne', 'work', 4 * DAY, `# 1:1 talking points

1. Beta timeline and what could slip
2. Hiring a second designer — budget?
3. Conference talk: yes or no
4. Time off in the spring`, { age: 2 * DAY }),

    note('gifts', 'personal', 12 * DAY, `# Gift ideas

- Pottery class voucher
- A good chef's knife
- Board game for the cabin weekend
- Framed print from the coast trip`, { tags: ['ideas'] }),

    note('pasta', 'recipes', 6 * DAY, `# Weeknight lemon pasta

Serves 2 · 20 minutes

- 200 g spaghetti
- 1 lemon (zest and juice)
- 2 cloves garlic, sliced
- 40 g parmesan, grated
- Handful of basil
- Olive oil, salt, black pepper

1. Cook the pasta; keep a cup of the water.
2. Warm the garlic gently in oil.
3. Toss everything with a splash of pasta water until glossy.`, { tags: ['dinner', 'quick'], age: 40 * DAY }),

    note('sourdough', 'recipes', 20 * DAY, `# Sourdough schedule

| Time | Step |
| --- | --- |
| 9:00 | Feed starter |
| 13:00 | Mix dough, rest 1 h |
| 14:00 | Stretch and fold ×4, every 30 min |
| 16:00 | Bulk ferment until puffy |
| 20:00 | Shape, into the fridge |
| Next day 8:00 | Bake 250 °C, 20 min lid on, 25 min off |`, { tags: ['baking'] }),

    note('coast', 'travel', 9 * DAY, `# Coast trip — Marlow Bay

${image(ids.coast, 'coast.svg', 'Sunset over the bay')}

## Packing

- [x] Rain jackets
- [x] Camera + spare battery
- [ ] Beach towels
- [ ] Snacks for the drive

## Ideas

- Sunrise walk to the lighthouse
- Fish shack on the harbour road
- Tide pools at low tide (check the times)`, { tags: ['trip'], version: 4, age: 20 * DAY }),

    note('book', 'reading', 35 * DAY, `# Notes on *The Quiet Workshop*

A (fictional) book about doing careful work in small teams.

- "Finish fewer things, but finish them."
- Keep a **decisions log**; it ends most repeated arguments.
- Protect two quiet mornings a week.

Rating: 4/5`, { tags: ['books'] }),

    note('articles', 'reading', 3 * DAY, `# Articles to read

- [ ] Designing for offline-first apps
- [ ] A field guide to writing release notes
- [x] Why small teams ship faster`, { tags: ['reading-list'] }),

    note('oldList', null, 3 * DAY, `Old grocery list

- oat milk
- eggs
- bread`, { deleted_at: at(2 * DAY) }),

    note('abstract', 'work', 8 * DAY, `# Draft — conference talk abstract

Building notes that agents can share: what we learned shipping offline sync.`, { deleted_at: at(5 * DAY) }),
  ];

  // Earlier versions (newest last), as the database keeps them before each editing session.
  const versions = [
    { note_id: ids.launch, version: 4, title: 'Lighthouse — launch plan', edited_by: 'you', edited_at: at(3 * DAY), content: `# Lighthouse — launch plan

Target: **public beta in two weeks**.

## Checklist

- [x] Freeze the onboarding copy
- [ ] Offline mode tested on three phones
- [ ] Write the release notes` },
    { note_id: ids.launch, version: 6, title: 'Lighthouse — launch plan', edited_by: 'you', edited_at: at(20 * HOUR), content: `# Lighthouse — launch plan

Target: **public beta in two weeks**. Owner: me. Status: on track.

## Checklist

- [x] Freeze the onboarding copy
- [x] Offline mode tested on three phones
- [ ] Write the release notes
- [ ] Record the 60-second walkthrough
- [ ] Send the beta invite email` },
    { note_id: ids.coast, version: 3, title: 'Coast trip — Marlow Bay', edited_by: 'you', edited_at: at(10 * DAY), content: `# Coast trip — Marlow Bay

## Packing

- [ ] Rain jackets
- [ ] Camera + spare battery` },
    { note_id: ids.walk, version: 1, title: "Ideas from today's walk", edited_by: 'you', edited_at: at(5 * HOUR + 10 * MINUTE), content: `Ideas from today's walk

what if the weekly review was a single screen` },
  ];

  const keys = [
    { id: 3, label: 'Claude Code', token_prefix: 'notes_8c41d2', access: 'edit', created_at: at(21 * DAY), last_used_at: at(2 * HOUR), revoked_at: null },
    { id: 2, label: 'Codex', token_prefix: 'notes_51ae07', access: 'inbox', created_at: at(30 * DAY), last_used_at: at(27 * HOUR), revoked_at: null },
    { id: 1, label: 'ChatGPT', token_prefix: 'notes_f0b39e', access: 'inbox', created_at: at(45 * DAY), last_used_at: at(26 * HOUR), revoked_at: null },
    { id: 4, label: 'Old laptop', token_prefix: 'notes_2d77c0', access: 'read', created_at: at(80 * DAY), last_used_at: at(60 * DAY), revoked_at: at(50 * DAY) },
  ];

  const actions = [
    { key_label: 'Claude Code', action: 'edit_note', note_id: ids.launch, ago: 2 * HOUR, summary: 'Edited "Lighthouse — launch plan"' },
    { key_label: 'Claude Code', action: 'search_notes', note_id: null, ago: 2 * HOUR + 3 * MINUTE, summary: 'Searched for "design review risks"' },
    { key_label: 'Codex', action: 'append_to_note', note_id: ids.decisions, ago: 27 * HOUR, summary: 'Added to "Decisions log"' },
    { key_label: 'ChatGPT', action: 'create_note', note_id: ids.research, ago: 26 * HOUR, summary: 'Created "Research: quiet dishwashers" in Inbox' },
    { key_label: 'Claude Code', action: 'move_note', note_id: ids.review, ago: 2 * DAY, summary: 'Moved "Design review — Thursday" to Work/Lighthouse app' },
    { key_label: 'Claude Code', action: 'update_note', note_id: ids.review, ago: 2 * DAY + MINUTE, summary: 'Updated "Design review — Thursday"' },
  ].map((a, i, all) => ({ id: all.length - i, key_label: a.key_label, action: a.action, summary: a.summary, note_id: a.note_id, created_at: at(a.ago) }));

  // An image removed from a note a few days ago sits in the image Trash.
  const images = [
    { path: `${ids.review}/wireframe.svg`, note_id: ids.review, trashed_at: null, delete_after: null },
    { path: `${ids.coast}/coast.svg`, note_id: ids.coast, trashed_at: null, delete_after: null },
    { path: `${ids.coast}/coast-old.svg`, note_id: ids.coast, trashed_at: at(4 * DAY), delete_after: at(-26 * DAY) },
  ];

  return { folders: folderRows, notes, versions, keys, actions, images };
};
