#!/usr/bin/env node
// Line-level fork-divergence lock for syncing from upstream (koala73/worldmonitor).
//
// The problem this solves: `fork-sync-check.mjs` tells you which FILES are
// risky, but the failure mode that has actually bitten this fork repeatedly is
// finer-grained than a file — a merge that reports zero conflicts silently
// reinstates a line we deleted (a gating check, a founder byline) or drops a
// line we added (the isClerkAuthEnabled() branch, an "ungated" early return).
// Reviewing whole files by hand to catch that is what makes every sync slow.
//
// So: treat `git diff <merge-base>...HEAD` as the machine-readable definition of
// this fork. Every `-` line in it is something we deliberately REMOVED and that
// must never come back; every `+` line is something we deliberately ADDED and
// that must survive. After a merge, re-checking those two sets is a mechanical
// operation, not a reading exercise.
//
// Usage:
//   node scripts/fork-sync-lock.mjs snapshot [--base=<ref>] [--head=<ref>] [--out=<path>]
//   node scripts/fork-sync-lock.mjs verify   [--lock=<path>] [--against=worktree|<ref>] [--json]
//
//   snapshot  Computes the divergence from the merge-base (recomputed fresh by
//             default, never read from the manifest) and writes the lock file.
//             Run this BEFORE `git merge` so the baseline describes the fork as
//             it was, uncontaminated by the incoming commits.
//   verify    Replays the lock against the current worktree (or any ref) and
//             reports removed-lines-that-came-back and added-lines-that-vanished.
//
// Exit codes: 0 clean, 1 violations found, 2 usage/IO error.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifestPath = resolve(root, 'docs/architecture/fork-sync-manifest.yaml');
const defaultLockPath = resolve(root, 'docs/architecture/fork-divergence.lock.json');

const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith('-'));
const getArg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    ...opts,
  });
}

function loadManifest() {
  return yaml.load(readFileSync(manifestPath, 'utf8')) ?? {};
}

// ---------------------------------------------------------------------------
// Path filtering
// ---------------------------------------------------------------------------

// Paths whose diffs carry no reviewable intent: build output, lockfiles,
// content-hashed bundles, generated clients. Tracking their individual lines
// would bury the signal (they account for ~4MB of the ~6MB raw fork diff) while
// adding nothing — a regression in generated code shows up as a build/test
// failure, not as a silently-reinstated gate. Overridable via the manifest's
// `lock.ignore_globs`.
const DEFAULT_IGNORE_GLOBS = [
  'package-lock.json',
  'public/pro/assets/**',
  'public/pro/index.html',
  'public/pro/welcome.html',
  'src/generated/**',
  'docs/api/*.openapi.json',
  'docs/api/*.openapi.yaml',
  '**/*.generated.js',
  '**/*.generated.json',
  '**/*.generated.ts',
  'public/product-facts.json',
  'e2e/**/*-snapshots/**',
  // The lock cannot lock itself: every re-snapshot rewrites this file, so the
  // previous snapshot's ~100 header//entry lines read as "fork work reverted"
  // on the very next verify.
  'docs/architecture/fork-divergence.lock.json',
  // Fork-owned sync paperwork upstream has no copy of, so a merge can never
  // touch it. `added_by_fork` already asserts these exist; tracking their line
  // content adds ~1200 locked lines of pure churn — they are rewritten by hand
  // every sync, which is exactly the noise that hides a real violation.
  'docs/architecture/fork-sync-manifest.yaml',
  'remove_pro.md',
];

// Minimal glob → RegExp. Supports **, * and ? with the usual semantics; that is
// the entire surface these path patterns need, so pulling in a matcher
// dependency for it would be overkill.
function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` should also match zero directories, so consume the slash too.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${out}$`);
}

function buildIgnoreMatcher(manifest) {
  const globs = manifest.lock?.ignore_globs ?? DEFAULT_IGNORE_GLOBS;
  const regexps = globs.map(globToRegExp);
  return (path) => regexps.some((re) => re.test(path));
}

// ---------------------------------------------------------------------------
// Line significance
// ---------------------------------------------------------------------------

// A line is only worth locking if its presence/absence is actually diagnostic.
// Closing braces, bare commas and short punctuation runs appear thousands of
// times in any tree, so "did this exact line come back" is meaningless for
// them — they'd produce constant false positives in both directions.
const MIN_LINE_LENGTH = 10;

