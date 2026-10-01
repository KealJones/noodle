#!/usr/bin/env node
// The capture hook (PLAN.md phase 1, docs/specs/testing.md 5.2).
//
// Run by Claude Code and Codex on every prompt (UserPromptSubmit). Reads the hook's JSON from stdin
// and records what the world was when the prompt was sent, so the prompt can be scored later by
// end state: the commit, the uncommitted work, pins so neither is garbage collected, the remote's
// refs, the worktree and its parent repository, the turns before, and whether a person typed it.
//
// It never blocks or changes a prompt: it prints nothing, always exits 0, and bounds every git call.
// Everything it writes stays under ~/.napkin/corpus/experiment/ (private; never committed).

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.NOODLE_CAPTURE_DIR ?? join(homedir(), '.napkin', 'corpus', 'experiment');
const MAX_UNTRACKED_BYTES = 50 * 1024 * 1024;
const PRIOR_TURNS = 8;

/** Runs git in `cwd`; returns trimmed stdout, or null on any failure. */
export function git(cwd, args, { timeout = 5000, trim = true } = {}) {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
    return trim ? out.trim() : out;
  } catch {
    return null;
  }
}

/** Messages a person did not type: scheduled heartbeats and harness blocks with no text of their own. */
export function isAutomated(prompt) {
  const t = (prompt ?? '').trimStart();
  return /^<(heartbeat|task-notification|in-app-browser-context|recommended_plugins)\b/.test(t)
    || /^\[\d+\] (user|assistant|tool)\b/.test(t)
    || /^The Codex agent has requested/.test(t);
}

/** The last turns before the prompt, from a Claude Code or Codex transcript (JSONL). */
export function priorTurns(transcriptPath, n = PRIOR_TURNS) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  const turns = [];
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    turns.push(...turnsOf(d));
  }
  return turns.slice(-n);
}

function turnsOf(d) {
  // Claude Code: { type: 'user'|'assistant', isSidechain, message: { content } }
  if ((d.type === 'user' || d.type === 'assistant') && d.message && !d.isSidechain) {
    const c = d.message.content;
    if (typeof c === 'string') return [{ role: d.type, text: c }];
    const out = [];
    for (const b of c ?? []) {
      if (b?.type === 'text' && b.text?.trim()) out.push({ role: d.type, text: b.text });
      else if (b?.type === 'tool_use') out.push({ role: 'tool', name: b.name, input: b.input });
    }
    return out;
  }
  // Codex: { type: 'response_item', payload: { type: 'message'|'custom_tool_call'|'function_call', ... } }
  if (d.type === 'response_item' && d.payload) {
    const p = d.payload;
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = (p.content ?? []).map((b) => b?.text ?? '').join('\n').trim();
      return text ? [{ role: p.role, text }] : [];
    }
    if (p.type === 'custom_tool_call' || p.type === 'function_call') {
      return [{ role: 'tool', name: p.name, input: p.input ?? p.arguments }];
    }
  }
  return [];
}

/** The repository state at cwd, with pins under refs/noodle/capture/<id>/. Null when not a repo. */
export function snapshotRepo(cwd, id, dir) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  const commonDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const gitDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const isWorktree = Boolean(commonDir && gitDir && commonDir !== gitDir);
  const head = git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']);
  const branch = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  // A commit of the index and the working tree that leaves the stash list alone; empty when clean.
  const work = head ? git(cwd, ['stash', 'create', `noodle capture ${id}`]) || null : null;
  const pins = {};
  for (const [name, sha] of [['head', head], ['work', work]]) {
    if (sha && git(cwd, ['update-ref', `refs/noodle/capture/${id}/${name}`, sha]) !== null) {
      pins[name] = `refs/noodle/capture/${id}/${name}`;
    }
  }
  const refs = refLines(git(cwd, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']));
  const remotes = refLines(git(cwd, ['remote', '-v']), true);
  const status = git(cwd, ['status', '--porcelain=v1', '--branch'], { trim: false });
  const untracked = captureUntracked(top, dir);
  return {
    top, gitDir, commonDir, isWorktree,
    parentRepo: isWorktree && commonDir ? commonDir.replace(/\/\.git$/, '') : top,
    head, branch, work, pins, refs, remotes, status, untracked,
  };
}

function refLines(out, remote = false) {
  const res = {};
  for (const l of (out ?? '').split('\n')) {
    const [k, v, kind] = l.split(/\s+/);
    if (!k || !v) continue;
    if (remote) { if (kind === '(push)') res[k] = v; } else res[k] = v;
  }
  return res;
}

/** Untracked, not ignored files: listed always, archived when small enough. */
function captureUntracked(top, dir) {
  const list = (git(top, ['ls-files', '--others', '--exclude-standard', '-z'], { trim: false }) ?? '')
    .split('\0').filter(Boolean);
  if (!list.length) return { files: [], archived: false };
  let bytes = 0;
  for (const f of list) {
    try { bytes += readFileSync(join(top, f)).length; } catch { /* vanished */ }
    if (bytes > MAX_UNTRACKED_BYTES) return { files: list, bytes, archived: false, why: 'over size cap' };
  }
  try {
    execFileSync('tar', ['-czf', join(dir, 'untracked.tar.gz'), '-C', top, '--null', '-T', '-'], {
      input: list.join('\0'), timeout: 10000, stdio: ['pipe', 'ignore', 'ignore'],
    });
    return { files: list, bytes, archived: true };
  } catch {
    return { files: list, bytes, archived: false, why: 'tar failed' };
  }
}

export function capture(input, { root = ROOT, now = new Date() } = {}) {
  const id = `cap_${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}_${randomBytes(3).toString('hex')}`;
  const dir = join(root, 'fixtures', id);
  mkdirSync(dir, { recursive: true });
  const prompt = input.prompt ?? input.user_prompt ?? input.input ?? '';
  const cwd = input.cwd ?? process.cwd();
  const automated = isAutomated(prompt);
  const assistant = input.transcript_path?.includes('/.codex/') || 'turn_id' in input ? 'codex' : 'claude-code';
  const meta = {
    id, at: now.toISOString(), assistant, sessionId: input.session_id ?? null, cwd,
    prompt, automated, transcriptPath: input.transcript_path ?? null,
    hookInput: Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'prompt')),
    repo: automated ? null : snapshotRepo(cwd, id, dir),
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  const turns = automated ? [] : priorTurns(input.transcript_path).filter(
    (t, k, all) => !(k === all.length - 1 && t.role === 'user' && t.text?.trim() === prompt.trim()));
  writeFileSync(join(dir, 'turns.jsonl'), turns.map((t) => JSON.stringify(t)).join('\n') + (turns.length ? '\n' : ''));
  appendFileSync(join(root, 'captures.jsonl'), JSON.stringify({
    id, at: meta.at, assistant, cwd, automated, head: meta.repo?.head ?? null,
    branch: meta.repo?.branch ?? null, dirty: Boolean(meta.repo?.work), prompt: prompt.slice(0, 500),
  }) + '\n');
  return meta;
}

async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    capture(JSON.parse(raw || '{}'));
  } catch (e) {
    try {
      mkdirSync(ROOT, { recursive: true });
      appendFileSync(join(ROOT, 'capture-errors.log'), `${new Date().toISOString()} ${e?.stack ?? e}\n`);
    } catch { /* never fail the prompt */ }
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
