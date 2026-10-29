import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';
import type { DigestRow } from '../src/digest/types.js';

// runs/ is read-only: anything this file writes goes in its own temp dir.
const scratch = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function nightWith(night: string, lines: string[]): string {
  writeFileSync(join(scratch, `${night}.jsonl`), lines.join('\n') + '\n', 'utf8');
  return scratch;
}

function rowFor(rows: DigestRow[], job: string): DigestRow {
  const row = rows.find((r) => r.job === job);
  if (row === undefined) throw new Error(`no row for ${job}`);
  return row;
}

describe('readNight on the real night', () => {
  const read = readNight('runs', '2026-10-28');

  it('reads 5 jobs and counts the one bad line', () => {
    expect(read).not.toBeNull();
    expect(read?.night).toBe('2026-10-28');
    expect(read?.rows).toHaveLength(5);
    expect(read?.badLines).toBe(1);
  });

  it('folds the retried job into runs, retries, last status and last error', () => {
    const row = rowFor(read?.rows ?? [], 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps the failed job and its error', () => {
    const row = rowFor(read?.rows ?? [], 'notes/backup');
    expect(row.lastStatus).toBe('fail');
    expect(row.lastError).toBe('quota exceeded');
    expect(row.runs).toBe(1);
    expect(row.retries).toBe(0);
  });

  it('keeps the row whose owner is null', () => {
    const row = rowFor(read?.rows ?? [], 'digest/render');
    expect(row.owner).toBeNull();
  });

  it('keeps the offset from the log, never converting to UTC', () => {
    for (const row of read?.rows ?? []) {
      expect(row.firstAt).toMatch(/\+01:00$/);
      expect(row.lastAt).toMatch(/\+01:00$/);
    }
  });

  it('returns rows sorted by job', () => {
    const jobs = (read?.rows ?? []).map((r) => r.job);
    expect(jobs).toEqual([...jobs].sort());
  });

  it('leaves lastError null for a job that never errored', () => {
    expect(rowFor(read?.rows ?? [], 'rig/rotate-logs').lastError).toBeNull();
  });
});

describe('readNight edges', () => {
  it('returns null when the night has no file', () => {
    expect(readNight(scratch, '1999-01-01')).toBeNull();
  });

  it('reads an empty file as a night with no rows', () => {
    const dir = nightWith('2026-01-01', []);
    expect(readNight(dir, '2026-01-01')).toEqual({ night: '2026-01-01', rows: [], badLines: 0 });
  });

  it('counts every unparseable line instead of throwing', () => {
    const dir = nightWith('2026-01-02', [
      'not json at all',
      '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"ok","owner":"rook"}',
      '{"at":"2026-01-02T02:00:00+01:00","job":"a","status":"nope","owner":"rook"}',
      '[1,2,3]',
      '{"at":"2026-01-02T03:00:00+01:00","job":"a"}',
      '"a string"',
    ]);
    const read = readNight(dir, '2026-01-02');
    expect(read?.badLines).toBe(5);
    expect(read?.rows).toHaveLength(1);
    expect(rowFor(read?.rows ?? [], 'a').runs).toBe(1);
  });

  it('ignores blank lines', () => {
    const dir = nightWith('2026-01-03', [
      '',
      '   ',
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":null}',
      '',
    ]);
    const read = readNight(dir, '2026-01-03');
    expect(read?.badLines).toBe(0);
    expect(read?.rows).toHaveLength(1);
  });

  it('orders by the instant, not the string, across offsets', () => {
    const dir = nightWith('2026-01-04', [
      '{"at":"2026-01-04T09:00:00+09:00","job":"a","status":"retry","owner":"rook","error":"early"}',
      '{"at":"2026-01-04T01:30:00+01:00","job":"a","status":"fail","owner":"rook","error":"late"}',
    ]);
    const row = rowFor(readNight(dir, '2026-01-04')?.rows ?? [], 'a');
    // 09:00+09:00 is 00:00 UTC, 01:30+01:00 is 00:30 UTC: the second line is the later one.
    expect(row.firstAt).toBe('2026-01-04T09:00:00+09:00');
    expect(row.lastAt).toBe('2026-01-04T01:30:00+01:00');
    expect(row.lastStatus).toBe('fail');
    expect(row.lastError).toBe('late');
  });

  it('folds lines that arrive out of order', () => {
    const dir = nightWith('2026-01-05', [
      '{"at":"2026-01-05T03:00:00+01:00","job":"a","status":"ok","owner":"rook"}',
      '{"at":"2026-01-05T01:00:00+01:00","job":"a","status":"retry","owner":"rook","error":"first try"}',
    ]);
    const row = rowFor(readNight(dir, '2026-01-05')?.rows ?? [], 'a');
    expect(row.firstAt).toBe('2026-01-05T01:00:00+01:00');
    expect(row.lastAt).toBe('2026-01-05T03:00:00+01:00');
    expect(row.lastStatus).toBe('ok');
    expect(row.lastError).toBe('first try');
  });

  it('keeps an owner named on an earlier line of the same job', () => {
    const dir = nightWith('2026-01-06', [
      '{"at":"2026-01-06T01:00:00+01:00","job":"a","status":"retry","owner":"rook","error":"x"}',
      '{"at":"2026-01-06T02:00:00+01:00","job":"a","status":"ok","owner":null}',
    ]);
    expect(rowFor(readNight(dir, '2026-01-06')?.rows ?? [], 'a').owner).toBe('rook');
  });
});
