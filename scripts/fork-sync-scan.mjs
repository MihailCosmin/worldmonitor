#!/usr/bin/env node
// Contamination scan for fork syncs against upstream (koala73/worldmonitor).
//
// The divergence lock (scripts/fork-sync-lock.mjs) answers "did the merge undo
// something we did?" — it is anchored to lines that already existed at the
// merge-base. This script answers the complementary question the lock
// structurally cannot: "did the merge bring in gating/branding that is NEW,
// that we have never seen and therefore never removed?" Upstream keeps
// developing its monetization layer, so most of what needs catching on any
// given sync is brand-new code, not a revert.
//
// It works on ADDED lines only (a pattern that was already in the tree before
// the merge is not this sync's problem — it's either allowlisted or existing
// debt), which keeps the output proportional to what actually changed.
//
// Usage:
//   node scripts/fork-sync-scan.mjs [--range=<base>..<head>] [--against=<ref>] [--json] [--all]
//
//   --range=A..B  Scan lines added between two refs (uses A...B merge-base
//                 semantics when both are branch tips).
//   --against=REF Scan lines the working tree adds relative to REF
//                 (default: ORIG_HEAD if it exists, else upstream merge-base).
//   --all         Report `info`-severity patterns too, not just warn/critical.
//
// Exit codes: 0 no critical hits, 1 critical hits found, 2 usage/IO error.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifestPath = resolve(root, 'docs/architecture/fork-sync-manifest.yaml');

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

