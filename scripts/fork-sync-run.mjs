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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

// Index-stage view of a conflict: 1 = merge-base, 2 = ours, 3 = theirs.
// A missing stage 2 with a present stage 1 is "we deleted it, upstream changed
// it" — the modify/delete case.
function conflictStages(path) {
  const stages = {};
  for (const line of git(['ls-files', '-u', '--', path]).split('\n')) {
    const m = line.match(/^\d+ ([0-9a-f]{40}) (\d)\t/);
    if (m) stages[m[2]] = m[1];
  }
  return stages;
}

// Modify/delete conflicts where THIS FORK is the side that deleted the file are
// the single most mechanical class in a sync: upstream kept developing a
// feature we removed, so every one resolves to "stay deleted". Deciding it from
// the baseline lock rather than a path glob means the rule keeps working when
// upstream renames the file — which it does: this sync's
// src/services/gates/export-resolver.ts is upstream's new home for the
// src/services/export-gate.ts we deleted, and git's rename detection reports
// the conflict under the NEW path. Matching on the merge-base blob SHA sees
// through that; matching on the path would not.
function resolveForkDeletions(conflicts) {
  if (!existsSync(baselinePath)) return { kept: [], remaining: conflicts };
  const lock = JSON.parse(readFileSync(baselinePath, 'utf8'));

  const deletedBlobs = new Map();
  for (const path of lock.deleted_by_fork ?? []) {
    const r = tryGit(['rev-parse', `${lock.base}:${path}`]);
    if (r.ok) deletedBlobs.set(r.stdout, path);
  }

  const kept = [];
  const remaining = [];
  for (const path of conflicts) {
    const stages = conflictStages(path);
    const forkDeleted = !stages['2'] && stages['1'] && deletedBlobs.has(stages['1']);
    if (!forkDeleted) {
      remaining.push(path);
      continue;
    }
    const r = tryGit(['rm', '-f', '--', path]);
    if (!r.ok) {
      remaining.push(path);
      continue;
    }
    const origin = deletedBlobs.get(stages['1']);
    kept.push({ path, origin: origin === path ? null : origin });
  }
  return { kept, remaining };
}

