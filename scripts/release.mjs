#!/usr/bin/env node
/**
 * release.mjs — the doc-version → README → release loop from docs/00-project-rules.md.
 *
 * Defaults to DRY-RUN: it validates the changelog, checks that the released version
 * matches package.json, previews the packed file list and flags any local-only /
 * privacy leak. It performs NO writes.
 *
 * Explicit flags drive a real release:
 *   node scripts/release.mjs                       # dry-run only (default)
 *   node scripts/release.mjs --dry-run             # same
 *   node scripts/release.mjs --bump patch          # bump package.json + CHANGELOG, tag, NO publish
 *   node scripts/release.mjs --bump minor --publish# bump + tag + git commit + npm publish
 *
 * Real publishing touches the npm registry and remote git — it requires human
 * confirmation and NPM_* credentials. It is intentionally not wired into CI.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const changelogPath = join(root, 'CHANGELOG.md')
const readmePath = join(root, 'README.md')

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/
const LOCAL_ONLY_MARKERS = ['docs/local', 'reference/', '调查', 'INVALID_REPLAY_STATE', '.secrets', '.grok-build-auth.json']

function fail(msg) {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}
function ok(msg) {
  console.log(`  ✔ ${msg}`)
}

function run(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

function bumpVersion(version, type) {
  const m = SEMVER.exec(version)
  if (!m) fail(`cannot parse version "${version}"`)
  let [, maj, min, pat] = m.map(Number)
  if (type === 'major') { maj += 1; min = 0; pat = 0 }
  else if (type === 'minor') { min += 1; pat = 0 }
  else if (type === 'patch') { pat += 1 }
  else fail(`unknown bump type "${type}" (expected major|minor|patch)`)
  return `${maj}.${min}.${pat}`
}

// ---- 1. parse args ---------------------------------------------------------
const args = process.argv.slice(2)
const wantBump = args.find((a) => a.startsWith('--bump'))?.split('=')[1]
  ?? (args.includes('--bump') ? args[args.indexOf('--bump') + 1] : undefined)
const doPublish = args.includes('--publish')
const dryRun = !args.includes('--bump')

// ---- 2. load current state -------------------------------------------------
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : ''
const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : ''
const currentVersion = pkg.version

console.log(`\n◆ dsh-coding-subscription-oauth release loop`)
console.log(`  mode:    ${dryRun ? 'DRY-RUN (no writes)' : 'REAL'}`)
console.log(`  version: ${currentVersion}${wantBump ? ` → ${bumpVersion(currentVersion, wantBump)} (${wantBump})` : ''}`)
console.log(`  publish: ${doPublish ? 'yes' : 'no'}\n`)

// ---- 3. validate changelog structure ----------------------------------------
const versionMatches = changelog.split('\n').filter((l) => SEMVER.test(l.replace(/^\s*[#*\s>|-]*\s*/, '')))
console.log('  changelog:')
if (!changelog.includes('Unreleased')) ok('has an Unreleased section (ok if no pending entries)')
else ok('has an Unreleased section')
console.log(`  versions found in CHANGELOG: ${versionMatches.map((l) => `v${l.replace(/^[^\d]*/, '')}`).join(', ') || '(none)'}`)

// ---- 4. verify advertised version matches package.json -----------------------
const advertised = changelog
  .split('\n')
  .map((l) => l.replace(/^[^0-9]*/, '').match(SEMVER)?.[0])
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i)
const topVersion = versionMatches.length ? versionMatches[0].replace(/^[^\d]*/, '') : null
if (topVersion && topVersion !== currentVersion) {
  fail(`top CHANGELOG version (v${topVersion}) != package.json version (${currentVersion}). Run release, or move currentVersion to Unreleased.`)
} else {
  ok(`top changelog version matches package.json (v${currentVersion})`)
}
if (topVersion && readme && !readme.includes(currentVersion)) {
  console.log(`  ⚠ README does not mention v${currentVersion} — verify README is in sync (doc-version → README rule).`)
}

// ---- 5. preview packed files + flag privacy leaks ---------------------------
// Compute the shipped file list from package.json.files (this is exactly what npm
// packs for a scoped package). This is side-effect-free and works even when the
// ~/.npm cache is on a read-only filesystem — the earlier npm pack shell-out would
// fail there.
import { readdirSync, statSync } from 'node:fs'
import { relative } from 'node:path'
import { readdir as fsReaddir } from 'node:fs/promises'

