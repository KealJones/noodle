import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, isAutomated, priorTurns, git } from './capture.mjs';

const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }).trim();

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'cap-repo-'));
  sh(d, 'init', '-q', '-b', 'main');
  writeFileSync(join(d, 'a.txt'), 'one\n');
  sh(d, 'add', '.'); sh(d, 'commit', '-q', '-m', 'first');
  return d;
}

test('captures head, uncommitted work, untracked files, and pins them', () => {
  const d = repo();
  writeFileSync(join(d, 'a.txt'), 'two\n');
  writeFileSync(join(d, 'new.txt'), 'fresh\n');
  const root = mkdtempSync(join(tmpdir(), 'cap-root-'));
  const m = capture({ prompt: 'commit and push', cwd: d, session_id: 's1' }, { root });
  const head = sh(d, 'rev-parse', 'HEAD');
  assert.equal(m.repo.head, head);
  assert.equal(m.repo.branch, 'main');
  assert.ok(m.repo.work && m.repo.work !== head, 'dirty tree gives a work commit');
  assert.equal(sh(d, 'rev-parse', m.repo.pins.head), head);
  assert.equal(sh(d, 'show', `${m.repo.pins.work}:a.txt`), 'two');
  assert.deepEqual(m.repo.untracked.files, ['new.txt']);
  assert.ok(existsSync(join(root, 'fixtures', m.id, 'untracked.tar.gz')));
  assert.equal(sh(d, 'stash', 'list'), '', 'stash list untouched');
  assert.equal(readFileSync(join(d, 'a.txt'), 'utf8'), 'two\n', 'working tree untouched');
  const idx = readFileSync(join(root, 'capture', `${m.at.slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(idx.at(-1).dirty, true);
  assert.equal(idx.at(-1).sessionId, 's1');
  assert.equal(idx.at(-1).prompt, 'commit and push');
});

test('a clean tree has no work commit', () => {
  const d = repo();
  const m = capture({ prompt: 'status?', cwd: d }, { root: mkdtempSync(join(tmpdir(), 'cap-root-')) });
  assert.equal(m.repo.work, null);
});

test('a worktree records its parent repository', () => {
  const d = repo();
  const wt = join(mkdtempSync(join(tmpdir(), 'cap-wt-')), 'w');
  sh(d, 'worktree', 'add', '-q', '-b', 'feat', wt);
  const m = capture({ prompt: 'x', cwd: wt }, { root: mkdtempSync(join(tmpdir(), 'cap-root-')) });
  assert.equal(m.repo.isWorktree, true);
  assert.equal(m.repo.branch, 'feat');
  assert.equal(execFileSync('realpath', [m.repo.parentRepo], { encoding: 'utf8' }).trim(),
    execFileSync('realpath', [d], { encoding: 'utf8' }).trim());
});

test('outside a repository it still records the prompt', () => {
  const m = capture({ prompt: 'hi', cwd: mkdtempSync(join(tmpdir(), 'cap-nogit-')) },
    { root: mkdtempSync(join(tmpdir(), 'cap-root-')) });
  assert.equal(m.repo, null);
  assert.equal(git(tmpdir(), ['--version']) !== null, true);
});

test('automated messages are marked and not snapshotted', () => {
  assert.equal(isAutomated('<heartbeat>\n<automation_id>x</automation_id>'), true);
  assert.equal(isAutomated('[12] user: hi'), true);
  assert.equal(isAutomated('commit and push'), false);
  const d = repo();
  const m = capture({ prompt: '<heartbeat>go</heartbeat>', cwd: d }, { root: mkdtempSync(join(tmpdir(), 'cap-root-')) });
  assert.equal(m.automated, true);
  assert.equal(m.repo, null);
});

test('prior turns from Claude Code and Codex transcripts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-tr-'));
  const claude = join(dir, 'c.jsonl');
  writeFileSync(claude, [
    { type: 'user', message: { content: 'fix it' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Want me to commit and push?' },
      { type: 'tool_use', name: 'Bash', input: { command: 'git status' } }] } },
    { type: 'assistant', isSidechain: true, message: { content: 'hidden' } },
  ].map((x) => JSON.stringify(x)).join('\n'));
  assert.deepEqual(priorTurns(claude).map((t) => t.role), ['user', 'assistant', 'tool']);
  const codex = join(dir, 'x.jsonl');
  writeFileSync(codex, [
    { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: 'sys' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'merge master' }] } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'git merge master' } },
  ].map((x) => JSON.stringify(x)).join('\n'));
  assert.deepEqual(priorTurns(codex).map((t) => t.role), ['user', 'tool']);
});