// --- json-replay ----------------------------------------------------------
//
// For structured data files (locale bundles above all), "pick a side" is always
// wrong: upstream's copy carries new keys and retranslations we want, ours
// carries the removals and rewrites that define the fork. Neither is a superset.
//
// So take upstream's file and replay the fork's key-level delta onto it: delete
// the leaves the fork deleted, re-apply the leaves it added or rewrote. The
// delta is recomputed from the merge-base every time rather than hardcoded, so
// it stays correct as the fork evolves — for src/locales/*.json it currently
// works out to 28 deletions (premium.*, components.proBanner.*,
// components.exportGate.*, components.tabCap.*, the free-tier limit strings and
// the Discord join copy), 6 rewrites and 11 additions.
//
// Where both sides changed the same leaf, the fork wins: those rewrites are
// deliberate de-gating/de-branding edits, and losing them silently is the exact
// failure this whole pipeline exists to prevent.
function leafMap(node, prefix = '', out = new Map()) {
  for (const key of Object.keys(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = node[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) leafMap(value, path, out);
    else out.set(path, value);
  }
  return out;
}

function setLeaf(root, path, value) {
  const parts = path.split('.');
  let node = root;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function deleteLeaf(root, path) {
  const parts = path.split('.');
  const chain = [root];
  let node = root;
  for (const part of parts.slice(0, -1)) {
    node = node?.[part];
    if (!node || typeof node !== 'object') return;
    chain.push(node);
  }
  delete node[parts.at(-1)];
  // Drop parents the deletion just emptied, so no `"proBanner": {}` husk is
  // left behind for a future merge to refill.
  for (let i = chain.length - 1; i > 0; i -= 1) {
    if (Object.keys(chain[i]).length > 0) break;
    delete chain[i - 1][parts[i - 1]];
  }
}

function jsonReplay(path) {
  const read = (stage) => {
    const r = tryGit(['show', `:${stage}:${path}`]);
    return r.ok ? r.stdout : null;
  };
  const [baseText, oursText, theirsText] = [read(1), read(2), read(3)];
  if (!baseText || !oursText || !theirsText) return { ok: false, note: 'missing a conflict stage' };

  let base;
  let ours;
  let theirs;
  try {
    [base, ours, theirs] = [JSON.parse(baseText), JSON.parse(oursText), JSON.parse(theirsText)];
  } catch (err) {
    return { ok: false, note: `not parseable JSON (${err.message})` };
  }

  const baseLeaves = leafMap(base);
  const ourLeaves = leafMap(ours);
  const removed = [...baseLeaves.keys()].filter((k) => !ourLeaves.has(k));
  const rewritten = [...ourLeaves].filter(([k, v]) => baseLeaves.has(k)
    && JSON.stringify(baseLeaves.get(k)) !== JSON.stringify(v));
  const introduced = [...ourLeaves].filter(([k]) => !baseLeaves.has(k));

  for (const key of removed) deleteLeaf(theirs, key);
  for (const [key, value] of [...rewritten, ...introduced]) setLeaf(theirs, key, value);

  const indent = /^\{\n(\s+)"/.exec(theirsText)?.[1].length ?? 2;
  const trailingNewline = theirsText.endsWith('\n') ? '\n' : '';
  writeFileSync(resolve(root, path), JSON.stringify(theirs, null, indent) + trailingNewline);
  return { ok: true, removed: removed.length, rewritten: rewritten.length, introduced: introduced.length };
}

// A locale upstream introduces that has never existed here is not a conflict at
// all — uk.json merged perfectly cleanly in the bc99aad53..ab798e628 sync,
// carrying the complete premium/proBanner/tabCap/upsell set with it. There is
// no base or ours side to replay a delta from, so json-replay cannot see it.
//
// Resolve it from its siblings instead: the leaves the fork strips from the 26
// locales it HAS diverged on are the same leaves that must not exist in a 27th.
// Runs over every file matching a json-replay glob, conflicted or not.
function normalizeNewSiblings(rules, resolvedPaths) {
  const jsonRules = rules.filter((r) => r.strategy === 'json-replay');
  if (jsonRules.length === 0) return [];

  const tracked = git(['ls-files']).split('\n').filter(Boolean);
  const normalized = [];

  for (const rule of jsonRules) {
    const siblings = tracked.filter((p) => rule.match.test(p));
    if (siblings.length === 0) continue;

    // Union of what the fork removes across every sibling with both sides.
    const stripKeys = new Set();
    for (const path of siblings) {
      const baseText = tryGit(['show', `${git(['merge-base', 'HEAD', 'MERGE_HEAD'])}:${path}`]);
      const oursText = tryGit(['show', `HEAD:${path}`]);
      if (!baseText.ok || !oursText.ok) continue;
      try {
        const baseLeaves = leafMap(JSON.parse(baseText.stdout));
        const ourLeaves = leafMap(JSON.parse(oursText.stdout));
        for (const k of baseLeaves.keys()) if (!ourLeaves.has(k)) stripKeys.add(k);
      } catch { /* unparseable sibling contributes nothing */ }
    }
    if (stripKeys.size === 0) continue;

    for (const path of siblings) {
      if (resolvedPaths.has(path)) continue; // json-replay already handled it
      const abs = resolve(root, path);
      if (!existsSync(abs)) continue;
      const text = readFileSync(abs, 'utf8');
      let doc;
      try { doc = JSON.parse(text); } catch { continue; }
      const present = leafMap(doc);
      const hits = [...stripKeys].filter((k) => present.has(k));
      if (hits.length === 0) continue;
      for (const k of hits) deleteLeaf(doc, k);
      const indent = /^\{\n(\s+)"/.exec(text)?.[1].length ?? 2;
      writeFileSync(abs, JSON.stringify(doc, null, indent) + (text.endsWith('\n') ? '\n' : ''));
      tryGit(['add', '--', path]);
      normalized.push({ path, stripped: hits.length });
    }
  }
  return normalized;
}

function autoResolve(manifest) {
  const rules = loadConflictPolicy(manifest);
  const allConflicts = conflictedPaths();
  if (allConflicts.length === 0) {
    console.log('No conflicts.');
    return { resolved: [], manual: [], regenerate: new Set() };
  }

  const { kept, remaining: conflicts } = resolveForkDeletions(allConflicts);
  if (kept.length > 0) {
    console.log(`Kept ${kept.length} fork deletion(s) — upstream kept developing features this fork removed:`);
    for (const k of kept) {
      console.log(`  ${k.path}${k.origin ? `   (upstream renamed it from ${k.origin})` : ''}`);
    }
    console.log('');
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
    if (rule.strategy === 'json-replay') {
      const res = jsonReplay(path);
      if (!res.ok) {
        manual.push({ path, rule, note: `json-replay failed: ${res.note}` });
        continue;
      }
      tryGit(['add', '--', path]);
      resolved.push({ path, rule, detail: res });
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
      if (!byRule.has(key)) byRule.set(key, { n: 0, removed: 0, rewritten: 0, introduced: 0 });
      const agg = byRule.get(key);
      agg.n += 1;
      if (r.detail) {
        agg.removed += r.detail.removed;
        agg.rewritten += r.detail.rewritten;
        agg.introduced += r.detail.introduced;
      }
    }
    for (const [key, agg] of byRule) {
      const delta = agg.removed || agg.rewritten || agg.introduced
        ? `   (replayed -${agg.removed} / ~${agg.rewritten} / +${agg.introduced} keys)`
        : '';
      console.log(`  ${agg.n.toString().padStart(4)}  ${key}${delta}`);
    }
  }

  const normalized = normalizeNewSiblings(rules, new Set(resolved.map((r) => r.path)));
  if (normalized.length > 0) {
    console.log(`\nNormalized ${normalized.length} non-conflicted file(s) that merged cleanly carrying stripped keys:`);
    for (const n of normalized) console.log(`  ${n.path}  (-${n.stripped} keys)`);
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

// Cheapest possible check, and the one with the worst failure mode if skipped:
// a single-line JSON file (docs/api/*Service.openapi.json) conflicts as one
// enormous hunk, so a resolution that misses it leaves `<<<<<<< HEAD` as line 1
// of a file nothing type-checks and no test parses. It shipped staged once
// before this guard existed.
function conflictMarkerSweep() {
  const r = tryGit(['grep', '-l', '-e', '^<<<<<<< HEAD', '-e', '^>>>>>>> ', '--', '.']);
  const files = r.stdout ? r.stdout.split('\n').filter(Boolean) : [];
  if (files.length === 0) {
    console.log('✓ No conflict markers anywhere in the tree.');
    return 0;
  }
  console.log(`⚠ ${files.length} file(s) still contain conflict markers:`);
  for (const f of files) console.log(`  ✗ ${f}`);
  return 1;
}

function audit(ctx) {
  banner(5, 'Audit — did the merge undo our work, or add new gating?');

  console.log('A. Conflict markers\n');
  const markerCode = conflictMarkerSweep();

  console.log(`\n${'-'.repeat(72)}\nB. Divergence lock — lines this fork removed/added\n${'-'.repeat(72)}`);
  const lockRes = node([
    resolve(__dirname, 'fork-sync-lock.mjs'), 'verify',
    `--lock=${baselinePath}`, '--against=worktree',
  ]);

  console.log(`\n${'-'.repeat(72)}\nC. Contamination — gating/branding this merge introduces\n${'-'.repeat(72)}`);
  // Diff against PRE-MERGE HEAD, not the merge-base. Scanning from the
  // merge-base re-reports the fork's own commits — its guard tests quote every
  // banned string as a regex, its docs describe the removals — which buries the
  // handful of lines the merge actually added under ~80k lines of our own work.
  const preMerge = tryGit(['rev-parse', '--verify', 'ORIG_HEAD']).stdout
    || ctx?.base || git(['merge-base', 'HEAD', 'upstream/main']);
  const scanRes = node([resolve(__dirname, 'fork-sync-scan.mjs'), `--against=${preMerge}`]);

  return { markerCode, lockCode: lockRes.code, scanCode: scanRes.code };
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
    const { markerCode, lockCode, scanCode } = audit(null);
    const testCode = doTests ? tests() : 0;
    return summary({ markerCode, lockCode, scanCode, testCode, manual: [] });
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
  const { markerCode, lockCode, scanCode } = audit(ctx);
  const testCode = doTests ? tests() : 0;
  return summary({ markerCode, lockCode, scanCode, testCode, manual });
}

function summary({ markerCode, lockCode, scanCode, testCode, manual }) {
  banner('✓', 'Summary');
  const rows = [
    ['unresolved conflicts', manual.length === 0 ? 'none' : `${manual.length} need manual resolution`, manual.length === 0],
    ['conflict markers', markerCode === 0 ? 'none in tree' : 'MARKERS LEFT IN FILES', markerCode === 0],
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
