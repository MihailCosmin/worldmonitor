#!/usr/bin/env node
// Pre-merge analysis for syncing this fork from upstream (koala73/worldmonitor).
//
// Computes the ACTUAL merge-base fresh (never trusts
// docs/architecture/fork-sync-manifest.yaml's last-recorded upstream SHA as
// the diff base — a stale assumption there has bitten this fork before: see
// the meta.last_sync_upstream_head comment in the manifest itself), lists the
// commits that would be pulled in, and cross-references their changed files
// against the manifest's high_risk_files and evaluated_upstream_commits so a
// human or an AI agent can tell in seconds whether a sync is routine or needs
// careful review — BEFORE running `git merge`.
//
// Usage:
//   node scripts/fork-sync-check.mjs [--remote=upstream] [--branch=main] [--no-fetch]
//
// Run `npm run fork-sync:check` for the default remote/branch.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifestPath = resolve(root, 'docs/architecture/fork-sync-manifest.yaml');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};
const remote = getArg('remote', 'upstream');
const branch = getArg('branch', 'main');
const noFetch = args.includes('--no-fetch');
const remoteRef = `${remote}/${branch}`;

function git(cmdArgs) {
  return execFileSync('git', cmdArgs, { cwd: root, encoding: 'utf8' }).trim();
}

function loadManifest() {
  return yaml.load(readFileSync(manifestPath, 'utf8'));
}

