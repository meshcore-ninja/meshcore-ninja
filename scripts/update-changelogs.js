// Fetches release info for each firmware and software record and writes
// data/<firmwares|software>/<id>/changelog.yaml.
//
// Source resolution per record (firmware.yaml / software.yaml):
//   changelog.source: github | manual | script
//     - github (default when `repository` is a GitHub URL): releases pulled from
//       the GitHub API and the file is overwritten.
//     - manual: the file is hand-maintained; this script leaves it untouched.
//     - script: GitHub releases are fetched (for tags/dates/links) and then
//       passed to a per-record enrichment script that lives in the record's
//       data folder (changelog.script, default "fetch-changelog.js"). The script
//       default-exports `async ({ githubReleases, mapRelease, fetch }) => releases`.
//   changelog.repo: "owner/name" override (else parsed from `repository`).
//   changelog.script: record-local script filename used with source: script.
//
// Usage: node scripts/update-changelogs.js
// Honors GITHUB_TOKEN (raises the API rate limit in CI).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load, dump } from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_RELEASES = 20;
const MAX_NOTE_CHARS = 4000;

function parseRepo(fw) {
  if (fw.changelog?.repo) return fw.changelog.repo;
  const m = /github\.com\/([^/]+\/[^/#?]+)/.exec(fw.repository ?? '');
  return m ? m[1].replace(/\.git$/, '') : null;
}

function resolveSource(fw) {
  if (fw.changelog?.source) return fw.changelog.source;
  return parseRepo(fw) ? 'github' : null;
}

/** Fetch raw (unmapped) GitHub releases, drafts removed. */
async function fetchGithubRaw(repo) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'meshcore-ninja',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=${MAX_RELEASES}`, {
    headers
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}`);
  const data = await res.json();
  return data.filter((r) => !r.draft).slice(0, MAX_RELEASES);
}

/** Map one raw GitHub release to the stored changelog shape. */
function mapRelease(r) {
  const out = {
    version: r.tag_name,
    name: r.name || r.tag_name,
    datetime: r.published_at ?? r.created_at ?? undefined,
    url: r.html_url,
    prerelease: !!r.prerelease
  };
  const notes = (r.body ?? '').trim();
  if (notes) out.notes = notes.length > MAX_NOTE_CHARS ? notes.slice(0, MAX_NOTE_CHARS) + '\n…' : notes;
  return out;
}

async function buildReleases(record, kind, dir, source) {
  const repo = parseRepo(record);

  if (source === 'github') {
    if (!repo) throw new Error('github source but no repo could be resolved');
    return { repo, releases: (await fetchGithubRaw(repo)).map(mapRelease) };
  }

  if (source === 'script') {
    const scriptName = record.changelog?.script ?? 'fetch-changelog.js';
    const scriptPath = join(root, 'data', kind, dir, scriptName);
    if (!existsSync(scriptPath)) throw new Error(`missing changelog script ${scriptName}`);
    const githubReleases = repo ? await fetchGithubRaw(repo) : [];
    const mod = await import(pathToFileURL(scriptPath).href);
    const releases = await mod.default({ githubReleases, mapRelease, fetch, repo });
    return { repo, releases };
  }

  throw new Error(`unknown source "${source}"`);
}

/** Deterministic JSON with recursively sorted keys, for content comparison. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// Record collections that carry changelogs, by data folder + manifest filename.
const COLLECTIONS = [
  { kind: 'firmwares', file: 'firmware.yaml' },
  { kind: 'software', file: 'software.yaml' }
];

let changed = 0;
let unchanged = 0;
let failed = 0;

for (const { kind, file } of COLLECTIONS) {
  const base = join(root, 'data', kind);
  if (!existsSync(base)) continue;

  for (const d of readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const recPath = join(base, d.name, file);
    if (!existsSync(recPath)) continue;
    const record = load(readFileSync(recPath, 'utf8')) ?? {};
    const label = `${kind}/${d.name}`;

    const source = resolveSource(record);
    if (source === 'manual') {
      console.log(`· ${label}: manual changelog, skipping`);
      continue;
    }
    if (!source) {
      console.log(`· ${label}: no release source, skipping`);
      continue;
    }

    try {
      const { repo, releases } = await buildReleases(record, kind, d.name, source);
      const outPath = join(base, d.name, 'changelog.yaml');

      // Preserve the existing `updatedAt` when the actual content (source/repo/
      // releases) is unchanged, so a refresh that finds no new releases doesn't
      // churn the file with a fresh timestamp.
      const existing = existsSync(outPath) ? load(readFileSync(outPath, 'utf8')) ?? {} : null;
      const body = { source, repo: repo ?? undefined, releases };
      const isUnchanged =
        existing &&
        stableStringify({ source: existing.source, repo: existing.repo, releases: existing.releases }) ===
          stableStringify(body);

      const updatedAt = isUnchanged ? existing.updatedAt : new Date().toISOString();
      const out = { source, repo: repo ?? undefined, updatedAt, releases };
      const yaml = dump(out, { lineWidth: 100, noRefs: true });

      if (!existing || readFileSync(outPath, 'utf8') !== yaml) {
        writeFileSync(outPath, yaml);
      }

      if (isUnchanged) {
        console.log(`· ${label}: ${releases.length} release(s) via ${source} — unchanged`);
        unchanged++;
      } else {
        console.log(`✓ ${label}: ${releases.length} release(s) via ${source}${repo ? ` (${repo})` : ''}`);
        changed++;
      }
    } catch (err) {
      console.error(`✗ ${label}: ${err.message}`);
      failed++;
    }
  }
}

console.log(`\nDone — ${changed} changed, ${unchanged} unchanged, ${failed} failed.`);
if (failed > 0 && changed === 0 && unchanged === 0) process.exit(1);
