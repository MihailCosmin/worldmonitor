#!/usr/bin/env node
// End-to-end fork sync driver for upstream (koala73/worldmonitor).
//
// Every previous sync ran the same sequence by hand — fetch, read the incoming
// commits, snapshot what the fork looks like, merge, triage conflicts, hunt for
// re-added gating, run the guard tests, decide whether each failure is new.
// This runs that sequence as one command and stops at exactly the points that
// genuinely need a human: real conflicts in fork-owned files, and critical
// contamination hits.
//
// Phases:
//   1. preflight  — clean worktree, fetch upstream, refuse to run mid-merge
//   2. baseline   — snapshot the divergence lock from the FRESH merge-base
//   3. analyze    — incoming commits, high-risk files, contamination in the
//                   incoming range (all before touching the working tree)
//   4. merge      — `git merge --no-commit`, then auto-resolve every conflict
//                   whose path matches a conflict_policy rule in the manifest
//   5. audit      — divergence-lock verify + contamination scan on the result
//   6. verify     — protected_invariant_tests, classified against known gaps
//
// Usage:
//   node scripts/fork-sync-run.mjs                 # phases 1-3, then stop (read-only)
//   node scripts/fork-sync-run.mjs --merge         # also merge + auto-resolve + audit
//   node scripts/fork-sync-run.mjs --audit         # re-run phases 5-6 on the current tree
//   node scripts/fork-sync-run.mjs --merge --tests # ... and run the guard tests
//   node scripts/fork-sync-run.mjs --abort         # `git merge --abort`
//
// Nothing here ever commits. The merge is left staged so the diff can be
// reviewed, which is the one step that must stay a human decision.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifestPath = resolve(root, 'docs/architecture/fork-sync-manifest.yaml');
const baselinePath = resolve(root, '.git/fork-sync-baseline.json');

const argv = process.argv.slice(2);
const hasFlag = (n) => argv.includes(`--${n}`);
const getArg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const doMerge = hasFlag('merge');
const doAudit = hasFlag('audit');
const doTests = hasFlag('tests');
const doAbort = hasFlag('abort');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'], ...opts,
  }).trim();
}

function tryGit(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

function node(scriptArgs, { inherit = true } = {}) {
  const r = spawnSync(process.execPath, scriptArgs, {
    cwd: root, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe',
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '' };
}

function banner(n, title) {
  console.log(`\n${'─'.repeat(72)}\n${n}. ${title}\n${'─'.repeat(72)}`);
}

function loadManifest() {
  return yaml.load(readFileSync(manifestPath, 'utf8')) ?? {};
}

function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else { out += '[^/]*'; }
    } else if (c === '?') { out += '[^/]'; } else { out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&'); }
  }
  return new RegExp(`${out}$`);
}

// ---------------------------------------------------------------------------

function abort() {
  const r = tryGit(['merge', '--abort']);
  console.log(r.ok ? 'Merge aborted.' : `No merge to abort (${r.stderr || 'clean tree'}).`);
  return 0;
}

function preflight() {
  banner(1, 'Preflight');
  if (existsSync(resolve(root, '.git/MERGE_HEAD'))) {
    console.error('A merge is already in progress. Finish it, or run with --abort.');
    console.error('To audit the in-progress merge instead, run with --audit.');
    return null;
  }
  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    console.error('Working tree is not clean. Commit or stash first:\n');
    console.error(dirty.split('\n').slice(0, 20).join('\n'));
    return null;
  }

  const manifest = loadManifest();
  const remote = getArg('remote', manifest.meta?.upstream_remote ?? 'upstream');
  const branch = getArg('branch', 'main');

  if (!hasFlag('no-fetch')) {
    console.log(`Fetching ${remote}/${branch}...`);
    const r = tryGit(['fetch', remote, branch]);
    if (!r.ok) {
      console.error(`Fetch failed: ${r.stderr}`);
      return null;
    }
  }

  const head = git(['rev-parse', 'HEAD']);
  const remoteSha = git(['rev-parse', `${remote}/${branch}`]);
  const base = git(['merge-base', 'HEAD', `${remote}/${branch}`]);
  const ahead = Number(git(['rev-list', '--count', `${base}..HEAD`]));
  const behind = Number(git(['rev-list', '--count', `${base}..${remote}/${branch}`]));

  console.log(`  HEAD             ${head.slice(0, 9)}  (+${ahead} fork commit(s))`);
  console.log(`  ${remote}/${branch}  ${remoteSha.slice(0, 9)}  (${behind} commit(s) to sync)`);
  console.log(`  merge-base       ${base.slice(0, 9)}  (recomputed, not read from the manifest)`);

  if (behind === 0) {
    console.log('\nAlready up to date. Nothing to sync.');
    return null;
  }
  return { manifest, remote, branch, head, remoteSha, base, ahead, behind };
}