// Normalizes a changed-file path so a high_risk_files entry like
// "pro-test/prerender.mjs" matches regardless of leading "./" or trailing
// slashes some git commands emit.
function norm(p) {
  return p.replace(/^\.\//, '').replace(/\/+$/, '');
}

function collectHighRiskPaths(manifest) {
  const paths = new Set();
  for (const entry of manifest.high_risk_files ?? []) {
    if (entry.path) paths.add(norm(entry.path));
    for (const key of ['mirrors', 'also_check']) {
      for (const p of entry[key] ?? []) paths.add(norm(p));
    }
    // `also` is a single string on some entries, an array on others (e.g.
    // auth-state.ts lists two related files) — normalize to array first.
    if (entry.also) {
      const alsoList = Array.isArray(entry.also) ? entry.also : [entry.also];
      for (const p of alsoList) paths.add(norm(p));
    }
  }
  // commit_ranges[].high_risk_files is a flat array of path strings (a
  // lighter-weight per-category list, distinct from the top-level
  // high_risk_files[] array of {path, risk, ...} objects above).
  for (const range of manifest.commit_ranges ?? []) {
    for (const p of range.high_risk_files ?? []) paths.add(norm(p));
  }
  return paths;
}

function main() {
  if (!noFetch) {
    console.log(`Fetching ${remoteRef}...`);
    try {
      git(['fetch', remote, branch]);
    } catch (err) {
      console.error(`Could not fetch ${remoteRef}: ${err.message}`);
      process.exit(1);
    }
  }

  let manifest;
  try {
    manifest = loadManifest();
  } catch (err) {
    console.error(`Could not read/parse ${manifestPath}: ${err.message}`);
    process.exit(1);
  }

  const head = git(['rev-parse', 'HEAD']);
  let remoteSha;
  try {
    remoteSha = git(['rev-parse', remoteRef]);
  } catch {
    console.error(`${remoteRef} does not exist locally. Run \`git fetch ${remote} ${branch}\` first, or drop --no-fetch.`);
    process.exit(1);
  }

  const mergeBase = git(['merge-base', head, remoteRef]);
  const recordedBase = manifest.meta?.last_sync_upstream_head;
  console.log(`HEAD:                 ${head.slice(0, 9)}`);
  console.log(`${remoteRef.padEnd(21)} ${remoteSha.slice(0, 9)}`);
  console.log(`Computed merge-base:  ${mergeBase.slice(0, 9)}`);
  if (recordedBase && recordedBase !== 'PENDING' && !mergeBase.startsWith(recordedBase.replace(/^"|"$/g, ''))) {
    console.log(
      `Note: manifest's last-recorded last_sync_upstream_head (${recordedBase}) does NOT match the ` +
      `computed merge-base. This is expected if commits landed on either side since the manifest was ` +
      `last updated — trust the computed merge-base above, not the manifest's stored value.`,
    );
  }

  if (mergeBase === remoteSha) {
    console.log('\nAlready up to date with upstream. Nothing to sync.');
    return;
  }

  const commitList = git(['log', '--oneline', `${mergeBase}..${remoteRef}`])
    .split('\n')
    .filter(Boolean);
  console.log(`\n${commitList.length} commit(s) to sync:`);
  for (const line of commitList) console.log(`  ${line}`);

  const highRiskPaths = collectHighRiskPaths(manifest);
  const changedFiles = git(['diff', '--name-only', `${mergeBase}..${remoteRef}`])
    .split('\n')
    .filter(Boolean)
    .map(norm);

  const touchedHighRisk = changedFiles.filter((f) => highRiskPaths.has(f));
  console.log(`\n${changedFiles.length} file(s) changed in this range.`);

  if (touchedHighRisk.length > 0) {
    console.log(`\n⚠ ${touchedHighRisk.length} HIGH-RISK file(s) touched — read these diffs by hand before merging:`);
    for (const f of touchedHighRisk) {
      const entry = (manifest.high_risk_files ?? []).find((e) => norm(e.path ?? '') === f);
      console.log(`  - ${f}`);
      if (entry?.risk) {
        const oneLine = entry.risk.trim().split('\n')[0].slice(0, 140);
        console.log(`      ${oneLine}${entry.risk.trim().length > 140 ? '…' : ''}`);
      }
    }
  } else {
    console.log('\nNo high-risk files touched by this range (per the manifest\'s current list).');
  }

  // Cross-reference each new commit's SHA against already-evaluated commits.
  // Exact-SHA matches only (a fuzzy content match across a whole commit range
  // has too high a false-positive/negative rate to be useful here) — this
  // catches the case of the exact same commit reappearing via a rebase or a
  // re-opened PR, which does happen upstream.
  const evaluated = manifest.evaluated_upstream_commits ?? {};
  const shaSet = new Map();
  for (const entry of evaluated.keep ?? []) if (entry.sha) shaSet.set(entry.sha.replace(/^"|"$/g, ''), { verdict: 'keep', entry });
  for (const entry of evaluated.exclude ?? []) if (entry.sha) shaSet.set(entry.sha.replace(/^"|"$/g, ''), { verdict: 'exclude', entry });

  const newShas = git(['log', '--format=%H', `${mergeBase}..${remoteRef}`]).split('\n').filter(Boolean);
  const matches = [];
  for (const sha of newShas) {
    for (const [knownSha, info] of shaSet) {
      if (sha.startsWith(knownSha) || knownSha.startsWith(sha.slice(0, knownSha.length))) {
        matches.push({ sha: sha.slice(0, 9), ...info });
      }
    }
  }
  if (matches.length > 0) {
    console.log(`\n${matches.length} commit(s) match an already-evaluated SHA:`);
    for (const m of matches) {
      console.log(`  - ${m.sha} -> already decided: ${m.verdict.toUpperCase()} (${m.entry.title ?? m.entry.pattern})`);
    }
  }

  // Pattern-text heuristic: check whether any exclude pattern's distinctive
  // keywords show up in the new commits' subject lines. This is intentionally
  // shallow (substring match on commit subjects, not full diff content) —
  // it's a nudge to go look closer, not a verdict.
  const subjects = git(['log', '--format=%s', `${mergeBase}..${remoteRef}`]).split('\n').filter(Boolean);
  const patternHints = [];
  for (const entry of evaluated.exclude ?? []) {
    if (!entry.pattern) continue;
    const keywords = entry.pattern.match(/[A-Za-z][A-Za-z0-9_-]{4,}/g) ?? [];
    for (const subject of subjects) {
      if (keywords.some((k) => subject.toLowerCase().includes(k.toLowerCase()))) {
        patternHints.push({ subject, pattern: entry.pattern, reason: entry.reason });
        break;
      }
    }
  }
  if (patternHints.length > 0) {
    console.log(`\n${patternHints.length} commit subject(s) loosely resemble an already-EXCLUDED pattern (verify, don't trust blindly):`);
    for (const h of patternHints) {
      console.log(`  - "${h.subject}" ~ ${h.pattern}`);
    }
  }

  console.log(
    '\nNext: git merge ' + remoteRef + ', resolve conflicts (prioritize the high-risk files above), ' +
    'then run `npm run fork-sync:verify`.',
  );
}

main();
