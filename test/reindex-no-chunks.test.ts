/**
 * Guard for the "reindex reports success while writing ZERO chunks" bug
 * class (memory `infra_gbrain_reindex_silent_nochunk`). A page can import
 * with `status: 'imported'` yet produce zero chunks when a gate marker
 * (`embed_skip` / `quarantine`) survives the DB round-trip and re-suppresses
 * chunking on re-import. Pre-fix, `reindex` counted this under `reindexed`
 * (success) with no signal that the page is now unsearchable and
 * `chunker_version` never advanced.
 *
 * This test drives the DB-only re-chunk path (no `source_path` / `--repo`):
 * `runReindex` reconstructs full markdown via `serializeMarkdown` from the
 * stored `frontmatter` + `compiled_truth` and re-imports through
 * `importFromContent`, so a frontmatter marker written directly into the
 * `pages.frontmatter` column round-trips exactly as it would in production
 * (no chunker mocking required — `isEmbedSkipped` reads the real marker).
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { runReindex } from '../src/commands/reindex.ts';
import { MARKDOWN_CHUNKER_VERSION } from '../src/core/chunkers/recursive.ts';
import { _resetCliExitVerdictForTests, currentExitCode } from '../src/core/cli-force-exit.ts';

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});

afterAll(async () => {
  await engine.disconnect();
});

beforeEach(async () => {
  _resetCliExitVerdictForTests();
  await (engine as any).db.exec('DELETE FROM content_chunks');
  await (engine as any).db.exec('DELETE FROM pages');
});

async function seedLegacyPage(slug: string, body: string): Promise<void> {
  // chunker_version=1 forces the page into the pending set regardless of
  // MARKDOWN_CHUNKER_VERSION's current value.
  await engine.executeRaw(
    `INSERT INTO pages (source_id, slug, type, title, compiled_truth, page_kind, chunker_version)
     VALUES ('default', $1, 'note', $2, $3, 'markdown', 1)`,
    [slug, slug, body],
  );
}

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const stderrWrite = process.stderr.write.bind(process.stderr);
  let stderr = '';
  (process.stderr.write as unknown as (chunk: unknown) => boolean) = (chunk: unknown) => {
    stderr += String(chunk);
    return true;
  };
  try {
    const result = await fn();
    return { result, stderr };
  } finally {
    process.stderr.write = stderrWrite;
  }
}

describe('gbrain reindex --markdown: zero-chunk guard', () => {
  test('page with real content but a gate marker suppressing chunks is counted as no_chunks + failed, exit non-zero', async () => {
    await seedLegacyPage('gated-page', 'This page has substantial real body content that would normally chunk fine.');
    // Simulate the production bug: a prior content-sanity pass (or a remote
    // MCP put_page pre-#1699-fix) left an embed_skip marker in the stored
    // frontmatter. On re-import, importFromContent re-parses this marker
    // from the reconstructed markdown and suppresses chunking again
    // (isEmbedSkipped branch in src/core/import-file.ts), even though the
    // body itself is real, non-empty prose.
    await engine.executeRaw(
      `UPDATE pages SET frontmatter = '{"embed_skip": {"bytes": 1}}'::jsonb WHERE slug = 'gated-page'`,
    );

    const { result, stderr } = await captureStderr(() =>
      runReindex(engine, ['--markdown', '--no-embed']),
    );

    expect(result.noChunks).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.reindexed).toBe(0);
    expect(stderr).toContain('gated-page');
    expect(stderr).toContain('no_chunks');
    expect(currentExitCode()).toBe(1);

    const chunkRows = await engine.executeRaw<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count FROM content_chunks cc
         JOIN pages p ON p.id = cc.page_id WHERE p.slug = 'gated-page'`,
    );
    expect(Number(chunkRows[0]?.count)).toBe(0);
  });

  test('content-free stub page (frontmatter-only, empty body) is NOT counted as no_chunks', async () => {
    // "4,222 stranded" boilerplate stubs: frontmatter carries identity but
    // compiled_truth is empty by design. Zero chunks here is correct,
    // expected behavior, not a bug — must not be flagged.
    await seedLegacyPage('stub-page', '');

    const { result, stderr } = await captureStderr(() =>
      runReindex(engine, ['--markdown', '--no-embed']),
    );

    expect(result.noChunks).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.reindexed).toBe(1);
    expect(stderr).not.toContain('UNSEARCHABLE');

    const rows = await engine.executeRaw<{ chunker_version: number }>(
      `SELECT chunker_version FROM pages WHERE slug = 'stub-page'`,
    );
    expect(Number(rows[0]?.chunker_version)).toBe(MARKDOWN_CHUNKER_VERSION);
  });

  test('normal page with real content chunks successfully and is counted as reindexed/ok', async () => {
    await seedLegacyPage('normal-page', 'A perfectly ordinary page with real content that chunks normally.');

    const { result, stderr } = await captureStderr(() =>
      runReindex(engine, ['--markdown', '--no-embed']),
    );

    expect(result.noChunks).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.reindexed).toBe(1);
    expect(stderr).not.toContain('UNSEARCHABLE');
    expect(currentExitCode()).toBe(0);

    const rows = await engine.executeRaw<{ chunker_version: number }>(
      `SELECT chunker_version FROM pages WHERE slug = 'normal-page'`,
    );
    expect(Number(rows[0]?.chunker_version)).toBe(MARKDOWN_CHUNKER_VERSION);

    const chunkRows = await engine.executeRaw<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count FROM content_chunks cc
         JOIN pages p ON p.id = cc.page_id WHERE p.slug = 'normal-page'`,
    );
    expect(Number(chunkRows[0]?.count)).toBeGreaterThan(0);
  });

  test('--json output includes no_chunks field', async () => {
    await seedLegacyPage('gated-json', 'Real content that will be gated.');
    await engine.executeRaw(
      `UPDATE pages SET frontmatter = '{"embed_skip": {"bytes": 1}}'::jsonb WHERE slug = 'gated-json'`,
    );

    const stdoutWrite = process.stdout.write.bind(process.stdout);
    let stdout = '';
    (process.stdout.write as unknown as (chunk: unknown) => boolean) = (chunk: unknown) => {
      stdout += String(chunk);
      return true;
    };
    let json: any;
    try {
      await runReindex(engine, ['--markdown', '--no-embed', '--json']);
      json = JSON.parse(stdout.trim().split('\n').pop()!);
    } finally {
      process.stdout.write = stdoutWrite;
    }

    expect(json.no_chunks).toBe(1);
    expect(json.failed).toBe(1);
  });
});