function git(args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
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

// Fallback patterns, used when the manifest has no `contamination_patterns`
// section. Keeping a copy here means a fresh checkout with a truncated manifest
// still gets a real scan rather than silently passing everything.
const BUILTIN_PATTERNS = [
  {
    id: 'panel-gating',
    severity: 'critical',
    regex: 'showLocked\\s*\\(|panel-locked-|panel-pro-badge|panel-is-locked|\\bWEB_PREMIUM_PANELS\\b|\\bupdatePanelGating\\b|\\bgetGateAction\\b|\\bgetProPanelKeys\\b|\\bPanelGateReason\\b|\\bresolveBillingAwareGateReason\\b',
    reason: 'D13 panel-gate machinery this fork deleted (tests/remove-pro-cleanup.test.mjs bans these identifiers).',
  },
  {
    id: 'export-gate',
    severity: 'critical',
    regex: '\\bExportGateControl\\b|services/export-gate|\\bcanExportStructuredData\\b|\\bcanExportEvidenceBundle\\b|export-locked-state',
    reason: 'Upstream export paywall — excluded wholesale on this fork.',
  },
  {
    id: 'tab-cap',
    severity: 'critical',
    regex: 'tab-cap-notice|\\bTAB_CAP\\b|\\btabCapReached\\b|\\bmaxDashboardTabs\\b',
    reason: 'Upstream dashboard-tab-count paywall.',
  },
  {
    id: 'pro-banner',
    severity: 'critical',
    regex: '\\bProBanner\\b|pro-banner-policy|components\\.proBanner|\\bshouldShowProBanner\\b',
    reason: 'Pure upsell surface, deleted outright by this fork.',
  },
  {
    id: 'premium-loaders',
    severity: 'critical',
    regex: '\\bfirePremiumLoaders\\b|\\bclearGlobalTenders\\b',
    reason: 'Entitlement-transition fan-out this fork removed; tests/premium-loaders-fan-out-coverage.test.mts asserts it must not exist.',
  },
  {
    id: 'ungated-endpoint-regating',
    severity: 'critical',
    regex: "'/api/market/v1/(analyze-stock|backtest-stock|get-stock-analysis-history|list-stored-stock-backtests)'|'/api/intelligence/v1/(get-country-intel-brief|deduct-situation)'|'/api/scenario/v1/(run-scenario|get-scenario-status)'",
    reason: 'Endpoints this fork made free. A new occurrence is only OK outside PREMIUM_RPC_PATHS / ENDPOINT_ENTITLEMENTS — check which registry it landed in.',
    allow_paths: ['tests/**', 'docs/**', 'src/services/**', 'src/app/**'],
  },
  {
    id: 'upsell-copy',
    severity: 'critical',
    regex: 'Upgrade to Pro\\b|Upgrade to PRO\\b|Sign In to Unlock|Pro is launched|premium analytics|Unlock with Pro',
    reason: 'Upsell copy removed from every locale bundle and component.',
  },
  {
    id: 'founder-branding',
    severity: 'critical',
    regex: 'eliehabib|Elie\\s+Habib|elie-habib',
    reason: 'Personal attribution to the original founder, removed from all branding surfaces (LICENSE copyright lines are the deliberate exception).',
    allow_paths: ['LICENSE', 'cli/LICENSE', 'sdk/**/LICENSE', 'docs/audits/**', 'docs/plans/**', 'remove_pro.md', 'docs/architecture/fork-sync-manifest.yaml', 'docs/architecture/fork-divergence.lock.json'],
  },
  {
    id: 'discord-marketing',
    severity: 'critical',
    regex: 'discord\\.gg/|Join the Discord|CommunityWidget',
    reason: 'Discord MARKETING links only. The functional Discord notification channel (OAuth connect, webhook delivery) is deliberately kept — a match inside notification-channel code is a false positive.',
    allow_paths: ['convex/notificationChannels.ts', 'server/**/notification*', 'src/services/notification*'],
  },
  {
    id: 'new-premium-gate',
    severity: 'warn',
    regex: '\\brequirePremiumRpcAccess\\b|\\bassertProEntitlement\\b|\\bhasPremiumAccess\\b|pro_required|PRO_REQUIRED',
    reason: 'Legitimate in the genuinely-paid surfaces on docs/architecture/paid-capability-allowlist.md (API/MCP access, scheduled digests, widget builder). Anywhere else it is new gating — check the call site.',
  },
  {
    id: 'premium-registry-growth',
    severity: 'warn',
    regex: '\\bPREMIUM_RPC_PATHS\\b|\\bENDPOINT_ENTITLEMENTS\\b',
    reason: 'A new entry in either registry gates an endpoint. Confirm against paid-capability-allowlist.md before accepting.',
  },
];

function loadPatterns() {
  let manifest = {};
  try {
    manifest = yaml.load(readFileSync(manifestPath, 'utf8')) ?? {};
  } catch {
    // A missing/broken manifest should not silently disable the scan.
  }
  const raw = manifest.contamination_patterns ?? BUILTIN_PATTERNS;
  return raw.map((p) => ({
    ...p,
    severity: p.severity ?? 'critical',
    compiled: new RegExp(p.regex, 'i'),
    allow: (p.allow_paths ?? []).map(globToRegExp),
  }));
}

// Two classes of path are excluded from scanning outright:
//
//  - Self-referential: the scanner's own ruleset and the fork's audit docs
//    necessarily quote every banned string, so scanning them reports the rules
//    as a violation of themselves.
//  - Build output: a minified bundle is one 400KB line, so a single hit inside
//    it matches every pattern at once and tells you nothing about a source
//    change. `public/pro/` is regenerated by `npm run build:pro` from
//    `pro-test/`, which IS scanned — that's where a real fix would go anyway.
const SKIP_PATHS = [
  'scripts/fork-sync-scan.mjs',
  'scripts/fork-sync-lock.mjs',
  'scripts/fork-sync-check.mjs',
  'scripts/fork-sync-run.mjs',
  'docs/architecture/fork-sync-manifest.yaml',
  'docs/architecture/fork-divergence.lock.json',
  'docs/architecture/paid-capability-allowlist.md',
  'remove_pro.md',
  'public/pro/**',
  'package-lock.json',
  '**/*.min.js',
  '**/*.generated.json',
].map(globToRegExp);

function resolveRange() {
  const range = getArg('range');
  if (range) return range;
  const against = getArg('against');
  if (against) return `${against}..WORKTREE`;
  try {
    git(['rev-parse', '--verify', 'ORIG_HEAD']);
    return 'ORIG_HEAD..WORKTREE';
  } catch {
    const base = git(['merge-base', 'HEAD', 'upstream/main']).trim();
    return `${base}..WORKTREE`;
  }
}

// Returns [{path, line, lineNo}] for every line the range adds. `lineNo` is the
// post-image line number, so the output is clickable in an editor.
function collectAddedLines(range) {
  const [from, to] = range.split('..');
  const args = ['diff', '--no-color', '--no-renames', '-U0'];
  if (to === 'WORKTREE') args.push(from);
  else args.push(`${from}..${to}`);

  const diff = git(args);
  const added = [];
  let path = null;
  let lineNo = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      path = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -\S+ \+(\d+)/);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (!path || raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      added.push({ path, line: raw.slice(1), lineNo });
      lineNo += 1;
    }
  }
  return added;
}

