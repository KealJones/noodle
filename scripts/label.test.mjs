import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captures, unlabelled, namesCommand, parseAct, parseConstraint, goldLine } from './label.mjs';

test('captures come from the monthly index and the older file, typed prompts only, once each', () => {
  const root = mkdtempSync(join(tmpdir(), 'label-'));
  mkdirSync(join(root, 'capture'));
  writeFileSync(join(root, 'captures.jsonl'), [
    { id: 'a', at: '2026-10-01T01:00:00Z', prompt: 'old' },
    { id: 'h', at: '2026-10-01T02:00:00Z', prompt: '<heartbeat>', automated: true },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  writeFileSync(join(root, 'capture', '2026-10.jsonl'), [
    { id: 'b', at: '2026-10-03T00:00:00Z', prompt: 'new' },
    { id: 'a', at: '2026-10-01T01:00:00Z', prompt: 'old' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\nnot json\n');
  const caps = captures(root);
  assert.deepEqual(caps.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(unlabelled(caps, [{ id: 'a' }]).map((c) => c.id), ['b']);
});

test('names the command by the frozen list, inflections included, not by substrings', () => {
  assert.equal(namesCommand('commit and push'), true);
  assert.equal(namesCommand('I committed it, now ship it'), true);
  assert.equal(namesCommand('open a pull request'), true);
  assert.equal(namesCommand('send my work up to the server'), false);
  assert.equal(namesCommand('the pushover setting'), false);
});

test('acts and constraints parse into the gold format', () => {
  assert.deepEqual(parseAct('git push remote=origin branch=feat/x'), { program: 'git', sub: 'push', remote: 'origin', branch: 'feat/x', flags: [] });
  assert.deepEqual(parseAct('git commit files=a.ts,b.ts message=names-changed-areas'), {
    program: 'git', sub: 'commit', files: ['a.ts', 'b.ts'], message: { constraints: ['names-changed-areas'] }, flags: [] });
  assert.deepEqual(parseAct('read files=src/a.ts'), { sub: 'read', files: ['src/a.ts'] });
  assert.throws(() => parseAct('git pr view now'));
  assert.deepEqual(parseConstraint('not git push until told'), { rule: 'not', act: { program: 'git', sub: 'push' }, until: 'told' });
  const g = goldLine({ id: 'cap_1', prompt: "don't push yet" }, { cls: 'constraint', constraints: [parseConstraint('not git push')] }, '2026-10-02T00:00:00Z');
  assert.equal(g.fixture, 'cap_1');
  assert.equal(g.namesCommand, true);
  assert.equal(g.class, 'constraint');
  assert.deepEqual(g.acts, []);
  assert.equal(g.labeller, 'keal');
});