function isSignificant(line) {
  const t = line.trim();
  if (t.length < MIN_LINE_LENGTH) return false;
  // Needs at least one identifier-ish token, not just symbols/indentation.
  if (!/[A-Za-z_$][A-Za-z0-9_$]{2,}/.test(t)) return false;
  return true;
}

function normalize(line) {
  // Compare on trimmed content with runs of whitespace collapsed: reindentation
  // (a merge moving a block into a new `if`) is not a semantic change and must
  // not read as "our line vanished".
  return line.trim().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

// Reads many `<rev>:<path>` blobs in one `git cat-file --batch` pass. Doing it
// with one `git show` per file works but costs ~800 process spawns on a sync of
// this size, which is most of the script's runtime.
function batchRead(revPaths) {
  const out = new Map();
  if (revPaths.length === 0) return out;
  const stdout = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: `${revPaths.join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });

  let offset = 0;
  for (const revPath of revPaths) {
    const nl = stdout.indexOf(0x0a, offset);
    if (nl === -1) break;
    const header = stdout.toString('utf8', offset, nl);
    offset = nl + 1;
    if (/\b(missing|ambiguous)$/.test(header)) {
      out.set(revPath, null);
      continue;
    }
    const size = Number(header.split(' ')[2]);
    const body = stdout.toString('utf8', offset, offset + size);
    offset += size + 1; // trailing newline git appends after each object
    out.set(revPath, body);
  }
  return out;
}

// How many times a given normalized line occurs in a file. Counting rather than
// set-testing is what makes this usable on CSS and test files: `color:
// var(--muted);` legitimately appears 40 times in main.css, so "is it present?"
// is worthless, while "did its count go back up from 38 to 40?" is exactly the
// question — did the block we deleted come back.
function countLines(content, wanted) {
  const counts = new Map();
  if (content === null) return counts;
  for (const raw of content.split('\n')) {
    if (!isSignificant(raw)) continue;
    const n = normalize(raw);
    if (!wanted.has(n)) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return counts;
}

function parseUnifiedDiff(diffText, isIgnored) {
  const files = new Map();
  let current = null;
  let currentPath = null;

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      current = null;
      currentPath = null;
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null') {
        currentPath = p.replace(/^b\//, '');
      }
      if (currentPath && !isIgnored(currentPath)) {
        if (!files.has(currentPath)) files.set(currentPath, { added: [], removed: [] });
        current = files.get(currentPath);
      } else {
        current = null;
      }
      continue;
    }
    if (raw.startsWith('--- ')) {
      // `--- a/path` for a file deleted on our side leaves `+++ /dev/null`, so
      // the path has to be taken from the minus side in that case.
      const p = raw.slice(4).trim();
      if (p !== '/dev/null') currentPath = p.replace(/^a\//, '');
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('@@') || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) {
      const line = raw.slice(1);
      if (isSignificant(line)) current.added.push(normalize(line));
    } else if (raw.startsWith('-')) {
      const line = raw.slice(1);
      if (isSignificant(line)) current.removed.push(normalize(line));
    }
  }
  return files;
}

function snapshot() {
  const manifest = loadManifest();
  const isIgnored = buildIgnoreMatcher(manifest);
  const remote = getArg('remote', manifest.meta?.upstream_remote ?? 'upstream');
  const branch = getArg('branch', 'main');
  const head = getArg('head', 'HEAD');
  // Always recompute the merge-base rather than trusting any recorded SHA —
  // the same rule fork-sync-check.mjs follows, and for the same reason.
  const base = getArg('base', git(['merge-base', head, `${remote}/${branch}`]).trim());
  const outPath = resolve(root, getArg('out', defaultLockPath));

  const headSha = git(['rev-parse', head]).trim();
  const baseSha = git(['rev-parse', base]).trim();

  const diffText = git([
    'diff', '-U0', '--no-color', '--no-renames', '--ignore-all-space',
    `${baseSha}...${headSha}`,
  ]);
  const perFile = parseUnifiedDiff(diffText, isIgnored);

  // Whole-file adds/deletes are the strongest invariants we have: a file this
  // fork deleted outright (ExportGateControl.ts, CommunityWidget.ts) reappearing
  // means an entire gating feature came back, and a file this fork created
  // (local-auth.ts) disappearing means the merge dropped it. Both are cheap to
  // check and impossible to miss, unlike a line buried in a 400-line file.
  const statusOut = git(['diff', '--name-status', '--no-renames', `${baseSha}...${headSha}`]);
  const deletedByFork = [];
  const addedByFork = [];
  for (const line of statusOut.split('\n')) {
    if (!line.trim()) continue;
    const [status, path] = line.split('\t');
    if (!path || isIgnored(path)) continue;
    if (status === 'D') deletedByFork.push(path);
    else if (status === 'A') addedByFork.push(path);
  }

  // A file this fork deleted outright has no "ours" side to count lines
  // against, and its whole-file invariant is already covered by
  // deleted_by_fork — line-level tracking would just restate it 200 times.
  const deletedSet = new Set(deletedByFork);
  const trackedPaths = [...perFile.keys()].filter((p) => !deletedSet.has(p)).sort();

  const blobs = batchRead([
    ...trackedPaths.map((p) => `${baseSha}:${p}`),
    ...trackedPaths.map((p) => `${headSha}:${p}`),
  ]);

  const files = {};
  let addedCount = 0;
  let removedCount = 0;
  for (const path of trackedPaths) {
    const { added, removed } = perFile.get(path);
    const wanted = new Set([...added, ...removed]);
    const baseCounts = countLines(blobs.get(`${baseSha}:${path}`) ?? null, wanted);
    const headCounts = countLines(blobs.get(`${headSha}:${path}`) ?? null, wanted);

    const entry = { added: {}, removed: {} };
    for (const line of wanted) {
      const b = baseCounts.get(line) ?? 0;
      const h = headCounts.get(line) ?? 0;
      // Equal counts mean the line only moved or was reindented within the
      // file — the diff shows it as ±, but nothing about the fork's intent
      // depends on it.
      if (h < b) entry.removed[line] = [b, h];
      else if (h > b) entry.added[line] = [b, h];
    }
    const nAdded = Object.keys(entry.added).length;
    const nRemoved = Object.keys(entry.removed).length;
    if (nAdded === 0 && nRemoved === 0) continue;
    files[path] = entry;
    addedCount += nAdded;
    removedCount += nRemoved;
  }

  const lock = {
    schema: 1,
    generated_at: new Date().toISOString(),
    base: baseSha,
    head: headSha,
    stats: {
      files: Object.keys(files).length,
      added_lines: addedCount,
      removed_lines: removedCount,
      deleted_by_fork: deletedByFork.length,
      added_by_fork: addedByFork.length,
    },
    deleted_by_fork: deletedByFork.sort(),
    added_by_fork: addedByFork.sort(),
    files,
  };

  writeFileSync(outPath, serializeLock(lock));
  console.log(`Fork divergence lock written to ${outPath.replace(`${root}/`, '')}`);
  console.log(`  base (merge-base): ${baseSha.slice(0, 9)}`);
  console.log(`  head:              ${headSha.slice(0, 9)}`);
  console.log(`  ${lock.stats.files} file(s), +${addedCount} / -${removedCount} significant line(s) locked`);
  console.log(`  ${deletedByFork.length} file(s) deleted by this fork, ${addedByFork.length} added`);
  return 0;
}

// Emits one line per locked file rather than fully-indented JSON: the lock is
// committed and rewritten every sync, so `git diff` on it should read as "these
// files' divergence changed", not as thousands of reflowed array elements.
function serializeLock(lock) {
  const { files, ...head } = lock;
  const parts = [];
  parts.push(JSON.stringify(head, null, 1).replace(/\n?\}$/, ''));
  parts.push(',\n "files": {\n');
  const entries = Object.entries(files);
  parts.push(entries.map(([p, v]) => `  ${JSON.stringify(p)}: ${JSON.stringify(v)}`).join(',\n'));
  parts.push('\n }\n}\n');
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

function readAt(path, against) {
  try {
    if (against === 'worktree') {
      const abs = resolve(root, path);
      if (!existsSync(abs)) return null;
      return readFileSync(abs, 'utf8');
    }
    return git(['show', `${against}:${path}`], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function verify() {
  const lockPath = resolve(root, getArg('lock', defaultLockPath));
  const against = getArg('against', 'worktree');
  const asJson = hasFlag('json');
  if (!existsSync(lockPath)) {
    console.error(`No lock file at ${lockPath}. Run \`node scripts/fork-sync-lock.mjs snapshot\` first.`);
    return 2;
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

  const violations = {
    resurrected: [],   // a line this fork deleted is present again
    vanished: [],      // a line this fork added is gone
    revived_files: [], // a file this fork deleted exists again
    lost_files: [],    // a file this fork added is gone
  };

  for (const path of lock.deleted_by_fork ?? []) {
    if (readAt(path, against) !== null) violations.revived_files.push(path);
  }
  const lostAdded = new Set();
  for (const path of lock.added_by_fork ?? []) {
    if (readAt(path, against) === null) lostAdded.add(path);
  }
  violations.lost_files.push(...lostAdded);

  const deletedSet = new Set(lock.deleted_by_fork ?? []);
  for (const [path, entry] of Object.entries(lock.files ?? {})) {
    const content = readAt(path, against);
    if (content === null) {
      // A file we deliberately deleted is expected to be missing; anything else
      // we edited going missing means the merge removed fork-local work.
      if (!deletedSet.has(path) && !lostAdded.has(path)) violations.lost_files.push(path);
      continue;
    }
    const wanted = new Set([...Object.keys(entry.added ?? {}), ...Object.keys(entry.removed ?? {})]);
    const now = countLines(content, wanted);

    for (const [line, [baseCount, oursCount]] of Object.entries(entry.removed ?? {})) {
      const n = now.get(line) ?? 0;
      // We cut this line's occurrences from baseCount to oursCount. Any climb
      // back above oursCount means deleted content is in the tree again.
      if (n > oursCount) violations.resurrected.push({ path, line, was: oursCount, now: n, base: baseCount });
    }
    for (const [line, [baseCount, oursCount]] of Object.entries(entry.added ?? {})) {
      const n = now.get(line) ?? 0;
      if (n < oursCount) violations.vanished.push({ path, line, was: oursCount, now: n, base: baseCount });
    }
  }

  const total = violations.resurrected.length + violations.vanished.length
    + violations.revived_files.length + violations.lost_files.length;

  if (asJson) {
    console.log(JSON.stringify({ ok: total === 0, lock: { base: lock.base, head: lock.head }, violations }, null, 2));
    return total === 0 ? 0 : 1;
  }

  console.log(`Verifying fork divergence lock (${lock.stats.files} files, base ${lock.base.slice(0, 9)}) against ${against}...\n`);

  if (total === 0) {
    console.log('✓ Every line this fork removed is still absent, and every line it added is still present.');
    return 0;
  }

  if (violations.revived_files.length > 0) {
    console.log(`⚠ ${violations.revived_files.length} file(s) this fork DELETED exist again — the merge brought a removed feature back:`);
    for (const p of violations.revived_files) console.log(`  ✗ ${p}`);
    console.log('');
  }
  if (violations.lost_files.length > 0) {
    console.log(`⚠ ${violations.lost_files.length} file(s) this fork owns are MISSING — the merge dropped fork-local work:`);
    for (const p of violations.lost_files) console.log(`  ✗ ${p}`);
    console.log('');
  }
  if (violations.resurrected.length > 0) {
    console.log(`⚠ ${violations.resurrected.length} line(s) this fork REMOVED are present again (gating/branding most likely crept back):`);
    printGrouped(violations.resurrected);
  }
  if (violations.vanished.length > 0) {
    console.log(`⚠ ${violations.vanished.length} line(s) this fork ADDED are gone (a fork change was reverted by the merge):`);
    printGrouped(violations.vanished);
  }

  console.log(
    'Each entry above is either (a) a real regression to fix, or (b) an intentional consequence of adopting an\n' +
    'upstream rewrite of that region — in which case re-run `snapshot` after the merge is committed so the lock\n' +
    'describes the new intended state.',
  );
  return 1;
}

function printGrouped(items, perFileCap = 12) {
  const byFile = new Map();
  for (const it of items) {
    if (!byFile.has(it.path)) byFile.set(it.path, []);
    byFile.get(it.path).push(it);
  }
  for (const [path, entries] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${path} (${entries.length})`);
    for (const it of entries.slice(0, perFileCap)) {
      const text = it.line.length > 140 ? `${it.line.slice(0, 140)}…` : it.line;
      console.log(`      [${it.was}→${it.now}] ${text}`);
    }
    if (entries.length > perFileCap) console.log(`      … ${entries.length - perFileCap} more`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------

function usage() {
  console.error('Usage: node scripts/fork-sync-lock.mjs <snapshot|verify> [options]');
  console.error('  snapshot [--base=<ref>] [--head=<ref>] [--out=<path>] [--remote=upstream] [--branch=main]');
  console.error('  verify   [--lock=<path>] [--against=worktree|<ref>] [--json]');
  return 2;
}

let code;
if (mode === 'snapshot') code = snapshot();
else if (mode === 'verify') code = verify();
else code = usage();
process.exit(code);
