#!/usr/bin/env node
// Post-merge verification for syncing this fork from upstream (koala73/worldmonitor).
//
// Runs the tests that guard against gating/branding regressions (or, with
// --full, the entire test:data suite), then classifies every failure against
// docs/architecture/fork-sync-manifest.yaml's known_pre_existing_gaps by test
// file — so "3 failures" doesn't require spinning up a git worktree and
// comparing against ORIG_HEAD by hand every single sync. That manual
// comparison is exactly what this script replaces.
//
// A file NOT listed in known_pre_existing_gaps that fails here is a real
// signal: either this sync introduced a regression, or the manifest's gap
// list is stale and needs a new entry — either way, look at it before
// declaring the sync done.
//
// Usage:
//   node scripts/fork-sync-verify.mjs           # protected_invariant_tests only (fast)
//   node scripts/fork-sync-verify.mjs --full    # full `npm run test:data` suite
//
// Run `npm run fork-sync:verify` / `npm run fork-sync:verify:full`.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifestPath = resolve(root, 'docs/architecture/fork-sync-manifest.yaml');

const full = process.argv.includes('--full');

function loadManifest() {
  return yaml.load(readFileSync(manifestPath, 'utf8'));
}

// Builds file -> [gap reasons] from known_pre_existing_gaps, which mixes
// three shapes: {test: "path", issue}, {tests: ["path", ...], issue}, and
// {cluster: "name", tests: [...], issue}.
function buildGapIndex(manifest) {
  const index = new Map();
  for (const gap of manifest.known_pre_existing_gaps ?? []) {
    const files = gap.test ? [gap.test] : (gap.tests ?? []);
    for (const f of files) {
      if (!index.has(f)) index.set(f, []);
      index.get(f).push(gap.cluster ? `[${gap.cluster}] ${gap.issue}` : gap.issue);
    }
  }
  return index;
}

function repoRelative(absPath) {
  return absPath.startsWith(root) ? absPath.slice(root.length + 1) : absPath;
}

function parseTapFailingFiles(tap) {
  const failingFiles = new Set();
  let pendingIsFailure = false;
  for (const line of tap.split('\n')) {
    if (/^\s*not ok \d+/.test(line)) {
      pendingIsFailure = true;
      continue;
    }
    if (/^\s*ok \d+/.test(line)) {
      pendingIsFailure = false;
      continue;
    }
    const m = pendingIsFailure && line.match(/location:\s*'(.+):(\d+):(\d+)'/);
    if (m) {
      failingFiles.add(repoRelative(m[1]));
      pendingIsFailure = false;
    }
  }
  return failingFiles;
}

// convex/__tests__/*.test.ts files use `import.meta.glob` (a Vitest-only
// feature — not standard ESM), so they crash outright under `node --test` /
// tsx --test. They need `vitest run --config vitest.config.mts` instead.
// Route by path convention rather than requiring a manifest schema change.
function isConvexVitestFile(f) {
  return f.startsWith('convex/');
}

// Runs `node --test` (via tsx) across the given files and returns the set of
// repo-relative file paths that had at least one failing subtest, parsed from
// each failing subtest's `location:` field in the TAP output (the same
// technique used for manual triage throughout this fork's sync history).
function runAndCollectFailingFiles(files) {
  const nodeFiles = files.filter((f) => !isConvexVitestFile(f));
  const convexFiles = files.filter(isConvexVitestFile);
  const failingFiles = new Set();
  const summaryParts = [];

  if (nodeFiles.length > 0) {
    const resultFile = resolve(tmpdir(), `fork-sync-verify-${process.pid}.tap`);
    const result = spawnSync(
      'npx',
      ['tsx', '--test', '--test-reporter=tap', '--test-reporter-destination', resultFile, ...nodeFiles],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let tap = '';
    try {
      tap = readFileSync(resultFile, 'utf8');
      unlinkSync(resultFile);
    } catch {
      // Fall back to stdout if the reporter destination didn't materialize
      // for any reason (e.g. tsx/node version mismatch) — best effort.
      tap = result.stdout ?? '';
    }
    for (const f of parseTapFailingFiles(tap)) failingFiles.add(f);
    const summaryLine = tap.split('\n').reverse().find((l) => /^# (pass|fail) \d+/.test(l));
    if (summaryLine) summaryParts.push(`node:test — ${summaryLine.replace(/^# /, '')}`);
  }

  // Vitest/convex files: run each individually so a failure can be attributed
  // to its own file (vitest's own suite-level pass/fail is enough here; the
  // manifest only needs file-level granularity, same as the node:test path).
  for (const f of convexFiles) {
    const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.config.mts', f], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) failingFiles.add(f);
  }
  if (convexFiles.length > 0) summaryParts.push(`vitest — ${convexFiles.length} file(s) checked`);

  return { failingFiles, summaryLine: summaryParts.join(' | ') };
}

function main() {
  let manifest;
  try {
    manifest = loadManifest();
  } catch (err) {
    console.error(`Could not read/parse ${manifestPath}: ${err.message}`);
    process.exit(1);
  }

  const gapIndex = buildGapIndex(manifest);

  if (full) {
    // test:data itself excludes convex/__tests__ (see its script entry in
    // package.json), so no vitest routing is needed here — plain TAP parsing
    // covers the whole run.
    console.log('Running full `npm run test:data` suite (this takes a while)...\n');
    const result = spawnSync('npm', ['run', 'test:data'], { cwd: root, encoding: 'utf8' });
    const failingFiles = parseTapFailingFiles(result.stdout ?? '');
    classify(failingFiles, gapIndex);
    return;
  }

  const testList = manifest.protected_invariant_tests ?? [];
  if (testList.length === 0) {
    console.error('protected_invariant_tests is empty in the manifest — nothing to run.');
    process.exit(1);
  }
  console.log(`Running ${testList.length} protected invariant test file(s)...\n`);
  const { failingFiles, summaryLine } = runAndCollectFailingFiles(testList);
  if (summaryLine) console.log(summaryLine + '\n');
  classify(failingFiles, gapIndex);
}

function classify(failingFiles, gapIndex) {
  if (failingFiles.size === 0) {
    console.log('✓ No failures. Clean.');
    return;
  }

  const known = [];
  const unknown = [];
  for (const f of failingFiles) {
    if (gapIndex.has(f)) known.push(f);
    else unknown.push(f);
  }

  if (known.length > 0) {
    console.log(`${known.length} failing file(s) match a documented known_pre_existing_gaps entry:`);
    for (const f of known) {
      console.log(`  ✓ ${f}`);
      for (const reason of gapIndex.get(f)) {
        console.log(`      ${reason.trim().split('\n')[0].slice(0, 160)}`);
      }
    }
  }

  if (unknown.length > 0) {
    console.log(`\n⚠ ${unknown.length} failing file(s) are NOT in known_pre_existing_gaps — investigate before declaring this sync done:`);
    for (const f of unknown) console.log(`  ✗ ${f}`);
    console.log(
      '\nFor each: confirm whether it fails on the pre-merge commit too (e.g. `git worktree add /tmp/check ' +
      '<pre-merge-sha> --detach && cd /tmp/check && npx tsx --test <file>`). If it does, add an entry to ' +
      'known_pre_existing_gaps. If it only fails after the merge, this sync introduced a regression.',
    );
    process.exit(1);
  }

  console.log('\n✓ Every failure is already documented. Safe to proceed.');
}

main();