function main() {
  const patterns = loadPatterns();
  const range = resolveRange();
  const showInfo = hasFlag('all');
  const asJson = hasFlag('json');

  let added;
  try {
    added = collectAddedLines(range);
  } catch (err) {
    console.error(`Could not diff ${range}: ${err.message}`);
    return 2;
  }

  const hits = [];
  for (const item of added) {
    if (SKIP_PATHS.some((re) => re.test(item.path))) continue;
    for (const p of patterns) {
      if (p.severity === 'info' && !showInfo) continue;
      if (!p.compiled.test(item.line)) continue;
      if (p.allow.some((re) => re.test(item.path))) continue;
      hits.push({ pattern: p.id, severity: p.severity, reason: p.reason, ...item });
    }
  }

  const critical = hits.filter((h) => h.severity === 'critical');

  if (asJson) {
    console.log(JSON.stringify({ range, ok: critical.length === 0, scanned_added_lines: added.length, hits }, null, 2));
    return critical.length === 0 ? 0 : 1;
  }

  console.log(`Contamination scan over ${range} — ${added.length} added line(s) across ${new Set(added.map((a) => a.path)).size} file(s).\n`);

  if (hits.length === 0) {
    console.log('✓ No gating, upsell, or founder-branding patterns introduced.');
    return 0;
  }

  const byPattern = new Map();
  for (const h of hits) {
    if (!byPattern.has(h.pattern)) byPattern.set(h.pattern, []);
    byPattern.get(h.pattern).push(h);
  }

  for (const sev of ['critical', 'warn', 'info']) {
    const ids = [...byPattern].filter(([, list]) => list[0].severity === sev);
    if (ids.length === 0) continue;
    const marker = sev === 'critical' ? '⚠ CRITICAL' : sev === 'warn' ? '· warn' : '· info';
    for (const [id, list] of ids) {
      console.log(`${marker}  ${id} — ${list.length} added line(s)`);
      console.log(`    ${list[0].reason}`);
      const byFile = new Map();
      for (const h of list) {
        if (!byFile.has(h.path)) byFile.set(h.path, []);
        byFile.get(h.path).push(h);
      }
      for (const [path, entries] of [...byFile].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) {
        console.log(`    ${path}`);
        for (const e of entries.slice(0, 5)) {
          const text = e.line.trim();
          console.log(`      :${e.lineNo}  ${text.length > 130 ? `${text.slice(0, 130)}…` : text}`);
        }
        if (entries.length > 5) console.log(`      … ${entries.length - 5} more in this file`);
      }
      if (byFile.size > 15) console.log(`    … ${byFile.size - 15} more file(s)`);
      console.log('');
    }
  }

  if (critical.length > 0) {
    console.log(`${critical.length} CRITICAL hit(s) — each must be removed or explicitly allowlisted in the manifest's contamination_patterns before this sync is done.`);
    return 1;
  }
  console.log('No critical hits. Review the warnings above against docs/architecture/paid-capability-allowlist.md.');
  return 0;
}

process.exit(main());