function baseline(ctx) {
  banner(2, 'Baseline — snapshot what this fork is, before merging');
  // Written to .git/, never to the worktree: the committed lock describes the
  // last COMMITTED state of the fork and is updated deliberately after a sync
  // lands (`npm run fork-sync:lock`). Overwriting it here would dirty the tree
  // — which preflight then refuses on the next run — and would also make the
  // lock itself a merge-conflict surface.
  const { code } = node([
    resolve(__dirname, 'fork-sync-lock.mjs'), 'snapshot',
    `--base=${ctx.base}`, `--out=${baselinePath}`,
  ]);
  return code === 0;
}

function analyze(ctx) {
  banner(3, 'Analyze — what is coming in');
  node([resolve(__dirname, 'fork-sync-check.mjs'), '--no-fetch', `--remote=${ctx.remote}`, `--branch=${ctx.branch}`]);

  console.log(`\n${'-'.repeat(72)}\nIncoming contamination (gating/branding in the upstream range itself)\n${'-'.repeat(72)}`);
  const { code } = node([resolve(__dirname, 'fork-sync-scan.mjs'), `--range=${ctx.base}..${ctx.remote}/${ctx.branch}`]);
  return code;
}

// Conflict auto-resolution -------------------------------------------------
//
// Every rule here encodes a decision an earlier sync already made by hand and
// wrote down in the manifest. `ours`/`theirs` pick a side; `regenerate` picks a
// side to get a parseable file and records the command that must be re-run
// afterwards for the real content.
function loadConflictPolicy(manifest) {
  const rules = manifest.conflict_policy ?? [];
  return rules.map((r) => ({ ...r, match: globToRegExp(r.path) }));
}

function conflictedPaths() {
  const out = git(['diff', '--name-only', '--diff-filter=U']);
  return out ? out.split('\n').filter(Boolean) : [];
}

function autoResolve(manifest) {
  const rules = loadConflictPolicy(manifest);
  const conflicts = conflictedPaths();
  if (conflicts.length === 0) {
    console.log('No conflicts.');
    return { resolved: [], manual: [], regenerate: new Set() };
  }

  const resolved = [];
  const manual = [];
  const regenerate = new Set();

  for (const path of conflicts) {
    const rule = rules.find((r) => r.match.test(path));
    if (!rule || rule.strategy === 'manual') {
      manual.push({ path, rule });
      continue;
    }
    const side = rule.strategy === 'theirs' || rule.strategy === 'regenerate-theirs' ? '--theirs' : '--ours';
    const r = tryGit(['checkout', side, '--', path]);
    if (!r.ok) {
      // A delete/modify conflict has no content on one side, so `checkout
      // --ours/--theirs` fails; fall back to the explicit add-or-remove the
      // strategy implies.
      const fallback = side === '--ours'
        ? tryGit(['rm', '-f', '--', path])
        : tryGit(['add', '--', path]);
      if (!fallback.ok) {
        manual.push({ path, rule, note: 'delete/modify conflict — resolve by hand' });
        continue;
      }
    } else {
      tryGit(['add', '--', path]);
    }
    resolved.push({ path, rule });
    if (rule.regenerate_with) regenerate.add(rule.regenerate_with);
  }

  if (resolved.length > 0) {
    console.log(`Auto-resolved ${resolved.length} conflict(s) by manifest conflict_policy:`);
    const byRule = new Map();
    for (const r of resolved) {
      const key = `${r.rule.path} → ${r.rule.strategy}`;
      byRule.set(key, (byRule.get(key) ?? 0) + 1);
    }
    for (const [key, n] of byRule) console.log(`  ${n.toString().padStart(4)}  ${key}`);
  }

  if (manual.length > 0) {
    console.log(`\n⚠ ${manual.length} conflict(s) need a human — no policy rule covers them:`);
    for (const m of manual) {
      console.log(`  ✗ ${m.path}${m.note ? `  (${m.note})` : ''}`);
      if (m.rule?.reason) console.log(`      policy says manual: ${m.rule.reason.trim().split('\n')[0]}`);
    }
  }

  if (regenerate.size > 0) {
    console.log('\nRegeneration required for the auto-resolved files above:');
    for (const cmd of regenerate) console.log(`  $ ${cmd}`);
  }

  return { resolved, manual, regenerate };
}

