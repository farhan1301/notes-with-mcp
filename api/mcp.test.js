// Every MCP tool must map to a notes_api action, and every argument a tool
// declares must be one the SQL reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LOCAL_TOOLS, TOOLS } = require('./mcp');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261103204955_standalone_notes.sql'), 'utf8');
const api = sql.slice(sql.lastIndexOf('create or replace function public.notes_api'), sql.length);

test('each tool is a notes_api action', () => {
  for (const tool of TOOLS.filter((t) => !LOCAL_TOOLS.has(t.name))) assert.match(api, new RegExp(`when '${tool.name}'|, '${tool.name}' then|when '[a-z_]+', '${tool.name}'`), tool.name);
});

test('each tool argument is read by notes_api', () => {
  for (const tool of TOOLS.filter((t) => !LOCAL_TOOLS.has(t.name))) {
    for (const arg of Object.keys(tool.inputSchema.properties)) {
      assert.match(api, new RegExp(`'${arg}'`), `${tool.name}.${arg}`);
    }
  }
});

test('tool names are unique and required args are declared', () => {
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
  for (const tool of TOOLS) {
    for (const r of tool.inputSchema.required || []) assert.ok(tool.inputSchema.properties[r], `${tool.name}.${r}`);
  }
});