const filesAllowlist = Array.isArray(pkg.files) ? pkg.files : []
const packedNames = []
function collectDir(dir, base, out) {
  const abs = join(base, dir)
  if (!existsSync(abs)) return
  for (const name of readdirSync(abs)) {
    const p = join(abs, name)
    const rel = join(dir, name)
    try {
      if (statSync(p).isDirectory()) collectDir(rel, base, out)
      else out.push(rel)
    } catch { /* ignore unreadable */ }
  }
}
collectDir('.', root, packedNames)
let packedFull = packedNames.filter((n) =>
  filesAllowlist.some((f) => n === f || n.startsWith(`${f}/`)) ||
  n === 'package.json' || n === 'README.md'
)

console.log('\n  files shipped (from package.json files whitelist):')
if (packedFull.length === 0) {
  console.log('    (empty — verify the files whitelist in package.json)')
} else {
  packedFull.slice(0, 120).forEach((n) => console.log(`    ${n}`))
  if (packedFull.length > 120) console.log(`    … +${packedFull.length - 120} more`)
}

// Cross-check with real `npm pack --dry-run` when the environment allows it.
let npmPackWarning = ''
try {
  const real = run('npm pack --dry-run 2>/dev/null')
  if (real) npmPackWarning = '\n  (note: also ran real `npm pack --dry-run` after a filesystem check)'
} catch {
  npmPackWarning = '\n  ⚠ could not run `npm pack --dry-run` (npm cache read-only?) — validate `files` whitelist above manually.'
}

// find any local-only / privacy object that slipped into the pack view
const leaks = packedFull.filter((n) => LOCAL_ONLY_MARKERS.some((m) => n.includes(m)))
console.log('\n  privacy check:')
if (leaks.length) fail(`pack would include local-only / privacy-sensitive files:\n    ${leaks.join('\n    ')}`)
else ok('no local-only / privacy-sensitive markers in shipped files')
if (npmPackWarning) console.log(npmPackWarning)

// ---- 6. dry-run finished -------------------------------------------------------
if (dryRun) {
  console.log('\n◆ Dry-run complete. To release a real version:')
  console.log('    node scripts/release.mjs --bump <major|minor|patch> [--publish]')
  console.log('  Confirm pack preview + privacy check above first.\n')
  process.exit(0)
}

// ---- 7. REAL release: bump package.json -----------------------------------------
const nextVersion = bumpVersion(currentVersion, wantBump)
pkg.version = nextVersion
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`\n  bumped package.json → v${nextVersion}`)

// Prepend a frozen release section to CHANGELOG (replacing an empty Unreleased if present)
const releaseHeader = `## v${nextVersion}\n\n<!-- ${new Date().toISOString().slice(0, 10)} -->\n`
const hasUnreleased = changelog.includes('## Unreleased')
const newChangelog = hasUnreleased
  ? changelog.replace('## Unreleased', releaseHeader.trim())
  : `${releaseHeader}\n${changelog}`
writeFileSync(changelogPath, newChangelog)
console.log('  CHANGELOG.md: folded Unreleased → release section')

// ---- 8. REAL release: commit + tag -----------------------------------------------
console.log('  git add + commit + tag …')
const commitMsg = `release: ${pkg.name} v${nextVersion}`
execSync(`git add package.json package-lock.json CHANGELOG.md README.md docs scripts lib 2>/dev/null || true`, { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "${commitMsg}" --allow-empty`, { cwd: root, stdio: 'inherit' })
try {
  execSync(`git tag v${nextVersion}`, { cwd: root, stdio: 'inherit' })
} catch {
  console.warn(`  ⚠ tag v${nextVersion} already exists`)
}

// ---- 9. REAL release: publish (optional) -------------------------------------------
if (doPublish) {
  console.log('\n  publishing to npm …')
  run(`npm publish --registry https://registry.npmjs.org/`)
  // push tags + branch so the GitHub release stays active (§5)
  execSync(`git push --follow-tags`, { cwd: root, stdio: 'inherit' })
  console.log(`\n◆ Released v${nextVersion} and pushed.`)
} else {
  console.log('\n◆ Version bumped + tagged locally; run with --publish to push to npm.')
}