function merge(ctx) {
  banner(4, 'Merge');
  const r = spawnSync('git', ['merge', '--no-commit', '--no-ff', `${ctx.remote}/${ctx.branch}`], {
    cwd: root, encoding: 'utf8',
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (output) console.log(output.split('\n').slice(-8).join('\n'));
  console.log('');
  return autoResolve(ctx.manifest);
}

function audit(ctx) {
  banner(5, 'Audit — did the merge undo our work, or add new gating?');

  console.log('A. Divergence lock — lines this fork removed/added\n');
  const lockRes = node([
    resolve(__dirname, 'fork-sync-lock.mjs'), 'verify',
    `--lock=${baselinePath}`, '--against=worktree',
  ]);

  console.log(`\n${'-'.repeat(72)}\nB. Contamination — gating/branding this merge introduces\n${'-'.repeat(72)}`);
  const base = ctx?.base ?? git(['merge-base', 'HEAD', 'upstream/main']);
  const scanRes = node([resolve(__dirname, 'fork-sync-scan.mjs'), `--against=${base}`]);

  return { lockCode: lockRes.code, scanCode: scanRes.code };
}

function tests() {
  banner(6, 'Verify — protected invariant tests');
  return node([resolve(__dirname, 'fork-sync-verify.mjs')]).code;
}

// ---------------------------------------------------------------------------

function main() {
  if (doAbort) return abort();

  if (doAudit && !doMerge) {
    // Auditing an already-merged (or mid-merge) tree: the baseline from the
    // pre-merge run is the only valid reference, so require it rather than
    // silently snapshotting the contaminated tree as "what the fork is".
    if (!existsSync(baselinePath)) {
      console.error('No pre-merge baseline at .git/fork-sync-baseline.json.');
      console.error('It is written by a normal run; without it an audit would compare the merged tree to itself.');
      return 2;
    }
    const { lockCode, scanCode } = audit(null);
    const testCode = doTests ? tests() : 0;
    return summary({ lockCode, scanCode, testCode, manual: [] });
  }

  const ctx = preflight();
  if (!ctx) return 1;
  if (!baseline(ctx)) return 1;
  const incomingScan = analyze(ctx);

  if (!doMerge) {
    console.log(`\n${'═'.repeat(72)}`);
    console.log('Read-only analysis complete. Nothing in the working tree was touched.');
    console.log(`Incoming range contamination: ${incomingScan === 0 ? 'clean' : 'CRITICAL hits (listed above)'}`);
    console.log('\nRe-run with --merge to merge and auto-resolve, then --tests to run the guard suite.');
    return 0;
  }

  const { manual } = merge(ctx);
  const { lockCode, scanCode } = audit(ctx);
  const testCode = doTests ? tests() : 0;
  return summary({ lockCode, scanCode, testCode, manual });
}

function summary({ lockCode, scanCode, testCode, manual }) {
  banner('✓', 'Summary');
  const rows = [
    ['unresolved conflicts', manual.length === 0 ? 'none' : `${manual.length} need manual resolution`, manual.length === 0],
    ['divergence lock', lockCode === 0 ? 'intact' : 'VIOLATIONS — fork work undone', lockCode === 0],
    ['contamination scan', scanCode === 0 ? 'clean' : 'CRITICAL — new gating/branding merged in', scanCode === 0],
  ];
  if (doTests) rows.push(['invariant tests', testCode === 0 ? 'all documented' : 'undocumented failures', testCode === 0]);

  for (const [label, value, ok] of rows) {
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(22)} ${value}`);
  }

  const allOk = rows.every(([, , ok]) => ok);
  if (allOk) {
    console.log('\nMerge is staged and clean. Review `git diff --cached`, then commit.');
    console.log('After committing, re-run `npm run fork-sync:lock` so the lock describes the new state,');
    console.log('and update meta.last_sync_* in docs/architecture/fork-sync-manifest.yaml.');
    return 0;
  }
  console.log('\nFix the ✗ rows above before committing. `npm run fork-sync -- --abort` rolls the merge back.');
  return 1;
}

process.exit(main());
